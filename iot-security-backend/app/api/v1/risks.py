from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime, timezone
from app.api.deps import get_device_service
from app.domains.devices.service import DeviceService
from app.domains.intelligence.risk_service import risk_engine
from app.domains.intelligence.nvd_service import nvd_service
from pydantic import BaseModel, Field

router = APIRouter()


class RiskWeightsUpdate(BaseModel):
    ml_anomaly: Optional[float] = None
    cve: Optional[float] = None
    dpi_alert: Optional[float] = None
    criticality: Optional[float] = None
    velocity: Optional[float] = None
    temporal: Optional[float] = None


@router.get("/risks/summary")
async def get_risk_summary(service: DeviceService = Depends(get_device_service)):
    """Resume global des risques de tous les devices."""
    from app.domains.intelligence.risk_service import DEVICE_CRITICALITY

    devices = await service.get_all_with_risk()
    if not devices:
        return {"total_devices": 0, "average_risk": 0, "risk_distribution": {}, "critical_devices": []}

    risks = []
    critical_devices = []
    for d in devices:
        risk = await risk_engine.compute_risk(
            device_id=d.id,
            device_type=d.device_type,
            firmware_version=d.firmware_version,
            location=d.location,
        )
        risk_dict = risk.to_dict()
        risk_dict["device_id"] = d.id
        risk_dict["device_name"] = d.name
        risk_dict["device_type"] = d.device_type
        risks.append(risk_dict)
        if risk.score >= 80:
            critical_devices.append(risk_dict)

    distribution = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "NONE": 0}
    for r in risks:
        sev = r["severity"]
        if sev in distribution:
            distribution[sev] += 1

    avg_risk = sum(r["risk_score"] for r in risks) / max(len(risks), 1)

    return {
        "total_devices": len(risks),
        "average_risk": round(avg_risk, 1),
        "risk_distribution": distribution,
        "critical_devices": critical_devices[:10],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.put("/risks/weights")
async def update_risk_weights(weights: RiskWeightsUpdate):
    """Met a jour les poids des facteurs de risque (ajustement expert)."""
    update_dict = {k: v for k, v in weights.model_dump().items() if v is not None}
    if update_dict:
        risk_engine.update_weights(update_dict)
    return {
        "message": "Poids mis a jour",
        "current_weights": risk_engine.weights,
    }


@router.get("/risks/weights")
async def get_risk_weights():
    """Retourne les poids actuels des facteurs de risque."""
    return {"weights": risk_engine.weights}


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
    dpi_alerts: int = Query(0, description="Nombre d'alertes DPI recentes"),
    dpi_severity: int = Query(0, description="Severite max des alertes DPI"),
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
        dpi_alerts_count=dpi_alerts,
        dpi_max_severity=dpi_severity,
    )

    return risk.to_dict()


@router.get("/risks/{device_id}/history")
async def get_device_risk_history(
    device_id: str,
    n: int = Query(20, description="Nombre de points historiques"),
    service: DeviceService = Depends(get_device_service)
):
    """Historique des risk scores pour un device."""
    device = await service.get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return risk_engine.get_risk_history(device_id, n)


@router.post("/risks/{device_id}/what-if")
async def what_if_analysis(
    device_id: str,
    service: DeviceService = Depends(get_device_service)
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


@router.get("/risks/{device_id}/decompose")
async def get_risk_decomposition(
    device_id: str,
    service: DeviceService = Depends(get_device_service)
):
    """Decompose la tendance du risque (trend, volatilite, bruit)."""
    device = await service.get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return risk_engine.decompose_trend(device_id)


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
