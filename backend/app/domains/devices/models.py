# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/devices/models.py
#   TABLES DES ÉQUIPEMENTS (devices) ET DES MESURES (telemetry).
# ══════════════════════════════════════════════════════════════════════════
from typing import Optional, List
from datetime import datetime
from sqlmodel import SQLModel, Field, Column, JSON
from sqlalchemy import Index

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] Device
#   Rôle   : TABLE devices : un équipement IoT (nom, type, IP, firmware, emplacement, état, scores).
# ──────────────────────────────────────────────────────────────────────
class Device(SQLModel, table=True):
    """IoT Device model with persistence"""
    __tablename__ = "devices"
    
    id: str = Field(primary_key=True, description="Unique device identifier")
    name: str = Field(index=True, description="Device name")
    device_type: str = Field(index=True, description="Device type (sensor, camera, gateway, etc.)")
    ip_address: Optional[str] = Field(default=None, index=True, description="IP address")
    mac_address: Optional[str] = Field(default=None, index=True, unique=True, description="MAC address")
    manufacturer: Optional[str] = Field(default=None, description="Device manufacturer")
    firmware_version: Optional[str] = Field(default=None, description="Firmware version")
    status: str = Field(default="online", description="Device status (online/offline)")
    location: str = Field(default="Unassigned", index=True, description="Physical location/facility")
    last_seen: datetime = Field(default_factory=datetime.utcnow, description="Last telemetry timestamp")
    registered_at: datetime = Field(default_factory=datetime.utcnow, description="Registration timestamp")
    risk_score: int = Field(default=0, description="Risk score (0-100)")
    compliance_score: int = Field(default=100, description="Compliance score (0-100)")
    compliance_status: str = Field(default="compliant", description="Compliance status")
    digital_twin_state: dict = Field(default_factory=dict, sa_column=Column(JSON), description="Digital twin telemetry state")

# Define composite indexes for common queries
Index('idx_device_type_status', Device.device_type, Device.status)
Index('idx_location_status', Device.location, Device.status)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] Telemetry
#   Rôle   : TABLE telemetry : une mesure d'un équipement à un instant.
# ──────────────────────────────────────────────────────────────────────
class Telemetry(SQLModel, table=True):
    """Time-series telemetry data for devices"""
    __tablename__ = "telemetry"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: str = Field(foreign_key="devices.id", index=True, description="Reference to device")
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True, description="Telemetry timestamp")
    metric_key: str = Field(description="Metric name (e.g., 'temperature', 'cpu_usage')")
    metric_value: dict = Field(sa_column=Column(JSON), description="Metric value and metadata")

# Composite index for efficient time-range queries
Index('idx_telemetry_device_time', Telemetry.device_id, Telemetry.timestamp.desc())
Index('idx_telemetry_metric', Telemetry.device_id, Telemetry.metric_key)
