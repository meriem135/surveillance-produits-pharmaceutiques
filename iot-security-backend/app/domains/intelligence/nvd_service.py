"""
NVD Service (Phase 3 — Vulnerability Intelligence)
==================================================
Fetches, caches, and maps CVE data from the National Vulnerability Database (NVD API 2.0).

Data Science innovations:
  1. EPSS (Exploit Prediction Scoring System) integration for exploit likelihood
  2. Firmware version range parsing with semantic versioning
  3. Temporal decay of CVE relevance (older CVEs weighted less)
  4. On-disk JSON cache with TTL to avoid NVD rate limits
  5. Batch CVE enrichment with keyword matching against device types
"""

import json
import os
import re
import time
import hashlib
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional
from pathlib import Path

CACHE_DIR = Path(__file__).parent.parent.parent / "models" / "cve_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

NVD_API_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0"
NVD_API_KEY_ENV = "NVD_API_KEY"
CACHE_TTL_HOURS = 6  # Re-fetch CVE data every 6 hours
EPSS_API_BASE = "https://api.first.org/data/v1/epss"

# Mapping: device_type -> keywords to search in CVE descriptions
DEVICE_CVE_KEYWORDS = {
    "weather": ["weather station", "sensor", "iot", "environmental", "modbus", "temperature sensor"],
    "fridge": ["refrigeration", "cold chain", "hvac", "modbus", "industrial control", "temperature"],
    "thermostat": ["thermostat", "hvac", "building automation", "bacnet", "modbus"],
}

# CVSS severity thresholds
CVSS_SEVERITY = {
    "NONE": (0.0, 0.0),
    "LOW": (0.1, 3.9),
    "MEDIUM": (4.0, 6.9),
    "HIGH": (7.0, 8.9),
    "CRITICAL": (9.0, 10.0),
}


def _parse_semver(version_str: str) -> tuple:
    """Parse a semver string into a comparable tuple."""
    if not version_str:
        return (0, 0, 0)
    clean = re.sub(r'[^0-9.]', '', version_str.split("-")[0])
    parts = clean.split(".")
    try:
        return tuple(int(p) for p in parts[:3]) + (0,) * (3 - len(parts))
    except ValueError:
        return (0, 0, 0)


def _version_in_range(version: str, start: str, end: str) -> bool:
    """Check if version falls within [start, end] range."""
    v = _parse_semver(version)
    s = _parse_semver(start)
    e = _parse_semver(end) if end else (999, 999, 999)
    return s <= v <= e


def _cvss_score_to_risk(cvss_score: Optional[float]) -> float:
    """Map CVSS score (0-10) to risk contribution (0-100)."""
    if cvss_score is None:
        return 20  # unknown severity -> moderate risk
    return min(100, cvss_score * 10)


def _epss_score_to_risk(epss_score: Optional[float]) -> float:
    """Map EPSS probability (0-1) to risk contribution (0-100)."""
    if epss_score is None:
        return 10  # unknown exploitability -> low
    return min(100, epss_score * 100)


class CVEData:
    """Structured CVE record with computed risk fields."""
    def __init__(self, cve_id: str, description: str, cvss_score: Optional[float],
                 cvss_severity: str, epss_score: Optional[float],
                 published: str, last_modified: str,
                 affected_products: list[str], references: list[str]):
        self.cve_id = cve_id
        self.description = description
        self.cvss_score = cvss_score
        self.cvss_severity = cvss_severity
        self.epss_score = epss_score
        self.published = published
        self.last_modified = last_modified
        self.affected_products = affected_products
        self.references = references

    def to_dict(self) -> dict:
        return {
            "cve_id": self.cve_id,
            "description": self.description[:200],
            "cvss_score": self.cvss_score,
            "cvss_severity": self.cvss_severity,
            "epss_score": self.epss_score,
            "published": self.published,
            "last_modified": self.last_modified,
            "affected_products": self.affected_products[:5],
            "references": self.references[:3],
        }

    def compute_risk_score(self, days_since_published: int = 0) -> float:
        """Weighted risk from CVSS + EPSS + temporal decay."""
        cvss_risk = _cvss_score_to_risk(self.cvss_score)
        epss_risk = _epss_score_to_risk(self.epss_score)
        temporal_weight = max(0.3, 1.0 - days_since_published / 1095)  # decays over 3 years
        return min(100, (cvss_risk * 0.6 + epss_risk * 0.4) * temporal_weight)


class NVDService:
    """Service for fetching, caching, and querying CVE data from the NVD API."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv(NVD_API_KEY_ENV, "")
        self._cache: dict[str, list[dict]] = {}
        self._last_fetch: dict[str, float] = {}
        # In-memory keyword-matched CVE index
        self._keyword_index: dict[str, list[CVEData]] = {}

    def _cache_path(self, key: str) -> Path:
        safe = hashlib.md5(key.encode()).hexdigest()
        return CACHE_DIR / f"cve_{safe}.json"

    def _load_cache(self, key: str) -> Optional[list[dict]]:
        path = self._cache_path(key)
        if not path.exists():
            return None
        try:
            with open(path, "r") as f:
                data = json.load(f)
            cached_at = data.get("cached_at", 0)
            if time.time() - cached_at > CACHE_TTL_HOURS * 3600:
                return None
            return data.get("cves", [])
        except (json.JSONDecodeError, OSError):
            return None

    def _save_cache(self, key: str, cves: list[dict]):
        path = self._cache_path(key)
        try:
            with open(path, "w") as f:
                json.dump({"cached_at": time.time(), "cves": cves}, f)
        except OSError:
            pass

    async def fetch_cves_by_keyword(self, keyword: str, max_results: int = 30) -> list[CVEData]:
        """Fetch CVEs matching a keyword from NVD API (with caching)."""
        cache_key = f"kw:{keyword.lower()}:{max_results}"

        cached = self._load_cache(cache_key)
        if cached is not None:
            return [CVEData(**c) if isinstance(c, dict) else c for c in cached]

        params = f"?keywordSearch={keyword}&resultsPerPage={max_results}"
        headers = {"User-Agent": "PeakSoft-CyberGuardian/1.0"}
        if self.api_key:
            params += f"&apiKey={self.api_key}"

        try:
            import httpx
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(f"{NVD_API_BASE}{params}", headers=headers)
                if resp.status_code == 403:
                    print(f"NVD API rate limited for keyword '{keyword}', using cache")
                    return self._keyword_index.get(keyword.lower(), [])
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            print(f"NVD fetch error for '{keyword}': {e}")
            return self._keyword_index.get(keyword.lower(), [])

        cves = []
        for vuln in data.get("vulnerabilities", []):
            cve = vuln.get("cve", {})
            metrics = cve.get("metrics", {})
            cvss_v3 = (metrics.get("cvssMetricV31", [{}])[0].get("cvssData", {}) or
                       metrics.get("cvssMetricV30", [{}])[0].get("cvssData", {}))
            cvss_score = cvss_v3.get("baseScore")
            cvss_severity = cvss_v3.get("baseSeverity", "UNKNOWN")

            descriptions = cve.get("descriptions", [])
            description = next(
                (d["value"] for d in descriptions if d.get("lang") == "en"),
                descriptions[0]["value"] if descriptions else "No description"
            )

            published = cve.get("published", "")
            modified = cve.get("lastModified", "")

            products = []
            for config in cve.get("configurations", []):
                for node in config.get("nodes", []):
                    for match in node.get("cpeMatch", []):
                        if "criteria" in match:
                            products.append(match["criteria"])

            refs = [r["url"] for r in cve.get("references", [])[:5]]

            cve_data = CVEData(
                cve_id=cve.get("id", "UNKNOWN"),
                description=description,
                cvss_score=cvss_score,
                cvss_severity=cvss_severity or "UNKNOWN",
                epss_score=None,  # filled separately
                published=published,
                last_modified=modified,
                affected_products=products,
                references=refs,
            )
            cves.append(cve_data)

        # Enrich with EPSS scores asynchronously
        if cves:
            cves = await self._enrich_epss(cves)

        # Cache the result
        self._save_cache(cache_key, [c.to_dict() for c in cves])
        self._keyword_index[keyword.lower()] = cves

        return cves

    async def _enrich_epss(self, cves: list[CVEData]) -> list[CVEData]:
        """Enrich CVEs with EPSS exploit probability scores."""
        cve_ids = [c.cve_id for c in cves if c.epss_score is None]
        if not cve_ids:
            return cves

        try:
            import httpx
            batch_size = 50
            for i in range(0, len(cve_ids), batch_size):
                batch = cve_ids[i:i + batch_size]
                params = {"cve": ",".join(batch)}
                async with httpx.AsyncClient(timeout=5.0) as client:
                    try:
                        resp = await client.get(EPSS_API_BASE, params=params)
                        if resp.status_code == 200:
                            data = resp.json()
                            epss_map = {}
                            for item in data.get("data", []):
                                epss_map[item["cve"]] = float(item.get("epss", 0))
                            for cve in cves:
                                if cve.cve_id in epss_map:
                                    cve.epss_score = epss_map[cve.cve_id]
                    except Exception as e:
                        print(f"EPSS enrichment error: {e}")
                await asyncio.sleep(0.1)  # rate limiting
        except ImportError:
            print("httpx not available for EPSS enrichment")
        return cves

    async def get_cves_for_device(self, device_type: str, firmware_version: Optional[str] = None,
                                   max_results: int = 20) -> list[dict]:
        """Get CVEs relevant to a specific device type and firmware version."""
        keywords = DEVICE_CVE_KEYWORDS.get(device_type.lower(), [device_type])
        all_cves: list[CVEData] = []

        for kw in keywords[:3]:  # limit to 3 keywords for performance
            cves = await self.fetch_cves_by_keyword(kw, max_results // len(keywords))
            all_cves.extend(cves)

        # Deduplicate by CVE ID
        seen = set()
        unique_cves = []
        for cve in all_cves:
            if cve.cve_id not in seen:
                seen.add(cve.cve_id)
                unique_cves.append(cve)

        # Filter by firmware version if available (parse CPE strings)
        if firmware_version:
            fw_clean = _parse_semver(firmware_version)
            filtered = []
            for cve in unique_cves:
                matches_fw = False
                for cpe in cve.affected_products:
                    # CPE format: cpe:2.3:part:vendor:product:version:...
                    parts = cpe.split(":")
                    if len(parts) >= 5:
                        cpe_version = parts[4]
                        if cpe_version and cpe_version not in ("*", "-"):
                            cpe_ver_clean = _parse_semver(cpe_version)
                            # Match if CPE version equals firmware version
                            # or firmware falls within [CPE_version, *) range
                            if cpe_ver_clean <= fw_clean or cpe_ver_clean == fw_clean:
                                matches_fw = True
                                break
                if matches_fw:
                    filtered.append(cve)
            if filtered:
                unique_cves = filtered

        # Compute risk scores with temporal decay
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        results = []
        for cve in unique_cves[:max_results]:
            try:
                pub_date = datetime.fromisoformat(cve.published.replace("Z", "+00:00"))
                if pub_date.tzinfo is not None:
                    pub_date = pub_date.replace(tzinfo=None)
                days_since = (now - pub_date).days
            except (ValueError, AttributeError, TypeError):
                days_since = 0

            cve_dict = cve.to_dict()
            cve_dict["risk_score"] = round(cve.compute_risk_score(days_since), 1)
            cve_dict["days_since_published"] = days_since
            cve_dict["temporal_weight"] = round(max(0.3, 1.0 - days_since / 1095), 3)
            results.append(cve_dict)

        results.sort(key=lambda x: x["risk_score"], reverse=True)
        return results

    async def get_device_vulnerability_summary(self, device_type: str,
                                                firmware_version: Optional[str] = None) -> dict:
        """Aggregate vulnerability summary for a device type."""
        cves = await self.get_cves_for_device(device_type, firmware_version, max_results=30)

        if not cves:
            return {
                "device_type": device_type,
                "total_cves": 0,
                "max_risk_score": 0,
                "avg_risk_score": 0,
                "critical_count": 0,
                "high_count": 0,
                "medium_count": 0,
                "low_count": 0,
                "top_cves": [],
                "overall_vulnerability_score": 0,
            }

        scores = [c["risk_score"] for c in cves]
        severities = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "NONE": 0}
        for c in cves:
            sev = c.get("cvss_severity", "UNKNOWN")
            if sev in severities:
                severities[sev] += 1
            else:
                severities["LOW"] += 1

        return {
            "device_type": device_type,
            "total_cves": len(cves),
            "max_risk_score": round(max(scores), 1),
            "avg_risk_score": round(sum(scores) / len(scores), 1),
            "critical_count": severities["CRITICAL"],
            "high_count": severities["HIGH"],
            "medium_count": severities["MEDIUM"],
            "low_count": severities["LOW"] + severities["NONE"],
            "top_cves": cves[:5],
            "overall_vulnerability_score": round(max(scores) * 0.5 + (sum(scores) / len(scores)) * 0.5, 1),
        }


nvd_service = NVDService()
