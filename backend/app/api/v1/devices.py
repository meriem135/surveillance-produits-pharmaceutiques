from fastapi import APIRouter, HTTPException, status, Depends
from typing import List, Optional
from app.api.deps import get_device_service
from app.domains.devices.service import DeviceService
from app.domains.devices.schemas import DeviceRead
from app.domains.auth.service import require_any_role

router = APIRouter()

@router.get("/devices", response_model=List[DeviceRead])
async def get_devices(
    status: Optional[str] = None,
    device_type: Optional[str] = None,
    service: DeviceService = Depends(get_device_service)
):
    """Get all registered IoT devices with live scores"""
    return await service.get_all_with_risk(status, device_type)

@router.post("/devices/{device_id}/simulate-vulnerability")
async def simulate_vulnerability(
    device_id: str,
    cve_id: str,
    service: DeviceService = Depends(get_device_service),
    _user=Depends(require_any_role("operator")),
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
