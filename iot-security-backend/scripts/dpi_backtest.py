"""
Backtesting du moteur DPI — Phase 1
====================================
Mesure la performance réelle des 6 règles DPI sur le dataset TON_IoT.

Principe :
  1. Parcourt TOUS les fichiers CSV (normal + 9 types d'attaque)
  2. Pour chaque ligne, construit un payload simulé (comme le ferait le simulateur)
  3. Passe le payload dans le DPI
  4. Compare la décision DPI avec le vrai label (normal vs attack)

Métriques produites :
  - Matrice de confusion (TP, FP, TN, FN)
  - Precision, Recall, F1-Score par règle
  - Precision, Recall, F1-Score par type d'attaque
  - Taux de vrais positifs par règle et par attaque

Usage :
  python scripts/dpi_backtest.py                          # affichage console
  python scripts/dpi_backtest.py --summary                # résumé court
  python scripts/dpi_backtest.py --output results.json    # sauvegarde JSON
"""

import argparse
import json
import os
import sys
import time
import random
from collections import defaultdict
from pathlib import Path
from typing import Optional

# Ajouter le backend au path pour importer le DPI
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DPI_BACKTEST_MODE", "1")

import pandas as pd
from app.domains.intelligence.mqtt_dpi_service import dpi_service

# ─── Configuration des chemins ──────────────────────────────────────────────

TON_IOT_PATH = Path(
    os.getenv(
        "TON_IOT_PATH",
        r"C:\Users\meriem\peaksoft-security-platform-main\peaksoft-security-platform-main"
        r"\Data\Raw\telemtry_data\telemtry_data",
    )
)

NORMAL_DIR = TON_IOT_PATH / "IoT_normal"
ATTACK_DIR = TON_IOT_PATH / "IoT_normal_attack"

# Mapping device → colonnes de données (pour construire le payload)
DEVICE_COLUMNS: dict[str, list[str]] = {
    "weather":    ["temperature", "pressure", "humidity"],
    "fridge":     ["Fridge_Temperature", "Temp_Condition"],
    "thermostat": ["current_temperature", "thermostate_status"],
}

ATTACK_TYPES = [
    "backdoor", "DDoS", "DoS", "Injection", "MITM",
    "password", "runsomware", "scanning", "XSS",
]


# ─── Chargement des fichiers CSV ───────────────────────────────────────────

def discover_files() -> list[dict]:
    """Parcourt les dossiers et retourne la liste de tous les fichiers CSV avec leur label."""
    files = []

    # Fichiers normaux
    if NORMAL_DIR.exists():
        for f in sorted(NORMAL_DIR.glob("*.csv")):
            device = _detect_device(f.name)
            if device:
                files.append({"path": f, "label": "normal", "attack_type": None, "device": device})

    # Fichiers d'attaque
    if ATTACK_DIR.exists():
        for attack_folder in sorted(ATTACK_DIR.iterdir()):
            if not attack_folder.is_dir():
                continue
            attack_name = attack_folder.name.replace("IoT_", "").replace("_normal", "")
            for f in sorted(attack_folder.glob("*.csv")):
                device = _detect_device(f.name)
                if device:
                    files.append({"path": f, "label": "attack", "attack_type": attack_name, "device": device})

    return files


def _detect_device(filename: str) -> Optional[str]:
    name_lower = filename.lower()
    if "weather" in name_lower:
        return "weather"
    if "fridge" in name_lower:
        return "fridge"
    if "thermostat" in name_lower:
        return "thermostat"
    return None


# ─── Construction du payload simulé ────────────────────────────────────────

def build_payload(row: dict, device: str, label: str, attack_type: Optional[str] = None) -> dict:
    """
    Construit un payload comme le ferait le simulateur.
    Pour les attaques, n'injecte PAS le label dans les données réelles
    (le DPI ne doit PAS se baser sur un label artificiel).
    """
    # Nettoyer les NaN
    clean = {k: v for k, v in row.items() if pd.notna(v) and str(k).strip() != ""}

    payload = {
        **clean,
        "timestamp": "2024-01-01T00:00:00",
        "device_type": device,
        "noise_factor": round(random.uniform(0.0, 0.08), 4),
        "packet_loss_sim": random.choices([0, 1], weights=[97, 3])[0],
    }

    return payload


# ─── Backtesting proprement dit ────────────────────────────────────────────

def run_backtest(max_rows_per_file: Optional[int] = None) -> dict:
    """
    Exécute le backtesting complet.

    Retourne un dict avec :
      - confusion_matrix: {tp, fp, tn, fn}
      - by_rule: {rule_id: {tp, fp, fn, precision, recall, f1}}
      - by_attack: {attack_type: {tp, fp, fn, precision, recall, f1}}
      - by_device: {device: {tp, fp, fn, precision, recall, f1}}
      - overall: {accuracy, precision, recall, f1}
    """
    files = discover_files()
    total_files = len(files)
    print(f"📁 {total_files} fichiers trouvés")

    # Compteurs globaux
    tp = fp = tn = fn = 0
    by_rule: dict = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    by_attack: dict = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "total": 0})
    by_device: dict = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "total": 0})

    processed = 0
    t_start = time.time()

    for file_info in files:
        path = file_info["path"]
        true_label = file_info["label"]
        device = file_info["device"]
        attack_type = file_info["attack_type"] or "normal"
        filename = path.name

        try:
            df = pd.read_csv(path, on_bad_lines="skip")
            df = df.dropna(axis=1, how="all")
        except Exception as e:
            print(f"  ⚠️  Erreur lecture {filename}: {e}")
            continue

        records = df.to_dict(orient="records")
        if max_rows_per_file:
            records = records[:max_rows_per_file]

        for row in records:
            payload = build_payload(row, device, true_label, attack_type)

            # Réinitialiser le cache DPI à chaque fichier (pas de contamination inter-fichiers)
            if device not in dpi_service._prev_payloads:
                dpi_service._prev_payloads[f"{device}_normal"] = {}
                dpi_service._prev_payloads[f"{device}_attack"] = {}

            alert = dpi_service.inspect_payload(payload)
            detected = alert is not None
            matched_rule_ids = set()
            if alert:
                corr = alert.get("rule", {}).get("correlation", {})
                matched_rules = corr.get("matched_rules", [alert["rule"]["id"]])
                matched_rule_ids = set(matched_rules)

            is_attack = true_label == "attack"

            # Mise à jour des compteurs
            if detected and is_attack:
                tp += 1
            elif detected and not is_attack:
                fp += 1
            elif not detected and not is_attack:
                tn += 1
            elif not detected and is_attack:
                fn += 1

            # Par règle
            for rid in dpi_service.stats.rule_match_counts:
                if rid in matched_rule_ids and is_attack:
                    by_rule[rid]["tp"] += 1
                elif rid in matched_rule_ids and not is_attack:
                    by_rule[rid]["fp"] += 1
                elif rid not in matched_rule_ids and is_attack:
                    by_rule[rid]["fn"] += 1

            # Par type d'attaque
            by_attack[attack_type]["total"] += 1
            if detected and is_attack:
                by_attack[attack_type]["tp"] += 1
            elif detected and not is_attack:
                by_attack[attack_type]["fp"] += 1
            elif not detected and is_attack:
                by_attack[attack_type]["fn"] += 1

            # Par device
            by_device[device]["total"] += 1
            if detected and is_attack:
                by_device[device]["tp"] += 1
            elif detected and not is_attack:
                by_device[device]["fp"] += 1
            elif not detected and is_attack:
                by_device[device]["fn"] += 1

            processed += 1

        elapsed = time.time() - t_start
        rate = processed / max(elapsed, 0.01)
        print(f"  📊 {filename}: {len(records)} lignes ({device}, {true_label}) — {rate:.0f} msg/s")

    # ─── Calcul des métriques ────────────────────────────────────────────
    def f1(p, r):
        return 2 * p * r / (p + r) if (p + r) > 0 else 0.0

    def metrics(tp_val, fp_val, fn_val):
        p = tp_val / (tp_val + fp_val) if (tp_val + fp_val) > 0 else 0.0
        r = tp_val / (tp_val + fn_val) if (tp_val + fn_val) > 0 else 0.0
        return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f1(p, r), 4)}

    overall_metrics = metrics(tp, fp, fn)
    accuracy = (tp + tn) / (tp + tn + fp + fn) if (tp + tn + fp + fn) > 0 else 0.0

    result = {
        "summary": {
            "total_files": total_files,
            "total_rows_processed": processed,
            "duration_seconds": round(time.time() - t_start, 1),
        },
        "confusion_matrix": {
            "true_positives": tp,
            "false_positives": fp,
            "true_negatives": tn,
            "false_negatives": fn,
        },
        "overall": {
            **overall_metrics,
            "accuracy": round(accuracy, 4),
        },
        "by_rule": {
            rid: {
                "tp": cnt["tp"],
                "fp": cnt["fp"],
                "fn": cnt["fn"],
                **metrics(cnt["tp"], cnt["fp"], cnt["fn"]),
            }
            for rid, cnt in sorted(by_rule.items())
        },
        "by_attack": {
            atk: {
                "total": cnt["total"],
                "tp": cnt["tp"],
                "fp": cnt["fp"],
                "fn": cnt["fn"],
                **metrics(cnt["tp"], cnt["fp"], cnt["fn"]),
            }
            for atk, cnt in sorted(by_attack.items())
        },
        "by_device": {
            dev: {
                "total": cnt["total"],
                "tp": cnt["tp"],
                "fp": cnt["fp"],
                "fn": cnt["fn"],
                **metrics(cnt["tp"], cnt["fp"], cnt["fn"]),
            }
            for dev, cnt in sorted(by_device.items())
        },
    }

    return result


# ─── Affichage ──────────────────────────────────────────────────────────

def print_summary(result: dict):
    """Affiche un résumé dans la console."""
    o = result["overall"]
    cm = result["confusion_matrix"]

    print("\n" + "=" * 70)
    print("  📊 BACKTESTING DPI — RÉSULTATS")
    print("=" * 70)
    print(f"\n  📁 {result['summary']['total_files']} fichiers | {result['summary']['total_rows_processed']:,} lignes")
    print(f"  ⏱️  {result['summary']['duration_seconds']} secondes")
    print()

    print("  ┌────────────────────────────────────────────┐")
    print(f"  │  Accuracy  :  {o['accuracy']:.2%}                     │")
    print(f"  │  Precision :  {o['precision']:.2%}                     │")
    print(f"  │  Recall    :  {o['recall']:.2%}                     │")
    print(f"  │  F1-Score  :  {o['f1']:.2%}                     │")
    print("  └────────────────────────────────────────────┘")
    print()

    print(f"  Matrice de confusion :")
    print(f"    TP (vrai positif)   : {cm['true_positives']:>8}")
    print(f"    FP (faux positif)   : {cm['false_positives']:>8}")
    print(f"    TN (vrai négatif)   : {cm['true_negatives']:>8}")
    print(f"    FN (faux négatif)   : {cm['false_negatives']:>8}")
    print()

    print("  ─── Par règle DPI ───")
    print(f"  {'Règle':<10} {'TP':>6} {'FP':>6} {'FN':>6} {'Precision':>10} {'Recall':>8} {'F1':>8}")
    print("  " + "-" * 58)
    for rid, m in result["by_rule"].items():
        print(f"  {rid:<10} {m['tp']:>6} {m['fp']:>6} {m['fn']:>6} {m['precision']:>8.1%} {m['recall']:>7.1%} {m['f1']:>7.1%}")
    print()

    print("  ─── Par type d'attaque ───")
    print(f"  {'Attaque':<14} {'Total':>8} {'TP':>6} {'FP':>6} {'FN':>6} {'Precision':>10} {'Recall':>8} {'F1':>8}")
    print("  " + "-" * 70)
    for atk, m in sorted(result["by_attack"].items()):
        print(f"  {atk:<14} {m['total']:>8} {m['tp']:>6} {m['fp']:>6} {m['fn']:>6} {m['precision']:>8.1%} {m['recall']:>7.1%} {m['f1']:>7.1%}")
    print()

    print("  ─── Par device ───")
    print(f"  {'Device':<12} {'Total':>8} {'TP':>6} {'FP':>6} {'FN':>6} {'Precision':>10} {'Recall':>8} {'F1':>8}")
    print("  " + "-" * 70)
    for dev, m in sorted(result["by_device"].items()):
        print(f"  {dev:<12} {m['total']:>8} {m['tp']:>6} {m['fp']:>6} {m['fn']:>6} {m['precision']:>8.1%} {m['recall']:>7.1%} {m['f1']:>7.1%}")

    print()
    print("  ✅ Backtesting terminé")


# ─── Point d'entrée ────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Backtesting du moteur DPI sur le dataset TON_IoT")
    parser.add_argument("--max-rows", type=int, default=None, help="Limiter le nombre de lignes par fichier")
    parser.add_argument("--summary", action="store_true", help="Afficher seulement le résumé")
    parser.add_argument("--output", type=str, default=None, help="Chemin du fichier JSON de sortie")
    args = parser.parse_args()

    print("🚀 Lancement du backtesting DPI...")
    result = run_backtest(max_rows_per_file=args.max_rows)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"💾 Résultats sauvegardés dans {args.output}")

    if args.summary:
        # N'afficher que les métriques globales
        o = result["overall"]
        cm = result["confusion_matrix"]
        print(f"Accuracy={o['accuracy']:.2%} Precision={o['precision']:.2%} Recall={o['recall']:.2%} F1={o['f1']:.2%}")
        print(f"TP={cm['true_positives']} FP={cm['false_positives']} TN={cm['true_negatives']} FN={cm['false_negatives']}")
    else:
        print_summary(result)


if __name__ == "__main__":
    main()
