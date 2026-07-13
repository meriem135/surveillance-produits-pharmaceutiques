# Rapport Technique : Pourquoi un Downsampling à 5 Minutes ?

## 1. Le constat de départ

| Données | Résolution | Volume |
|---------|-----------|--------|
| Données réelles (5 jours) | **1 seconde** | ~400 000 lignes/capteur |
| Données générées (1 an) | **5 minutes** | 105 120 lignes |

On ne peut **pas** comparer ou entraîner des modèles avec des résolutions différentes. Il faut les aligner.

---

## 2. Pourquoi 5 minutes et pas 1 seconde ?

### Raison physique : l'inertie thermique

La température ne change presque **pas** en 1 seconde. Dans un bâtiment industriel :
- En 1 seconde : variation ≈ **0,00°C** (bruit du capteur)
- En 5 minutes : variation ≈ **0,1–0,5°C** (signal utile)
- En 1 heure : variation ≈ **1–5°C** (cycle jour/nuit)

Conséquence : **1 seconde = bruit, 5 minutes = signal**. Prendre la moyenne sur 5 minutes lisse le bruit haute fréquence des capteurs tout en conservant les variations physiques réelles.

### Raison informatique : volume de données

| Résolution | Points par an |
|-----------|--------------|
| 1 seconde | 31 536 000 |
| 5 minutes | **105 120** |

L'Isolation Forest n'apprend **rien de plus** avec 31 millions de points qu'avec 105 000 points pour ce type de données, car la température a un **contenu informationnel faible** à haute fréquence.

### Raison métier : granularité de détection d'attaques

Les attaques simulées (DDoS, injection, MITM, backdoor, ransomware...) provoquent des altérations qui durent **plusieurs minutes à plusieurs heures**, pas quelques secondes. Une résolution de 5 minutes est donc parfaitement adaptée à la détection.

```
Attaque DDoS : altération continue pendant 30 min → 6 points à 5 min ✓
              altération continue pendant 30 sec → 30 points à 1 sec (redondant)
```

### Raison statistique : paramètre AR(1)

Le modèle AR(1) utilisé pour le bruit réaliste :
```
ε(t) = φ × ε(t-1) + η(t)
```

Le coefficient φ est **estimé à l'échelle 5 min** (cf. `Generation_Annuelle.ipynb` ligne 482 : fonction `estimate_ar1_phi(series, subsample=300)`, où 300 = 300 secondes = 5 minutes). C'est cohérent : on estime φ à la même échelle que la génération.

---

## 3. Le raisonnement : faut-il sous-échantillonner les 5 jours réels quand on entraîne avec l'annuelle ?

**Oui, mais à deux endroits distincts :**

### Cas 1 : Estimation des paramètres de génération

| Paramètre | Données utilisées | Résolution |
|-----------|------------------|-----------|
| Profil journalier (moyenne par heure) | 5 jours réels | **1 seconde** → OK car on calcule une moyenne par heure, pas besoin de downsample |
| φ AR(1) (mémoire du bruit) | 5 jours réels | **1 seconde → à downsampler à 5 min** (déjà fait, subsample=300) |
| σ AR(1) (écart-type du bruit) | 5 jours réels | **1 seconde → à downsampler à 5 min** |

### Cas 2 : Validation et comparaison

| Test | Données comparées | Résolution nécessaire |
|-----|-------------------|---------------------|
| KS-test (distribution) | Réelles vs Générées | **Alignée** → les 5 jours réels doivent être downsamplés à 5 min |
| ACF (autocorrélation) | Réelles vs Générées | **Alignée** → les 5 jours réels doivent être downsamplés à 5 min |
| Cross-corrélation | Réelles vs Générées | **Alignée** → les 5 jours réels doivent être downsamplés à 5 min |

### Cas 3 : Entraînement des modèles ML (le plus important)

| Modèle | Données d'entraînement | Résolution |
|--------|----------------------|-----------|
| Isolation Forest | **Données annuelles générées** | **5 minutes** (déjà bon) |
| LSTM-Autoencoder | **Données annuelles générées** | **5 minutes** (déjà bon) |
| Comparaison modèle | Annuelle générée vs réelles 5 jours | **Les 5 jours réels doivent être downsamplés à 5 min** |

**On n'entraîne JAMAIS sur les 5 jours réels.** Ils sont trop courts (5 jours) pour apprendre les motifs saisonniers. Ils servent uniquement à :

1. Extraire le profil journalier (forme du cycle jour/nuit)
2. Estimer φ et σ du bruit AR(1)
3. Valider que les données générées ressemblent à la réalité

---

## 4. Schéma du pipeline complet

```
┌─────────────────────────────────────────────────────┐
│                    DONNÉES RÉELLES                    │
│                    (5 jours, 1 sec)                   │
└──────────────────────┬──────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
┌────────────────┐ ┌────────┐ ┌──────────────┐
│ Profil         │ │ AR(1)  │ │ Validation   │
│ journalier     │ │ φ, σ   │ │ (KS, ACF)    │
│ (moy/heure)    │ │ (à     │ │              │
│ → garde 1 sec  │ │ 5 min) │ │ → DOWNSAMPLE │
│   (OK pour     │ │        │ │   à 5 min    │
│   la moyenne)  │ │        │ │              │
└────────────────┘ └────────┘ └──────┬───────┘
                                     │
                                     ▼
                            ┌────────────────┐
                            │ Comparaison    │
                            │ avec générées  │
                            └────────────────┘
```

```
┌─────────────────────────────────────────────────────┐
│                  DONNÉES GÉNÉRÉES                     │
│                  (1 an, 5 min)                        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│         Entraînement ML (Isolation Forest)   │
│          → Résolution 5 min (naturelle)              │
│          → PAS de downsample nécessaire              │
└─────────────────────────────────────────────────────┘
```

---

## 5. Résumé pour le jury

> **Pourquoi 5 minutes ?**
> 
> Pour 4 raisons imbriquées :
> 1. **Physique** : la température a une inertie thermique — 1 seconde c'est du bruit, 5 minutes c'est le signal
> 2. **Informatique** : 105 120 points/an vs 31 millions — même qualité ML, 300× plus rapide
> 3. **Métier** : les attaques durent des minutes/heures, pas des secondes — 5 min suffit
> 4. **Statistique** : le modèle AR(1) est estimé à 5 min — cohérent avec la génération
>
> **Et pour l'entraînement ?**
>
> On entraîne sur l'annuelle (déjà à 5 min). Les 5 jours réels servent à calibrer les paramètres, pas à entraîner le ML. Quand on compare réelles vs générées (KS, ACF), on downsample les réelles à 5 min pour aligner les échelles. C'est déjà fait dans le notebook de prétraitement (`.dt.floor('5min')` avec moyenne par intervalle).
