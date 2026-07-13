"""
ML Report Generator — Rapport Phase 2 (IF Multivarié)
======================================================
Génère un rapport structuré pour opérateur usine à partir
des prédictions du modèle Isolation Forest Multivarié,
sans LLM, en utilisant les vrais labels et données ML.
"""

import os, json, joblib, numpy as np, pandas as pd

CHUNK_SIZE = 5000

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
MODELS_DIR = os.path.join(BASE, "phase2", "Data", "Processed", "models")
DATA_DIR = os.path.join(BASE, "phase2", "Data", "Processed")

MV_MODEL_PATH = os.path.join(MODELS_DIR, "if_multivarie.pkl")
MV_SCALER_PATH = os.path.join(MODELS_DIR, "scaler_multivarie.pkl")
MV_CACHE_PATH = os.path.join(DATA_DIR, "multivarie_inferred.json")

MV_FEATURE_COLS = [
    "weather_temp", "fridge_temp", "thermostat_temp",
    "weather_diff_1", "weather_roll_mean_10", "weather_roll_std_10",
    "fridge_diff_1", "fridge_roll_mean_10", "fridge_roll_std_10",
    "thermostat_diff_1", "thermostat_roll_mean_10", "thermostat_roll_std_10",
    "weather_fridge_diff", "weather_thermostat_diff", "fridge_thermostat_diff",
    "hour_sin", "hour_cos", "season_sin", "season_cos",
    "fridge_cond_enc", "thermo_status",
]

FEATURE_EXPLICATIONS = {
    "weather_temp": "Température extérieure anormale",
    "fridge_temp": "Température du frigo anormale",
    "thermostat_temp": "Température ambiante anormale",
    "weather_diff_1": "La température extérieure a changé brutalement",
    "weather_roll_mean_10": "La tendance météo se dégrade",
    "weather_roll_std_10": "La météo est instable",
    "fridge_diff_1": "La température du frigo a changé brutalement",
    "fridge_roll_mean_10": "Le frigo dérive (température moyenne anormale)",
    "fridge_roll_std_10": "Le frigo est instable (variations fréquentes)",
    "thermostat_diff_1": "La température ambiante a changé brutalement",
    "thermostat_roll_mean_10": "La température ambiante dérive",
    "thermostat_roll_std_10": "La température ambiante est instable",
    "weather_fridge_diff": "Écart anormal entre la météo et le frigo",
    "weather_thermostat_diff": "Écart anormal entre la météo et le thermostat",
    "fridge_thermostat_diff": "Incohérence entre le frigo et le thermostat",
    "hour_sin": "Comportement anormal pour cette heure",
    "hour_cos": "Moment de la journée suspect",
    "season_sin": "Comportement anormal pour cette saison",
    "season_cos": "Période de l'année anormale",
    "fridge_cond_enc": "État du compresseur frigo anormal",
    "thermo_status": "Statut du thermostat anormal",
}

SEASONS = {"hiver": 1, "printemps": 2, "ete": 3, "automne": 4}

_model = None
_scaler = None


def _load_model():
    global _model, _scaler
    if _model is not None:
        return
    if not os.path.exists(MV_MODEL_PATH) or not os.path.exists(MV_SCALER_PATH):
        _model = False
        return
    _model = joblib.load(MV_MODEL_PATH)
    _scaler = joblib.load(MV_SCALER_PATH)


def _ensure_multivarie_cached():
    global _model
    _load_model()
    if _model is False:
        return None

    if os.path.exists(MV_CACHE_PATH):
        with open(MV_CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)

    print("[Multivarié] Chargement et merge des 3 CSV...")
    weather = pd.read_csv(
        os.path.join(DATA_DIR, "weather_features_concat.csv"),
        parse_dates=["datetime"], usecols=["datetime", "temperature", "diff_1",
                                            "roll_mean_10", "roll_std_10",
                                            "hour_sin", "hour_cos", "season_sin", "season_cos"]
    )
    fridge = pd.read_csv(
        os.path.join(DATA_DIR, "fridge_features_concat.csv"),
        parse_dates=["datetime"], usecols=["datetime", "fridge_temperature", "diff_1",
                                           "roll_mean_10", "roll_std_10",
                                           "hour_sin", "hour_cos", "season_sin", "season_cos",
                                           "condition_enc"]
    )
    thermostat = pd.read_csv(
        os.path.join(DATA_DIR, "thermostat_features_concat.csv"),
        parse_dates=["datetime"], usecols=["datetime", "current_temperature", "diff_1",
                                           "roll_mean_10", "roll_std_10",
                                           "hour_sin", "hour_cos", "season_sin", "season_cos",
                                           "thermostat_status"]
    )

    # Drop duplicates and sort
    weather = weather.drop_duplicates(subset=["datetime"]).sort_values("datetime").reset_index(drop=True)
    fridge = fridge.drop_duplicates(subset=["datetime"]).sort_values("datetime").reset_index(drop=True)
    thermostat = thermostat.drop_duplicates(subset=["datetime"]).sort_values("datetime").reset_index(drop=True)

    # Rename
    w = weather.rename(columns={"temperature": "weather_temp", "diff_1": "weather_diff_1",
                                "roll_mean_10": "weather_roll_mean_10", "roll_std_10": "weather_roll_std_10"})
    f = fridge.rename(columns={"fridge_temperature": "fridge_temp", "diff_1": "fridge_diff_1",
                               "roll_mean_10": "fridge_roll_mean_10", "roll_std_10": "fridge_roll_std_10",
                               "condition_enc": "fridge_cond_enc"})
    t = thermostat.rename(columns={"current_temperature": "thermostat_temp", "diff_1": "thermostat_diff_1",
                                   "roll_mean_10": "thermostat_roll_mean_10", "roll_std_10": "thermostat_roll_std_10",
                                   "thermostat_status": "thermo_status"})

    # Merge asof to handle near-miss timestamps
    print("[Multivarié] Merge des données...")
    merged = pd.merge_asof(w, f, on="datetime", tolerance=pd.Timedelta("5min"), direction="nearest")
    merged = pd.merge_asof(merged, t, on="datetime", tolerance=pd.Timedelta("5min"), direction="nearest")

    # Drop duplicate hour/season columns from merge
    for suffix in ["_x", "_y"]:
        for col in [f"hour_sin{suffix}", f"hour_cos{suffix}",
                     f"season_sin{suffix}", f"season_cos{suffix}"]:
            if col in merged.columns:
                merged.drop(columns=[col], inplace=True)

    # Build cross-sensor features
    merged["weather_fridge_diff"] = merged["weather_temp"] - merged["fridge_temp"]
    merged["weather_thermostat_diff"] = merged["weather_temp"] - merged["thermostat_temp"]
    merged["fridge_thermostat_diff"] = merged["fridge_temp"] - merged["thermostat_temp"]

    merged = merged.dropna(subset=MV_FEATURE_COLS).reset_index(drop=True)
    print(f"[Multivarié] {len(merged)} lignes après merge")

    # Chunked inference
    print("[Multivarié] Inférence par lots...")
    all_records = []
    for start in range(0, len(merged), CHUNK_SIZE):
        chunk = merged.iloc[start:start+CHUNK_SIZE]
        X = chunk[MV_FEATURE_COLS].fillna(0).values
        X_scaled = _scaler.transform(X)
        preds = np.where(_model.predict(X_scaled) == -1, 1, 0)
        scores = -_model.score_samples(X_scaled)

        for i, (_, row) in enumerate(chunk.iterrows()):
            all_records.append({
                "datetime": row["datetime"].strftime("%Y-%m-%dT%H:%M:%S"),
                "weather_temp": float(row["weather_temp"]),
                "fridge_temp": float(row["fridge_temp"]),
                "thermostat_temp": float(row["thermostat_temp"]),
                "prediction": int(preds[i]),
                "anomaly_score": float(scores[i]),
            })
        print(f"[Multivarié] {min(start+CHUNK_SIZE, len(merged))}/{len(merged)}")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(MV_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(all_records, f, ensure_ascii=False)

    print(f"[Multivarié] Cache sauvegardé: {len(all_records)} points")
    return all_records


def _filter_records(records: list, filters: dict) -> list:
    result = []
    for r in records:
        dt = pd.Timestamp(r["datetime"])
        year = filters.get("year")
        if year and str(dt.year) != str(year):
            continue
        season = filters.get("season")
        if season:
            season_num = SEASONS.get(season)
            month = dt.month
            mapped = ((month % 12 + 3) // 3)
            season_map = {4: 1, 1: 2, 2: 3, 3: 4}
            if season_map.get(mapped) != season_num:
                continue
        month = filters.get("month")
        if month is not None and dt.month != month:
            continue
        day = filters.get("day")
        if day is not None and dt.day != day:
            continue
        shift = filters.get("shift")
        if shift:
            h = dt.hour
            if shift == "matin" and not (6 <= h < 14):
                continue
            if shift == "apres-midi" and not (14 <= h < 22):
                continue
            if shift == "nuit" and not (h >= 22 or h < 6):
                continue
        day_type = filters.get("day_type")
        if day_type:
            dow = dt.dayofweek
            if day_type == "ouvre" and dow >= 5:
                continue
            if day_type == "weekend" and dow < 5:
                continue
        start_hour = filters.get("start_hour")
        if start_hour is not None and dt.hour < start_hour:
            continue
        end_hour = filters.get("end_hour")
        if end_hour is not None and dt.hour > end_hour:
            continue
        start_date = filters.get("start_date")
        if start_date and dt < pd.Timestamp(start_date):
            continue
        end_date = filters.get("end_date")
        if end_date and dt > pd.Timestamp(end_date):
            continue
        result.append(r)
    return result


def _compute_stats(filtered: list) -> dict:
    total = len(filtered)
    if total == 0:
        return {"total": 0, "n_pred_anomaly": 0, "n_pred_normal": 0, "avg_score": 0}
    df = pd.DataFrame(filtered)
    n_pred_anomaly = int(df["prediction"].sum())

    # Per-shift breakdown
    dt = pd.to_datetime(df["datetime"])
    shifts = {"Matin (6h-14h)": (6, 14), "Après-midi (14h-22h)": (14, 22), "Nuit (22h-6h)": (22, 6)}
    shift_stats = {}
    for name, (start, end) in shifts.items():
        if start < end:
            mask = (dt.dt.hour >= start) & (dt.dt.hour < end)
        else:
            mask = (dt.dt.hour >= start) | (dt.dt.hour < end)
        subset = df[mask]
        if len(subset) > 0:
            n_anom = int(subset["prediction"].sum())
            shift_stats[name] = {
                "total": len(subset),
                "anomalies": n_anom,
                "pct": round(n_anom / len(subset) * 100, 1),
            }

    return {
        "total": total,
        "n_pred_anomaly": n_pred_anomaly,
        "n_pred_normal": total - n_pred_anomaly,
        "avg_score": round(float(df["anomaly_score"].mean()), 4),
        "shift_stats": shift_stats,
        "fridge_max": float(df["fridge_temp"].max()),
        "fridge_min": float(df["fridge_temp"].min()),
        "weather_avg": float(df["weather_temp"].mean()),
        "fridge_avg": float(df["fridge_temp"].mean()),
        "thermostat_avg": float(df["thermostat_temp"].mean()),
    }


def generate_report(filters: dict) -> str:
    records = _ensure_multivarie_cached()
    if records is None:
        return (
            "# ⚠️ Rapport non disponible\n\n"
            "Le modèle IF Multivarié n'est pas chargé. "
            "Vérifiez que `if_multivarie.pkl` et `scaler_multivarie.pkl` "
            "existent dans `phase2/Data/Processed/models/`."
        )

    filtered = _filter_records(records, filters)
    stats = _compute_stats(filtered)

    period_parts = []
    if filters.get("year"):
        period_parts.append(f"Année {filters['year']}")
    if filters.get("season"):
        period_parts.append(f"Saison {filters['season']}")
    if filters.get("month"):
        period_parts.append(f"Mois {filters['month']}")
    if filters.get("shift"):
        period_parts.append(f"Période {filters['shift']}")
    if filters.get("start_date") or filters.get("end_date"):
        sd = filters.get("start_date", "début")
        ed = filters.get("end_date", "fin")
        period_parts.append(f"Du {sd} au {ed}")
    period_str = " · ".join(period_parts) if period_parts else "Période complète"

    lines = [
        "# 📊 Rapport — Isolation Forest Multivarié",
        f"**Période :** {period_str}",
        f"**Modèle :** Isolation Forest Multivarié (3 capteurs fusionnés)",
        "",
    ]

    if stats["total"] == 0:
        lines += [
            "## Aucune donnée",
            "",
            "Aucun point de données ne correspond aux filtres sélectionnés. "
            "Essayez d'élargir la période ou de modifier les filtres.",
        ]
        return "\n".join(lines)

    anomaly_pct = (stats["n_pred_anomaly"] / stats["total"] * 100) if stats["total"] > 0 else 0
    if anomaly_pct > 10:
        icon, msg = "🔴", "**URGENT** — Beaucoup d'anomalies détectées, vérification nécessaire."
    elif anomaly_pct > 3:
        icon, msg = "🟠", "**ATTENTION** — Quelques anomalies détectées, surveiller les capteurs."
    else:
        icon, msg = "🟢", "**OK** — Peu d'anomalies, fonctionnement normal."

    lines += [
        f"## 1. Résumé {icon}", "",
        msg, "",
        f"**{stats['total']}** points de données analysés sur les 3 capteurs "
        f"(météo, frigo, thermostat).", "",
        f"- 🔴 **{stats['n_pred_anomaly']}** anomalies détectées ({anomaly_pct:.1f}% des points)",
        f"- ✅ **{stats['n_pred_normal']}** points normaux",
        f"- 📊 Score d'anomalie moyen : **{stats['avg_score']:.3f}**", "",
    ]

    if filtered:
        df = pd.DataFrame(filtered)
        w_avg = df["weather_temp"].mean()
        f_avg = df["fridge_temp"].mean()
        t_avg = df["thermostat_temp"].mean()

        lines += [
            "## 2. Températures Moyennes", "",
            "| Capteur | Température moyenne |",
            "|---------|-------------------:|",
            f"| 🌤️ Météo extérieure | {w_avg:.1f}°C |",
            f"| 🧊 Frigo | {f_avg:.1f}°C |",
            f"| 🌡️ Thermostat (ambiant) | {t_avg:.1f}°C |", "",
        ]

        issues = []
        wf_diff = abs(w_avg - f_avg)
        wt_diff = abs(w_avg - t_avg)
        ft_diff = abs(f_avg - t_avg)

        if wf_diff > 15:
            issues.append(f"- 🧊 **Écart météo / frigo : {wf_diff:.1f}°C** → Le frigo est très différent de l'extérieur, vérifier l'isolation.")
        if wt_diff > 10:
            issues.append(f"- 🌡️ **Écart météo / thermostat : {wt_diff:.1f}°C** → L'ambiance intérieure est anormale par rapport à l'extérieur.")
        if ft_diff > 8:
            issues.append(f"- 🔄 **Écart frigo / thermostat : {ft_diff:.1f}°C** → Incohérence entre la température du frigo et l'ambiance.")

        if issues:
            lines += ["## 3. Incohérences Détectées", "",
                       "Le modèle multivarié analyse les 3 capteurs ensemble. Voici les écarts anormaux :", ""]
            lines += issues
            lines += [""]

    lines += ["## 4. Actions Recommandées", ""]

    recs = []

    # ── Urgence globale ─────────────────────────────────────────────────
    if anomaly_pct > 15:
        recs += [
            "🔴 **Priorité 1 — Intervention urgente**",
            f"   • {anomaly_pct:.0f}% des points sont anormaux → inspection immédiate",
            "   • Vérifier les 3 capteurs (câbles, connectique, alimentation)",
            "   • Consulter l'historique des 24 dernières heures",
        ]
    elif anomaly_pct > 5:
        recs += [
            "🟠 **Priorité 2 — Surveillance renforcée**",
            f"   • {anomaly_pct:.0f}% d'anomalies → planifier une vérification",
            "   • Surveiller le tableau de bord les prochaines heures",
            "   • Préparer une équipe de maintenance",
        ]

    # ── Par créneau horaire ─────────────────────────────────────────────
    shift_stats = stats.get("shift_stats", {})
    worst_shift = max(shift_stats.items(), key=lambda x: x[1]["pct"]) if shift_stats else None
    if worst_shift and worst_shift[1]["pct"] > anomaly_pct + 5:
        recs += [
            f"⏰ **Créneau le plus touché : {worst_shift[0]}**",
            f"   • {worst_shift[1]['pct']:.0f}% d'anomalies sur {worst_shift[1]['total']} points",
            "   • Renforcer la surveillance pendant ce créneau",
        ]

    if shift_stats and len(shift_stats) >= 2:
        pcts = [s["pct"] for s in shift_stats.values()]
        if max(pcts) - min(pcts) > 20:
            recs += [
                "📊 **Écart significatif entre les créneaux**",
                "   • Les anomalies ne sont pas réparties uniformément",
                "   • Vérifier si un événement spécifique se produit sur le créneau le plus touché",
            ]

    # ── Par capteur (températures) ──────────────────────────────────────
    f_max = stats.get("fridge_max", 0)
    f_min = stats.get("fridge_min", 0)
    w_avg = stats.get("weather_avg", 0)
    f_avg = stats.get("fridge_avg", 0)
    t_avg = stats.get("thermostat_avg", 0)

    if f_max > 8:
        recs += [
            "🧊 **Frigo — Température trop élevée**",
            f"   • Max {f_max:.1f}°C détecté (normale: 2-8°C)",
            "   • Vérifier le joint de porte, la ventilation, et l'état du compresseur",
        ]
    if f_min < 0:
        recs += [
            "🧊 **Frigo — Risque de gel**",
            f"   • Min {f_min:.1f}°C → risque de gel des produits",
            "   • Vérifier le thermostat et le réglage du compresseur",
        ]
    if 8 >= f_max > 6 and f_avg > 5:
        recs += [
            "🧊 **Frigo — Sous-surveillance**",
            "   • La température frigo est dans la norme mais en hausse",
            "   • Planifier un contrôle préventif du système de réfrigération",
        ]

    if abs(w_avg - f_avg) > 15:
        recs += [
            "🌡️ **Incohérence météo / frigo**",
            f"   • Écart de {abs(w_avg - f_avg):.1f}°C entre l'extérieur et le frigo",
            "   • Vérifier l'isolation du frigo et l'étanchéité des joints",
        ]
    if abs(f_avg - t_avg) > 10:
        recs += [
            "🔄 **Incohérence frigo / thermostat**",
            f"   • Écart de {abs(f_avg - t_avg):.1f}°C entre le frigo et l'ambiance",
            "   • Vérifier que le thermostat n'est pas situé près d'une source de chaleur",
        ]

    # ── Actions générales ──────────────────────────────────────────────
    season = filters.get("season")
    if season == "ete":
        recs += [
            "☀️ **Conseil saisonnier — Été**",
            "   • Les températures élevées augmentent le risque de surchauffe",
            "   • Vérifier les systèmes de ventilation et de climatisation",
            "   • S'assurer que les capteurs extérieurs sont à l'ombre",
        ]
    elif season == "hiver":
        recs += [
            "❄️ **Conseil saisonnier — Hiver**",
            "   • Les températures basses peuvent affecter les capteurs extérieurs",
            "   • Vérifier l'isolation des câbles et des boîtiers",
            "   • Surveiller les écarts entre température extérieure et intérieure",
        ]

    if not recs:
        recs += ["✅ **Aucune action urgente**", "   • Les 3 capteurs sont cohérents", "   • Poursuivre la surveillance normale"]

    # ── Résumé des actions ─────────────────────────────────────────────
    recs += ["", "**📋 Check-list opérateur :**"]
    recs += ["   • Noter les anomalies dans le registre de maintenance"]
    recs += ["   • Signaler tout écart anormal à l'équipe technique"]
    recs += ["   • Consulter le tableau de bord en temps réel"]

    lines += recs + [""]

    lines += [
        "## 5. Détail Technique", "",
        "| Métrique | Valeur |",
        "|----------|------:|",
        f"| Points analysés | {stats['total']} |",
        f"| Anomalies détectées | {stats['n_pred_anomaly']} ({anomaly_pct:.1f}%) |",
        f"| Points normaux | {stats['n_pred_normal']} |",
        f"| Score anomalie moyen | {stats['avg_score']:.3f} |",
        f"| Modèle | Isolation Forest Multivarié (21 features) |",
        f"| Capteurs fusionnés | Météo, Frigo, Thermostat |", "",
    ]

    lines += [
        "---",
        "*Rapport généré par Peaksoft Security Platform — "
        "Phase 2 · IF Multivarié — "
        f"{pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')}*",
    ]

    return "\n".join(lines)
