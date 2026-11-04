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
    source: str = Field(default="web", index=True, description="web (dashboard) | reference (étude, scripts/charger_base.py)")
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
    model_key: str = Field(description="RandomForest | XGBoost | Logistique | MLP")
    nom: str = Field(default="")
    model_type: str = Field(default="", description="supervisé")
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


# ── Tables de l'étude : ce que les pages du site affichent ─────────────────────
# Remplies par scripts/charger_base.py (étude de référence, à partir des sorties réelles du
# pipeline) et par chaque entraînement lancé depuis le dashboard (repository.finish_run).
# Toutes rattachées à une ligne de transmission_runs (source = « reference » ou « web »).

class TransmissionMetric(SQLModel, table=True):
    """Métriques d'un modèle sur un rôle (train / val / test), à un niveau donné :
    « ligne » (score ≥ seuil, sans persistance) ou « alarme » (après la règle k sur n)."""
    __tablename__ = "transmission_metrics"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="transmission_runs.id", index=True)
    model_key: str = Field(index=True)
    role: str = Field(description="train | val | test")
    niveau: str = Field(description="ligne | alarme")
    is_best: bool = Field(default=False)
    seuil: Optional[float] = None
    k: Optional[int] = None
    n: Optional[int] = None
    recall: Optional[float] = None
    precision: Optional[float] = None
    f1: Optional[float] = None
    fpr: Optional[float] = None
    roc_auc: Optional[float] = None
    avg_precision: Optional[float] = None
    tp: Optional[int] = None
    fp: Optional[int] = None
    fn: Optional[int] = None
    tn: Optional[int] = None
    part_attaques: Optional[float] = None
    heures_normales: Optional[float] = None
    alertes: Optional[int] = None
    fausses_alertes: Optional[int] = None
    fausses_alertes_par_heure: Optional[float] = None
    episodes: Optional[int] = None
    episodes_detectes: Optional[int] = None
    delai_median_min: Optional[float] = None
    delai_p90_min: Optional[float] = None
    per_attack: dict = Field(default_factory=dict, sa_column=Column(JSON))
    per_episode: dict = Field(default_factory=dict, sa_column=Column(JSON))


class TransmissionShap(SQLModel, table=True):
    """Importance SHAP moyenne |valeur| d'une feature pour le meilleur modèle, globale ou par scénario."""
    __tablename__ = "transmission_shap"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="transmission_runs.id", index=True)
    model_key: str
    portee: str = Field(description="global | <nom du scénario>")
    rang: int
    feature: str
    libelle: str = Field(default="")
    importance: float


class TransmissionDatasetRow(SQLModel, table=True):
    """Le jeu de données réel avec attaques (répétition 0) : une ligne par pas de 5 s."""
    __tablename__ = "transmission_dataset"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="transmission_runs.id", index=True)
    idx: int = Field(description="numéro de la ligne (pas de 5 s)")
    ts: datetime
    bloc: int
    role: str = Field(description="train | val | test")
    evaluee: bool = Field(description="False : zone de garde (après un épisode ou en début de bloc)")
    weather_temp: float
    fridge_temp: float
    thermostat_temp: float
    fridge_true: float
    thermostat_true: float
    fridge_cond: str = Field(default="")
    thermo_status: int = Field(default=0)
    garde: bool = Field(default=False, description="zone de garde après un épisode (colonne du CSV)")
    label: int
    attack_type: str
    cible: str = Field(default="")


class TransmissionEpisode(SQLModel, table=True):
    """Épisodes d'attaque injectés (toutes les répétitions de l'étude, ou celle de l'entraînement web)."""
    __tablename__ = "transmission_episodes"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="transmission_runs.id", index=True)
    repetition: int = Field(default=0)
    scenario: str
    capteur: str
    mecanisme: str
    parametre: Optional[float] = None
    role: str
    start_idx: int
    end_idx: int
    start_ts: Optional[datetime] = None
    end_ts: Optional[datetime] = None
    detecte: Optional[bool] = Field(default=None, description="meilleur modèle, répétition 0")
    delai_min: Optional[float] = None


class TransmissionPrediction(SQLModel, table=True):
    """Score du meilleur modèle sur chaque ligne du jeu de données (répétition 0)."""
    __tablename__ = "transmission_predictions"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="transmission_runs.id", index=True)
    model_key: str
    idx: int
    score: float
    signal: bool = Field(description="score ≥ seuil")
    alarme: bool = Field(description="après la règle de persistance k sur n")


class TransmissionAlert(SQLModel, table=True):
    """Alertes levées par le meilleur modèle (suites continues de lignes en alarme)."""
    __tablename__ = "transmission_alerts"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="transmission_runs.id", index=True)
    model_key: str
    role: str
    start_idx: int
    end_idx: int
    start_ts: datetime
    end_ts: datetime
    duree_min: float
    score_max: float
    vraie: bool = Field(description="recouvre une ligne d'attaque")
    scenario: Optional[str] = None
    capteur: Optional[str] = None


class TransmissionLearningPoint(SQLModel, table=True):
    """Courbe d'apprentissage du meilleur modèle : score selon la taille du train."""
    __tablename__ = "transmission_learning_curve"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="transmission_runs.id", index=True)
    model_key: str
    part_train: float
    lignes_train: int
    ap_train: float
    ap_val: float
    f1_train: Optional[float] = None
    f1_val: Optional[float] = None


Index("idx_transmission_dataset_run_idx", TransmissionDatasetRow.run_id, TransmissionDatasetRow.idx)
Index("idx_transmission_pred_run_idx", TransmissionPrediction.run_id, TransmissionPrediction.idx)
