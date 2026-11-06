"""
Chemins canoniques du projet (données, modèles, journaux).

Un seul endroit décide où vivent les fichiers ; tous les modules importent
ces constantes au lieu de reconstruire des chemins relatifs à leur propre
emplacement. Chaque dossier peut être surchargé par variable d'environnement.

    <racine>/
      notebook/Raw/Normal/                 traces TON_IoT normales (brutes)
      notebook/Raw/Attaques/Attaque/<t>/   traces TON_IoT d'attaque (brutes)
      data/processed/                      dataset_fusionne.csv, *_concat.csv, SQLite
      data/generated/                      flux de démonstration saisonnier
      models/                              modèles entraînés + résultats JSON
"""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = PROJECT_ROOT / "backend"


def _dir(env: str, default: Path) -> Path:
    value = os.getenv(env)
    return Path(value).expanduser().resolve() if value else default


RAW_DIR = _dir("RAW_DATA_DIR", PROJECT_ROOT / "notebook" / "Raw")
RAW_NORMAL_DIR = RAW_DIR / "Normal"
RAW_ATTACK_DIR = RAW_DIR / "Attaques" / "Attaque"

DATA_DIR = _dir("DATA_DIR", PROJECT_ROOT / "data")
PROCESSED_DIR = DATA_DIR / "processed"
GENERATED_DIR = DATA_DIR / "generated"

MODELS_DIR = _dir("MODELS_DIR", PROJECT_ROOT / "models")

# ── Données ────────────────────────────────────────────────────────────────
DATASET_FUSIONNE = PROCESSED_DIR / "dataset_fusionne.csv"
MERGED_3_SENSORS = PROCESSED_DIR / "merged_3_sensors.csv"
INFERRED_OCSVM = PROCESSED_DIR / "multivarie_inferred_ocsvm.json"
CONCAT_CSV = {
    "weather": PROCESSED_DIR / "weather_concat.csv",
    "fridge": PROCESSED_DIR / "fridge_concat.csv",
    "thermostat": PROCESSED_DIR / "thermostat_concat.csv",
}
SEASONAL_STREAM_CSV = GENERATED_DIR / "extraits_saisonniers_fusionne.csv"
SQLITE_DB = PROCESSED_DIR / "iot_security.db"

# ── Modèles et résultats ──────────────────────────────────────────────────
OCSVM_MODEL = MODELS_DIR / "ocsvm_multivarie.pkl"
OCSVM_SCALER = MODELS_DIR / "scaler_ocsvm.pkl"
OCSVM_THRESHOLD = MODELS_DIR / "threshold_ocsvm.json"
OCSVM_HYPERPARAMS = MODELS_DIR / "hyperparams_ocsvm.json"
RESULTS_COMPARISON = MODELS_DIR / "resultats_comparaison_final.json"
RESULTS_COMPLETS = MODELS_DIR / "resultats_complets.json"
LIVE_RESULTS = MODELS_DIR / "live_trained_results.json"


def model_file(name: str) -> str:
    """Chemin (str) d'un fichier du dossier des modèles."""
    return str(MODELS_DIR / name)


def ensure_dirs() -> None:
    for d in (PROCESSED_DIR, GENERATED_DIR, MODELS_DIR):
        d.mkdir(parents=True, exist_ok=True)
