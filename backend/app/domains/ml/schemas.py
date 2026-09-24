from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel


# ── MLModel ───────────────────────────────────────────────────────────────────

class MLModelBase(BaseModel):
    name: str
    model_type: str
    sensor: str
    version: str = "1.0.0"
    hyperparameters: dict = {}
    features: list = []
    feature_count: int = 0
    training_samples: int = 0
    contamination: float = 0.05
    n_estimators: int = 200
    anomaly_rate_normal: float = 0.0
    score_moyen_normal: float = 0.0
    status: str = "trained"
    model_path: str = ""
    scaler_path: Optional[str] = None


class MLModelCreate(MLModelBase):
    id: str
    trained_at: Optional[datetime] = None


class MLModelRead(MLModelBase):
    id: str
    trained_at: datetime

    class Config:
        from_attributes = True


class MLModelSummary(BaseModel):
    id: str
    name: str
    model_type: str
    sensor: str
    status: str
    version: str
    trained_at: datetime
    training_samples: int
    feature_count: int
    anomaly_rate_normal: float
    score_moyen_normal: float
    detection_moyenne: Optional[float] = None
    meilleure_attaque: Optional[str] = None
    meilleur_taux: Optional[float] = None
    pire_attaque: Optional[str] = None
    pire_taux: Optional[float] = None

    class Config:
        from_attributes = True


# ── ModelMetric ───────────────────────────────────────────────────────────────

class ModelMetricBase(BaseModel):
    attack_type: str
    capteur: str = ""
    n_total: int = 0
    n_anomalies: int = 0
    taux_detection: float = 0.0
    score_moyen: float = 0.0
    roc_auc: Optional[float] = None
    avg_precision: Optional[float] = None
    precision_normal: Optional[float] = None
    recall_normal: Optional[float] = None
    f1_normal: Optional[float] = None
    precision_attaque: Optional[float] = None
    recall_attaque: Optional[float] = None
    f1_attaque: Optional[float] = None


class ModelMetricCreate(ModelMetricBase):
    pass


class ModelMetricRead(ModelMetricBase):
    id: int
    model_id: str

    class Config:
        from_attributes = True


class ModelDetail(BaseModel):
    model: MLModelRead
    metrics: List[ModelMetricRead] = []


class ModelComparison(BaseModel):
    models: List[MLModelSummary] = []
    best_sensor: Optional[str] = None
    worst_sensor: Optional[str] = None
    average_detection_by_sensor: dict[str, float] = {}


# ── ModelVersion ──────────────────────────────────────────────────────────────

class ModelVersionRead(BaseModel):
    version: str
    model_id: str
    status: str
    reason: str
    notes: str
    score_mean: float
    score_std: float
    n_training_samples: int
    trained_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


class RegistrySummary(BaseModel):
    current_version: Optional[str] = None
    total_versions: int = 0
    active_model: Optional[ModelVersionRead] = None
    history: List[ModelVersionRead] = []
