"""Compatibilité : les notebooks importent ``app.domains.ml.pipeline``.

Dans cette version du projet, l'ingénierie des features et les fonctions
d'entraînement sont exposées par ``app.api.v1.phase2``. Ce module réexporte
son contenu afin que les imports des notebooks continuent de fonctionner.
"""

from app.api.v1 import phase2 as _phase2

for _name in dir(_phase2):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_phase2, _name)

del _name
