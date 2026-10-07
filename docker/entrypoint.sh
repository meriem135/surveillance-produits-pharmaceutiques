#!/bin/sh
# Démarrage du conteneur : reconstruit le jeu de données s'il manque (volume data/ vide au premier
# lancement), puis lance la commande (uvicorn par défaut, ou pytest, un script…).
set -e
if [ ! -f /app/data/processed/dataset_fusionne.csv ]; then
  echo "[vigilochain] Premier démarrage : construction du jeu de données depuis notebook/Raw…"
  python scripts/build_dataset.py
fi
exec "$@"
