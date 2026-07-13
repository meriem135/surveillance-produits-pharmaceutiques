# Guide Phase 3 pour les Débutants

## Qu'est-ce que j'ai fait exactement ?

Avant la Phase 3, ton projet avait :
- **Phase 1** : Filtre les messages MQTT suspects (comme un videur)
- **Phase 2** : Détecte les anomalies avec l'IA (Isolation Forest + SHAP)

**Problème :** Si tu reçois 100 alertes par jour, l'opérateur ignore tout.

**Solution Phase 3 :** Je crée une NOTE DE RISQUE sur 100 pour chaque capteur.
Comme un bulletin météo, mais pour la sécurité :

```
Risque 0-20  🟢 = Tout va bien
Risque 20-40 🟡 = Surveiller
Risque 40-60 🟠 = Attention
Risque 60-80 🔴 = Dangereux
Risque 80-100 💀 = CRITIQUE (agir immédiatement)
```

### Comment la note est calculée ?

C'est comme une recette de cuisine avec 6 ingrédients :

| Ingrédient | Poids | Explication simple |
|---|---|---|
| Score IA (ML) | 30% | "Est-ce que le capteur se comporte bizarrement ?" |
| Vulnérabilités CVE | 25% | "Est-ce que le firmware a des failles connues ?" |
| Alertes DPI | 15% | "Y a-t-il des alertes réseau récentes ?" |
| Criticité | 10% | "Est-ce que ce capteur est important ?" |
| Vélocité | 10% | "Est-ce que le risque augmente vite ?" |
| Historique | 10% | "Quel était le risque récemment ?" |

### Exemple concret

Si le Frigo Usine A a :
- L'IA détecte une anomalie (température bizarre)
- Son firmware a une faille CVE connue
- 15 alertes DPI en 1 heure

→ **Score = 86/100** → 🔴 **CRITIQUE** → L'opérateur voit cette alerte en PRIORITÉ

---

## Comment voir le résultat de la Phase 3 ?

### Méthode 1 : Le script démo (le plus simple, 0 installation)

```bash
# 1. Va dans le dossier scripts
cd C:\peaksoft-security-platform-main\peaksoft-security-platform-main\scripts

# 2. Lance le script
python phase3_demo_risk_scoring.py
```

Tu verras défiler :
1. Le calcul du risque pour 3 capteurs (Frigo, Thermostat, Météo)
2. Pour 3 scénarios (Normal, Suspect, Attaque)
3. La décomposition de chaque note (Waterfall)
4. L'analyse What-If (que se passe-t-il si je patche ?)
5. La simulation 24h avec tendance

### Méthode 2 : Le Notebook Jupyter (pour voir les graphiques)

```bash
# 1. Va dans le dossier notebooks
cd C:\peaksoft-security-platform-main\peaksoft-security-platform-main\notebooks

# 2. Lance Jupyter
jupyter notebook 3_Risk_Scoring_Predictif_Phase3.ipynb
```

Tu verras de **beaux graphiques** :
- Diagramme Waterfall (cascade des contributions)
- Graphique Radar (comparaison des capteurs)
- Distribution Monte Carlo (intervalles de confiance)
- Analyse de sensibilité
- Simulation temporelle

### Méthode 3 : L'API backend (si le serveur tourne)

```bash
# 1. Va dans le dossier backend
cd C:\peaksoft-security-platform-main\peaksoft-security-platform-main\iot-security-backend

# 2. Lance le serveur
uvicorn app.main:app --reload

# 3. Ouvre le navigateur à :
#    http://localhost:8000/docs
```

Dans Swagger, tu verras une nouvelle section **"risks"** avec ces endpoints :

| Endpoint | À quoi ça sert ? |
|---|---|
| `GET /api/v1/risks/{id}` | Calcule le risque d'un capteur |
| `GET /api/v1/risks/{id}/history` | Historique du risque |
| `GET /api/v1/risks/{id}/what-if` | Simule l'impact d'actions |
| `GET /api/v1/risks/summary` | Résumé de tous les capteurs |
| `GET /api/v1/risks/weights` | Voir les poids des facteurs |
| `PUT /api/v1/risks/weights` | Modifier les poids |
| `GET /api/v1/risks/{id}/anomaly` | Détecte si le risque est anormal |
| `GET /api/v1/risks/{id}/forecast` | Prédire le risque futur |
| `POST /api/v1/risks/correlation` | Corrélation entre capteurs |
| `GET /api/v1/cves/{type}` | Voir les CVEs d'un capteur |

---

## Pas à pas pour tester l'API

### Étape 1 : Démarrer le backend
```bash
cd C:\peaksoft-security-platform-main\peaksoft-security-platform-main\iot-security-backend
uvicorn app.main:app --reload
```

### Étape 2 : Créer un device (si aucun n'existe)
Dans Swagger (`http://localhost:8000/docs`), section **devices** :
1. Clique sur `POST /api/v1/devices`
2. Clique "Try it out"
3. Colle ce JSON :
```json
{
  "name": "Mon Frigo Test",
  "device_type": "fridge",
  "firmware_version": "1.2.3",
  "location": "production"
}
```
4. "Execute" → copie le `id` retourné

### Étape 3 : Calculer le risque
Dans Swagger, section **risks** :
1. `GET /api/v1/risks/{device_id}`
2. Colle l'id du device
3. Ajoute des paramètres : `dpi_alerts=10`, `dpi_severity=8`
4. "Execute" → tu vois le score et sa décomposition

---

## Ce que tu peux montrer au jury

> *"Sans Phase 3, l'opérateur reçoit 100 alertes par jour et ignore tout. Avec la Phase 3, chaque capteur a une NOTE DE RISQUE sur 100. Le capteur Frigo passe de 30 (normal) à 86 (attaque). L'opérateur ne voit que les 2-3 capteurs critiques. Et en plus, on peut simuler l'impact d'un patch avant de l'appliquer !"*

### Les 3 arguments forts pour le jury :

1. **Note unique 0-100** : remplace 100 alertes par jour
2. **Décomposition explicable** : on voit pourquoi le risque est élevé (ex: "30% à cause d'une anomalie IA")
3. **What-If prédictif** : "Si je patche le firmware, le risque passe de 86 à 62"

---

## Résumé des fichiers créés

```
📁 iot-security-backend/app/domains/intelligence/
   ├── nvd_service.py     → Cherche les failles CVE sur Internet
   └── risk_service.py    → Calcule la note de risque

📁 iot-security-backend/app/api/v1/
   └── risks.py           → Les 10 endpoints API

📁 scripts/
   └── phase3_demo_risk_scoring.py  → Script démo (le plus simple)

📁 notebooks/
   └── 3_Risk_Scoring_Predictif_Phase3.ipynb  → Notebook avec graphiques
```
