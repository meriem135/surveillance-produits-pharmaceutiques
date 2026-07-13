# Rapport : Détection d'Anomalies IoT avec Isolation Forest
## Explications pas à pas pour débutants — Notebook ML (exécuté)

---

## Étape 1 : Charger les features préparées

**Problème :** Le notebook précédent (`2_Preprocessing_Capteurs_IoT`) a déjà
transformé les données brutes en features normalisées. Pourquoi refaire ?
On charge simplement les fichiers CSV prêts à l'emploi.

**Fichiers chargés depuis `Data/Processed/` :**
- `features_weather.csv` : 399 188 lignes, 8 features
- `features_fridge.csv` : 383 368 lignes, 6 features
- `features_thermostat.csv` : 291 182 lignes, 5 features

**Les 9 types d'attaques disponibles dans `Data/Raw/` :**

| Attaque | Abréviation | Qu'est-ce que c'est ? |
|---------|-------------|----------------------|
| IoT_DDoS | DDoS | Attaque par déni de service distribué — submerge le capteur de requêtes |
| IoT_DoS | DoS | Déni de service simple — une seule source submerge le capteur |
| IoT_MITM | MITM | Homme du milieu — l'attaquant intercepte et modifie les données |
| IoT_XSS | XSS | Injection de scripts — altère les mesures du capteur |
| IoT_backdoor | Backdoor | Accès non autorisé à distance — l'attaquant prend le contrôle |
| IoT_injection | Injection | Fausses données injectées dans le flux |
| IoT_password | Password | Tentative de force brute — l'attaquant essaie de deviner les accès |
| IoT_runsomware | Ransomware | Rançongiciel — chiffre les données du capteur |
| IoT_scanning | Scanning | Scan de ports — l'attaquant explore le réseau |

---

## Étape 2 : Pipeline pour les données d'attaque

**Problème :** Les données d'attaque sont au format `.log` (JSON Lines),
pas en CSV. Chaque ligne est un objet JSON :
```json
{"timestamp": "31 Mar 2019 12:36:52", "temperature": 42.3, "humidity": 30.9}
```

**Solution :**
1. Fonction `charger_attaque_log(dossier)` :
   - Cherche les fichiers `.log` de chaque capteur
   - Lit chaque ligne, la parse en JSON avec `json.loads()`
   - Retourne un DataFrame pandas par capteur

2. Fonction `engineer_features(df, type_capteur)` :
   - Convertit le timestamp (format RFC 1123 → datetime pandas)
   - Calcule les **mêmes features** que sur les données normales :
     - Δt (temp_diff_1, humidity_diff_1, fridge_diff_1, thermo_diff_1)
     - Moyenne mobile (temp_roll_mean_10, fridge_roll_mean_10)
     - Écart-type mobile (temp_roll_std_10)
     - Encodage de l'état (temp_condition_encoded, thermostat_status)
     - Heure cyclique (hour_sin, hour_cos)
   - **Normalisation** avec le StandardScaler des données normales
     (pas de refit ! On utilise la moyenne et l'écart-type des normales)

**Pourquoi utiliser le même scaler (sans refit) ?** Si on recalcule la
moyenne et l'écart-type sur les données d'attaque, les valeurs seront
centrées sur la distribution de l'attaque, pas sur la normale. Un pic
de température dû à une attaque pourrait sembler "normal" après
re-normalisation. On fixe la référence une fois pour toutes.

---

## Étape 3 : Pourquoi Isolation Forest ?

**L'analogie du jeu de cartes :**
Imaginez un jeu de 52 cartes + 1 joker. Pour trouver le joker :
- **Forêt d'isolation** : à chaque étape, on coupe le paquet en deux
  aléatoirement. Le joker se retrouve tout seul très vite (peu de
  coupes nécessaires). Les cartes normales mettent beaucoup plus
  de coupes à être isolées.
- Le **score** d'Isolation Forest = profondeur moyenne d'isolation.
  Plus il est négatif, plus le point est facile à isoler → anomalie.

**Pourquoi ce modèle plutôt qu'un autre ?**

| Algorithme | Pour | Contre |
|------------|------|--------|
| **Isolation Forest** ✅ | Non-supervisé, rapide (O(n log n)), robuste | Assume que les anomalies sont rares et différentes |
| One-Class SVM | Bon en haute dimension | Lent sur > 100k lignes |
| LSTM Autoencoder | Capture les séquences | Lourd, nécessite beaucoup de données |
| Simple threshold (Z-score) | Très simple | Rate les anomalies contextuelles |

**Pour nous, Isolation Forest est le meilleur choix :**
- Pas besoin de données d'attaque pour l'entraînement
- 400k lignes traitées en ~10 secondes
- Peu de réglages nécessaires

---

## Étape 4 : Les features choisies (et pourquoi)

### Features gardées

| Feature | Capteur | Formule | Rôle |
|---------|---------|---------|------|
| `temperature` | Weather | - | Valeur brute de base |
| `temp_diff_1` | Weather | T(t) - T(t-1) | Capture les **sauts brusques** |
| `humidity_diff_1` | Weather | H(t) - H(t-1) | Complémentaire à la température |
| `temp_roll_mean_10` | Weather | moyenne(T(t-9)...T(t)) | **Lisse** le bruit, détecte les dérives |
| `temp_roll_std_10` | Weather | σ(T(t-9)...T(t)) | Mesure la **volatilité** récente |
| `fridge_temperature` | Fridge | - | Valeur brute |
| `fridge_diff_1` | Fridge | T_f(t) - T_f(t-1) | Sauts brusques du frigo |
| `fridge_roll_mean_10` | Fridge | moyenne(T_f(t-9)...T_f(t)) | Dérive du frigo |
| `temp_condition_encoded` | Fridge | 1=high, 0=low | État du compresseur |
| `current_temperature` | Thermostat | - | Valeur brute |
| `thermo_diff_1` | Thermostat | T_th(t) - T_th(t-1) | Sauts brusques du thermostat |
| `thermostat_status` | Thermostat | 1=ON, 0=OFF | État de la clim |
| `hour_sin`, `hour_cos` | Tous | sin(2π×h/24), cos(2π×h/24) | Encodage cyclique de l'heure |

### Features exclues

| Feature | Raison |
|---------|--------|
| `pressure` | Valeurs négatives aberrantes (identifié dans l'EDA) |
| `current_temperature` seule | Variance trop faible (σ=2.4) → on garde ses dérivées |
| `device_id` / `source_file` | Pas de valeur prédictive |

---

## Étape 5 : Les 4 modèles Isolation Forest

### Modèle 1 : Weather (8 features)

Entraîné sur **399 188 échantillons**. Features :
- temperature, humidity (valeurs brutes)
- temp_diff_1, humidity_diff_1 (Δt)
- temp_roll_mean_10, temp_roll_std_10 (rolling)
- hour_sin, hour_cos (cyclique)

### Modèle 2 : Fridge (6 features)

Entraîné sur **383 368 échantillons**. Features :
- fridge_temperature (valeur brute)
- temp_condition_encoded (état)
- fridge_diff_1 (Δt)
- fridge_roll_mean_10 (rolling)
- hour_sin, hour_cos (cyclique)

### Modèle 3 : Thermostat (5 features)

Entraîné sur **291 182 échantillons**. Features :
- current_temperature (valeur brute)
- thermostat_status (état)
- thermo_diff_1 (Δt)
- hour_sin, hour_cos (cyclique)

### Modèle 4 : Combiné (19 features)

**Pourquoi fusionner les capteurs ?** Une attaque peut n'affecter qu'un
seul capteur. Mais les corrélations entre capteurs sont informatives.
Exemple :
- Weather = 35°C + Fridge = 8°C → normal (le frigo compense la chaleur)
- Weather = 35°C + Fridge = 14°C → ANORMAL (le frigo ne refroidit plus)

**Comment fusionner ?** `merge_asof` avec tolérance de 5 secondes.
On associe chaque mesure Weather à la mesure Fridge et Thermostat
la plus proche dans le temps (max 5s d'écart).

**Résultat de la fusion :** 370 972 lignes combinées (sur ~400k possibles,
certaines mesures n'ont pas de correspondance dans les 5 secondes).

---

## Étape 6 : Baseline — test sur données normales

**Question :** Est-ce que le modèle détecte des anomalies sur des données
normales ? Si oui, combien ? Ce sont des **faux positifs**.

**Résultat :**

| Modèle | Anomalies détectées | Taux | Score moyen |
|--------|-------------------|------|-------------|
| Weather | 19 960 / 399 188 | 5.00% | +0.0713 |
| Fridge | 19 169 / 383 368 | 5.00% | +0.0871 |
| Thermostat | 14 560 / 291 182 | 5.00% | +0.1484 |
| Combiné | 18 549 / 370 972 | 5.00% | +0.0797 |

**Interprétation :**
- Exactement 5% pour tous → le paramètre `contamination=0.05` fonctionne
  comme prévu. Ces 5% sont les **outliers naturels** (variations rares
  mais normales), pas des attaques.
- Les scores moyens sont **positifs** → la majorité des données normales
  est bien reconnue comme normale.

---

## Étape 7 : Test sur les 9 types d'attaques

**Principe :** Pour chaque attaque, on charge les fichiers .log, on
applique le même feature engineering, et on regarde combien de mesures
sont classées "anomalie" par le modèle.

### Résultats par attaque

| Attaque | Weather | Fridge | Thermostat | Combiné |
|---------|---------|--------|------------|---------|
| **DDoS** | **100.0%** | 97.8% | 5.0% | 100.0% |
| **DoS** | **100.0%** | 99.8% | 51.9% | 100.0% |
| **MITM** | **100.0%** | **100.0%** | 23.3% | 100.0% |
| **XSS** | **100.0%** | 99.6% | 41.1% | 100.0% |
| **Backdoor** | **100.0%** | 98.6% | - | - |
| **Injection** | 99.4% | **99.8%** | 38.9% | 100.0% |
| **Password** | **100.0%** | 98.5% | 24.5% | 100.0% |
| **Ransomware** | 97.5% | 93.8% | 43.9% | 100.0% |
| **Scanning** | 74.2% | **99.4%** | 54.4% | 100.0% |

### Analyse détaillée

**Weather (le meilleur capteur) :**
- **100%** sur 7 types d'attaques sur 9
- **99.4%** sur injection (l'attaque imite des données normales)
- **74.2%** sur scanning (le scan réseau perturbe peu la température)
- Pourquoi ? La température extérieure a une grande variance (20-50°C),
  et les attaques provoquent des sauts que Δt capture parfaitement.

**Fridge (très bon) :**
- Toujours > 93%, souvent > 98%
- La variable `temp_condition` (high/low) donne un signal très fort :
  une attaque qui force le frigo à rester en mode high ou low est
  immédiatement détectée

**Thermostat (faible) :**
- 5% à 54% selon l'attaque
- **5% sur DDoS** = le thermostat ne détecte rien (c'est le bruit de fond)
- Pourquoi ? La température régulée est trop stable (25-35°C, σ=2.4).
  Le thermostat est ON 89% du temps → peu de signal utile.

**Modèle combiné (100% sur 8/9 attaques) :**
- La fusion des 3 capteurs donne une vue d'ensemble
- Attention : backdoor n'a pas pu être fusionné (problème de timestamps
  dans les logs). Solution : fallback sur Weather seul (100% quand même).
- Le combiné a moins d'échantillons (car il faut que les 3 capteurs
  aient des mesures à moins de 5 secondes d'intervalle).

---

## Étape 8 : Métriques détaillées (exemple avec DDoS)

Pour l'attaque DDoS, on calcule les métriques complètes :

### Weather
```
Matrice de confusion:
              Normal prédit   Attaque prédit
Normal réel      34 259           1 794
Attaque réel         16          36 037

ROC-AUC: 0.9991 | Précision Attaque: 0.953 | Rappel Attaque: 1.000 | F1: 0.976
```

**Lecture de la matrice :**
- **34 259 normaux** correctement identifiés (vrais négatifs)
- **1 794 faux positifs** (normaux classés comme attaque — ~5%)
- **16 faux négatifs** (attaques non détectées — seulement 16 sur 36 053)
- **36 037 vrais positifs** (attaques correctement détectées)

### Fridge
```
ROC-AUC: 0.9957 | Précision Attaque: 0.953 | Rappel Attaque: 0.978 | F1: 0.965
```

### Thermostat
```
ROC-AUC: 0.9186 | Précision Attaque: 0.508 | Rappel Attaque: 0.050 | F1: 0.091
```

**Rappel de 0.050** → sur 100 attaques, le thermostat n'en voit que 5.
C'est catastrophique. Mais la **ROC-AUC à 0.9186** est bonne : le
classement est correct (les attaques ont un score plus négatif), mais
le seuil par défaut est mal placé. On pourrait baisser le seuil pour
ce capteur spécifique.

---

## Étape 9 : Définition des métriques (pour le jury)

| Métrique | Formule | Exemple | Sens |
|----------|---------|---------|------|
| **Précision** | VP / (VP + FP) | 36 037 / (36 037 + 1 794) = 0.953 | Parmi les alarmes, 95.3% sont de vraies attaques |
| **Rappel** | VP / (VP + FN) | 36 037 / (36 037 + 16) = 1.000 | 100% des vraies attaques sont détectées |
| **F1-score** | 2 × (P × R) / (P + R) | 2 × (0.953 × 1.0) / (0.953 + 1.0) = 0.976 | Équilibre entre précision et rappel |
| **ROC-AUC** | Aire sous la courbe ROC | 0.9991 | Capacité à distinguer normal vs attaque (1 = parfait) |

**VP = Vrais Positifs** (attaque correctement identifiée)
**FP = Faux Positifs** (normal étiqueté attaque)
**FN = Faux Négatifs** (attaque manquée)
**VN = Vrais Négatifs** (normal correctement identifié)

---

## Étape 10 : Sauvegarde des modèles

Tout est sauvegardé dans `Data/Processed/` :

| Fichier | Contenu | Poids |
|---------|---------|-------|
| `isolation_forest_weather.joblib` | Modèle + scaler + features | ~50 MB |
| `isolation_forest_fridge.joblib` | Modèle + scaler + features | ~50 MB |
| `isolation_forest_thermostat.joblib` | Modèle + scaler + features | ~50 MB |
| `isolation_forest_combine.joblib` | Modèle + scaler + features | ~50 MB |
| `resultats_detection.csv` | Métriques par attaque | ~2 KB |

**Pour le backend :** On peut charger un modèle avec :
```python
import joblib
modele = joblib.load('Data/Processed/isolation_forest_weather.joblib')
```

Puis prédire en temps réel sur chaque nouvelle mesure.

---

## Résumé des performances

```
                  DDoS    DoS   MITM    XSS  Backdoor  Injection  Password  Ransomware  Scanning
Weather         100%   100%   100%   100%     100%      99.4%      100%      97.5%      74.2%
Fridge          97.8%  99.8%  100%  99.6%    98.6%     99.8%     98.5%      93.8%      99.4%
Thermostat       5.0%  51.9%  23.3%  41.1%      -       38.9%     24.5%      43.9%      54.4%
Combiné         100%   100%   100%   100%       -       100%      100%       100%       100%
```

**Conclusion :**
- ✅ **Weather** → excellent sur 7/9 attaques, bon sur les 2 autres
- ✅ **Fridge** → très bon sur toutes les attaques
- ❌ **Thermostat** → trop stable pour être utile seul
- ✅ **Combiné** → 100% quand la fusion est possible
- ✅ **Architecture retenue pour le backend** : Weather + Fridge en parallèle
