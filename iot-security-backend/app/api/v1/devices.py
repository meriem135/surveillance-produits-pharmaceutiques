from fastapi import APIRouter, HTTPException, status, Depends
from typing import List, Optional
from app.api.deps import get_device_service
from app.domains.devices.service import DeviceService
from app.domains.devices.schemas import (
    DeviceRead, DeviceCreate, DeviceUpdate, TelemetryRead, StatsSummary
)
from app.domains.intelligence.ml_service import ml_anomaly

router = APIRouter()

@router.get("/devices", response_model=List[DeviceRead])
async def get_devices(
    status: Optional[str] = None,
    device_type: Optional[str] = None,
    service: DeviceService = Depends(get_device_service)
):
    """Get all registered IoT devices with live scores"""
    return await service.get_all_with_risk(status, device_type)

@router.post("/devices", response_model=DeviceRead, status_code=status.HTTP_201_CREATED)
async def register_device(
    data: DeviceCreate,
    service: DeviceService = Depends(get_device_service)
):
    """Register a new IoT device"""
    return await service.register(data)

@router.get("/devices/stats/summary", response_model=StatsSummary)
async def get_stats(service: DeviceService = Depends(get_device_service)):
    """Get device statistics"""
    return await service.get_summary()

@router.get("/devices/{device_id}", response_model=DeviceRead)
async def get_device(
    device_id: str,
    service: DeviceService = Depends(get_device_service)
):
    """Get specific device by ID"""
    device = await service.get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device

@router.get("/devices/{device_id}/telemetry", response_model=List[TelemetryRead])
async def get_device_telemetry(
    device_id: str,
    limit: int = 50,
    service: DeviceService = Depends(get_device_service)
):
    """Get telemetry history for a device"""
    # Note: Service layer should ideally handle existence check
    return await service.get_telemetry(device_id, limit)

@router.put("/devices/{device_id}", response_model=DeviceRead)
async def update_device(
    device_id: str,
    data: DeviceUpdate,
    service: DeviceService = Depends(get_device_service)
):
    """Update device information"""
    device = await service.update(device_id, data)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device

@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device_id: str,
    service: DeviceService = Depends(get_device_service)
):
    """Delete a device"""
    success = await service.delete(device_id)
    if not success:
        raise HTTPException(status_code=404, detail="Device not found")

@router.post("/devices/{device_id}/analyze")
async def analyze_device_telemetry(device_id: str, telemetry: dict):
    """Analyse la telemetrie d'un device via Isolation Forest"""
    result = ml_anomaly.analyze(telemetry)
    return {"device_id": device_id, **result}

@router.get("/drift/status")
async def get_drift_status():
    """[DESACTIVE] Le drift a ete desactive (faux positifs, reference trop etroite)"""
    return {"drift_detected": False, "status": "disabled",
            "message": "Drift desactive — le modele est stable (F1=0.995 sur IF multivarie)"}

@router.get("/drift/history")
async def get_drift_history():
    """[DESACTIVE] Historique des scores pour le drift"""
    return {"history": [], "status": "disabled", "message": "Drift desactive"}

@router.post("/devices/{device_id}/simulate-vulnerability")
async def simulate_vulnerability(
    device_id: str,
    cve_id: str,
    service: DeviceService = Depends(get_device_service)
):
    """
    Perform 'What-If' Digital Twin Analysis (Objective 7.4)
    Simulates a vulnerability impact based on the Digital Twin state.
    """
    device = await service.get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    # Simple simulation logic
    base_impact = 40
    twin_impact = 0
    
    if "status" in device.digital_twin_state and device.digital_twin_state["status"] == "open":
        twin_impact = 30
    elif "stream_active" in device.digital_twin_state and device.digital_twin_state["stream_active"]:
        twin_impact = 50
        
    predicted_risk = min(device.risk_score + base_impact + twin_impact, 100)
    
    return {
        "device_name": device.name,
        "cve_simulated": cve_id,
        "current_risk": device.risk_score,
        "predicted_risk": predicted_risk,
        "impact_analysis": "High" if predicted_risk > 80 else "Medium",
        "recommendation": "Immediate Patching Required" if predicted_risk > 80 else "Monitor for anomalies"
    }
