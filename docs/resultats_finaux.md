# VigiloChain — résultats finaux de la détection des attaques de transmission

*Version 3 (novembre 2026), après la relecture du professeur. Tous les chiffres viennent de
`models/transmission_reel/comparaison_modeles.json` (script `backend/scripts/transmission_models.py`,
20 répétitions, test cumulé) ; ils sont aussi chargés en base PostgreSQL (tables `transmission_*`) et
affichés par le site. Rien n'est écrit à la main.*

## 1. En bref

| | Avant (version d'octobre) | Après (version 3) |
|---|---|---|
| Modèle retenu (sur la validation) | Random Forest | **Extra Trees** |
| Réglage d'alerte | deux seuils : « max F1 » et « rappel cible 0,90 » | **un seul** : score ≥ 0,70 **et** 3 mesures sur les 6 dernières (30 s) |
| Critère de choix | F2 de validation (favorise le rappel) | rappel maximal sous **précision ≥ 0,90** et **≤ 0,5 fausse alerte/h** (validation) |
| Zone de garde | 5 min après chaque épisode | **20 min** après chaque épisode **et** en début de bloc changeant de rôle |
| Features | 35 (dont EWMA à mémoire infinie) | 53 (fenêtres ≤ 15 min, + min / max / quantiles, variation absolue, résidus) |
| **Fausses alertes par heure (test)** | 3,22 (max F1) · 18,55 (rappel 0,90) | **0,43** |
| **Précision (test, mesures)** | 0,771 (max F1) · 0,227 (rappel 0,90) | **0,939** (0,921 ramenée à 13,5 % d'attaques) |
| Rappel (test, mesures) | 0,656 (max F1) · 0,873 (rappel 0,90) | 0,652 |
| Épisodes détectés (test) | 71/73 (max F1) · 73/73 (rappel 0,90) | **70/73** |
| Délai médian de détection | 2,2 min (max F1) · 0,1 min (rappel 0,90) | 3,9 min (90 % des épisodes en moins de 12,7 min) |

En une phrase : **les fausses alertes sont divisées par 7,4 par rapport au meilleur point de l'ancienne
version (3,22 → 0,43 par heure, soit une toutes les 2 h 20 environ) et par 43 par rapport au point
« rappel 0,90 »**, pour la même proportion de mesures falsifiées détectées (65 %) et presque les mêmes
épisodes (70 sur 73), au prix d'un délai médian un peu plus long (3,9 min). Les trois épisodes manqués
sont des attaques à faible signal : un rejeu, un biais −0,5 °C et un biais thermostat.

> Comparaison honnête : l'ancien chiffre « fausses alertes/h » comptait chaque suite de lignes normales
> signalées ; le nouveau compte chaque alerte (après persistance) qui ne recouvre aucune mesure falsifiée.
> Les deux comptent des alertes distinctes par heure de fonctionnement normal. La précision dépend de la
> part d'attaques des lignes évaluées : elle est de 17,0 % ici (13,5 % avant), car la zone de garde plus
> longue retire des lignes normales ; ramenée à 13,5 %, la précision de l'Extra Trees serait 0,921.

## 2. Correction de la zone de garde (fuite entre blocs)

**Remarque du professeur.** La zone de garde faisait 5 minutes alors que les features glissantes
regardent jusqu'à 15 minutes en arrière : une ligne pouvait « voir » des mesures d'un autre rôle
(train / validation / test) ou d'un épisode d'attaque terminé.

**Correction.**

- **Plus longue fenêtre des features : 15 min** (`W_MAX` = 180 pas de 5 s). La moyenne lissée EWMA,
  dont la mémoire n'est pas bornée, a été **retirée** des features.
- **Zone de garde : 20 min** (`GUARD` = 240 pas) = 15 min de fenêtre + 3 min de règle de persistance
  des alertes (qui regarde au plus 36 mesures en arrière) + marge.
- Elle est appliquée à **deux endroits** :
  1. **après chaque épisode d'attaque** : pendant 15 min, les fenêtres glissantes contiennent encore
     des valeurs falsifiées alors que l'étiquette est « normal » ; ces lignes ne sont ni apprises ni
     évaluées ;
  2. **au début de chaque bloc d'une heure dont le rôle diffère du bloc précédent**
     (train → validation, validation → test, test → train) : ces lignes ne sont ni apprises ni
     évaluées, et les épisodes de ces blocs commencent après la zone de garde.
- **Vérification automatique** (`backend/tests/test_transmission_protocol.py`,
  `test_no_feature_window_crosses_a_role_boundary_or_an_episode`, 4 rotations du découpage) : pour
  chaque ligne apprise ou évaluée, les 240 lignes précédentes sont toutes du **même rôle**, et une
  ligne normale ne voit **aucune** ligne d'attaque dans sa fenêtre. Un second test vérifie que les
  features sont **causales** (modifier le futur ne change rien) et **bornées à 15 min** (modifier le
  passé au-delà de 15 min ne change aucune feature glissante). Le notebook 2 refait la vérification.
- La validation croisée de confirmation reste **groupée par bloc d'une heure**
  (`StratifiedGroupKFold`) ; le `StratifiedKFold` naïf est gardé comme contre-exemple.

**Conséquence sur la proportion d'attaques.** La zone de garde retire des lignes normales (après
chaque épisode) : la part d'attaques des lignes évaluées monte un peu. La précision dépend de cette
part ; le nombre de **fausses alertes par heure normale** n'en dépend pas, c'est pourquoi c'est
l'indicateur principal pour l'opérateur. La précision ramenée à la proportion de l'ancienne version (13,5 %)
est donnée dans la section 1 pour une comparaison honnête.


## 3. Un seul réglage d'alerte, orienté précision

**Remarque du professeur.** Trop de fausses alertes ; deux seuils (« max F1 » et « rappel cible
0,90 ») prêtaient à confusion ; classer les modèles sur le F2 donnait une précision très faible
(0,23 au rappel 0,90, soit 18,6 fausses alertes par heure : l'opérateur ne peut pas suivre).

**Correction : un seul point de fonctionnement, choisi sur la validation.**

1. **Persistance (anti-rebond), comme dans les IDS** : une mesure isolée au-dessus du seuil ne
   déclenche rien ; l'alerte est levée quand **au moins *k* des *n* dernières mesures** (5 s chacune)
   dépassent le seuil. Une alerte = une suite continue de mesures en alarme ; elle est **vraie** si elle
   recouvre au moins une mesure falsifiée, **fausse** sinon.
2. **Critère** (le même pour tous les modèles) : parmi environ 100 seuils × 7 règles de persistance
   (*k*/*n* de 1/1 à 30/36, *n* ≤ 3 min), on garde, **sur la validation**, celle qui a le **rappel le plus
   haut** sous deux contraintes :
   - **précision ≥ 0,90** : au moins 9 mesures signalées sur 10 sont vraiment falsifiées ;
   - **au plus 0,5 fausse alerte par heure** de fonctionnement normal (une toutes les 2 h au plus).

   Pourquoi ce critère : la contrainte exprime ce que l'opérateur peut traiter (peu d'alertes, presque
   toutes justes) ; à l'intérieur de cette contrainte, on veut rater le moins d'attaques possible. Le F2
   faisait l'inverse (il récompense le rappel au prix de la précision).
3. **Un seul réglage par modèle** : le seuil et *k*/*n* sont choisis sur la validation **cumulée des 20
   répétitions**, puis appliqués tels quels au test de chaque répétition.
4. **Classement des modèles sur la validation** : d'abord ceux qui tiennent la contrainte, puis le rappel
   le plus haut, puis le moins de fausses alertes/h, puis le délai le plus court. Le test ne sert qu'à
   confirmer.
5. On rapporte deux niveaux : **mesure** (rappel, précision, F1 des mesures en alarme) et **alerte /
   épisode** (épisodes détectés, fausses alertes par heure, délai de détection = début de l'épisode →
   première mesure en alarme).

## 4. Résultats par modèle : entraînement, validation, test

Cumul des 20 répétitions (chaque heure sert 3 fois de test). « Mesures » = rappel et précision calculés mesure
par mesure (pas de 5 s) **après** la règle de persistance. Réglage = seuil de score · *k*/*n*. AP = précision
moyenne (aire sous la courbe précision-rappel, sans seuil). Part d'attaques des lignes évaluées : train 49,7 %,
validation 17,0 %, test 17,0 % (entre 12,5 % et 23,0 % selon la répétition).

| Modèle | Réglage | Contrainte tenue (val) | Rôle | Épisodes détectés | Fausses alertes/h | Précision | Rappel | F1 | Délai médian | AP | ROC-AUC |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Extra Trees** | 0,70 · 3/6 | oui | train | 854/854 | 0,00 | 100,0 % | 98,7 % | 0,993 | 0,2 min | 1,000 | 1,000 |
| | | | val | 71/73 | 0,49 | 92,4 % | 64,6 % | 0,760 | 4,0 min | 0,818 | 0,888 |
| | | | **test** | **70/73** | **0,43** | **93,9 %** | **65,2 %** | **0,769** | **3,9 min** | **0,845** | **0,912** |
| Random Forest | 0,79 · 6/12 | oui | train | 854/854 | 0,00 | 100,0 % | 95,0 % | 0,974 | 1,0 min | 1,000 | 1,000 |
| | | | val | 70/73 | 0,40 | 90,2 % | 60,8 % | 0,726 | 4,2 min | 0,809 | 0,884 |
| | | | test | 70/73 | 0,35 | 92,1 % | 60,4 % | 0,730 | 4,5 min | 0,833 | 0,910 |
| XGBoost | 0,84 · 18/24 | oui | train | 854/854 | 0,01 | 100,0 % | 87,1 % | 0,931 | 2,2 min | 1,000 | 1,000 |
| | | | val | 72/73 | 0,36 | 90,4 % | 59,0 % | 0,714 | 5,0 min | 0,795 | 0,883 |
| | | | test | 71/73 | 0,30 | 91,6 % | 61,0 % | 0,732 | 5,0 min | 0,838 | 0,907 |
| HistGradientBoosting | 0,99 · 6/12 | oui | train | 854/854 | 0,00 | 100,0 % | 94,0 % | 0,969 | 1,2 min | 1,000 | 1,000 |
| | | | val | 71/73 | 0,35 | 90,9 % | 56,3 % | 0,695 | 4,4 min | 0,785 | 0,874 |
| | | | test | 72/73 | 0,20 | 94,9 % | 61,5 % | 0,747 | 5,0 min | 0,844 | 0,914 |
| Régression Logistique | 0,985 · 1/1 | oui | train | 534/854 | 0,14 | 99,4 % | 26,1 % | 0,413 | 4,9 min | 0,911 | 0,896 |
| | | | val | 43/73 | 0,27 | 90,8 % | 25,5 % | 0,398 | 4,9 min | 0,663 | 0,831 |
| | | | test | 43/73 | 0,18 | 93,3 % | 29,8 % | 0,451 | 4,8 min | 0,709 | 0,855 |
| MLP (64, 32) | 0,999 · 30/36 | **non** | train | 851/854 | 0,00 | 100,0 % | 71,4 % | 0,833 | 3,9 min | 1,000 | 1,000 |
| | | | val | 63/73 | 0,56 | 74,8 % | 47,2 % | 0,579 | 6,2 min | 0,630 | 0,825 |
| | | | test | 65/73 | 0,44 | 80,3 % | 48,4 % | 0,604 | 6,8 min | 0,667 | 0,818 |
| *Random Forest, anciennes features (avant)* | 0,71 · 30/36 | oui | train | 854/854 | 0,00 | 100,0 % | 86,8 % | 0,929 | 2,7 min | 1,000 | 1,000 |
| | | | val | 65/73 | 0,19 | 90,0 % | 52,2 % | 0,661 | 5,9 min | 0,753 | 0,856 |
| | | | test | 61/73 | 0,19 | 93,5 % | 52,8 % | 0,675 | 4,9 min | 0,764 | 0,862 |

**Classement sur la validation** (contrainte tenue, puis rappel, puis fausses alertes, puis délai) :
Extra Trees > Random Forest > XGBoost > HistGradientBoosting > Régression Logistique > MLP.
Sur le test, les quatre modèles arborescents sont proches (rappel 0,60–0,65, 0,20–0,43 fausse alerte/h) ; ce
classement ne change pas le diagnostic. Le choix est fait sur la validation, sans regarder le test.

**Effet de la règle de persistance** (Extra Trees, même seuil 0,70, test) :

| | Fausses alertes/h | Alertes (dont fausses) | Précision | Rappel | Épisodes | Délai médian |
|---|---|---|---|---|---|---|
| Mesure par mesure (1/1) | 0,87 | 265 (103) | 94,1 % | 65,6 % | 70/73 | 3,7 min |
| Persistance 3 sur 6 | **0,43** | 153 (51) | 93,9 % | 65,2 % | 70/73 | 3,9 min |

La persistance divise les fausses alertes par deux pour 12 s de délai en plus. Pour l'opérateur : sur
153 alertes au test (117,9 h de fonctionnement normal), 102 correspondent à une vraie attaque et 51 sont
fausses (une alerte sur trois, mais une toutes les 2 h 20) ; un épisode long peut donner plusieurs alertes.
Pour l'ancien Random Forest, la même règle (30 sur 36) fait passer les fausses alertes de 2,59 à 0,19 par
heure, mais il ne détecte alors que 61 épisodes sur 73.

**Avant / après, même protocole corrigé et même critère** : avec les anciennes features, le Random Forest
détecte 61 épisodes sur 73 (rappel 0,528, AP 0,764) ; avec les nouvelles, l'Extra Trees en détecte 70
(rappel 0,652, AP 0,845) pour 0,43 fausse alerte/h. **Le gain vient surtout des features**.


## 5. Modèles et features essayés (sur la validation seulement)

Tous les choix ci-dessous ont été faits **sans regarder le test**.

**Features** (Random Forest, 5 rotations du découpage, précision moyenne AP sur la validation, zone de
garde de 20 min) :

| Jeu de features | Nombre | AP validation (moyenne des 5 rotations) |
|---|---|---|
| Version précédente sans EWMA (moyennes / écarts-types 1, 5, 15 min, rejeu, écarts entre capteurs) ¹ | 32 | 0,698 |
| + min / max glissants 5 et 15 min (frigo, thermostat), variation absolue moyenne 5 min, résidus entre capteurs moyennés sur 15 min | 45 | 0,742 |
| **+ quantiles 10 % et 90 % glissants 5 et 15 min (frigo, thermostat), sans EWMA — retenu** | **53** | **0,779** |
| Même chose + fenêtres de 30 min (zone de garde portée à 35 min) | 55 | 0,736 |

¹ Avec l'EWMA (35 features, la version précédente exacte), l'AP de la rotation 0 est 0,753 contre 0,763 sans : l'EWMA
n'apportait rien, et sa mémoire non bornée traversait la zone de garde.

Lecture : ce qui aide le plus pour les petits biais, ce sont les features de **forme de la distribution
glissante** (minimum, maximum, quantiles). Les traces du frigo sont bornées (1 à 14 °C, bruit presque
uniforme) : un décalage de −0,5 °C déplace tout de suite le haut et le bas de la distribution, alors que la
moyenne glissante, noyée dans un bruit de σ ≈ 3,4 °C, met longtemps à bouger. Les fenêtres de 30 min
n'apportent rien sur des épisodes de 15 à 25 min et obligent à allonger la zone de garde : écartées.
Les **résidus entre capteurs** n'apportent presque rien ici, car les trois traces TON_IoT n'ont pas de lien
physique entre elles (corrélation partielle frigo–salle ≈ 0).

**Hyperparamètres** : petite grille, validation croisée **groupée par bloc** (4 plis
`StratifiedGroupKFold`) sur les seules lignes d'entraînement de la répétition 0, score AP
(`models/transmission_reel/recherche_hyperparametres.json`) :

| Modèle | Réglages essayés (AP moyenne ± écart-type) | Retenu |
|---|---|---|
| Random Forest (300 arbres) | feuille ≥ 5, √p : 0,895 ± 0,030 · feuille ≥ 10, 30 % des features : **0,901 ± 0,027** · feuille ≥ 2, √p : 0,894 ± 0,031 | feuille ≥ 10, 30 % |
| Extra Trees (400 arbres) | feuille ≥ 2, √p : 0,895 ± 0,028 · feuille ≥ 5, 50 % : **0,905 ± 0,029** | feuille ≥ 5, 50 % |
| XGBoost (400 arbres, taux 0,05) | profondeur 4, poids min 5 : **0,880 ± 0,044** · 6 / 1 : 0,877 ± 0,043 · 8 / 5 : 0,871 ± 0,042 | profondeur 4 |
| HistGradientBoosting (300 itérations) | 15 feuilles, taux 0,05 : 0,880 ± 0,039 · 31 / 0,05 : 0,887 ± 0,038 · 63 / 0,03 : **0,893 ± 0,034** | 63 feuilles |

LightGBM n'est pas installé dans l'image ; `HistGradientBoostingClassifier` de scikit-learn est le même
algorithme (boosting par histogrammes, inspiré de LightGBM). Les écarts entre réglages (≈ 0,01 d'AP) sont
plus petits que l'écart-type entre plis (≈ 0,03) : le réglage compte peu, les features comptent beaucoup.

## 6. Détection par scénario (Extra Trees, test cumulé)

| Scénario | Ce que fait l'attaquant | Épisodes détectés | Délai médian | Mesures falsifiées signalées |
|---|---|---|---|---|
| MITM_gel | dernière mesure du frigo répétée | 8/8 | 1,0 min | 95,0 % |
| MITM_rejeu | mesures passées du frigo renvoyées | 8/9 | 2,1 min | 73,8 % |
| Injection_nominale | valeurs forgées ~7 °C, peu bruitées | 9/9 | 2,2 min | 88,7 % |
| Injection_biais_0.5 | frigo décalé de −0,5 °C | 9/10 | 11,0 min | 26,9 % |
| Injection_biais_1.0 | frigo décalé de −1 °C | 8/8 | 6,0 min | 52,3 % |
| Injection_biais_2.0 | frigo décalé de −2 °C | 7/7 | 3,0 min | 83,9 % |
| Injection_derive | décalage progressif 0 → −2 °C | 7/7 | 11,6 min | 31,8 % |
| MITM_gel_thermostat | dernière mesure du thermostat répétée | 7/7 | 3,6 min | 83,4 % |
| Injection_biais_thermostat | thermostat décalé de −1,5 °C | 7/8 | 6,9 min | 51,8 % |

Les petits biais (−0,5 et −1 °C) étaient la limite connue de la version précédente (22,9 % et 44,2 % des
mesures signalées au seuil max F1, pour 3,2 fausses alertes/h) ; ils sont maintenant détectés dans 17 épisodes
sur 18, mais **lentement** (6 à 11 min de délai médian) et seule une partie de leurs mesures est signalée.

## 7. Entraînement contre validation et test : le diagnostic

- **Sur-apprentissage des modèles arborescents.** Extra Trees, Random Forest, XGBoost, HistGradientBoosting
  et MLP sont **parfaits sur leur propre train** (AP 1,000, ROC-AUC 1,000, 854 épisodes sur 854) et nettement
  moins bons en validation (Extra Trees : AP 0,818, ROC-AUC 0,888). Ils **mémorisent** les lignes
  d'entraînement : c'est attendu pour des arbres profonds, et c'est pourquoi on ne juge jamais un modèle sur
  son train. Le réglage le plus régularisé (feuilles d'au moins 5 à 10 lignes) a été retenu par la validation
  croisée groupée.
- **Mais la généralisation est stable** : validation et test sont au même niveau (Extra Trees AP 0,818 en
  validation, 0,845 au test ; ROC-AUC 0,888 et 0,912). Le seuil et le modèle choisis sur la validation tiennent
  sur des heures jamais vues : le choix n'est pas « sur-ajusté » à la validation.
- **Courbe d'apprentissage** (Extra Trees, 3 rotations, AP) :

  | Part du train | Lignes | AP train | AP validation |
  |---|---|---|---|
  | 10 % | 1 721 | 1,000 | 0,723 |
  | 25 % | 4 936 | 1,000 | 0,804 |
  | 50 % | 10 061 | 1,000 | 0,856 |
  | 75 % | 15 171 | 1,000 | 0,870 |
  | 100 % | 20 191 | 1,000 | 0,881 |

  L'AP de validation monte avec la taille du train et ne plafonne pas encore tout à fait : le modèle est
  **limité par la quantité de données** (62 h de traces seulement) et par le **bruit** du capteur, pas par sa
  capacité. Ce n'est **pas du sous-apprentissage**. Plus de données (ou des épisodes plus longs) aideraient ;
  un modèle plus complexe, non.
- **Sous-apprentissage de la Régression Logistique** : ROC-AUC 0,896 même sur son train, 26 % des mesures
  falsifiées seulement au seuil qui tient la contrainte ; la frontière normal / attaque n'est pas linéaire.
- **Précaution de lecture** : l'AP dépend de la part d'attaques (≈ 50 % en train, ≈ 17 % en validation et
  test) ; la ROC-AUC, qui n'en dépend pas, confirme le même diagnostic.

## 8. Validation croisée : naïve contre groupée par bloc

Lignes d'entraînement de la répétition 0, 5 plis, seuil 0,5 :

| Modèle | AP naïve (lignes mélangées) | AP groupée par bloc | Rappel naïf | Rappel groupé | Précision groupée |
|---|---|---|---|---|---|
| Extra Trees | 1,000 | 0,900 ± 0,034 | 0,996 | 0,712 | 0,927 |
| Random Forest | 1,000 | 0,899 | 0,989 | 0,754 | 0,887 |
| Régression Logistique | 0,897 | 0,844 | 0,769 | 0,680 | 0,772 |

Le découpage naïf partage 220 blocs d'une heure entre apprentissage et évaluation (fuite par les fenêtres
glissantes : scores presque parfaits, faux) ; le découpage groupé n'en partage aucun.

## 9. SHAP : ce que regarde l'Extra Trees

Importance moyenne |SHAP| sur 4 394 mesures falsifiées du test (5 rotations) :

| Rang | Feature | Importance |
|---|---|---|
| 1 | `fridge_repeat_2min` (séquence de 2 min déjà transmise) | 0,061 |
| 2 | `fridge_max_5min` (maximum sur 5 min du frigo) | 0,054 |
| 3 | `fridge_q10_5min` (quantile 10 % sur 5 min) | 0,047 |
| 4 | `fridge_std_1min` (écart-type sur 1 min) | 0,044 |
| 5 | `fridge_mean_5min` | 0,043 |
| 6 | `fridge_mean_15min` | 0,042 |
| 7 | `fridge_max_15min` | 0,031 |
| 8 | `fridge_q90_5min` | 0,023 |

Par scénario : rejeu → `fridge_repeat_2min` (0,40) ; gel et injection nominale → écart-type sur 1 min ;
biais et dérive du frigo → maximum et quantile 10 % sur 5 min, puis moyennes sur 5 et 15 min ; gel du
thermostat → écarts-types du thermostat et sa variation absolue moyenne.

## 10. Limites

- **62 heures de traces seulement**, sans relation physique entre les trois capteurs TON_IoT (bruit presque
  sans mémoire) : les résidus entre capteurs n'apportent presque rien, et les résultats sont cumulés sur
  20 rotations du découpage pour être stables (73 épisodes de test au total).
- **Attaques injectées** par nous (9 scénarios), pas observées en vrai : les chiffres valent pour ces
  mécanismes et ces amplitudes.
- Les features de **forme de distribution** (min, max, quantiles) profitent du fait que la trace du frigo est
  bornée (1–14 °C) ; sur un vrai capteur gaussien, le gain sur les petits biais serait probablement moindre.
- **Petits biais** (−0,5 et −1 °C) : détectés mais lentement (délai médian 6 à 11 min), et seule une partie
  de leurs mesures est signalée ; un biais plus faible ou plus court resterait invisible.
- **Une alerte sur trois est fausse** au test (51 sur 153), même si leur rythme (0,43 par heure) reste
  supportable ; la précision de 0,94 est mesurée mesure par mesure.
- Les modèles arborescents **sur-apprennent** leur train (AP 1,0) ; la validation et le test sont cohérents,
  mais l'écart rappelle que la quantité de données limite le résultat.
- La proportion d'attaques des lignes évaluées (17 %) dépend du protocole ; la précision dépend de cette
  proportion, les fausses alertes par heure non.
- Le rejeu est détecté par un indicateur « séquence déjà vue » qui garde la mémoire de tout l'historique (ce
  n'est pas une fenêtre glissante) : il compare des valeurs brutes, sans étiquette, mais un rejeu de valeurs
  jamais transmises auparavant lui échapperait.

## 11. Reproduire

```bash
cd backend
nice -n 10 .venv/bin/python scripts/transmission_recherche.py   # grille d'hyperparamètres, ~25 min
nice -n 10 .venv/bin/python scripts/transmission_models.py      # 20 répétitions, ~2 h 10 sur 3 cœurs
.venv/bin/python scripts/comparer_supervises.py                  # tableaux val / test / train
.venv/bin/python scripts/charger_base.py                         # charge l'étude dans PostgreSQL
.venv/bin/python -m pytest                                       # dont les tests de la zone de garde
```

Fichiers : `models/transmission_reel/comparaison_modeles.json` (tout), `validation_croisee.json`,
`shap_transmission_reel.json`, `recherche_hyperparametres.json`, `meilleur_modele.json` (features, seuil,
*k*, *n* du modèle en service) ; notebooks `notebook/transmission/01…04`.
