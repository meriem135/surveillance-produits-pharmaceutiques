"""
API endpoint for DPI alerts — exposes mqtt_dpi_alerts.log to the dashboard.

Ne renvoie que les alertes de la session de simulation EN COURS : tant que la
simulation n'a pas démarré, la liste est vide (aucune alerte "statique").
"""

import json
import os
from typing import List, Optional

from fastapi import APIRouter, Query

from app.domains.intelligence.mqtt_dpi_service import WAZUH_LOG_PATH, _LOCAL_LOG_PATH as LOCAL_LOG_PATH
from app.services.realtime_service import manager

router = APIRouter()


def _read_alerts_since(start_iso: str) -> List[dict]:
    """Lire les alertes du log dont le timestamp >= start_iso."""
    alerts = []
    for path in (WAZUH_LOG_PATH, LOCAL_LOG_PATH):
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ts = entry.get("timestamp", "")
                    if ts and ts >= start_iso:
                        alerts.append(entry)
            return alerts
    return alerts


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
    session: bool = Query(default=True, description="Ne renvoyer que les alertes de la session de simulation en cours"),
):
    """
    Return DPI alerts from the Wazuh-compatible log file.
    Results are sorted newest-first and capped at `limit`.

    Par défaut, seules les alertes de la session de simulation en cours sont
    renvoyées. Si aucune simulation n'est active, la liste est vide.
    """
    session_info = manager.get_simulation_session()

    if session:
        if not session_info["active"] or not session_info["started_at"]:
            return []
        alerts = _read_alerts_since(session_info["started_at"])
    else:
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
