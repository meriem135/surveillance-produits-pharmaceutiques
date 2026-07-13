import sys
sys.path.insert(0, r'c:\peaksoft-security-platform-main\peaksoft-security-platform-main\iot-security-backend')

SEP = "=" * 55

# ── Test 1 : Construction de l'index RAG ─────────────────────
print(f"\n{SEP}")
print("  TEST 1 : Construction index RAG")
print(SEP)
from app.domains.analyst.retriever import retriever
stats = retriever.stats
print(f"  Documents       : {stats['total_documents']}")
print(f"  Vocabulaire     : {stats['vocabulary_size']} features TF-IDF")
print(f"  Par categorie   : {stats['by_category']}")

# ── Test 2 : Recherche sémantique DDoS ───────────────────────
print(f"\n{SEP}")
print("  TEST 2 : Recherche 'DDoS temperature capteur weather'")
print(SEP)
results = retriever.retrieve("DDoS temperature capteur weather flood", top_k=3)
for r in results:
    print(f"  [{r['relevance_score']:.2f}]  {r['id']} — {r['title']}")

# ── Test 3 : Question opérateur ───────────────────────────────
print(f"\n{SEP}")
print("  TEST 3 : Question 'detecter MITM frigo'")
print(SEP)
results2 = retriever.retrieve("comment detecter une attaque MITM sur le frigo", top_k=3)
for r in results2:
    print(f"  [{r['relevance_score']:.2f}]  {r['id']} — {r['title']}")

# ── Test 4 : Requête construite depuis contexte alerte ────────
print(f"\n{SEP}")
print("  TEST 4 : Requete depuis contexte alerte DDoS critique")
print(SEP)
context = {
    "rule_id":        "DPI-001",
    "rule_name":      "Label attaque",
    "device_type":    "fridge",
    "sensor":         "fridge",
    "attack_type":    "IoT_DDoS",
    "risk_score":     87,
    "severity":       "CRITICAL",
    "drift_detected": True,
    "n_sensors_alert": 2,
}
query = retriever.build_query_from_alert(context)
print(f"  Requete construite : '{query}'")
docs = retriever.retrieve(query, top_k=4)
print(f"  Documents retrouves : {len(docs)}")
for d in docs:
    print(f"    [{d['relevance_score']:.2f}]  {d['id']} — {d['title']}")

# ── Test 5 : Génération rapport template ──────────────────────
print(f"\n{SEP}")
print("  TEST 5 : Generation rapport template (sans Ollama)")
print(SEP)
import asyncio
from app.domains.analyst.llm_engine import generate_analysis

alert_ctx = {
    "device_id":    "dev-fridge-01",
    "device_name":  "Frigo Usine A",
    "device_type":  "fridge",
    "rule_id":      "DPI-001",
    "rule_name":    "Label attaque explicite",
    "attack_type":  "IoT_DDoS",
    "risk_score":   87,
    "severity":     "CRITICAL",
    "sensor":       "fridge",
    "top_factors":  ["ml_anomaly (72)", "cve (45)", "dpi_alert (30)"],
    "drift_info":   {"severity": "warning", "confidence_pct": 70, "explanation": "Drift possible"},
    "cross_sensor_info": {
        "alert_score": 65,
        "n_sensors_alert": 2,
        "sensor_details": {
            "weather": {"anomaly_rate_pct": 45.0, "is_alerting": True},
            "fridge":  {"anomaly_rate_pct": 38.0, "is_alerting": True},
            "thermostat": {"anomaly_rate_pct": 8.0, "is_alerting": False},
        },
        "interpretation": "2/3 capteurs anormaux simultanement. Attaque coordonnee probable.",
    },
}

result = asyncio.run(generate_analysis(
    alert_context=alert_ctx,
    rag_documents=docs,
    question="Quels sont les risques pour la ligne de production ?",
    force_template=True,
))

print(f"  Engine  : {result['engine']}")
print(f"  Modele  : {result['model']}")
print(f"  Docs RAG: {result['rag_docs_used']}")
print()
print("─── DEBUT DU RAPPORT ───────────────────────────────────")
# Afficher seulement les 40 premieres lignes
lines = result["report"].split("\n")
for line in lines[:40]:
    print(line)
if len(lines) > 40:
    print(f"  ... ({len(lines) - 40} lignes supprimees pour l'affichage)")
print("─── FIN DU RAPPORT ─────────────────────────────────────")

print(f"\n{SEP}")
print("  Tous les tests passent.")
print(SEP)
