"""
API endpoint for DPI alerts — exposes mqtt_dpi_alerts.log to the dashboard.
"""

import json
import os
from typing import List, Optional

from fastapi import APIRouter, Query

router = APIRouter()

WAZUH_LOG_PATH = os.getenv(
    "WAZUH_DPI_LOG_PATH",
    "/var/ossec/logs/mqtt_dpi_alerts.log",
)

# Fallback for Windows dev environment
LOCAL_LOG_PATH = "mqtt_dpi_alerts.log"


def _read_alerts() -> List[dict]:
    """Read all DPI alerts from the log file (Wazuh or local fallback)."""
    for path in (WAZUH_LOG_PATH, LOCAL_LOG_PATH):
        if os.path.exists(path):
            alerts = []
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        alerts.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
            return alerts
    return []


@router.get("/alerts")
def get_alerts(
    limit: int = Query(default=100, ge=1, le=1000, description="Max number of alerts to return"),
    rule_id: Optional[str] = Query(default=None, description="Filter by rule ID (e.g. DPI-001)"),
    min_level: Optional[int] = Query(default=None, ge=1, le=15, description="Minimum severity level"),
    device: Optional[str] = Query(default=None, description="Filter by device type"),
):
    """
    Return DPI alerts from the Wazuh-compatible log file.
    Results are sorted newest-first and capped at `limit`.
    """
    alerts = _read_alerts()

    # Apply filters
    if rule_id:
        alerts = [a for a in alerts if a.get("rule", {}).get("id") == rule_id]
    if min_level is not None:
        alerts = [a for a in alerts if a.get("rule", {}).get("level", 0) >= min_level]
    if device:
        alerts = [a for a in alerts if a.get("data", {}).get("device", "").lower() == device.lower()]

    # Sort newest-first (ISO timestamp string sort works correctly)
    alerts.sort(key=lambda a: a.get("timestamp", ""), reverse=True)

    return alerts[:limit]


@router.get("/alerts/summary")
def get_alerts_summary():
    """
    Return aggregated statistics about DPI alerts:
    - total count
    - breakdown by rule_id
    - breakdown by severity level
    - breakdown by device type
    - count of critical alerts (level >= 10)
    """
    alerts = _read_alerts()

    by_rule: dict[str, int] = {}
    by_level: dict[str, int] = {}
    by_device: dict[str, int] = {}
    critical = 0

    for alert in alerts:
        rule = alert.get("rule", {})
        rule_id = rule.get("id", "unknown")
        level = rule.get("level", 0)
        device = alert.get("data", {}).get("device", "unknown")

        by_rule[rule_id] = by_rule.get(rule_id, 0) + 1
        level_key = str(level)
        by_level[level_key] = by_level.get(level_key, 0) + 1
        by_device[device] = by_device.get(device, 0) + 1

        if level >= 10:
            critical += 1

    return {
        "total": len(alerts),
        "critical": critical,
        "by_rule": by_rule,
        "by_level": by_level,
        "by_device": by_device,
    }
