from fastapi import APIRouter, HTTPException, status, Depends, Query
from typing import List, Optional
from app.api.deps import get_ml_model_service
from app.domains.ml_models.service import MLModelService
from app.domains.ml_models.schemas import (
    MLModelRead, MLModelCreate, MLModelSummary,
    ModelMetricRead, ModelMetricCreate, ModelDetail, ModelComparison,
)

router = APIRouter()


@router.get("/", response_model=List[MLModelSummary])
async def list_ml_models(
    sensor: Optional[str] = Query(None, description="Filter by sensor"),
    status: Optional[str] = Query(None, description="Filter by status"),
    service: MLModelService = Depends(get_ml_model_service),
):
    """List all registered ML models with summary performance"""
    comparison = await service.get_comparison()
    models = comparison.get("models", [])
    if sensor:
        models = [m for m in models if m["sensor"] == sensor]
    if status:
        models = [m for m in models if m["status"] == status]
    return models


@router.get("/comparison")
async def compare_ml_models(
    service: MLModelService = Depends(get_ml_model_service),
):
    """Compare all models side by side with average detection rates"""
    return await service.get_comparison()


@router.post("/", response_model=MLModelRead, status_code=status.HTTP_201_CREATED)
async def register_ml_model(
    data: MLModelCreate,
    service: MLModelService = Depends(get_ml_model_service),
):
    """Register a new trained ML model"""
    return await service.register(data)


@router.get("/{model_id}", response_model=ModelDetail)
async def get_ml_model_detail(
    model_id: str,
    service: MLModelService = Depends(get_ml_model_service),
):
    """Get model details with all performance metrics"""
    detail = await service.get_detail(model_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Model not found")
    return detail


@router.post("/{model_id}/metrics", response_model=ModelMetricRead)
async def add_model_metric(
    model_id: str,
    data: ModelMetricCreate,
    service: MLModelService = Depends(get_ml_model_service),
):
    """Add a performance metric for an attack type"""
    model = await service.get_by_id(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return await service.add_metric(model_id, data)


@router.get("/{model_id}/metrics", response_model=List[ModelMetricRead])
async def get_model_metrics(
    model_id: str,
    service: MLModelService = Depends(get_ml_model_service),
):
    """Get all performance metrics for a model"""
    model = await service.get_by_id(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    detail = await service.get_detail(model_id)
    return detail["metrics"] if detail else []


@router.patch("/{model_id}/status")
async def update_model_status(
    model_id: str,
    status: str = Query(..., description="New status: trained, deployed, archived"),
    service: MLModelService = Depends(get_ml_model_service),
):
    """Update model status (deploy/archive)"""
    model = await service.update_status(model_id, status)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return {"id": model_id, "status": status}


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ml_model(
    model_id: str,
    service: MLModelService = Depends(get_ml_model_service),
):
    """Delete a model and its metrics"""
    success = await service.delete_model(model_id)
    if not success:
        raise HTTPException(status_code=404, detail="Model not found")


@router.get("/chart/{sensor}")
async def get_sensor_chart_data(
    sensor: str,
    service: MLModelService = Depends(get_ml_model_service),
):
    """Get chart-ready metrics for the latest model of a sensor"""
    return await service.get_sensor_metrics_chart(sensor)
