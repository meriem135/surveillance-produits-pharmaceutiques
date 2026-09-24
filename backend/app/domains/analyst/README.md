# Analyste IA (LLM + RAG)

Analyse de sécurité via LLM local (Ollama) + base de connaissances RAG.

Flux :
1. Contexte d'alerte → `build_query_from_alert()`
2. RAG → `retriever.retrieve(query)` (top-k=4)
3. Génération → `llm_engine.generate_analysis()` (Ollama mistral ou fallback template)
4. Cache MD5 → évite les appels LLM redondants

Fonctionnalités :
- `analyze_alert()` → Rapport Markdown complet
- `ask()` → Question libre en langage naturel
- `get_kb_status()` → État de la base de connaissances
