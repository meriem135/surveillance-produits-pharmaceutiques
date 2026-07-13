# Rapport Technique : Génération d'une Année de Données IoT
## Explications pas à pas pour débutants

---

## Le problème de départ

**Ce qu'on a :** 5 fichiers de données réelles (31 mars → 4 avril 2019).
Chaque fichier contient des températures enregistrées **chaque seconde**.
3 capteurs : météo extérieure (weather), frigo (fridge), thermostat intérieur.

**Ce qu'on veut :** 1 année complète (2019) pour entraîner un modèle de
détection d'attaques informatiques.

**La difficulté :** Comment créer 365 jours de données réalistes à partir
de seulement 5 jours ? On ne peut pas recopier les 5 jours en boucle
(ça ferait JEUDI = LUNDI 52 fois, pas réaliste).

**Notre idée :** Décomposer le problème en 5 sous-problèmes indépendants,
résoudre chacun séparément, puis tout reconstruire.

---

## Étape 1 : Analyser ce qu'on a (les données réelles)

Avant de générer, on regarde nos 5 jours pour comprendre comment se comporte
la température.

### Le profil journalier

On calcule la température **moyenne à chaque heure** sur les 5 jours :

```
Heure 0 (minuit) : moyenne des températures à minuit sur 5 jours
Heure 1 (1h)     : moyenne des températures à 1h du matin sur 5 jours
...
Heure 14 (14h)   : moyenne des températures à 14h sur 5 jours
...
```

**Résultat observé :**
- Minimum vers 5h du matin (il a fait froid toute la nuit)
- Maximum vers 14h (le soleil a chauffé l'après-midi)
- La différence entre le max et le min s'appelle **l'amplitude thermique**

On **centre** ce profil (on enlève la moyenne générale) pour n'avoir que
la "forme" du cycle jour/nuit. C'est comme un **pochoir** : on a la forme,
et on pourra l'agrandir/rétrécir/décaler selon la saison.

---

## Étape 2 : Créer les saisons

### Le problème
Comment faire varier la température sur l'année ? Il fait chaud en été,
froid en hiver. Il faut une courbe qui monte et descend.

### La solution intuitive : une vague (sinusoïde)

Imaginez une vague qui monte et descend régulièrement :

```
y = A × sin(2π × (jour - 80) / 365)
```

**Décortiquons cette formule :**
- `jour` : le numéro du jour (1 = 1er janvier, 365 = 31 décembre)
- `(jour - 80)` : on décale de 80 jours pour que le printemps commence vers le 21 mars
- `/ 365` : on divise pour qu'un cycle complet fasse exactement 365 jours
- `2π × ...` : 2π = 360° = un tour complet. Ça transforme les jours en angle
- `sin(...)` : la fonction sinus transforme un angle en une valeur entre -1 et 1
- `A = 10` : l'amplitude. Ça multiplie le résultat. Si A=10, la température
  varie entre -10°C et +10°C autour de la moyenne

**Exemple concret :**
- Jour 80 (21 mars) : sin(0) = 0 → température = 0 (ni chaud ni froid)
- Jour 172 (21 juin) : sin(π/2) ≈ 1 → température = +10°C (été)
- Jour 266 (21 septembre) : sin(π) = 0 → température = 0
- Jour 355 (21 décembre) : sin(3π/2) ≈ -1 → température = -10°C (hiver)

**Limite de cette approche :** l'été et l'hiver sont parfaitement symétriques.
Même durée, même forme, mêmes transitions. Dans la réalité, le printemps
est plus court que l'été.

### La solution améliorée : combiner 3 vagues (Fourier K=3)

Au lieu d'une seule vague, on en prend **3 de fréquences différentes**
et on les additionne. C'est comme mélanger 3 couleurs pour obtenir
une couleur plus nuancée.

#### Formule complète :

```
T_saison(j) = somme_pour_k=1_à_3 de [ A_k × sin(2π × k × (j-80) / 365) + B_k × cos(2π × k × (j-80) / 365) ]
```

**Terme par terme :**
- `k` : le numéro de la vague (k=1, k=2, k=3)
- `A_k` : la force de la vague sin pour k
- `B_k` : la force de la vague cos pour k
- On choisit A_k = 6/k et B_k = 4/k → les vagues rapides (k=2, k=3)
  sont moins fortes que la vague principale (k=1)

**Détail de chaque vague :**
- **k=1** (vague lente) : A₁=6, B₁=4 → c'est la vague principale,
  elle dessine le cycle été/hiver de base
- **k=2** (vague 2× plus rapide) : A₂=3, B₂=2 → elle fait 2 cycles
  dans l'année. Elle casse la symétrie en "tirant" la courbe vers
  le haut au printemps et vers le bas à l'automne
- **k=3** (vague 3× plus rapide) : A₃=2, B₃=1.33 → elle affine
  la forme générale

**Pourquoi on ajoute des cos ?**
Le sinus donne une courbe qui passe par 0 au départ. Le cosinus
décale la courbe horizontalement. Ensemble, ils permettent de
positionner le pic exactement où on veut.

**Résultat visuel :** La courbe finale (rouge) n'est plus symétrique :
- L'été est plus long et plus plat (les chaleurs s'installent)
- L'hiver est plus court et plus froid
- Le printemps monte rapidement
- L'automne descend lentement

---

## Étape 3 : Adapter le cycle jour/nuit à chaque saison

### Le problème
Le profil jour/nuit n'est pas le même en été et en hiver. En été,
les journées sont plus longues, le pic de chaleur est plus haut
et arrive plus tard.

### Notre solution : déformer le profil (warping)

On prend le profil de base (printemps) et on le transforme avec
2 réglages qui dépendent du jour J.

#### Réglage 1 : L'amplitude

```
amplitude(J) = 0.6 + 0.4 × sin(2π × (J - 80) / 365)
```

**Valeurs selon la saison :**
- Printemps (J=80) : sin(0)=0 → amplitude = 0.6+0 = 0.6 (le profil
  est à 60% de sa hauteur de base, parce qu'on l'a déjà centré)
- Été (J=172) : sin(π/2)=1 → amplitude = 0.6+0.4 = 1.0 (on garde
  la hauteur de base)
- Hiver (J=355) : sin(3π/2)=-1 → amplitude = 0.6-0.4 = 0.2
  (le profil est réduit à 20% de sa hauteur)

*Pourquoi 0.6 et 0.4 ?* Parce que 0.6 + 0.4 = 1.0 donne l'amplitude
maximale en été, et 0.6 - 0.4 = 0.2 donne l'amplitude minimale en hiver.
Ces valeurs ont été calibrées pour correspondre aux climats tempérés.

#### Réglage 2 : Le décalage horaire

```
décalage(J) = 2 × sin(2π × (J - 80) / 365)
```

Le décalage est en **heures**.

- Printemps (J=80) : décalage = 0 → le pic est à l'heure normale
- Été (J=172) : décalage = +2h → les températures maximales
  arrivent 2h plus tard dans l'après-midi
- Hiver (J=355) : décalage ≈ -2h → le pic arrive 2h plus tôt

**Comment on applique le décalage ?**
On décale les heures. Par exemple, pour l'été avec +2h :
- La valeur qui était à 14h devient la valeur à 16h
- La valeur qui était à 6h (lever du soleil) devient la valeur à 8h
- Tout le profil est glissé vers la droite de 2h

**Résultat final :**
- Le profil d'été est plus haut et décalé vers la droite
- Le profil d'hiver est plus bas et décalé vers la gauche
- Le profil de printemps/automne sont entre les deux

---

## Étape 4 : Ajouter un bruit réaliste avec mémoire

### Le problème
Un bruit blanc (valeurs aléatoires indépendantes) n'est pas réaliste
pour des températures. Si il fait 20°C à 10h, il fera probablement
encore autour de 20°C à 10h05. C'est ce qu'on appelle **l'inertie
thermique**. Il y a une **mémoire** dans le système.

### Notre solution : le modèle AR(1)

AR(1) = AutoRégressif d'ordre 1. Ça signifie que la valeur à
l'instant t dépend de la valeur à l'instant t-1 (juste avant).

#### La formule

```
ε(t) = φ × ε(t-1) + η(t)
```

**Décortiquons chaque morceau :**
- `ε(t)` (epsilon) : le bruit à l'instant t (ce qu'on veut calculer)
- `ε(t-1)` : le bruit à l'instant t-1 (juste avant, on le connaît)
- `φ` (phi) : le coefficient de "mémoire". C'est un nombre entre 0 et 1.
- `η(t)` (êta) : une petite secousse aléatoire, tirée d'une loi normale
  (gaussienne). C'est le seul élément vraiment aléatoire.

#### Exemple concret avec φ = 0.9

Imaginons :
- ε(t-1) = 2.0 (le bruit était de +2°C à l'instant d'avant)
- φ = 0.9 (mémoire forte)
- η(t) = -0.3 (petite secousse aléatoire)

```
ε(t) = 0.9 × 2.0 + (-0.3) = 1.8 - 0.3 = 1.5
```

Le bruit passe de 2.0 à 1.5 : il a baissé un peu, mais il reste proche.
Sans mémoire (φ=0), on aurait ε(t) = -0.3 : un saut brutal.

Avec mémoire forte (φ=0.95) :
```
ε(t) ≈ 0.95 × ε(t-1) + petite secousse
```
Le bruit change très lentement, il "colle" à sa valeur précédente.

Avec mémoire faible (φ=0.3) :
```
ε(t) ≈ 0.3 × ε(t-1) + petite secousse
```
Le bruit change rapidement, il ressemble presque à du bruit blanc.

#### Comment trouve-t-on φ ?

On prend les **vraies données**, on extrait le bruit résiduel
(la différence entre la température mesurée et la moyenne locale),
et on calcule :

```
φ = (moyenne de ε(t) × ε(t-1)) / (moyenne de ε(t-1)²)
```

C'est la formule de la **régression linéaire** : on cherche le
meilleur coefficient pour prédire ε(t) à partir de ε(t-1).

On sous-échantillonne d'abord à 5 minutes (pas 1 seconde) parce
qu'on veut le coefficient à l'échelle de notre génération.

---

## Étape 5 : Coupler les capteurs entre eux

### Le problème
Les 3 capteurs ne sont pas indépendants. La météo influence le frigo
et le thermostat. Si on les génère séparément, on perd ces relations.

### Les relations physiques

1. **Météo → Frigo** : quand il fait chaud dehors, le frigo doit
   refroidir plus. Donc si la température extérieure augmente,
   la température du frigo **diminue**.

2. **Météo → Thermostat** : la climatisation compense la chaleur.
   Plus il fait chaud dehors, plus la clim refroidit.

3. **Frigo → Thermostat** : les deux réagissent à la météo, donc
   ils bougent dans le même sens.

### Les équations

#### Pour le frigo :
```
T_fridge = 7.0 - 0.10 × (T_weather - 25) + bruit(0, 0.5)
```

**Terme par terme :**
- `T_weather - 25` : on calcule l'écart par rapport à 25°C (température
  de référence, un "printemps typique")
- `-0.10 × ...` : le coefficient -0.10 dit que pour chaque degré au-dessus
  de 25°C, le frigo baisse de 0.10°C. C'est la force du couplage.
- `7.0` : température de base du frigo quand il fait 25°C dehors
- `bruit(0, 0.5)` : une petite variation aléatoire de ±0.5°C en moyenne

**Exemples :**
- S'il fait 25°C : T_fridge = 7.0 - 0.10 × 0 = 7.0°C
- S'il fait 35°C : T_fridge = 7.0 - 0.10 × 10 = 6.0°C (le frigo refroidit plus)
- S'il fait 15°C : T_fridge = 7.0 - 0.10 × (-10) = 8.0°C (le frigo a moins de travail)

#### Pour le thermostat :
```
T_thermo = 24.0 - 0.12 × (T_weather - 25) + bruit(0, 0.3)
```

Même principe, avec :
- `24.0` : température de confort de base (la clim maintient 24°C)
- `-0.12` : couplage plus fort que pour le frigo (la clim réagit plus vite)
- `bruit(0, 0.3)` : moins de bruit que le frigo (le thermostat est plus précis)

#### Pourquoi ces coefficients précis ?
Ils ont été choisis pour produire des corrélations de r ≈ -0.94
(weather-fridge) et r ≈ -0.97 (weather-thermostat), ce qui correspond
à des relations physiques fortes mais pas parfaites (la réalité
a toujours un peu de variabilité).

### À quoi sert la fonction "clip" ?
```
np.clip(valeur, min, max)
```
Elle empêche les températures de sortir des bornes réalistes :
- Frigo : entre 0.5°C et 14.0°C (un frigo ne peut pas descendre
  sous 0°C ni monter à température ambiante)
- Thermostat : entre 18°C et 32°C (confort humain)

---

## Étape 6 : Créer des événements extrêmes (canicules, froid)

### Le problème
Sans événements rares, les données sont "trop parfaites". Dans la
réalité, il y a des canicules en été et des vagues de froid en hiver.

Si notre modèle IDS n'a jamais vu d'extrême climatique, il va
confondre une canicule avec une attaque informatique.

### Notre solution : la loi GEV

GEV = Generalized Extreme Value (loi des valeurs extrêmes généralisée).
C'est une loi mathématique qui sert à modéliser... les événements extrêmes !
Les ouragans, les crues centennales, les records de température.

#### Les 3 paramètres de la GEV
```
X ~ GEV(ξ=0.2, μ=12, σ=4)
```

- **ξ (xi) = 0.2** : paramètre de forme. Il contrôle la "lourdeur"
  de la queue de la distribution.
  - ξ = 0 : loi de Gumbel (queue légère, comme la gaussienne)
  - ξ > 0 : loi de Fréchet (queue lourde, plus d'extrêmes)
  - ξ < 0 : loi de Weibull (queue bornée, pas d'extrêmes)
  - Notre choix ξ = 0.2 donne une queue modérément lourde,
    comme les températures réelles

- **μ (mu) = 12** : paramètre de localisation (la moyenne).
  Un extrême typique a une amplitude de 12°C.

- **σ (sigma) = 4** : paramètre d'échelle (la dispersion).
  La plupart des extrêmes sont entre 12-4=8°C et 12+4=16°C,
  mais certains peuvent aller jusqu'à 30-40°C.

#### Comparaison GEV vs Gaussienne

Une gaussienne classique (courbe en cloche) :
- 68% des valeurs sont dans ±1 écart-type
- 95% dans ±2 écarts-types
- 99.7% dans ±3 écarts-types
- Au-delà de ±4σ (soit 12±16 = 28°C), c'est quasiment impossible

Une GEV(ξ=0.2) :
- La queue descend **beaucoup moins vite** que la gaussienne
- Des valeurs à 30-40°C sont rares mais possibles
- C'est exactement ce qu'on observe dans les records climatiques

#### Le déclenchement : processus de Poisson

À chaque pas de temps (toutes les 5 minutes), on lance une pièce :
```
probabilité d'un extrême = 0.001 = 0.1% = 1 chance sur 1000
```

Ça donne environ :
- 105 120 pas de temps × 0.001 ≈ 105 événements par an
- Certains seront des canicules, d'autres des vagues de froid

#### Règle d'application

```
Si jour 170-260 (été) : T += amplitude_GEV  → canicule
Si jour < 80 ou > 340 (hiver) : T -= amplitude_GEV → vague de froid
Sinon (printemps/automne) : T += ±amplitude_GEV → signe aléatoire
```

---

## Étape 7 : Tout assembler

### La formule finale

Pour chaque instant (toutes les 5 minutes) :

```
T_weather(t) = T_saison(jour) + T_profil(heure, jour) + ε_AR1(t) + Extrême
```

**Les 4 composantes additionnées :**
1. **T_saison(jour)** : la température de base pour ce jour (Fourier K=3)
   → varie entre -15°C et +15°C environ
2. **T_profil(heure, jour)** : l'écart dû au cycle jour/nuit (warping)
   → varie entre -5°C et +5°C autour de la moyenne
3. **ε_AR1(t)** : le bruit réaliste avec mémoire
   → varie entre -20°C et +20°C environ (selon l'écart-type du capteur)
4. **Extrême** : canicule ou vague de froid (GEV)
   → ajouté seulement si le tirage au sort tombe sur 0.1%

### Exemple chiffré

Imaginons le 15 juillet à 14h :

1. T_saison (15 juillet ≈ jour 196) = +12.5°C (plein été)
2. T_profil (14h, été) = +3.2°C (l'après-midi, c'est chaud)
3. ε_AR1(t) = +1.8°C (petit bruit positif)
4. Pas d'extrême aujourd'hui

```
T_weather = 12.5 + 3.2 + 1.8 = 17.5°C
```

Puis :
```
T_fridge = 7.0 - 0.10 × (17.5 - 25) + bruit
         = 7.0 - 0.10 × (-7.5) + 0.2
         = 7.0 + 0.75 + 0.2
         = 7.95°C
```

### Les features cycliques (pour le machine learning)

Pour aider les algorithmes à comprendre les cycles, on encode
l'heure et le jour sous forme de **coordonnées circulaires** :

```
hour_sin = sin(2π × heure / 24)
hour_cos = cos(2π × heure / 24)
```

Pourquoi ? Parce que 23h et 1h sont proches (minuit) mais
23-1=22 serait vu comme très différent par l'algorithme.
Avec sin/cos, 23h et 1h ont des coordonnées proches.

Même chose pour le jour :
```
season_sin = sin(2π × jour / 365)
season_cos = cos(2π × jour / 365)
```

---

## Étape 8 : Vérifier que les données sont réalistes

### Test 1 : Kolmogorov-Smirnov (KS-test)

Ce test répond à la question : **"Est-ce que deux échantillons
suivent la même distribution ?"**

**Comment ça marche :**
1. On prend la fonction de répartition des données réelles (F_réel)
2. On prend la fonction de répartition des données générées (F_gen)
3. On calcule la plus grande différence entre les deux : D = max|F_réel - F_gen|
4. On calcule la p-value : probabilité d'observer une différence
   aussi grande si les deux viennent de la même distribution

**Interprétation :**
- **p > 0.05** : pas de différence significative → les distributions
  sont statistiquement identiques
- **p < 0.05** : différence significative → les distributions sont
  différentes

**Dans notre cas :** On compare le printemps généré (jour 80-170)
avec les données réelles (qui ne couvrent que le printemps).
On ne peut pas comparer avec l'année entière puisque les données
réelles n'ont pas d'été ni d'hiver.

### Test 2 : Autocorrélation (ACF)

L'autocorrélation mesure la **corrélation entre une valeur et elle-même
décalée dans le temps**.

**Formule pour lag 1 :**
```
ACF(1) = corrélation entre X(t) et X(t-1)
```

**Interprétation :**
- ACF = 0.95 → très forte mémoire (le signal change très lentement)
- ACF = 0.30 → mémoire modérée
- ACF = 0.00 → pas de mémoire (bruit blanc)

On compare l'ACF des données réelles (sous-échantillonnées à 5 min)
avec celle des données générées. Plus l'écart est faible, plus la
dynamique temporelle est réaliste.

### Test 3 : Cross-corrélation

On calcule la corrélation entre les différents capteurs :
```
r_weather_fridge = corrélation entre température extérieure et frigo
r_weather_thermo = corrélation entre température extérieure et thermostat
r_fridge_thermo  = corrélation entre frigo et thermostat
```

Une corrélation de r = -0.9 est **forte et négative** : quand l'un monte,
l'autre descend. C'est exactement ce qu'on attend pour météo→frigo.

### Test 4 : Isolation Forest (validation par un vrai modèle)

On teste si un modèle de détection d'anomalies arrive à distinguer
les attaques des données normales. On entraîne uniquement sur les
données normales, puis on teste sur tout le dataset.

**Métriques :**
- **ROC-AUC** : capacité à classer correctement normal vs attaque
  (0.5 = aléatoire, 1.0 = parfait). On obtient 0.988.
- **Rappel** : parmi les vraies attaques, combien sont détectées ?
  On obtient 100%. Aucune attaque n'est manquée.

---

## Résumé des formules (aide-mémoire)

| Composant | Formule | Paramètres |
|-----------|---------|------------|
| Saisonnalité | Σ[A_k sin(2πk(j-80)/365) + B_k cos(...)] | A_k=6/k, B_k=4/k, k=1..3 |
| Amplitude jour | 0.6 + 0.4 × sin(2π(j-80)/365) | varie entre 0.2 et 1.0 |
| Décalage horaire | 2 × sin(2π(j-80)/365) heures | varie entre -2h et +2h |
| Bruit AR(1) | ε(t) = φ×ε(t-1) + η(t) | φ estimé (~0.3), η ~ N(0,σ) |
| Couplage frigo | 7.0 - 0.10×(T_w-25) + N(0,0.5) | -0.10 = force du couplage |
| Couplage thermo | 24.0 - 0.12×(T_w-25) + N(0,0.3) | -0.12 = force du couplage |
| Extrême | GEV(ξ=0.2, μ=12, σ=4) | p=0.001 par pas de temps |

## Format du fichier final

**`generated_yearly_merged.csv`** — 105 120 lignes, 11 colonnes :
- `datetime` : date et heure (YYYY-MM-DD HH:MM:SS)
- `temperature` : température extérieure (°C)
- `fridge_temperature` : température du frigo (°C)
- `current_temperature` : température du thermostat (°C)
- `hour_sin`, `hour_cos` : heure encodée (pour le ML)
- `season_sin`, `season_cos` : saison encodée (pour le ML)
- `label` : 0 = normal, 1 = attaque
- `temp_condition` : 'high' ou 'low' (état du frigo)
- `thermostat_status` : 0 ou 1 (clim active ou non)
