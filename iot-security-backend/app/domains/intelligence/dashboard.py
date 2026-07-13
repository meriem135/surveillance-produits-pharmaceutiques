import sqlite3
import json
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import streamlit as st
import plotly.express as px
import plotly.graph_objects as go

DB_PATH = Path(__file__).resolve().parents[4] / "Data" / "Processed" / "iot_security.db"

st.set_page_config(page_title="IoT Security SOC Dashboard", layout="wide", page_icon="🛡️")
st.title("🛡️ IoT Security Operations Center — Phase 3 Intégré")
st.caption("Live depuis la base SQLite — Isolation Forest + Risk Scoring + CVE Intelligence")


@st.cache_data(ttl=5)
def load_data():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT * FROM devices")
    devices = [dict(r) for r in cur.fetchall()]
    df_devices = pd.DataFrame(devices)

    cur.execute("SELECT * FROM telemetry ORDER BY timestamp DESC LIMIT 5000")
    telemetry = [dict(r) for r in cur.fetchall()]
    df_telemetry = pd.DataFrame(telemetry)

    cur.execute("SELECT * FROM ml_models")
    models = [dict(r) for r in cur.fetchall()]
    df_models = pd.DataFrame(models)

    cur.execute("SELECT * FROM model_metrics ORDER BY model_id, attack_type")
    metrics = [dict(r) for r in cur.fetchall()]
    df_metrics = pd.DataFrame(metrics)

    conn.close()
    return df_devices, df_telemetry, df_models, df_metrics


df_devices, df_telemetry, df_models, df_metrics = load_data()


st.subheader("📊 Vue d'ensemble")
col1, col2, col3, col4, col5 = st.columns(5)

col1.metric("Devices", len(df_devices))
avg_risk = round(df_devices["risk_score"].mean(), 1) if not df_devices.empty else 0
col2.metric("Risk Score moyen", avg_risk)
online_count = int((df_devices["status"] == "online").sum())
col3.metric("En ligne", online_count)
col4.metric("Modèles ML", len(df_models))
anomalies = int(df_metrics["n_anomalies"].sum()) if not df_metrics.empty else 0
col5.metric("Anomalies détectées", anomalies)

st.divider()

tab_devices, tab_telemetry, tab_models, tab_risk = st.tabs([
    "📡 Devices", "📈 Télémétrie", "🤖 Modèles ML", "⚠️ Analyse des Risques"
])

with tab_devices:
    if df_devices.empty:
        st.warning("Aucun device enregistré.")
    else:
        display_cols = ["name", "device_type", "ip_address", "status", "location",
                        "firmware_version", "risk_score", "compliance_score"]
        available = [c for c in display_cols if c in df_devices.columns]
        df_display = df_devices[available].copy()

        def color_risk(val):
            if val >= 70:
                return "color: red; font-weight: bold"
            elif val >= 40:
                return "color: orange"
            return "color: green"

        styled = df_display.style.map(color_risk, subset=["risk_score"])
        st.dataframe(styled, use_container_width=True, hide_index=True)

        if "digital_twin_state" in df_devices.columns:
            with st.expander("🔍 Digital Twin — États détaillés"):
                for _, row in df_devices.iterrows():
                    st.markdown(f"**{row['name']}** ({row['device_type']})")
                    try:
                        state = json.loads(row["digital_twin_state"])
                        st.json(state)
                    except (json.JSONDecodeError, TypeError):
                        st.code(row["digital_twin_state"])
                    st.divider()

with tab_telemetry:
    if df_telemetry.empty:
        st.warning("Aucune télémétrie disponible.")
    else:
        df_telemetry["timestamp"] = pd.to_datetime(df_telemetry["timestamp"], errors="coerce")
        df_telemetry["metric_value"] = pd.to_numeric(df_telemetry["metric_value"], errors="coerce")
        df_clean = df_telemetry.dropna(subset=["metric_value", "timestamp"])

        if not df_clean.empty:
            metric_keys = df_clean["metric_key"].unique()
            selected_metric = st.selectbox("Sélectionner une métrique", sorted(metric_keys))

            df_filtered = df_clean[df_clean["metric_key"] == selected_metric]
            device_ids = df_filtered["device_id"].unique()
            selected_device = st.selectbox("Sélectionner un device", sorted(device_ids))

            df_device = df_filtered[df_filtered["device_id"] == selected_device]
            if not df_device.empty:
                fig = px.line(
                    df_device.sort_values("timestamp"),
                    x="timestamp", y="metric_value",
                    title=f"{selected_metric} — {selected_device}"
                )
                st.plotly_chart(fig, use_container_width=True)
            else:
                st.info("Aucune donnée pour cette sélection.")

            with st.expander("📋 Données brutes"):
                st.dataframe(df_clean.sort_values("timestamp", ascending=False).head(100),
                             use_container_width=True, hide_index=True)

with tab_models:
    if df_models.empty:
        st.warning("Aucun modèle ML enregistré.")
    else:
        for _, model in df_models.iterrows():
            with st.container(border=True):
                cols = st.columns([2, 1, 1, 1, 1])
                cols[0].markdown(f"**{model['name']}**")
                cols[1].markdown(f"Type: `{model['model_type']}`")
                cols[2].markdown(f"Sensor: `{model['sensor']}`")
                cols[3].markdown(f"Status: `{model['status']}`")
                cols[4].markdown(f"Échantillons: {model['training_samples']:,}")

                with st.expander("Détails"):
                    st.json({
                        "hyperparameters": json.loads(model["hyperparameters"]) if isinstance(model["hyperparameters"], str) else model["hyperparameters"],
                        "features": json.loads(model["features"]) if isinstance(model["features"], str) else model["features"],
                        "anomaly_rate_normal": model["anomaly_rate_normal"],
                        "score_moyen_normal": model["score_moyen_normal"],
                    })

        if not df_metrics.empty:
            st.subheader("📊 Métriques par attaque")
            for _, metric in df_metrics.iterrows():
                with st.expander(f"{metric['attack_type']} — {metric['capteur']}"):
                    cols = st.columns(4)
                    cols[0].metric("Taux détection", f"{metric['taux_detection']:.1f}%")
                    cols[1].metric("Échantillons", f"{metric['n_total']:,}")
                    cols[2].metric("Anomalies", f"{metric['n_anomalies']:,}")
                    cols[3].metric("Score moyen", f"{metric['score_moyen']:.4f}")
                    if metric.get("roc_auc"):
                        st.metric("ROC AUC", f"{metric['roc_auc']:.3f}")

with tab_risk:
    if df_devices.empty:
        st.warning("Aucune donnée de risque disponible.")
    else:
        fig_bar = px.bar(
            df_devices.sort_values("risk_score", ascending=False),
            x="name", y="risk_score",
            color="risk_score",
            color_continuous_scale="RdYlGn_r",
            title="Risk Score par Device",
            text_auto=True,
        )
        fig_bar.update_traces(textposition="outside")
        st.plotly_chart(fig_bar, use_container_width=True)

        fig_gauge = go.Figure()
        for _, row in df_devices.iterrows():
            fig_gauge.add_trace(go.Indicator(
                mode="gauge+number+delta",
                value=row["risk_score"],
                title={"text": row["name"]},
                domain={"row": 0, "column": _},
                gauge={"axis": {"range": [0, 100]},
                       "bar": {"color": "red" if row["risk_score"] >= 70 else "orange" if row["risk_score"] >= 40 else "green"}},
            ))
        fig_gauge.update_layout(grid={"rows": 1, "columns": len(df_devices)}, height=250)
        st.plotly_chart(fig_gauge, use_container_width=True)

        if "compliance_score" in df_devices.columns:
            st.subheader("Conformité (Compliance Score)")
            fig_compliance = px.pie(
                df_devices, names="name", values="compliance_score",
                title="Répartition du Compliance Score"
            )
            st.plotly_chart(fig_compliance, use_container_width=True)
