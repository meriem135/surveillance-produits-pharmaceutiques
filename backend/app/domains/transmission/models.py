"""Tables des entraînements « attaques de transmission » (PostgreSQL, repli SQLite).

Une ligne par entraînement lancé depuis le dashboard (transmission_runs) et une ligne par
modèle candidat de cet entraînement (transmission_model_results). Tables distinctes de
ml_models / model_metrics : ces dernières alimentent les pages de la phase 2, qui lisent
toutes leurs lignes sans filtre.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Index
from sqlmodel import JSON, Column, Field, SQLModel


def utcnow() -> datetime:
    """UTC naïf, comme le reste du schéma."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class TransmissionRun(SQLModel, table=True):
    __tablename__ = "transmission_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=utcnow, index=True)
    finished_at: Optional[datetime] = Field(default=None)
    status: str = Field(default="en_cours", description="en_cours | termine | erreur | interrompu")
    launched_by: Optional[str] = Field(default=None, description="Nom d'utilisateur de l'admin")
    user_id: Optional[int] = Field(default=None, foreign_key="users.id")
    duration_s: Optional[float] = Field(default=None)

    # Jeu de données de l'entraînement (traces réelles, répétition 0)
    n_rows: int = Field(default=0)
    n_features: int = Field(default=0)
    n_episodes: int = Field(default=0)
    dataset: dict = Field(default_factory=dict, sa_column=Column(JSON))
    scenarios: list = Field(default_factory=list, sa_column=Column(JSON))

    best_model: Optional[str] = Field(default=None)
    best_f1: Optional[float] = Field(default=None)
    ranking: list = Field(default_factory=list, sa_column=Column(JSON), description="Classement sur la validation")
    error: Optional[str] = Field(default=None)

    # Résultat complet, identique à models/transmission_reel/entrainement_web.json
    result_json: dict = Field(default_factory=dict, sa_column=Column(JSON))


class TransmissionModelResult(SQLModel, table=True):
    __tablename__ = "transmission_model_results"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="transmission_runs.id", index=True)
    model_key: str = Field(description="IsolationForest | OCSVM | RandomForest | XGBoost")
    nom: str = Field(default="")
    model_type: str = Field(default="", description="supervisé | non supervisé")
    is_best: bool = Field(default=False)

    f1: Optional[float] = Field(default=None)
    precision: Optional[float] = Field(default=None)
    recall: Optional[float] = Field(default=None)
    roc_auc: Optional[float] = Field(default=None)
    avg_precision: Optional[float] = Field(default=None)
    fpr: Optional[float] = Field(default=None)
    val_f1: Optional[float] = Field(default=None)
    threshold: Optional[float] = Field(default=None)
    fausses_alarmes_par_heure: Optional[float] = Field(default=None)
    episodes: Optional[int] = Field(default=None)
    episodes_detectes: Optional[int] = Field(default=None)
    delai_median_min: Optional[float] = Field(default=None)

    hyperparameters: dict = Field(default_factory=dict, sa_column=Column(JSON))
    per_attack: dict = Field(default_factory=dict, sa_column=Column(JSON), description="Taux de détection par scénario")
    per_episode: dict = Field(default_factory=dict, sa_column=Column(JSON))


Index("idx_transmission_result_run_model", TransmissionModelResult.run_id, TransmissionModelResult.model_key)
