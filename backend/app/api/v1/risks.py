from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from app.api.deps import get_device_service
from app.domains.devices.service import DeviceService
from app.domains.intelligence.risk_service import risk_engine
from app.domains.intelligence.nvd_service import nvd_service
from app.domains.auth.service import require_any_role

router = APIRouter()


@router.get("/cves/{device_type}")
async def get_device_cves(
    device_type: str,
    firmware: Optional[str] = Query(None, description="Version du firmware"),
):
    """Recupere les CVE pertinentes pour un type de device."""
    cves = await nvd_service.get_cves_for_device(device_type, firmware, max_results=20)
    summary = await nvd_service.get_device_vulnerability_summary(device_type, firmware)
    return {
        "device_type": device_type,
        "firmware_version": firmware,
        "summary": summary,
        "cves": cves,
    }


@router.post("/risks/correlation")
async def get_risk_correlation(payload: dict):
    """Correlation de risque entre plusieurs devices."""
    device_ids = payload.get("device_ids", [])
    if len(device_ids) < 2:
        raise HTTPException(status_code=400, detail="Au moins 2 devices requis")

    return {
        "correlations": risk_engine.compute_correlation(device_ids),
        "interpretation": (
            "Correlation elevee = facteur de risque partage (attaque coordonnee ou environnement)"
            if any(c["risk_correlation"] > 0.7 for c in risk_engine.compute_correlation(device_ids))
            else "Risques independants entre devices"
        ),
    }


@router.get("/risks/{device_id}")
async def get_device_risk(
    device_id: str,
    service: DeviceService = Depends(get_device_service)
):
    """Calcule le risk score predictif pour un device (Phase 3)."""
    device = await service.get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    risk = await risk_engine.compute_risk(
        device_id=device.id,
        device_type=device.device_type,
        firmware_version=device.firmware_version,
        location=device.location,
        ml_telemetry=device.digital_twin_state,
    )

    return risk.to_dict()


@router.get("/risks/{device_id}/history")
async def get_device_risk_history(
    device_id: str,
    n: int = Query(20, description="Nombre de points historiques"),
    start_date: Optional[str] = Query(None, description="Date de debut (ISO-8601, ex: 2025-08-05)"),
    end_date: Optional[str] = Query(None, description="Date de fin (ISO-8601, ex: 2025-08-05T23:59:59Z)"),
    service: DeviceService = Depends(get_device_service)
):
    """Historique des risk scores pour un device (filtrable par date)."""
    device = await service.get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return risk_engine.get_risk_history(device_id, n, start_date, end_date)


@router.post("/risks/{device_id}/what-if")
async def what_if_analysis(
    device_id: str,
    service: DeviceService = Depends(get_device_service),
    _user=Depends(require_any_role("operator")),
):
    """Analyse What-If: impact des actions correctives sur le risque."""
    device = await service.get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    scenarios = await risk_engine.what_if_analysis(
        device_id=device.id,
        device_type=device.device_type,
        firmware_version=device.firmware_version,
        location=device.location,
        current_risk=device.risk_score,
    )

    return {
        "device_id": device_id,
        "device_name": device.name,
        "current_risk": device.risk_score,
        "scenarios": scenarios,
    }


@router.get("/risks/{device_id}/anomaly")
async def get_risk_anomaly(
    device_id: str,
    threshold: float = Query(2.0, description="Seuil Z-score pour l'anomalie"),
    service: DeviceService = Depends(get_device_service)
):
    """Detecte les anomalies de risque (risk-on-risk)."""
    device = await service.get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return risk_engine.detect_risk_anomaly(device_id, z_threshold=threshold)


@router.get("/risks/{device_id}/forecast")
async def get_risk_forecast(
    device_id: str,
    steps: int = Query(12, description="Nombre de pas de prediction"),
    service: DeviceService = Depends(get_device_service)
):
    """Prediction du risque futur avec intervalles de confiance."""
    device = await service.get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return {
        "device_id": device_id,
        "forecasts": risk_engine.forecast_risk(device_id, steps),
    }
