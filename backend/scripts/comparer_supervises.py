# -*- coding: utf-8 -*-
"""Compare UNIQUEMENT les modeles SUPERVISES et designe le meilleur.

Le choix se fait sur la VALIDATION (val_*), jamais sur le test : le test ne sert
qu'a CONFIRMER le choix une fois qu'il est fait.

Ordre des metriques (priorite pharma, jamais l'accuracy) :
  1. Rappel            (ne pas rater d'attaque -> securite patient)   -> PLUS GRAND = mieux
  2. Fausses alertes/h (fatigue des operateurs)                      -> PLUS PETIT = mieux
  3. Delai median      (rapidite de detection, minutes)              -> PLUS PETIT = mieux
  4. Precision         (part des alertes qui sont de vraies attaques) -> PLUS GRAND = mieux
  5. F1 / F2           (F2 : le rappel compte 4 fois plus que la precision)

Methode 1 (officielle, mode « rappel d'abord ») : le seuil de chaque modele est
regle sur la validation pour atteindre le RAPPEL CIBLE (0,90 par defaut) ; a rappel
egal, on classe par F2 de validation, puis fausses alertes/h, puis delai.
Methode 2 (controle) : les 3 filtres de Meriem, sur la validation au seuil max F1.

Les chiffres viennent de comparaison_modeles.json (cumul des repetitions).

Usage :  python backend/scripts/comparer_supervises.py [rappel_cible, ex. 0.90]
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

# les 4 modeles SUPERVISES
SUPERVISES = ["RandomForest", "XGBoost", "Logistique", "MLP"]
COURT = {"RandomForest": "Random Forest", "XGBoost": "XGBoost",
         "Logistique": "Régression Logistique", "MLP": "MLP"}


def point(res, k, op, role):
    """Metriques cumulees d'un modele a un point de fonctionnement, sur 'val' ou 'test'."""
    return res[k]["points_fonctionnement"][op][role]


def cle_tri(k, res, op):
    """Tri mode rappel d'abord, sur la VALIDATION : F2, puis FA/h, puis delai."""
    v = point(res, k, op, "val")
    delai = v["delai_median_min"] if v["delai_median_min"] is not None else 99.0
    return (-v["f2"], v["fausses_alarmes_evenements_par_heure"], delai)


def classer(res, op):
    return sorted([k for k in SUPERVISES if k in res], key=lambda k: cle_tri(k, res, op))


def ligne(i, k, v):
    delai = v["delai_median_min"]
    return (f"{i:<5}{COURT[k]:<24}{v['recall']:>8.3f}{v['fausses_alarmes_evenements_par_heure']:>8.2f}"
            f"{(f'{delai:.1f}' if delai is not None else '—'):>7}"
            f"{str(v['episodes_detectes']) + '/' + str(v['episodes']):>8}"
            f"{v['precision']:>8.3f}{v['f1']:>7.3f}{v['f2']:>7.3f}")


def entete():
    print(f"{'rang':<5}{'modele':<24}{'RAPPEL':>8}{'FA/h':>8}{'delai':>7}{'epis':>8}"
          f"{'prec':>8}{'F1':>7}{'F2':>7}")
    print("-" * 92)


def main() -> None:
    j = json.load(open(JSON_P, encoding="utf-8"))
    res = j["resultats"]
    cible = float(sys.argv[1]) if len(sys.argv) > 1 else float(j.get("cible_rappel", 0.90))
    op = f"rappel_{cible:.2f}"
    dispo = [k for k in SUPERVISES if k in res]
    if not dispo:
        print("Aucun modele supervise trouve dans le JSON.")
        return
    if op not in res[dispo[0]].get("points_fonctionnement", {}):
        print(f"Rappel cible {cible:.2f} absent du JSON (relancer transmission_models.py avec TARGET_RECALL={cible}).")
        return
    n_rep = j["protocole"]["repetitions"]
    prev = j.get("prevalence", {})

    classement = classer(res, op)

    print("=" * 92)
    print(f"COMPARAISON DES MODELES SUPERVISES (cumul des {n_rep} repetitions)")
    if prev:
        print("Part d'attaques : " + ", ".join(f"{r} {100 * v['part']:.1f} %" for r, v in prev.items()))
    print("=" * 92)
    print()
    print(f"--- METHODE 1 (officielle) : rappel cible {cible:.2f} sur la VALIDATION, classement par F2 de validation ---")
    entete()
    for i, k in enumerate(classement, 1):
        print(ligne(i, k, point(res, k, op, "val")))
    gagnant = classement[0]
    print(f"    -> LE MEILLEUR (choisi sur la validation) : {COURT[gagnant]}")
    print()
    print("    Confirmation sur le TEST (meme seuil, jamais utilise pour choisir) :")
    entete()
    for i, k in enumerate(classement, 1):
        print(ligne(i, k, point(res, k, op, "test")))

    print()
    print("--- METHODE 2 (controle) : les 3 filtres, sur la VALIDATION au seuil max F1 ---")
    entete()
    for i, k in enumerate(sorted(dispo, key=lambda k: -point(res, k, "max_f1", "val")["f1"]), 1):
        print(ligne(i, k, point(res, k, "max_f1", "val")))
    # Filtre 1 : rappel acceptable
    seuil_rappel = 0.55
    restants = [k for k in dispo if res[k]["val_recall"] >= seuil_rappel]
    print(f"    Filtre 1 - rappel de validation >= {seuil_rappel:.2f} : "
          f"gardes = {[COURT[k] for k in restants]} | elimines = {[COURT[k] for k in dispo if k not in restants]}")
    # Filtre 2 : meilleur F1 de validation
    if restants:
        f2 = max(restants, key=lambda k: res[k]["val_f1"])
        print(f"    Filtre 2 - meilleur F1 de validation parmi les gardes : {COURT[f2]} (F1 {res[f2]['val_f1']:.3f})")
        # Filtre 3 : departage par FA/h de validation
        meilleurs = [k for k in restants if abs(res[k]["val_f1"] - res[f2]["val_f1"]) < 1e-9]
        f3 = min(meilleurs, key=lambda k: res[k]["val_fausses_alarmes_par_heure"])
        print(f"    Filtre 3 - departage par fausses alertes/h de validation : {COURT[f3]} "
              f"({res[f3]['val_fausses_alarmes_par_heure']:.2f} FA/h)")

    print()
    print("--- ATTENTION (pieges a eviter) ---")
    print("    - Ne PAS choisir sur le TEST : on choisit sur la VALIDATION, le test ne sert qu'a confirmer.")
    part_test = prev.get("test", {}).get("part")
    if part_test is not None:
        print(f"    - Ne PAS choisir avec l'accuracy : un modele 'tout normal' aurait ~{round(100 * (1 - part_test))} %"
              f" (test a {100 * part_test:.1f} % d'attaques) et ne detecte rien.")
    print("    - Ne PAS choisir sur un cross_val_score naif (lignes melangees) : trop optimiste (fuite par les"
          " fenetres glissantes) ; la validation croisee groupee par BLOC d'une heure confirme seulement.")
    print(f"    - Ne PAS choisir sur une seule repetition : c'est instable, il faut regarder les {n_rep}.")

    print()
    print("--- PHRASE POUR LE JURY ---")
    v, t = point(res, gagnant, op, "val"), point(res, gagnant, op, "test")
    print(f"    « Je regle le seuil de chaque modele sur la VALIDATION pour attraper {round(100 * cible)} % des mesures")
    print(f"      falsifiees, puis je choisis le modele qui le fait avec le meilleur F2 de validation, sur {n_rep}")
    print(f"      repetitions. C'est le {COURT[gagnant]}. Le test le confirme : rappel {t['recall']:.2f},")
    print(f"      {t['fausses_alarmes_evenements_par_heure']:.2f} fausse(s) alerte(s)/heure, delai median "
          f"{t['delai_median_min']} min, precision {t['precision']:.2f}, {t['episodes_detectes']}/{t['episodes']}"
          " episodes detectes. »")
    print(f"      (validation : rappel {v['recall']:.2f}, precision {v['precision']:.2f}, F2 {v['f2']:.2f})")


if __name__ == "__main__":
    main()
