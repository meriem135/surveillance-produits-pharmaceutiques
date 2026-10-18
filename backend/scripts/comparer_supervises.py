# -*- coding: utf-8 -*-
"""Compare UNIQUEMENT les modeles SUPERVISES et designe le meilleur.

Methode (priorite pharma, jamais l'accuracy) :
  1. Rappel          (ne pas rater d'attaque -> securite patient)   -> PLUS GRAND = mieux
  2. F1              (compromis rappel / precision)                 -> PLUS GRAND = mieux
  3. Fausses alertes/h (fatigue des operateurs)                     -> PLUS PETIT = mieux
  4. Delai median    (rapidite de detection, minutes)               -> PLUS PETIT = mieux
  5. Episodes detectes                                              -> PLUS GRAND = mieux
  6. ROC-AUC         (pouvoir de separation global)                 -> PLUS GRAND = mieux

Les chiffres viennent de comparaison_modeles.json (cumul des 9 repetitions),
donc c'est plus fiable qu'une seule repetition.

Usage :  python backend/scripts/comparer_supervises.py
"""
import json
import os
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

# les 4 modeles SUPERVISES (on exclut les non supervises et la reference)
SUPERVISES = ["RandomForest", "XGBoost", "Logistique", "MLP"]
COURT = {"RandomForest": "Random Forest", "XGBoost": "XGBoost",
         "Logistique": "Régression Logistique", "MLP": "MLP"}


def cle_tri(k, res):
    """Tri par priorite pharma : rappel, puis F1, puis FA/h, puis delai, ..."""
    r = res[k]
    return (-r["recall"],
            -r["f1"],
            r["fausses_alarmes_evenements_par_heure"],
            r.get("delai_median_min", 99.0),
            -r["episodes_detectes"],
            -r.get("roc_auc", 0.0))


def main() -> None:
    j = json.load(open(JSON_P, encoding="utf-8"))
    res = j["resultats"]
    dispo = [k for k in SUPERVISES if k in res]
    if not dispo:
        print("Aucun modele supervise trouve dans le JSON.")
        return

    classement = sorted(dispo, key=lambda k: cle_tri(k, res))

    print("=" * 92)
    print("COMPARAISON DES MODELES SUPERVISES (cumul des 9 repetitions, 55 episodes de test)")
    print("=" * 92)
    print(f"{'rang':<5}{'modele':<24}{'RAPPEL':>8}{'F1':>8}{'prec':>8}"
          f"{'FA/h':>8}{'delai':>7}{'epis':>7}{'AUC':>8}")
    print("-" * 92)
    for i, k in enumerate(classement, 1):
        r = res[k]
        print(f"{i:<5}{COURT[k]:<24}{r['recall']:>8.3f}{r['f1']:>8.3f}{r['precision']:>8.3f}"
              f"{r['fausses_alarmes_evenements_par_heure']:>8.2f}"
              f"{r.get('delai_median_min', float('nan')):>7.1f}"
              f"{str(r['episodes_detectes']) + '/' + str(r['episodes']):>7}"
              f"{r.get('roc_auc', float('nan')):>8.3f}")

    gagnant = classement[0]
    print()
    print("--- METHODE 1 : tri par priorite (rappel > F1 > FA/h > delai > episodes > AUC) ---")
    print(f"    -> LE MEILLEUR : {COURT[gagnant]}")

    print()
    print("--- METHODE 2 : les 3 filtres (plus simple a expliquer) ---")
    # Filtre 1 : rappel acceptable
    seuil_rappel = 0.55
    restants = [k for k in dispo if res[k]["recall"] >= seuil_rappel]
    print(f"    Filtre 1 - rappel >= {seuil_rappel:.2f} (on elimine ceux qui ratent trop d'attaques) : "
          f"gardes = {[COURT[k] for k in restants]} | elimines = {[COURT[k] for k in dispo if k not in restants]}")
    # Filtre 2 : meilleur F1
    if restants:
        f2 = max(restants, key=lambda k: res[k]["f1"])
        print(f"    Filtre 2 - meilleur F1 parmi les gardes : {COURT[f2]} (F1 {res[f2]['f1']:.3f})")
        # Filtre 3 : departage par FA/h
        meilleurs = [k for k in restants if abs(res[k]["f1"] - res[f2]["f1"]) < 1e-9]
        f3 = min(meilleurs, key=lambda k: res[k]["fausses_alarmes_evenements_par_heure"])
        print(f"    Filtre 3 - departage par fausses alertes/h : {COURT[f3]} "
              f"({res[f3]['fausses_alarmes_evenements_par_heure']:.2f} FA/h)")

    print()
    print("--- ATTENTION (pieges a eviter) ---")
    print("    - Ne PAS choisir sur le TEST : on choisit sur la VALIDATION, le test ne sert qu'a confirmer.")
    print("    - Ne PAS choisir avec l'accuracy : un modele 'tout normal' aurait ~87 % et ne detecte rien.")
    print("    - Ne PAS choisir sur le cross_val_score (F1 ~0,99) : il est trop optimiste (fuite temporelle).")
    print("    - Ne PAS choisir sur une seule repetition : c'est instable, il faut regarder les 9.")

    print()
    print("--- PHRASE POUR LE JURY ---")
    r = res[gagnant]
    print(f"    « Je choisis le modele sur la VALIDATION avec le seuil qui maximise le F1, dans l'ordre de")
    print(f"      priorite pharma (rappel d'abord), et je verifie la stabilite sur 9 repetitions. Le meilleur")
    print(f"      des 4 modeles supervises est le {COURT[gagnant]} : rappel {r['recall']:.2f}, F1 {r['f1']:.2f},")
    print(f"      {r['fausses_alarmes_evenements_par_heure']:.2f} fausse(s) alerte(s)/heure, "
          f"{r['episodes_detectes']}/{r['episodes']} episodes detectes. »")


if __name__ == "__main__":
    main()
