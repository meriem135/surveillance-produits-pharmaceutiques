# -*- coding: utf-8 -*-
"""Compare les modèles SUPERVISÉS et désigne le meilleur (version 3 : point de fonctionnement unique).

Le choix se fait sur la VALIDATION, jamais sur le test : le test ne sert qu'à CONFIRMER.

Chaque modèle a UN seul point de fonctionnement, choisi sur la validation : un seuil et une
règle de persistance « k lignes signalées sur les n dernières », qui maximisent le rappel
sous les contraintes précision ≥ 0,90 et ≤ 0,5 fausse alerte par heure (voir
transmission_alertes.py). Classement : modèles qui tiennent la contrainte d'abord, puis
rappel de validation, puis fausses alertes/h, puis délai.

Les chiffres viennent de comparaison_modeles.json (cumul des répétitions).

Usage :  python backend/scripts/comparer_supervises.py
"""
import json
import sys
from pathlib import Path

for _flux in (sys.stdout, sys.stderr):
    try:
        _flux.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = Path(__file__).resolve().parent
ROOT = next(p for p in [HERE, *HERE.parents] if (p / "models").is_dir() or (p / "backend").is_dir())
JSON_P = ROOT / "models" / "transmission_reel" / "comparaison_modeles.json"

SUPERVISES = ["RandomForest", "ExtraTrees", "XGBoost", "HistGB", "Logistique", "MLP"]
COURT = {"RandomForest": "Random Forest", "ExtraTrees": "Extra Trees", "XGBoost": "XGBoost",
         "HistGB": "HistGradientBoosting", "Logistique": "Régression Logistique", "MLP": "MLP",
         "RF_v1": "RF anciennes features"}


def cle_tri(k, res):
    r = res[k]
    delai = r.get("val_delai_median_min")
    return (not (r.get("point_fonctionnement") or {}).get("contrainte_tenue", False), -(r.get("val_recall") or 0.0),
            r.get("val_fausses_alarmes_par_heure") or 0.0, delai if delai is not None else 99.0)


def classer(res):
    return sorted([k for k in SUPERVISES if k in res], key=lambda k: cle_tri(k, res))


def ligne(i, k, r, role):
    v = r["par_role"]["alarme"][role]
    op = r["point_fonctionnement"]
    d = v["delai_median_min"]
    return (f"{i:<5}{COURT.get(k, k):<24}{op['seuil']:>6.2f}{str(op['k']) + '/' + str(op['n']):>7}"
            f"{v['recall']:>8.3f}{v['precision']:>8.3f}{v['fausses_alarmes_evenements_par_heure']:>7.2f}"
            f"{(f'{d:.1f}' if d is not None else '—'):>7}{str(v['episodes_detectes']) + '/' + str(v['episodes']):>9}"
            f"{v['f1']:>7.3f}  {'oui' if op['contrainte_tenue'] else 'NON'}")


def entete():
    print(f"{'rang':<5}{'modele':<24}{'seuil':>6}{'k/n':>7}{'RAPPEL':>8}{'PREC':>8}{'FA/h':>7}{'delai':>7}"
          f"{'episodes':>9}{'F1':>7}  contrainte")
    print("-" * 100)


def main() -> None:
    j = json.load(open(JSON_P, encoding="utf-8"))
    res = j["resultats"]
    if j.get("version", 1) < 3:
        print("JSON d'une ancienne version : relancer transmission_models.py.")
        return
    classement = classer(res)
    n_rep = j["protocole"]["repetitions"]
    print("=" * 100)
    print(f"COMPARAISON DES MODELES SUPERVISES (cumul des {n_rep} repetitions) — {j['protocole']['seuil']}")
    print("=" * 100)
    for role, titre in (("val", "VALIDATION (sert au choix)"), ("test", "TEST (confirmation, jamais utilise pour choisir)"),
                        ("train", "TRAIN (diagnostic sous/sur-apprentissage)")):
        print(f"\n--- {titre} ---")
        entete()
        for i, k in enumerate(classement, 1):
            print(ligne(i, k, res[k], role))
        if "RF_v1" in res:
            print(ligne("ref", "RF_v1", res["RF_v1"], role))
    g = classement[0]
    t = res[g]["par_role"]["alarme"]["test"]
    print(f"\n-> LE MEILLEUR (choisi sur la validation) : {COURT[g]}")
    print(f"   « Sur {n_rep} répétitions, le {COURT[g]} détecte {t['episodes_detectes']}/{t['episodes']} épisodes "
          f"d'attaque du test, avec {t['fausses_alarmes_evenements_par_heure']:.2f} fausse(s) alerte(s) par heure, "
          f"une précision de {t['precision']:.2f} et un délai médian de {t['delai_median_min']} min. »")


if __name__ == "__main__":
    main()
