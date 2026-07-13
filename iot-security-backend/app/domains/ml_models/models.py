from typing import Optional, List
from datetime import datetime
from sqlmodel import SQLModel, Field, Column, JSON
from sqlalchemy import Index


class MLModel(SQLModel, table=True):
    """Registered ML model metadata"""
    __tablename__ = "ml_models"

    id: str = Field(primary_key=True, description="Unique model identifier")
    name: str = Field(index=True, description="Human-readable model name")
    model_type: str = Field(description="Algorithm type: isolation_forest, one_class_svm, lstm_autoencoder")
    sensor: str = Field(index=True, description="Target sensor: weather, fridge, thermostat, combine")
    version: str = Field(default="1.0.0", description="Model version")

    hyperparameters: dict = Field(default_factory=dict, sa_column=Column(JSON), description="Training hyperparameters")
    features: list = Field(default_factory=list, sa_column=Column(JSON), description="Feature list")
    feature_count: int = Field(default=0, description="Number of features")

    training_samples: int = Field(default=0, description="Number of training samples")
    contamination: float = Field(default=0.05, description="Expected contamination rate")
    n_estimators: int = Field(default=200, description="Number of estimators (tree-based)")
    anomaly_rate_normal: float = Field(default=0.0, description="Anomaly rate on normal data")
    score_moyen_normal: float = Field(default=0.0, description="Mean decision score on normal data")

    status: str = Field(default="trained", description="Model status: trained, deployed, archived")
    trained_at: datetime = Field(default_factory=datetime.utcnow, description="Training timestamp")

    model_path: str = Field(default="", description="Path to .joblib model file")
    scaler_path: Optional[str] = Field(default=None, description="Path to .joblib scaler file")


Index("idx_ml_model_sensor", MLModel.sensor, MLModel.status)


class ModelMetric(SQLModel, table=True):
    """Per-attack performance metrics for a trained model"""
    __tablename__ = "model_metrics"

    id: Optional[int] = Field(default=None, primary_key=True)
    model_id: str = Field(foreign_key="ml_models.id", index=True)
    attack_type: str = Field(description="Attack type name (e.g. IoT_DDoS_normal)")
    capteur: str = Field(default="", description="Sensor used for this metric row")

    n_total: int = Field(default=0)
    n_anomalies: int = Field(default=0)
    taux_detection: float = Field(default=0.0)
    score_moyen: float = Field(default=0.0)

    roc_auc: Optional[float] = Field(default=None)
    avg_precision: Optional[float] = Field(default=None)
    precision_normal: Optional[float] = Field(default=None)
    recall_normal: Optional[float] = Field(default=None)
    f1_normal: Optional[float] = Field(default=None)
    precision_attaque: Optional[float] = Field(default=None)
    recall_attaque: Optional[float] = Field(default=None)
    f1_attaque: Optional[float] = Field(default=None)


Index("idx_metric_model_attack", ModelMetric.model_id, ModelMetric.attack_type)
