"""
Show Phase 2 + Phase 3 data: devices, risk scores, CVE summary.
"""
import asyncio, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import text
from app.db.session import AsyncSessionLocal, init_db
from app.domains.intelligence.risk_service import risk_engine
from app.domains.intelligence.nvd_service import nvd_service


async def show():
    await init_db()
    async with AsyncSessionLocal() as s:
        rows = await s.execute(
            text("SELECT id, name, device_type, firmware_version, risk_score FROM devices ORDER BY device_type")
        )
        print("=" * 100)
        print(f"{'ID':25s} | {'Name':30s} | {'Type':12s} | {'Firmware':12s} | {'Risk':>5s}")
        print("-" * 100)
        for r in rows:
            print(f"{r[0]:25s} | {r[1]:30s} | {r[2]:12s} | {r[3] or '-':12s} | {r[4]:5d}")
        print("=" * 100)

    # --- Risk score for each of the 3 sensors ---
    print("\n>>> RISK SCORES (Phase 3) <<<")
    print("-" * 80)
    for dev_id, dev_type, fw, loc in [
        ("dev-weather-01", "weather", "v1.3.2", "Paris-Factory-01"),
        ("dev-fridge-01", "fridge", "v2.0.1", "Paris-Factory-01"),
        ("dev-thermostat-01", "thermostat", "v3.1.0", "Paris-Factory-01"),
    ]:
        risk = await risk_engine.compute_risk(
            device_id=dev_id,
            device_type=dev_type,
            firmware_version=fw,
            location=loc,
            dpi_alerts_count=3,
            dpi_max_severity=2,
        )
        d = risk.to_dict()
        sev = d["severity"]
        print(f"\n  {dev_type:12s} ({fw:8s}) : Score {int(d['risk_score']):3d}/100 [{sev}]")
        print(f"  {'-'*50}")
        for decomp in d["decomposition"]:
            print(f"    {decomp['factor']:20s} : raw={decomp['raw_value']:6.2f} -> {decomp['contribution']:5.1f} pts (weight {decomp['weight']})")
        print(f"  {'-'*50}")
        print(f"    {'TOTAL':20s} : {int(d['risk_score']):3d}/100  (CI: {d['confidence_interval']})")

    # --- CVE summary ---
    print("\n>>> CVE VULNERABILITY SUMMARY <<<")
    print("-" * 80)
    for dev_type, fw in [("weather", "v1.3.2"), ("fridge", "v2.0.1"), ("thermostat", "v3.1.0")]:
        try:
            summary = await nvd_service.get_device_vulnerability_summary(dev_type, fw)
            print(f"\n  {dev_type:12s} (fw: {fw:8s}) :")
            print(f"    Total CVEs: {summary['total_cves']}")
            print(f"    Overall vuln score: {summary['overall_vulnerability_score']:.1f}/100")
            print(f"    Critical: {summary['critical_count']}, High: {summary['high_count']}, Medium: {summary['medium_count']}")
            if summary.get("top_cves"):
                top = summary["top_cves"][0]
                print(f"    Top CVE: {top['cve_id']} (score: {top['risk_score']}) - {top['description'][:80]}...")
        except Exception as e:
            print(f"\n  {dev_type:12s} (fw: {fw:8s}) : NVD API indisponible -> pas de CVE pour ce run")
            print(f"    (c'est normal, l'API NVD publique est souvent rate-limitée sans clé)")

    # --- What-If example ---
    print("\n>>> WHAT-IF ANALYSIS (Fridge) <<<")
    print("-" * 80)
    scenarios = await risk_engine.what_if_analysis(
        device_id="dev-fridge-01",
        device_type="fridge",
        firmware_version="v2.0.1",
        location="Paris-Factory-01",
        current_risk=85,
    )
    for s in scenarios:
        print(f"  Scenario: {s['scenario']}")
        print(f"    {s['description']}")
        print(f"    Risque actuel: {s['current_risk']} -> predit: {s['predicted_risk']} (reduction: {s['risk_reduction']})")
        print()

    print("Done!")


if __name__ == "__main__":
    asyncio.run(show())
