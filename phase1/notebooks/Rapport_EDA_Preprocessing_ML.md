# Rapport : Exploration, Prétraitement & Détection d'Anomalies IoT
## Explications pas à pas pour débutants — Notebooks 1 & 2

---

## PARTIE 1 : EXPLORATION DES DONNÉES (EDA)

### Étape 1 : Charger les données — le premier contact

**Problème :** On a 13 fichiers CSV répartis en 3 capteurs (Weather, Fridge,
Thermostat) qui enregistrent la température chaque seconde pendant 5 jours
(31 mars → 4 avril 2019). Comment les lire sans se tromper ?

**Solution :** On écrit une fonction `load_sensor()` qui :
1. Cherche tous les fichiers qui commencent par `IoT_normal_weather_` (ou fridge, Thermostat)
2. Les lit un par un avec `pd.read_csv()`
3. Nettoie les espaces parasites (ex: `'high '` → `'high'`)
4. Concatène tout en un seul DataFrame

**Pourquoi nettoyer les espaces ?** Si une colonne contient `'high '` avec
un espace à la fin, Python va croire que `'high '` ≠ `'high'`. Ça fausse
les comptages et les analyses.

**Résultat attendu :**
- Weather : 399 189 lignes, 5 colonnes (date, time, temperature, pressure, humidity)
- Fridge : 383 369 lignes, 4 colonnes (date, time, fridge_temperature, temp_condition)
- Thermostat : 291 183 lignes, 4 colonnes (date, time, current_temperature, thermostat_status)

---

### Étape 2 : Vérifier la qualité des données

**Problème :** Avant toute analyse, on doit savoir si les données sont
propres. Des valeurs manquantes ou des doublons fausseraient tout.

**Ce qu'on vérifie :**

| Contrôle | Outil | Pourquoi |
|----------|-------|----------|
| **Valeurs manquantes** | `df.isna().sum()` | Une température vide = trou dans la mesure |
| **Doublons** | `df.duplicated().sum()` | Une ligne en double = comptage faussé |
| **Types** | `df.dtypes` | Une température en texte ne peut pas être analysée |

**Interprétation :**
- Weather : 0 valeurs manquantes, 0 doublons → ✅ Parfait
- Fridge : 0 valeurs manquantes, 0 doublons → ✅ Parfait
- Thermostat : 0 valeurs manquantes, 0 doublons → ✅ Parfait

**Pourquoi les données sont si propres ?** C'est un dataset académique.
Dans la vraie vie (usine, entrepôt), les capteurs IoT ont souvent des
pannes, des trous de transmission, du bruit. Ici, on peut passer
directement à l'analyse.

---

### Étape 3 : Analyser le capteur Weather (station météo)

#### Ce qu'on veut savoir
- Quelle température fait-il dans cet atelier ?
- L'humidité varie-t-elle ? La pression est-elle fiable ?
- Y a-t-il déjà des valeurs extrêmes dans le fonctionnement normal ?

#### Les outils statistiques expliqués

**Moyenne (average)** : On additionne toutes les températures, on divise
par le nombre de mesures. C'est la température "typique".

**Médiane (median)** : On trie toutes les températures du plus petit au
plus grand. La médiane est celle du milieu. Si la moyenne et la médiane
sont différentes, la distribution est asymétrique.

**Écart-type (std)** : Il mesure comment les valeurs s'éloignent de la
moyenne. Plus il est grand, plus les données sont dispersées.

**Quartiles (Q1, Q3)** : On coupe les données triées en 4 parts égales :
- Q1 = 25% des données sont en dessous
- Q2 = médiane = 50% en dessous
- Q3 = 75% en dessous

**IQR (Interquartile Range)** : Q3 - Q1. C'est l'intervalle qui contient
50% des données du milieu. Utile pour détecter les outliers.

**Skewness (asymétrie)** : Mesure si la distribution est penchée :
- Skew ≈ 0 : symétrique (la cloche est équilibrée)
- Skew > 0 : queue à droite (plus de valeurs élevées que basses)
- Skew < 0 : queue à gauche (plus de valeurs basses)

**Kurtosis (aplatissement)** : Mesure si la distribution est pointue ou aplatie :
- ≈ 0 : normale (comme une gaussienne)
- > 0 : pointue (beaucoup de valeurs près de la moyenne + des extrêmes)
- < 0 : aplatie (les valeurs sont étalées, pas de pic net)

**Test de normalité (D'Agostino-Pearson)** :
- p > 0.05 : la distribution est normale (gaussienne)
- p < 0.05 : la distribution n'est pas normale

**Pourquoi ça nous intéresse ?** Beaucoup de modèles ML (dont Isolation
Forest) fonctionnent mieux sans hypothèse de normalité. Si nos données
sont déjà non-normales, c'est parfait.

#### Résultats pour Weather

| Variable | Min | Max | Moyenne | Écart-type | Problème ? |
|----------|-----|-----|---------|------------|------------|
| **Température** | 20.5°C | 50°C | 36.2°C | 8.2°C | ✅ Bonne variance |
| **Pression** | -37.6 | 26.7 | 2.07 | 9.1 | ❌ Négatif = impossible |
| **Humidité** | 0% | 100% | 53.3% | 27.4% | ✅ Variation maximale |

**Découverte importante :** La pression a des valeurs négatives (-37.6).
Une pression atmosphérique ne peut pas être négative. C'est une erreur
de capteur ou de conversion. On exclut cette colonne.

**Décision :** On garde température et humidité pour le ML. On jette
la pression.

---

### Étape 4 : Analyser le capteur Fridge (chambre froide)

#### Le cycle du frigo
Un frigo fonctionne par cycles :
1. **Phase haute (high)** : la température monte, le compresseur est OFF
2. **Phase basse (low)** : le compresseur s'allume, la température descend

La variable `temp_condition` étiquette chaque mesure : 'high' ou 'low'.

#### Résultats

| Statistique | Valeur | Interprétation |
|-------------|--------|----------------|
| Min | 1.0°C | Le frigo peut descendre à 1°C |
| Max | 14.0°C | et monter jusqu'à 14°C |
| Moyenne | 7.1°C | Température de fonctionnement typique |
| Médiane | 6.7°C | Proche de la moyenne → distribution symétrique |

**Répartition high/low :**
- high (compresseur OFF) : 56% du temps
- low (compresseur ON) : 44% du temps

Les deux phases sont bien équilibrées. Et surtout, la température en
mode high est clairement différente de la température en mode low
(visible sur le boxplot). `temp_condition` sera une feature précieuse
pour le ML.

---

### Étape 5 : Analyser le capteur Thermostat

**Spécificité :** Le thermostat régule la température. On s'attend à
une température quasi-constante si la climatisation fonctionne bien.

#### Résultats

| Statistique | Valeur |
|-------------|--------|
| Min | 25.0°C |
| Max | 35.0°C |
| Moyenne | 28.7°C |
| Écart-type | 2.4°C |
| ON (True) | 88.7% du temps |
| OFF (False) | 11.3% du temps |

**Problème :** L'écart-type de 2.4°C est faible par rapport à la plage
(25-35°C). Et le thermostat est allumé 89% du temps. Une variable presque
constante = peu d'information pour le ML. On garde la température mais
on créera des features dérivées (Δt) pour capturer les changements.

---

### Étape 6 : Histogrammes et boxplots — lire les graphiques

**Histogramme :** Découpe les données en "tranches" (bins) et compte
combien de mesures tombent dans chaque tranche. La hauteur de chaque
barre = le nombre de mesures dans cette tranche.

**Courbe KDE (Kernel Density Estimation) :** C'est une version lissée
de l'histogramme. Imaginez que chaque mesure est une petite cloche
gaussienne, on les additionne toutes pour obtenir une courbe continue.
Ça permet de mieux voir la forme de la distribution.

**Boxplot (boîte à moustaches) :**
```
     ┌─────┬─────┐
  ───┤  Q1 │ Méd │ Q3 ├───
     └─────┴─────┘
```
- La boîte contient 50% des données (de Q1 à Q3)
- Le trait dans la boîte = la médiane
- Les "moustaches" (────) vont jusqu'aux données non-extrêmes
- Les points isolés sont les outliers potentiels

---

### Étape 7 : Relations entre les capteurs (cross-corrélation)

**Pourquoi ?** Les 3 capteurs mesurent des températures dans le même
bâtiment. Si la météo change, le frigo et le thermostat réagissent.
Ces relations sont importantes pour comprendre le système.

**Corrélation de Pearson (r)** : Mesure la relation linéaire entre
deux variables. La valeur va de -1 à +1 :
- r = +1 : quand l'un monte, l'autre monte (parfaitement)
- r = -1 : quand l'un monte, l'autre descend
- r = 0 : pas de relation linéaire

**Résultats :**
- Weather vs Fridge : r ≈ -0.94 → TRÈS FORTE corrélation négative.
  Quand il fait plus chaud dehors, le frigo refroidit plus.
- Weather vs Thermostat : r ≈ -0.97 → Presque parfait. Quand il fait
  chaud, la climatisation compense.
- Fridge vs Thermostat : r ≈ +0.94 → Les deux réagissent dans le même
  sens à la météo.

**Ce que ça signifie :** Les capteurs ne sont pas indépendants. On ne
peut pas les analyser séparément. Un modèle qui combine les 3 capteurs
(comme notre modèle combiné plus tard) sera plus performant.

---

### Étape 8 : ACP (Analyse en Composantes Principales)

**Problème :** On a 3 capteurs avec plusieurs colonnes chacun. Comment
visualiser tout ça en 2D ?

**Solution :** L'ACP projette les données multi-dimensionnelles sur
2 axes (PC1 et PC2) qui capturent le maximum de variance.

**Interprétation :**
- PC1 (1er axe) : capture la plus grande source de variation dans les
  données. Ici, c'est la température extérieure (Weather).
- PC2 (2ème axe) : capture la 2ème plus grande source, indépendante
  de la première. Ici, c'est l'humidité.
- Les données normales forment un "nuage" allongé → la variation
  principale est le cycle jour/nuit.

**Vecteurs propres (loadings) :** Ils montrent quelle colonne contribue
à chaque axe. Plus la flèche est longue, plus la variable est importante
pour cet axe.

---

## PARTIE 2 : PRÉTRAITEMENT & FEATURE ENGINEERING

### Étape 9 : Standardisation des formats

**Problème :** Les dates sont dans des formats mélangés (`31 Mar 2019`,
`1-Apr-19`, `2019-04-01`). Chaque capteur a des noms de colonnes
différents. On doit tout uniformiser.

**Solution :**
1. On combine `date` + `time` en une colonne `datetime` unique
2. On convertit avec `pd.to_datetime(dayfirst=True, format='mixed')`
3. On trie par datetime
4. On ne garde que les colonnes utiles

**Pourquoi `dayfirst=True` ?** Parce que `31 Mar 2019` signifie 31 mars
(le jour est avant le mois). En France et dans ce dataset, c'est le
format jour/mois/année.

**Pourquoi `format='mixed'` ?** Parce que les fichiers n'ont pas tous
le même format de date. `mixed` dit à pandas d'essayer plusieurs formats
et de choisir celui qui marche.

---

### Étape 10 : Création des features temporelles

#### Feature 1 : Δt (différence entre t et t-1)

**Formule :**
```
temp_diff_1(t) = température(t) - température(t-1)
```

**Pourquoi ?** En fonctionnement normal, la température change
lentement. La différence entre deux secondes consécutives est
proche de 0. Une attaque (DDoS, injection de données) provoque
des sauts brusques → la différence devient grande (positive ou
négative).

**Exemple :**
- Normal : température = 36.2°C, puis 36.3°C → Δt = +0.1°C
- Attaque : température = 36.2°C, puis 50.0°C → Δt = +13.8°C

**Calcul :**
```
temp_diff_1 = [NaN, 36.3-36.2=0.1, 36.1-36.3=-0.2, ...]
```
La première valeur est NaN (on n'a pas t-1). On supprime cette ligne.

#### Feature 2 : Moyenne mobile (rolling mean)

**Formule :**
```
temp_roll_mean_10(t) = moyenne de température(t-9) à température(t)
```

**Pourquoi ?** La température brute peut avoir du bruit (un capteur
peut donner 36.2°C puis 36.8°C puis 36.1°C à cause de fluctuations
électriques). La moyenne mobile sur 10 secondes lisse ce bruit.

**Exemple :**
Derrière les 10 dernières températures : [36.2, 36.3, 36.1, 36.4,
36.2, 36.3, 36.1, 36.2, 36.3, 36.2]
Moyenne = (36.2 + 36.3 + ... + 36.2) / 10 = 36.23°C

#### Feature 3 : Écart-type mobile (rolling std)

**Formule :**
```
temp_roll_std_10(t) = écart-type de température(t-9) à température(t)
```

**Pourquoi ?** Il mesure la volatilité récente. Si les 10 dernières
secondes sont stables, l'écart-type est petit. Si une attaque
provoque des oscillations, l'écart-type augmente.

**Exemple :**
- Normal : [36.2, 36.3, 36.1, 36.2, ...] → σ ≈ 0.1
- Attaque : [36.2, 42.0, 30.1, 45.0, ...] → σ ≈ 6.5

---

### Étape 11 : Encodage des variables catégorielles

**Problème :** Les modèles ML ne comprennent que les nombres.
`temp_condition = 'high'` ou `thermostat_status = False` ne sont
pas des nombres.

**Solution :**

Pour `temp_condition` (frigo) :
```
temp_condition_encoded = 1 si 'high', 0 si 'low'
```

Pour `thermostat_status` :
```
thermostat_status = 1 si True (ON), 0 si False (OFF)
```

C'est ce qu'on appelle du **one-hot encoding** ou **label encoding**
quand il n'y a que 2 catégories.

---

### Étape 12 : Encodage cyclique de l'heure

**Problème :** 23h et 1h sont proches (minuit), mais 23 - 1 = 22
en différence numérique. L'algorithme va croire qu'elles sont très
éloignées alors qu'elles sont voisines.

**Solution :** On projette l'heure sur un cercle avec sinus et cosinus.

**Formules :**
```
hour_sin = sin(2π × heure / 24)
hour_cos = cos(2π × heure / 24)
```

**Pourquoi sinus et cosinus ?** Imaginez une horloge. 23h est à 23h
et 1h est à 1h. Mais sur le cercle, 23h et 1h sont très proches
(seulement 2h d'écart).
- Sinus tout seul ne suffit pas car sin(0) = sin(π) = 0
  (minuit et midi auraient la même valeur)
- Cosinus tout seul ne suffit pas car cos(0) = cos(2π) = 1
- Les DEUX ensemble codent chaque heure de façon unique

**Exemple :**
- Minuit (0h) : sin(0)=0, cos(0)=1
- Midi (12h) : sin(π)=0, cos(π)=-1
- 18h : sin(3π/2)=-1, cos(3π/2)=0

---

### Étape 13 : Normalisation avec StandardScaler

**Problème :** L'Isolation Forest est sensible aux échelles. Une
température (20-50°C) et une humidité (0-100%) ont des ordres de
grandeur différents. Sans normalisation, l'humidité dominerait
l'analyse simplement parce que ses nombres sont plus grands.

**La formule du z-score :**
```
z = (x - moyenne) / écart-type
```

**Terme par terme :**
- `x` : la valeur brute (ex: température = 36.2°C)
- `moyenne` : la moyenne de toutes les températures (36.2°C)
- `(x - moyenne)` : l'écart à la moyenne (0.0 si on est à la moyenne)
- `écart-type` : la dispersion typique des données (8.2°C)

**Exemple concret :**
- Température = 44.4°C (un jour chaud) :
  z = (44.4 - 36.2) / 8.2 = 8.2 / 8.2 = 1.0
  Cette valeur est à 1 écart-type au-dessus de la moyenne

- Température = 28.0°C (un jour frais) :
  z = (28.0 - 36.2) / 8.2 = -8.2 / 8.2 = -1.0
  Cette valeur est à 1 écart-type en dessous de la moyenne

**Après normalisation :**
- Chaque feature a une moyenne de 0
- Chaque feature a un écart-type de 1
- La FORME de la distribution est préservée (juste l'échelle qui change)

**Pourquoi StandardScaler et pas MinMaxScaler ?**
- StandardScaler est robuste aux outliers (quelques valeurs extrêmes
  ne déforment pas tout)
- L'Isolation Forest utilise la distance, le z-score est mieux adapté

---

### Étape 14 : Sauvegarde des données préparées

On sauvegarde 3 fichiers CSV :
- `features_weather.csv` : 8 features, ~399k lignes
- `features_fridge.csv` : 6 features, ~383k lignes
- `features_thermostat.csv` : 5 features, ~291k lignes

Et 3 scalers (format .joblib) pour normaliser les futures données
d'attaque de la MÊME façon.

**Pourquoi sauvegarder les scalers ?** Quand on testera les attaques,
on doit appliquer exactement la même transformation. Si on recalcule
la moyenne sur les données d'attaque, elle sera différente et les
résultats seront faussés.

---

## PARTIE 3 : ISOLATION FOREST & DÉTECTION D'ATTAQUES

### Étape 15 : Qu'est-ce qu'Isolation Forest ?

**L'idée en une phrase :** Les anomalies sont plus faciles à isoler
que les points normaux.

**Comment ça marche :**
1. On prend un échantillon de données
2. On choisit aléatoirement une feature (ex: température)
3. On choisit aléatoirement une valeur de coupe (ex: 30°C)
4. On sépare les données en 2 groupes (temp < 30°C, temp ≥ 30°C)
5. On répète jusqu'à ce que chaque point soit seul
6. On compte combien de coupes (profondeur) il a fallu pour chaque point

**Résultat :**
- Un point normal a besoin de BEAUCOUP de coupes pour être isolé
  (il est entouré d'autres points similaires)
- Une anomalie est isolée très VITE (elle est toute seule dans son coin)

**Analogie :**
- Normal = une aiguille dans une botte de foin (difficile à trouver)
- Anomalie = une aiguille sur une table vide (facile à isoler)

---

### Étape 16 : Les 4 modèles

On entraîne 4 modèles :
1. **Weather seul** : 8 features (température, humidité, Δt, rolling, heure)
2. **Fridge seul** : 6 features (température frigo, état, Δt, rolling, heure)
3. **Thermostat seul** : 5 features (température, statut, Δt, heure)
4. **Combiné** : fusion des 3 capteurs → jusqu'à 19 features

**Paramètres d'Isolation Forest :**
- `contamination=0.05` : On s'attend à ~5% d'outliers naturels dans
  les données normales (ce ne sont pas des attaques, juste des variations
  rares)
- `n_estimators=200` : 200 arbres aléatoires. Plus il y a d'arbres,
  plus l'estimation est stable
- `random_state=42` : Pour que les résultats soient reproductibles

**Baseline :** On vérifie que les modèles ne détectent pas trop de
faux positifs sur les données normales. Résultat : ~5%, ce qui est
exactement ce qu'on attend avec contamination=0.05.

---

### Étape 17 : Le modèle combiné (fusion inter-capteurs)

**Pourquoi fusionner ?** Une attaque peut n'affecter qu'un seul capteur.
Mais la combinaison des 3 peut révéler des corrélations anormales.

Par exemple : température extérieure = 30°C + frigo = 10°C peut être
normal (le frigo compense la chaleur). Mais si en plus l'humidité
chute à 0%, c'est peut-être une attaque.

**Comment fusionner :** `merge_asof` avec tolérance de 5 secondes.
On aligne les timestamps des 3 capteurs en associant chaque mesure
weather à la mesure fridge la plus proche (≤ 5s d'écart).

---

### Étape 18 : Tests sur 9 types d'attaques

Les données d'attaque sont dans des fichiers `.log` (format JSON Lines).
Chaque ligne est un objet JSON : `{"timestamp": "...", "temperature": ...}`.

**Pipeline de test :**
1. Charger les fichiers .log
2. Parser les timestamps (RFC 1123 → datetime pandas)
3. Appliquer le MÊME feature engineering que sur les données normales
4. Normaliser avec LE MÊME scaler (pas de refit !)
5. Prédire avec Isolation Forest

**Métriques de performance :**

| Métrique | Formule | Sens |
|----------|---------|------|
| **Taux de détection** | anomalies_détectées / total_attaques | Pourcentage d'attaques repérées |
| **Précision** | VP / (VP + FP) | Parmi les alarmes, combien sont de vraies attaques ? |
| **Rappel** | VP / (VP + FN) | Parmi les vraies attaques, combien sont détectées ? |
| **F1-score** | 2 × (P × R) / (P + R) | Équilibre entre précision et rappel |
| **ROC-AUC** | Aire sous la courbe ROC | Discrimination : 1 = parfait, 0.5 = aléatoire |

**VP = Vrais Positifs** (attaque correctement identifiée)
**FP = Faux Positifs** (normal identifié comme attaque)
**FN = Faux Négatifs** (attaque non détectée)
**VN = Vrais Négatifs** (normal correctement identifié)

---

### Étape 19 : Résultats de la détection

**Weather :** 100% sur 7/9 attaques, 99.4% sur injection, 74.2% sur scanning
→ Excellent capteur, le meilleur des 3.

**Fridge :** 93.8-100% sur tous les types d'attaques
→ Très bonne détection, surtout parce que la variable `temp_condition`
(high/low) donne un signal fort.

**Thermostat :** 5-54% selon l'attaque → Faible. La température est
trop stable (σ=2.4) et le statut ON/OFF manque de variabilité.

**Modèle combiné :** Performances limitées par les timestamps
synthétiques du thermostat (pas de date réelle dans les logs d'attaque).
Solution pratique : fusionner weather + fridge uniquement.

---

## Récapitulatif des formules

| Feature | Formule | Rôle |
|---------|---------|------|
| Δt | X(t) - X(t-1) | Capture les changements brusques |
| Moyenne mobile | moyenne(X(t-9)...X(t)) | Lisse le bruit |
| Écart-type mobile | σ(X(t-9)...X(t)) | Mesure la volatilité |
| Heure sin | sin(2π × h / 24) | Encodage cyclique |
| Heure cos | cos(2π × h / 24) | Encodage cyclique |
| Z-score | (x - μ) / σ | Normalisation |
| IF score | profondeur moyenne d'isolation | Distance à la normale |

## Fichiers produits

| Fichier | Contenu | Utilité |
|---------|---------|---------|
| `features_weather.csv` | 8 features normalisées | Entraînement IF Weather |
| `features_fridge.csv` | 6 features normalisées | Entraînement IF Fridge |
| `features_thermostat.csv` | 5 features normalisées | Entraînement IF Thermostat |
| `scaler_*.joblib` | StandardScalers ajustés | Normalisation des attaques |
| `isolation_forest_*.joblib` | Modèles entraînés | Détection en production |
| `resultats_detection.csv` | Métriques par attaque | Analyse des performances |
