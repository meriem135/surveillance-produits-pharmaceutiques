"""
Retriever — Moteur de recherche sémantique TF-IDF
==================================================
Transforme les documents de la Knowledge Base en vecteurs numériques
(TF-IDF) et trouve les documents les plus pertinents pour une requête.

POURQUOI TF-IDF et pas un LLM pour la recherche ?
  - TF-IDF = Term Frequency × Inverse Document Frequency
  - Aucune dépendance externe (pas d'API, pas de GPU)
  - Instantané (<1ms par requête)
  - Déterministe (même résultat à chaque appel)
  - Parfaitement adapté à notre corpus spécialisé (vocabulaire IoT fixe)
  - scikit-learn est déjà dans requirements.txt

COMMENT ÇA MARCHE :
  1. À l'initialisation : chaque document est transformé en vecteur
     de mots-clés pondérés (mots rares = poids fort, mots courants = poids faible)
  2. À chaque requête : la requête est transformée en vecteur
  3. La similarité cosinus mesure l'angle entre les vecteurs
  4. Les top-K documents les plus proches sont retournés

EXEMPLE :
  Requête : "DDoS temperature capteur weather"
  → Vecteur requête = [0.8, 0.0, 0.6, 0.7, ...]
  → Comparé à chaque document
  → ATK-001 (DDoS) : similarité = 0.94 ← top 1
  → SENSOR-001 (weather) : similarité = 0.72 ← top 2
  → REM-001 (critique) : similarité = 0.45 ← top 3
"""

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from app.domains.analyst.knowledge_base import get_all_documents


class RAGRetriever:
    """
    Moteur de recherche sémantique sur la Knowledge Base.

    Construit l'index TF-IDF au démarrage (une seule fois).
    Chaque appel à retrieve() est O(n) où n = nombre de documents.
    """

    def __init__(self):
        self._documents = get_all_documents()
        self._vectorizer = TfidfVectorizer(
            analyzer="word",
            ngram_range=(1, 2),      # unigrams + bigrams (ex: "brute force")
            min_df=1,
            max_df=0.95,
            sublinear_tf=True,       # log(1+tf) pour réduire l'impact des mots fréquents
            strip_accents="unicode",
            lowercase=True,
        )
        # Construire le corpus : title + tags + content pour chaque document
        self._corpus = [
            f"{d['title']} {' '.join(d['tags'])} {d['content']}"
            for d in self._documents
        ]
        # Vectoriser tout le corpus une seule fois
        self._tfidf_matrix = self._vectorizer.fit_transform(self._corpus)
        print(
            f"[RAGRetriever] Index construit : {len(self._documents)} documents, "
            f"{self._tfidf_matrix.shape[1]} features TF-IDF"
        )

    def retrieve(
        self,
        query: str,
        top_k: int = 4,
        min_score: float = 0.05,
        category_filter: str | None = None,
    ) -> list[dict]:
        """
        Trouve les documents les plus pertinents pour une requête.

        Args:
            query           : texte de la requête (alerte, question, description)
            top_k           : nombre maximum de documents à retourner
            min_score       : seuil minimum de similarité (0 à 1)
            category_filter : limiter à une catégorie (attack, dpi, sensor...)

        Returns:
            Liste de documents triés par pertinence décroissante, avec leur score.
            [
                {
                    "id": "ATK-001",
                    "category": "attack",
                    "title": "...",
                    "content": "...",
                    "relevance_score": 0.87
                },
                ...
            ]
        """
        if not query or not query.strip():
            return []

        # Vectoriser la requête avec le même vocabulaire que le corpus
        query_vec = self._vectorizer.transform([query.lower()])

        # Calculer la similarité cosinus entre la requête et tous les documents
        similarities = cosine_similarity(query_vec, self._tfidf_matrix).flatten()

        # Trier par score décroissant
        ranked_indices = np.argsort(similarities)[::-1]

        results = []
        for idx in ranked_indices:
            score = float(similarities[idx])
            if score < min_score:
                break  # les suivants seront encore moins pertinents
            doc = self._documents[idx]
            if category_filter and doc["category"] != category_filter:
                continue
            results.append(
                {
                    "id": doc["id"],
                    "category": doc["category"],
                    "title": doc["title"],
                    "content": doc["content"].strip(),
                    "relevance_score": round(score, 4),
                }
            )
            if len(results) >= top_k:
                break

        return results

    def build_query_from_alert(self, alert_context: dict) -> str:
        """
        Construit une requête de recherche enrichie à partir d'une alerte IoT.

        On combine :
          - le type de règle DPI déclenchée
          - le type de device
          - le score de risque et sa sévérité
          - les facteurs de risque dominants
          - les infos de drift MLOps si disponibles

        Cette requête est ensuite utilisée pour récupérer les documents
        les plus pertinents de la Knowledge Base.
        """
        parts = []

        # Règle DPI
        rule_id = alert_context.get("rule_id", "")
        rule_name = alert_context.get("rule_name", "")
        if rule_id:
            parts.append(rule_id)
        if rule_name:
            parts.append(rule_name)

        # Type de device / capteur
        device_type = alert_context.get("device_type", "")
        sensor = alert_context.get("sensor", "")
        if device_type:
            parts.append(device_type)
        if sensor:
            parts.append(sensor)

        # Sévérité et score de risque
        severity = alert_context.get("severity", "")
        risk_score = alert_context.get("risk_score", 0)
        if severity:
            parts.append(severity)
        if risk_score >= 80:
            parts.append("critical remediation urgent")
        elif risk_score >= 60:
            parts.append("high risk surveillance")

        # Facteurs dominants du score de risque
        factors = alert_context.get("top_factors", [])
        for f in factors[:3]:
            parts.append(f)

        # Nom d'attaque si connu
        attack_type = alert_context.get("attack_type", "")
        if attack_type:
            parts.append(attack_type)

        return " ".join(parts)

    @property
    def stats(self) -> dict:
        """Statistiques sur l'index TF-IDF."""
        by_category: dict[str, int] = {}
        for d in self._documents:
            cat = d["category"]
            by_category[cat] = by_category.get(cat, 0) + 1
        return {
            "total_documents": len(self._documents),
            "vocabulary_size": self._tfidf_matrix.shape[1],
            "by_category": by_category,
        }


# Singleton — construit l'index une seule fois au démarrage
retriever = RAGRetriever()
