# DÉFENDRE L'IDÉE : POURQUOI 3 CAPTEURS (compilation complète des arguments)

> Soutenance PFE — Détection d'attaques MQTT (Injection + MITM) sur la chaîne du froid pharma (2-8 °C).
> Capteurs : **Frigo** (le produit), **Thermostat** (l'air de la salle), **Météo** (l'extérieur).
> Contexte : modèle entraîné uniquement sur 5 jours de données normales (57 322 instants), attaques injectées pour l'évaluation.

---

## 🖼️ RAPPEL : LES 3 ACTEURS DE L'HISTOIRE

```
FRIGO       = l'accusé : c'est lui que l'attaquant veut falsifier (le produit)
THERMOSTAT  = témoin 1 : l'air de la salle   (~28,7 °C)
MÉTÉO       = témoin 2 : l'extérieur         (~37 °C)

En NORMAL (5 jours de données) :
  • le frigo oscille en permanence entre 1 et 14 °C (moyenne 7,2 °C)
  • le local reste stable autour de 28,7 °C
  • la météo reste stable autour de 37 °C
```

---

# PARTIE 1 — POURQUOI PAS UN SEUL CAPTEUR ?

## ARGUMENT 1.1 — Une fausse valeur réaliste est INVISIBLE sur un seul capteur

**Principe simple :** un menteur peut imiter un chiffre parfaitement.

**Analogie :** tu dis à ta mère « j'étais à la maison à 20h ». Si elle ne demande qu'à TOI, tu peux mentir sans problème — personne ne vérifie.

**Exemple avec tes données :**
```
Vrai frigo = 12,5 °C (le lot chauffe depuis 3 h).
L'attaquant envoie : « frigo = 7,2 °C ».

Avec 1 SEUL capteur (le frigo) :
  → 7,2 °C est une valeur PARFAITEMENT normale pour un frigo
  → rien ne sonne, l'opérateur voit « tout va bien » 😴
  → L'ATTAQUE EST INVISIBLE.
```

**Phrase à dire :**
> « Une fausse température réaliste est indiscernable d'une vraie si je regarde un seul capteur : 7,2 °C est une valeur normale pour un frigo. La valeur seule ne contient pas assez d'information. »

---

## ARGUMENT 1.2 — Un simple seuil déclenche ~1 fausse alerte sur 2 (mesuré !)

**Principe simple :** le frigo est trop « agité » pour servir d'alarme seul.

**Analogie :** une alarme incendie qui sonne dès qu'il fait un peu chaud — elle sonnerait tout le temps, on arrêterait d'y croire.

**Exemple avec tes données (chiffre mesuré) :**
```
En NORMAL, le frigo sort de la zone 2-8 °C dans 46,6 % des cas
(il monte jusqu'à 14 °C : c'est son cycle normal de refroidissement).

Une alarme « si le frigo est trop chaud » →
sonnerait PRESQUE UNE FOIS SUR DEUX sans aucune attaque.
```

**Phrase à dire :**
> « Une simple alarme sur le frigo est inutilisable : mes données montrent qu'il sort de la zone 2-8 °C dans 46,6 % des cas sans aucune attaque. Soit l'alarme sonne à tort tout le temps, soit elle est tellement haute qu'elle laisse passer le mensonge. »

---

## ARGUMENT 1.3 — On surveillerait la bouche du menteur

**Principe simple :** surveiller uniquement ce que l'attaquant contrôle = lire la version qu'il a écrite.

**Analogie :** le tricheur écrit lui-même sa copie d'examen. Contrôler SA copie, c'est lire ce qu'il a voulu écrire — jamais la vérité.

**Exemple avec tes données :**
```
L'attaquant décide du message du frigo. Il écrit « 7,2 °C ».
Si je surveille le frigo seul, je lis exactement ce qu'il a écrit.
Je n'ai aucun regard que l'attaquant ne contrôle pas.
```

**Phrase à dire :**
> « Le capteur que l'attaquant falsifie, c'est précisément celui du produit. Le surveiller seul, c'est vérifier le mensonge avec le menteur. Il faut une source que l'attaquant ne contrôle pas. »

---

## ARGUMENT 1.4 — Un seul capteur = aucune comparaison possible

**Principe simple :** une valeur ne peut être validée que si on la compare à autre chose.

**Analogie :** tu reçois une lettre de ton banquier. Une seule lettre → tu la crois. Deux lettres différentes → tu commences à vérifier.

**Phrase à dire :**
> « Un seul capteur produit une seule affirmation, sans contre-vérification possible. La détection de mensonge a besoin d'au moins une autre source pour comparer. »

---

# PARTIE 2 — POURQUOI PAS DEUX CAPTEURS ?

## ARGUMENT 2.1 — La contradiction est AMBIGUË : on ne sait pas QUI ment

**Principe simple :** 1 contre 1, c'est un match nul.

**Analogie :** deux personnes s'accusent l'une l'autre : « c'est lui ! » / « non, c'est lui ! ». Impossible de savoir qui dit la vérité. Personne ne tranche.

**Exemple avec tes données :**
```
Avec 2 capteurs uniquement :
  frigo dit    : « 7,2 °C »
  local dit    : « 28,7 °C »
→ ils se contredisent → quelqu'un ment.
→ MAIS QUI ? Le frigo ? Le local ? Impossible de décider : 1 contre 1.
```

**Phrase à dire :**
> « Deux capteurs qui se contredisent me disent qu'il y a un menteur, mais pas lequel. 1 contre 1 est une égalité : aucune décision n'est possible. »

---

## ARGUMENT 2.2 — Pas de VOTE MAJORITAIRE possible avec 2

**Principe simple :** il faut minimum 3 voix pour avoir une majorité.

**Analogie :** un match de foot sans arbitre ni tiers : chaque équipe crie « but ! », l'autre crie « hors-jeu ! » → match nul, personne ne tranche. Avec un arbitre (une 3ᵉ voix), on décide.

**Phrase à dire :**
> « Un vote à deux, c'est 1 contre 1 : rien ne peut être décidé. La majorité n'existe qu'à partir de 3. Et trois est donc le plus petit nombre qui permet de désigner le menteur par majorité. »

---

## ARGUMENT 2.3 — Si l'attaquant corrompt les 2 → je suis aveugle

**Principe simple :** s'il ne reste plus aucun témoin honnête, toute comparaison disparaît.

**Analogie :** au tribunal, les DEUX seuls témoins sont des menteurs → toutes les versions sont fausses, rien ne peut être vérifié. Détecter un mensonge exige au moins une vérité.

**Exemple avec tes données :**
```
L'attaquant modifie le frigo ET le thermostat :
  frigo : « 7,2 °C »     thermostat : « 7,2 °C, rien d'anormal »
→ ils sont « d'accord » entre eux... mais l'accord est FAUX.
→ avec 2 capteurs : plus aucune source de vérité → tout passe.
```

**Phrase à dire :**
> « Avec deux capteurs, si l'attaquant en corrompt deux, je n'ai plus aucune vérité pour comparer. Tout ce que je reçois est faux, et pourtant tout semble cohérent. »

---

# PARTIE 3 — POURQUOI TROIS CAPTEURS ?

## ARGUMENT 3.1 — Le VOTE MAJORITAIRE désigne le menteur

**Principe simple :** 2 témoins honnêtes contre 1 menteur → la majorité départage.

**Analogie :** trois arbitres regardent la même action : deux disent « hors-jeu », un dit « non ». On suit la majorité : le troisième s'est trompé.

**Exemple avec tes données (le MITM) :**
```
ATTAQUE : l'attaquant gèle le frigo pendant 3 minutes.
  frigo :  7,2 → 7,2 → 7,2 → 7,2 → 7,2   (FIGÉ : jamais vu en 5 jours !)
  local : 28,7 → 28,7 → 28,7 → 28,7 → 28,7  (normale, stable)
  météo : 37 → 37 → 37 → 37 → 37           (normale, stable)

→ 2 témoins restent dans leur comportement normal
→ le frigo sort du sien de façon IMPOSSIBLE
→ 2 contre 1 : le menteur est isolé et désigné. 🚨
```

**Phrase à dire :**
> « Quand deux témoins indépendants racontent leur comportement normal et que le troisième ne les suit pas, la majorité désigne le menteur. Un frigo figé est impossible en normal : mes 5 jours de données le prouvent. »

---

## ARGUMENT 3.2 — Robustesse : il en reste toujours un honnête

**Principe simple :** la sécurité de repli — même si 2 mentent, 1 vérité reste.

**Analogie :** trois ampoules dans une pièce. Si 2 grillent, il reste 1 lumière. Avec 2 ampoules seules, si les 2 grillent : nuit noire.

**Exemple avec tes données :**
```
L'attaquant corrompt le frigo ET le thermostat (les 2 !).
→ la MÉTÉO reste honnête : elle continue de dire ~37 °C, rien d'anormal.
→ je compare les 2 histoires impossibles à CETTE vérité restante
  → l'incohérence se voit. 🚨
Avec 2 capteurs seulement : corrompre les 2 = fin de la détection.
```

**Phrase à dire :**
> « Avec trois capteurs, même si l'attaquant en corrompt deux, il m'en reste toujours un pour dire la vérité. C'est une exigence de disponibilité : un système de détection ne doit pas devenir aveugle au premier capteur corrompu. »

---

## ARGUMENT 3.3 — La difficulté se MULTIPLIE pour l'attaquant

**Principe simple :** imiter une chose est facile ; imiter trois choses cohérentes est très difficile.

**Analogie :** le faux passeport. Copier 1 signature = facile ✍️. Copier signature + photo + cachet + date, qui se tiennent ensemble = 4 chances de se tromper 🚨.

**Exemple avec tes données :**
```
Pour passer inaperçu en touchant les 3 capteurs, l'attaquant devrait imiter PILE :
  • le niveau du frigo (~7 °C)
  • SA variation permanente (un frigo normal ne reste jamais figé)
  • la stabilité du local (~28,7 °C)
  • la stabilité de la météo (~37 °C)
  • le tout en accord avec 5 jours de comportement normal appris par le modèle

→ chaque chose à imiter = une chance de se tromper
→ une seule erreur suffit au modèle pour détecter
→ plus l'attaque est large, plus elle est visible
```

**Phrase à dire :**
> « Modifier un seul capteur, c'est facile à imiter. Modifier trois histoires cohérentes entre elles et avec le passé, c'est multiplier les chances de se trahir. Un attaquant intelligent vise donc le capteur produit seul — et c'est exactement là que les deux témoins le démasquent. »

---

## ARGUMENT 3.4 — Les témoins sont INDÉPENDANTS (prouvé par les données)

**Principe simple :** les témoins ne se copient pas → ils ne peuvent pas répéter le mensonge.

**Exemple avec tes données (chiffres mesurés) :**
```
Corrélations entre capteurs : 0,006 / 0,005 / 0,004 (≈ zéro).
Et : le frigo à 2, 7 ou 13 °C → le local reste ~28,7 °C, la météo ~37 °C.

Preuve d'indépendance : les témoins ne « suivent » pas le frigo.
→ ils restent fidèles à leur propre réalité pendant qu'il ment.
```

**Phrase à dire :**
> « Mes corrélations à 0,006 prouvent que les témoins ne dépendent pas du frigo : ils ne peuvent pas confirmer un mensonge. C'est parce qu'ils sont indépendants qu'ils sont fiables. »

---

## 🎯 LA QUESTION PIÈGE : « MAIS ILS N'ONT PAS DE RELATION ? ALORS COMMENT LES COMPARER ? »

**Réponse simple :**

| Mot | Vrai sens |
|---|---|
| « Pas de relation » | leurs NOMBRES ne se copient pas (corrélation 0,006) → ils ne peuvent pas répéter un mensonge |
| « Raconter la même histoire » | chacun reste dans SA zone normale apprise — PAS les mêmes valeurs |

**Exemple :**
```
« La même histoire » ≠ « le local dit 7,2 comme le frigo ».
= « le local reste à 28,7 °C (sa normale) et la météo à 37 °C (sa normale),
   pendant que le frigo invente un comportement jamais vu ».
```

**Phrase à dire :**
> « Mes capteurs n'ont pas de relation de valeurs — c'est ce qui les rend fiables. Comparer, ce n'est pas chercher la même valeur : c'est vérifier que chaque capteur reste dans son comportement normal appris. Quand le frigo devient figé et que les deux autres restent stables, la majorité désigne le frigo comme menteur. »

---

## 📊 LE TABLEAU RÉCAP 1 vs 2 vs 3 (à projeter)

| | 1 capteur | 2 capteurs | 3 capteurs |
|---|---|---|---|
| Fausse valeur réaliste visible ? | ❌ non | ⚠️ mais qui ment ? | ✅ majorité désigne |
| Vote majoritaire possible ? | non | non (1 vs 1) | ✅ oui (2 vs 1) |
| Si l'attaquant en corrompt 2 ? | aveugle | aveugle | ✅ il en reste 1 honnête |
| Fausses alertes mesurées | 46,6 % | — | 0,52 % |
| AUC du modèle | — | — | 0,978 |

---

## 🎤 LE DISCOURS FINAL (30 secondes, à apprendre par cœur)

> « Un seul capteur est aveugle : mes données montrent 46,6 % de fausses alertes avec un seuil simple, et une fausse valeur réaliste de 7,2 °C est invisible. Deux capteurs sont ambigus : ils détectent un mensonge mais ne peuvent pas désigner le menteur — c'est 1 contre 1. Trois capteurs désignent : deux témoins indépendants restent dans leur comportement normal pendant que le troisième en sort de façon impossible. La majorité isole le menteur, et il m'en reste toujours au moins un honnête, même si l'attaquant en corrompt deux. Mes mesures le confirment : AUC 0,978, 0,52 % de fausses alertes, MITM détecté à 92 %. »

---

## ⭐ L'ESSENTIEL EN UNE PHRASE

> **« Un menteur peut imiter un chiffre, pas trois. Deux voix qui se contredisent sont un match nul ; il en faut trois pour former une majorité — et pour qu'il reste toujours une vérité qui le démasque. »**