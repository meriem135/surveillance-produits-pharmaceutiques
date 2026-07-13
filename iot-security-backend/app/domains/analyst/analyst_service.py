"""
Analyst Service — Orchestrateur LLM/RAG
=========================================
Point d'entrée unique pour toute analyse de sécurité.

Flux d'analyse :
  1. Réception du contexte d'alerte (device, risk, DPI, MLOps, cross-sensor)
  2. Construction de la requête RAG (build_query_from_alert)
  3. Récupération des documents pertinents (retriever.retrieve)
  4. Génération du rapport (llm_engine.generate_analysis)
  5. Enrichissement avec les métadonnées (version, timing, documents utilisés)
  6. Mise en cache (éviter de re-générer pour la même alerte)
"""

import hashlib
import json
import time
from datetime import datetime
from typing import Optional

from app.domains.analyst.retriever import retriever, RAGRetriever
from app.domains.analyst.llm_engine import generate_analysis


class AnalystService:
    """
    Service d'analyse IA des alertes IoT.

    Expose :
      - analyze_alert()    : analyse complète d'une alerte
      - ask()              : question libre sur le système
      - get_kb_status()    : état de la base de connaissances
    """

    def __init__(self, rag_retriever: RAGRetriever):
        self.retriever = rag_retriever
        # Cache simple en mémoire : hash(context) → résultat
        # Évite de re-appeler le LLM pour la même alerte
        self._cache: dict[str, dict] = {}
        self._max_cache_size = 50
        self._analysis_count = 0

    def _make_cache_key(self, alert_context: dict, question: Optional[str]) -> str:
        """Génère une clé de cache déterministe à partir du contexte."""
        payload = {
            "device_id":  alert_context.get("device_id"),
            "risk_score": alert_context.get("risk_score"),
            "rule_id":    alert_context.get("rule_id"),
            "severity":   alert_context.get("severity"),
            "question":   question,
        }
        return hashlib.md5(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    async def analyze_alert(
        self,
        alert_context: dict,
        question: Optional[str] = None,
        top_k_docs: int = 4,
        use_cache: bool = True,
        force_template: bool = False,
    ) -> dict:
        """
        Analyse complète d'une alerte de sécurité IoT.

        Args:
            alert_context  : contexte complet de l'alerte
            question       : question optionnelle de l'opérateur
            top_k_docs     : nombre de documents RAG à récupérer
            use_cache      : utiliser le cache (éviter les appels LLM redondants)
            force_template : forcer le moteur template (sans LLM)

        Returns:
            {
                "report"         : rapport Markdown complet
                "engine"         : "ollama" | "template"
                "model"          : nom du modèle LLM utilisé
                "rag_documents"  : liste des documents utilisés
                "rag_query"      : requête RAG construite
                "rag_docs_used"  : nb de documents utilisés
                "processing_ms"  : temps de traitement
                "cached"         : True si résultat depuis le cache
                "timestamp"      : horodatage de l'analyse
            }
        """
        t_start = time.perf_counter()

        # ── Vérification cache ────────────────────────────────────────────────
        cache_key = self._make_cache_key(alert_context, question)
        if use_cache and cache_key in self._cache:
            cached = self._cache[cache_key].copy()
            cached["cached"] = True
            cached["processing_ms"] = round((time.perf_counter() - t_start) * 1000, 1)
            return cached

        # ── Étape 1 : Construire la requête RAG ───────────────────────────────
        rag_query = self.retriever.build_query_from_alert(alert_context)

        # ── Étape 2 : Récupérer les documents pertinents ──────────────────────
        rag_docs = self.retriever.retrieve(rag_query, top_k=top_k_docs)

        # Toujours inclure la procédure de remédiation adaptée
        risk_score = alert_context.get("risk_score", 0)
        rem_query = (
            "critical urgent isolate"    if risk_score >= 80 else
            "high surveillance monitor"  if risk_score >= 60 else
            "medium watch"
        )
        # Ajouter la remédiation si pas déjà dans les résultats
        rem_docs = self.retriever.retrieve(rem_query, top_k=1, category_filter="remediation")
        existing_ids = {d["id"] for d in rag_docs}
        for rem_doc in rem_docs:
            if rem_doc["id"] not in existing_ids:
                rag_docs.append(rem_doc)

        # ── Étape 3 : Générer le rapport ──────────────────────────────────────
        generation_result = await generate_analysis(
            alert_context=alert_context,
            rag_documents=rag_docs,
            question=question,
            force_template=force_template,
        )

        # ── Étape 4 : Assembler la réponse ────────────────────────────────────
        processing_ms = round((time.perf_counter() - t_start) * 1000, 1)
        self._analysis_count += 1

        result = {
            "report":          generation_result["report"],
            "engine":          generation_result["engine"],
            "model":           generation_result["model"],
            "ollama_available": generation_result["ollama_available"],
            "rag_query":       rag_query,
            "rag_docs_used":   len(rag_docs),
            "rag_documents":   [
                {
                    "id":               d["id"],
                    "category":         d["category"],
                    "title":            d["title"],
                    "relevance_score":  d["relevance_score"],
                }
                for d in rag_docs
            ],
            "processing_ms":   processing_ms,
            "cached":          False,
            "timestamp":       datetime.now().isoformat(),
            "analysis_count":  self._analysis_count,
        }

        # ── Étape 5 : Mettre en cache ─────────────────────────────────────────
        if use_cache:
            if len(self._cache) >= self._max_cache_size:
                # Supprimer l'entrée la plus ancienne (FIFO)
                oldest_key = next(iter(self._cache))
                del self._cache[oldest_key]
            self._cache[cache_key] = result

        return result

    async def ask(
        self,
        question: str,
        device_context: Optional[dict] = None,
    ) -> dict:
        """
        Question libre en langage naturel sur le système IoT.

        L'opérateur peut poser des questions comme :
          - "Quels sont les signes d'une attaque DDoS ?"
          - "Comment réagir si le frigo est compromis ?"
          - "Que signifie la règle DPI-004 ?"
          - "Quel standard s'applique pour les mots de passe ?"

        Args:
            question       : question en langage naturel
            device_context : contexte optionnel (device_type, risk_score...)

        Returns:
            Même structure que analyze_alert(), axée sur la réponse à la question.
        """
        context = device_context or {}
        context["question_mode"] = True

        rag_docs = self.retriever.retrieve(question, top_k=4)

        generation_result = await generate_analysis(
            alert_context=context,
            rag_documents=rag_docs,
            question=question,
        )

        return {
            "question":       question,
            "report":         generation_result["report"],
            "engine":         generation_result["engine"],
            "model":          generation_result["model"],
            "rag_docs_used":  len(rag_docs),
            "rag_documents":  [
                {"id": d["id"], "title": d["title"], "relevance_score": d["relevance_score"]}
                for d in rag_docs
            ],
            "timestamp":      datetime.now().isoformat(),
        }

    def get_kb_status(self) -> dict:
        """État de la base de connaissances et du retriever."""
        stats = self.retriever.stats
        return {
            "knowledge_base": stats,
            "cache_size": len(self._cache),
            "total_analyses": self._analysis_count,
            "ollama_config": {
                "url":   "http://localhost:11434",
                "model": "mistral",
                "note":  "Installer Ollama sur https://ollama.ai puis 'ollama pull mistral'",
            },
        }

    def clear_cache(self):
        """Vide le cache (utile après un réentraînement ou mise à jour KB)."""
        self._cache.clear()


# Singleton
analyst_service = AnalystService(rag_retriever=retriever)
