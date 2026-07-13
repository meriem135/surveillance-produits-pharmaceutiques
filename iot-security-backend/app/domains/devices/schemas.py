from typing import Optional, List, Any
from datetime import datetime
from pydantic import BaseModel, Field

class DeviceBase(BaseModel):
    name: str = Field(..., description="Device name")
    device_type: str = Field(..., description="Device type (e.g., sensor, camera, gateway)")
    ip_address: Optional[str] = Field(None, description="IP address")
    mac_address: Optional[str] = Field(None, description="MAC address")
    manufacturer: Optional[str] = Field(None, description="Device manufacturer")
    firmware_version: Optional[str] = Field(None, description="Firmware version")
    location: Optional[str] = Field("Unassigned", description="Physical location")

class DeviceCreate(DeviceBase):
    """Model for creating a new device"""
    pass

class DeviceUpdate(BaseModel):
    """Model for updating device information"""
    name: Optional[str] = None
    device_type: Optional[str] = None
    ip_address: Optional[str] = None
    mac_address: Optional[str] = None
    manufacturer: Optional[str] = None
    firmware_version: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None

class DeviceRead(DeviceBase):
    """Response model for a device"""
    id: str
    status: str
    last_seen: datetime
    registered_at: datetime
    risk_score: int
    compliance_score: int
    compliance_status: str
    digital_twin_state: dict

    class Config:
        from_attributes = True

class TelemetryRead(BaseModel):
    """Response model for telemetry"""
    id: int
    device_id: str
    timestamp: datetime
    metric_key: str
    metric_value: dict

    class Config:
        from_attributes = True

class StatsSummary(BaseModel):
    total_devices: int
    online_devices: int
    offline_devices: int
    device_types: dict[str, int]
    average_risk_score: float
    risk_distribution: dict[str, int]
