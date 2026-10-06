# Intelligence

| Fichier | Rôle |
|---------|------|
| `mqtt_dpi_service.py` | Deep Packet Inspection : règles YAML, corrélation, score de risque 0–100, journal d'alertes |
| `dpi_rules.yaml` | Les 4 règles DPI (seuils éditables à chaud via `/api/dpi/rules`) |
| `ml_service.py` | Inférence One-Class SVM multivariée + explications locales par ablation |
| `risk_service.py` | Score de risque prédictif par équipement (ML, CVE, criticité, tendance) |
| `nvd_service.py` | CVE depuis NVD + EPSS (avec cache) |
| `service.py` | Score de risque / conformité depuis OpenSearch-Wazuh (si disponible) |
