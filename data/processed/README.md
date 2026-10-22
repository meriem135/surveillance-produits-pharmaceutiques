# `data/processed/` — contenu des fichiers

Ce dossier contient les données **prêtes pour l'entraînement** des modèles de
détection d'attaques de transmission (MITM / injection) sur les traces réelles
TON_IoT de la chaîne du froid pharmaceutique.

> ℹ️ Les fichiers `.csv` et `.json` ne supportent pas de commentaires internes
> (une ligne `#` casserait `pandas.read_csv`, et le JSON est un tableau, donc pas
> de clé `_comment` possible sans modifier les notebooks/scripts). Ce README sert
> donc de documentation « au niveau des fichiers ».

## Chaîne de production

```
notebook/Raw/Normal/*.csv              (9 traces brutes, 3 par capteur)
        │  NOTEBOOK 01 — exploration + fusion sur grille de 5 s
        ▼
traces_reelles_5s.csv
        │  NOTEBOOK 02 / transmission_models.py — injection de 9 scénarios (le découpage n'est plus stocké)
        ▼
dataset_transmission_reel.csv  +  episodes_transmission_reel.json
        │  NOTEBOOK 03 / transmission_models.py / service Transmission
        ▼
models/transmission_reel/*             (modèles, résultats, SHAP)
```

Équivalents « scripts backend » : `backend/scripts/transmission_real.py`,
`backend/scripts/transmission_models.py` et
`backend/app/domains/transmission/service.py`.

---

## 1. `traces_reelles_5s.csv`

**Quoi :** les 3 capteurs réels TON_IoT fusionnés sur une grille régulière de 5 s,
**sans feature ni label**. C'est la matière première du notebook 02.

- **Lignes :** 44 443 (hors en-tête) — ≈ 62 h de mesures, du 31/03 au 04/04/2019.
- **Colonnes :** 6.
- **Production :** notebook `01_exploration_pretraitement.ipynb`
  (via `transmission_real.fuse_real`).

| Colonne | Description |
|---|---|
| `datetime` | Horodatage (pas de 5 s, trous < 1 min comblés par la dernière valeur) |
| `weather_temp` | Température extérieure (météo), en °C |
| `fridge_temp` | Température **intérieure** du frigo (le produit), en °C |
| `thermostat_temp` | Température de la **salle** autour du frigo, en °C |
| `fridge_cond` | État du frigo : `low` / `high` |
| `thermo_status` | État du thermostat (booléen converti en 0 / 1) |

---

## 2. `dataset_transmission_reel.csv`

**Quoi :** le même jeu de traces (répétition 0) **après injection de 9 scénarios
d'attaque** MITM / injection, avec **35 features** calculées sur les données
attaquées et les labels. C'est le fichier d'entraînement des modèles de
transmission.

- **Lignes :** 44 443 (hors en-tête).
- **Colonnes :** 44 (dont 35 features modèle).
- **Production :** `transmission_models.py` (seul script qui l'écrit, avec le
  planning des épisodes), le notebook `02_injection_attaques.ipynb` ou le service
  `Transmission` (s'il manque ou vient d'un ancien protocole), via
  `transmission_models.engineer`. `transmission_real.py` ne l'écrit plus : l'ordre
  d'exécution des deux scripts n'a plus d'importance.

> ⚠️ **Le découpage train/val/test n'est plus une colonne du fichier.** Il est
> calculé **au moment de l'entraînement**, de façon **non aléatoire**, par
> `transmission_real.block_split(n, run)` : les heures sont découpées en **blocs
> d'une heure** attribués selon un motif fixe **70 / 15 / 15** (14 train / 3 val /
> 3 test sur un cycle de 20 blocs). Une attaque tient entièrement dans un bloc →
> aucune attaque n'est coupée entre deux rôles. Le `run` (répétition) décale le
> motif ; les 20 répétitions parcourent les 20 rotations (chaque heure sert 3 fois
> de test). Pour relire les rôles depuis le CSV seul : `tr.block_split(len(df))`.
>
> **Prévalence par rôle :** un épisode dans **chaque** bloc d'entraînement (~33 %
> d'attaques, les modèles supervisés ont besoin d'exemples), dans **2 blocs sur 5**
> de validation et de test (≈ 13–15 %, une proportion réaliste : la précision et le
> F1 en dépendent).

### 2.1 Identité et labels

| Colonne | Description |
|---|---|
| `datetime` | Horodatage (pas de 5 s) |
| `weather_temp` | Température extérieure (météo) |
| `fridge_temp` | Température frigo **telle que reçue** (après attaque éventuelle) |
| `thermostat_temp` | Température salle **telle que reçue** (après attaque éventuelle) |
| `fridge_cond` | État frigo `low` / `high` |
| `thermo_status` | État du thermostat (0 / 1) |
| `fridge_true` | Valeur frigo **réelle** avant attaque (référence) |
| `thermostat_true` | Valeur salle **réelle** avant attaque (référence) |
| `label` | `0` = normal, `1` = mesure falsifiée |
| `attack_type` | Nom du scénario (`normal` si aucune attaque) |
| `cible` | Capteur attaqué : `fridge`, `thermostat` ou chaîne vide |
| `incident` | Toujours `0` (aucun incident réel identifiable dans ces traces) |
| `garde` | `True` = 5 min après un épisode, **exclues de l'évaluation** |

> (La colonne `split` a été retirée ; voir l'encadré ci-dessus.)

### 2.2 Les 35 features du modèle

Par capteur (`weather`, `fridge`, `thermostat`) — d'où 10 × 3 = 30 features :

| Feature | Description |
|---|---|
| `<capteur>_temp` | Valeur brute |
| `<capteur>_diff_1` | Variation d'une mesure à l'autre |
| `<capteur>_mean_1min` / `_std_1min` | Moyenne / écart-type sur 1 min |
| `<capteur>_mean_5min` / `_std_5min` | Moyenne / écart-type sur 5 min |
| `<capteur>_mean_15min` / `_std_15min` | Moyenne / écart-type sur 15 min |
| `<capteur>_ewma_10min` | Moyenne lissée (EWMA) sur ~10 min |
| `<capteur>_repeat_2min` | `1` si la séquence de 2 min a déjà été transmise (rejeu exact) |

Plus 5 features transverses :

| Feature | Description |
|---|---|
| `weather_fridge_diff` | Écart météo − frigo |
| `weather_thermostat_diff` | Écart météo − salle |
| `fridge_thermostat_diff` | Écart frigo − salle |
| `fridge_cond_enc` | Encodage numérique de `fridge_cond` |
| `thermo_status` | État du thermostat (numérique) |

### 2.3 Les 9 scénarios d'attaque

| Scénario | Capteur | Mécanisme |
|---|---|---|
| `MITM_gel` | frigo | dernière mesure répétée en boucle |
| `MITM_rejeu` | frigo | fenêtre passée (≥ 1 h plus tôt) rejouée |
| `Injection_nominale` | frigo | valeurs forgées ~7 °C, peu bruitées |
| `Injection_biais_0.5` | frigo | décalage constant −0,5 °C (limite connue) |
| `Injection_biais_1.0` | frigo | décalage constant −1,0 °C (limite connue) |
| `Injection_biais_2.0` | frigo | décalage constant −2,0 °C |
| `Injection_derive` | frigo | rampe lente 0 → −2 °C |
| `MITM_gel_thermostat` | thermostat | dernière mesure répétée en boucle |
| `Injection_biais_thermostat` | thermostat | décalage constant −1,5 °C |

> Les biais faibles −0,5 °C et −1,0 °C sont **gardés** bien qu'ils soient sous le bruit
> du capteur (σ ≈ 3,4 °C) : leurs résultats, scénario par scénario, montrent cette
> limite ; `backend/scripts/transmission_biais_long.py` mesure à partir de quelle durée
> (1 à 3 h) ils deviennent détectables.

---

## 3. `episodes_transmission_reel.json`

**Quoi :** le **planning des attaques** injectées, c'est-à-dire la liste des
épisodes qui ont servi à étiqueter `dataset_transmission_reel.csv`. C'est un
tableau JSON d'objets (pas de commentaire possible dans un tableau).

- **Contenu :** 51 épisodes (répétition 0 : un dans chaque bloc d'entraînement, dans
  2 blocs sur 5 de validation et de test : 43 train / 4 val / 4 test).
- **Production :** `transmission_models.py` ou notebook `02_injection_attaques.ipynb`
  (via `transmission_real.build_schedule`).
- **Consommé par :** notebook 03/04 et le service `transmission` du backend (pour
  compter les épisodes détectés, par scénario et par split).

Champs de chaque objet :

| Champ | Description |
|---|---|
| `name` | Nom du scénario (ex. `MITM_gel`, `Injection_biais_2.0`) |
| `sensor` | Capteur ciblé : `fridge` ou `thermostat` |
| `kind` | Famille / mécanisme : `gel`, `rejeu`, `nominale`, `biais`, `derive` |
| `param` | Paramètre du scénario (décalage en °C) ou `null` |
| `start` | Indice de début de l'épisode (en pas de 5 s) |
| `end` | Indice de fin (exclu) |
| `split` | Rôle du bloc : `train`, `val` ou `test` |

Répartition (répétition 0) : `train` 43, `val` 4, `test` 4 épisodes (durée 15 à
25 min) → ~35 % d'attaques en train, ~16–18 % en validation et en test pour cette
répétition (≈ 14 % en cumul des 20 répétitions, voir `prevalence` dans
`models/transmission_reel/comparaison_modeles.json`).

Exemple :

```json
{
  "name": "MITM_gel",
  "sensor": "fridge",
  "kind": "gel",
  "param": null,
  "start": 151,
  "end": 314,
  "split": "train"
}
```

---

## Remarque

`dataset_transmission_reel.csv` et `episodes_transmission_reel.json` sont
**régénérés ensemble** : si l'un est reconstruit, l'autre doit l'être aussi pour
rester cohérent (mêmes épisodes, mêmes bornes).
