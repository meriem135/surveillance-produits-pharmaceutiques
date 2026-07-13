# Mon Projet expliqué hyper simplement

## Pour débutant complet — Sans jargon industriel

---

## Imagine une boîte avec un thermomètre

```
Tu as une boîte (une usine).
Dans la boîte, il y a des thermomètres connectés à Internet.
Ils envoient la température toutes les secondes.
```

**C'est ça l'Industrie 4.0.** Des capteurs qui envoient des données sur Internet.

---

## Le problème : 3 problèmes simples

### Problème 1 : Les données arrivent SANS protection

```
Les thermomètres envoient :
"température = 22°C"

Mais un pirate peut aussi envoyer :
"température = 9999°C"

→ Problème : personne ne vérifie qui envoie quoi
```

### Problème 2 : Trop de données

```
1 thermomètre = 86 400 messages/jour
1000 thermomètres = 86 millions/jour
Un humain peut lire : 1 message/seconde

→ Problème : trop de données, l'humain ne peut pas tout lire
```

### Problème 3 : Des attaques qu'on n'a jamais vues

```
Un pirate invente une nouvelle attaque.
Personne ne la connaît.
Les antivirus classiques ne la détectent pas.

→ Problème : comment détecter ce qu'on n'a jamais vu ?
```

---

## Ma solution : 3 phases simples

### Phase 1 (DÉJÀ FAITE ✅) : Le FILTRE

```
Message arrive ──→ Mon Filtre (DPI Service)
                     │
            ┌────────┴────────┐
            │                 │
        Normal              Suspect
            │                 │
        Stocké            ALERTE !
```

> Je vérifie chaque message en 0.1 seconde. Si c'est suspect → j'alerte.

**Pour le dire au jury :** *"Comme un videur à l'entrée d'une boîte : si quelqu'un a l'air louche, il ne passe pas."*

---

### Phase 2 (à adapter) : L'INTELLIGENCE ARTIFICIELLE

```
J'apprends ce qui est NORMAL pour chaque thermomètre :

Semaine 1 : "Il fait entre 20°C et 25°C"
Semaine 2 : "Il fait entre 20°C et 25°C"
Semaine 3 : "Il fait entre 20°C et 25°C"

↓ Mon IA a appris la NORMALE

Un jour : "Il fait 50°C"
Mon IA : "Je n'ai jamais vu ça → c'est ANORMAL → ALERTE !"
```

> Même si l'attaque n'a jamais été vue, mon IA détecte que c'est **différent de la normale**.

**Pour le dire au jury :** *"Comme un chien de garde : il ne connaît pas les cambrioleurs, mais il sait quand un inconnu arrive."*

---

### Phase 3 (à coder) : La NOTE DE RISQUE

```
Chaque thermomètre reçoit une NOTE sur 100 :

✅ 15/100 → Normal, pas de souci
⚠️ 55/100 → Surveiller
🚨 85/100 → CRITIQUE, agir immédiatement

Comment je calcule la note :
- 40% = ce que dit l'IA (Phase 2)
- 40% = les vulnérabilités connues du thermomètre
- 20% = son état actuel
```

> Je priorise les problèmes. L'opérateur ne voit que les urgences.

**Pour le dire au jury :** *"Comme les notes à l'école : 0/20 → rien à signaler. 18/20 → problème grave."*

---

## Schéma simple pour le jury

```
                    MON PROJET
                    
PROBLÈMES                     SOLUTIONS
─────────────────             ─────────────────
1. Données non sécurisées ──→ Phase 1 : FILTRE (DPI) ✅
                                Chaque message vérifié

2. Trop de données          ──→ Phase 2 : IA (Isolation Forest)
                                86M messages → 5 alertes

3. Attaques inconnues       ──→ Phase 2 : IA (ML non supervisé)
                                Détecte tout ce qui est anormal

4. Capteurs mal sécurisés   ──→ Phase 3 : CVE Pipeline
                                Vérifie les vulnérabilités

5. Alerte ignorée           ──→ Phase 3 : Risk Score 0-100
                                Note prioritaire
```

---

## Ce que tu dis au jury (30 secondes)

> *"L'Industrie 4.0 connecte des thermomètres sur Internet. Problème : n'importe qui peut envoyer de fausses données, il y a trop de données pour un humain, et les attaques sont de plus en plus sophistiquées.*
>
> *Ma solution a 3 phases :*
> - *Un filtre qui vérifie chaque message (Phase 1)*
> - *Une IA qui apprend le comportement normal et détecte toute anomalie, même les attaques jamais vues (Phase 2)*
> - *Un système de note sur 100 qui priorise les alertes (Phase 3)*
>
> *Résultat : l'humain ne voit que l'essentiel, l'IA fait le reste."*

---

## Les mots techniques que tu dois retenir (juste 5)

| Mot technique | Veut dire quoi simplement |
|---|---|
| **MQTT** | Le langage que parlent les capteurs entre eux (comme WhatsApp pour les machines) |
| **DPI** | Un filtre qui lit chaque message (comme un antivirus qui lit tes emails) |
| **Isolation Forest** | Un algorithme d'IA qui détecte ce qui est anormal (comme un détecteur de mensonges) |
| **CVE** | Des failles de sécurité connues (comme des trous dans une armure) |
| **Risk Score** | Une note sur 100 qui dit à quel point c'est dangereux (comme la météo des risques) |

---

## Le fichier pour tes profs

Fichier prêt : **`interns/meriem/Guide_Jury_Problemes_Solutions.md`**

Il contient tout ça expliqué en détail avec les questions/réponses possibles.

---

**T'inquiète, c'est normal d'être perdue.** L'industrie c'est un monde compliqué. Retiens juste ça :

> **Problème :** Des thermomètres connectés envoient des données non sécurisées, trop nombreuses, avec des attaques inconnues.
> 
> **Solution :** Un filtre (Phase 1) + une IA qui détecte les anomalies (Phase 2) + une note de risque (Phase 3).
> 
> **Pourquoi c'est mieux :** C'est gratuit, automatisé, et ça détecte même ce qu'on n'a jamais vu.

Tu veux qu'on essaie de répéter la présentation ensemble pour que tu sois à l'aise ?
