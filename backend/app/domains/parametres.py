# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/parametres.py
#   PARAMÈTRES MODIFIABLES PAR L'ADMIN (table app_settings) : valeurs par défaut, bornes,
#   lecture et écriture.
# ══════════════════════════════════════════════════════════════════════════
"""Paramètres de la plateforme (table app_settings), modifiables par l'administrateur seul.

- precision_min : précision minimale exigée sur la validation pour régler le seuil d'alerte
                  du prochain entraînement (0,5 à 0,99)
- fa_max        : fausses alertes par heure tolérées sur la validation (0,05 à 5)
- vitesse_temps_reel : mesures envoyées par seconde dans la page « Temps réel » (1 à 200)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import JSON, Column, Field, SQLModel, select

DEFAULTS: dict[str, Any] = {"precision_min": 0.90, "fa_max": 0.5, "vitesse_temps_reel": 60}
BOUNDS: dict[str, tuple[float, float]] = {"precision_min": (0.5, 0.99), "fa_max": (0.05, 5.0),
                                          "vitesse_temps_reel": (1, 200)}
LABELS = {"precision_min": "Précision minimale (validation) pour régler le seuil d'alerte",
          "fa_max": "Fausses alertes tolérées par heure (validation)",
          "vitesse_temps_reel": "Vitesse du temps réel (mesures de 5 s envoyées par seconde)"}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] AppSetting
#   Rôle   : TABLE app_settings : un paramètre (clé, valeur, date, auteur).
# ──────────────────────────────────────────────────────────────────────
class AppSetting(SQLModel, table=True):
    __tablename__ = "app_settings"

    key: str = Field(primary_key=True)
    value: Any = Field(default=None, sa_column=Column(JSON))
    updated_at: Optional[datetime] = Field(default=None)
    updated_by: Optional[str] = Field(default=None)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] get_all
#   Rôle   : Lit tous les paramètres (valeurs par défaut si absents).
#   Entrée : session
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
async def get_all(session: AsyncSession) -> dict[str, Any]:
    rows = (await session.execute(select(AppSetting))).scalars().all()
    out = dict(DEFAULTS)
    out.update({r.key: r.value for r in rows if r.key in DEFAULTS})
    return out


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] validate
#   Rôle   : Vérifie que les valeurs sont connues et dans leurs bornes.
#   Entrée : values
#   Sortie : valeurs propres (sinon erreur)
# ──────────────────────────────────────────────────────────────────────
def validate(values: dict[str, Any]) -> dict[str, Any]:
    clean = {}
    for k, v in values.items():
        if k not in DEFAULTS:
            raise ValueError(f"Paramètre inconnu : {k}")
        lo, hi = BOUNDS[k]
        x = float(v)
        if not lo <= x <= hi:
            raise ValueError(f"{k} doit être entre {lo} et {hi}")
        clean[k] = int(x) if k == "vitesse_temps_reel" else round(x, 3)
    return clean


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] update
#   Rôle   : Enregistre de nouvelles valeurs de paramètres.
#   Entrée : session ; values ; username
#   Sortie : tous les paramètres
# ──────────────────────────────────────────────────────────────────────
async def update(session: AsyncSession, values: dict[str, Any], username: Optional[str]) -> dict[str, Any]:
    clean = validate(values)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for k, v in clean.items():
        row = await session.get(AppSetting, k)
        if row is None:
            session.add(AppSetting(key=k, value=v, updated_at=now, updated_by=username))
        else:
            row.value, row.updated_at, row.updated_by = v, now, username
    await session.commit()
    return await get_all(session)
