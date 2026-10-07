"""
Retriever — Moteur de recherche sémantique hybride
====================================================
Combine trois techniques, sans aucune dépendance externe lourde :

  1. TF-IDF (cosinus) : similarité lexicale classique.
  2. BM25 : ranking lexical probabiliste (compatible avec la logique
     "mots rares et longs = discriminants" de la KB).
  3. MMR (Maximal Marginal Relevance) : diversifie les documents
     sélectionnés pour éviter 3 fiches quasi identiques.

Le système applique aussi une EXPANSION DE REQUÊTE via un glossaire
IoT/cybersécurité français→français/anglais, qui comble l'écart entre
la question de l'opérateur et le vocabulaire spécialisé de la KB
(ex: "mot de passe" → brute force password credential login).

POURQUOI pas un LLM pour la recherche ?
  - Aucune dépendance externe (pas d'API, pas de GPU)
  - Instantané (<1ms par requête)
  - Déterministe (même résultat à chaque appel)
  - Parfaitement adapté à notre corpus spécialisé (vocabulaire IoT fixe)

COMMENT ÇA MARCHE :
  1. À l'initialisation : index TF-IDF + index BM25 + matrice de
     similarité inter-documents (pour le MMR).
  2. À chaque requête : expansion de la requête via le glossaire.
  3. Scores hybrides = α · (cosinus TF-IDF normalisé) + (1-α) · (BM25 normalisé).
  4. Reranking MMR : λ · pertinence − (1−λ) · similarité max avec les docs déjà choisis.

EXEMPLE :
  Requête : "comment réagir à une attaque sur le frigo ?"
  → Expansion : react attack fridge remediation procedure...
  → BM25+TF-IDF : ATK-001 (DDoS) = 0.92 ← top 1
  → MMR diversifie : REM-001 (remédiation) = 0.81 ← top 2
"""

import numpy as np
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from app.domains.analyst.knowledge_base import get_all_documents


# ── Glossaire d'expansion de requête (IoT / cybersécurité / FR↔EN) ──────────
# clé : terme (ou phrase) que l'opérateur utilise ; valeur : termes ajoutés
# qui appartiennent au vocabulaire de la Knowledge Base.
QUERY_EXPANSION = {
    "frigo": "fridge refrigerateur refrigerator",
    "refrigerateur": "fridge frigo refrigerator",
    "refrigeration": "fridge frigo",
    "meteo": "weather temperature exterieure",
    "météo": "weather temperature exterieure",
    "exterieur": "weather temperature",
    "extérieur": "weather temperature",
    "ambiance": "thermostat temperature ambiante",
    "ambiant": "thermostat temperature",

    "ddos": "ddos dos flood saturation botnet",
    "dos": "ddos dos flood saturation",
    "deni de service": "ddos dos flood saturation",
    "déni de service": "ddos dos flood saturation",
    "denial": "ddos dos flood",
    "mitm": "mitm intercept eavesdrop homme du milieu",
    "homme du milieu": "mitm intercept",
    "interception": "mitm intercept",
    "brute force": "brute force password credential login",
    "mot de passe": "brute force password credential login",
    "mots de passe": "brute force password credential login",
    "password": "brute force credential login",
    "identifiant": "password credential login auth",
    "connexion": "login auth password credential",
    "ransomware": "ransomware encrypt ransom rancon",
    "rancon": "ransomware encrypt chiffrement",
    "rançon": "ransomware encrypt chiffrement",
    "chiffrement": "ransomware encrypt",
    "backdoor": "backdoor unauthorized remote access",
    "porte derobee": "backdoor unauthorized access",
    "acces distant": "backdoor unauthorized remote control",
    "controle": "backdoor control access remote",
    "xss": "xss script injection payload",
    "script": "xss script injection payload",
    "injection": "injection xss spoof forge",
    "fausses donnees": "injection forge spoof fake data",
    "donnees falsifiees": "injection tampering spoof",
    "scan": "scanning nmap reconnaissance ports",
    "scanning": "scanning nmap reconnaissance ports",
    "reconnaissance": "scanning nmap reconnaissance probe",
    "ports": "scanning port open network",
    "cve": "cve vulnerability faille firmware",
    "vulnerabilite": "cve vulnerability faille",
    "vulnérabilité": "cve vulnerability faille",
    "faille": "cve vulnerability firmware",
    "firmware": "cve firmware update",

    "regle": "regle rule",
    "règle": "regle rule",
    "seuil": "threshold plage range",
    "hors plage": "threshold plage range",
    "plage": "threshold range",
    "spike": "saisonnier pic",
    "pic": "spike saisonnier",
    "saison": "saison saisonnier saisonniere saisonnalite",
    "saisonnier": "saison saisonnier saisonnalite",
    "canicule": "ete spike chaleur",
    "surchauffe": "ete chaleur incendie",

    "anomalie": "anomalie anomaly anormal",
    "anormal": "anomalie anomaly suspect",
    "suspect": "anomalie anomaly",
    "inhabituel": "anomalie anomaly",
    "attaque": "attack attaque",
    "attaquant": "attack attacker malveillant",
    "pirate": "attack attacker",
    "compromis": "compromise compromission attack",
    "compromission": "compromise attack",
    "intrusion": "attack unauthorized access",
    "virulence": "attack",

    "remediation": "remediation procedure action intervention",
    "remédiation": "remediation procedure action intervention",
    "resoudre": "remediation action intervention procedure",
    "résoudre": "remediation action intervention procedure",
    "solution": "remediation action intervention",
    "reagir": "remediation action intervention procedure",
    "réagir": "remediation action intervention procedure",
    "faire": "action intervention remediation procedure",
    "intervenir": "action intervention remediation",
    "isoler": "remediation isolate critical urgent",
    "urgent": "critical remediation isolate",
    "isolation": "remediation isolate",
    "normal": "normal behavior comportement baseline",
    "comportement": "normal behavior baseline",
    "referentiel": "normal baseline reference standard",
    "référentiel": "normal baseline reference standard",
    "baseline": "normal baseline reference",
    "reference": "normal baseline standard",
    "référence": "normal baseline standard",
    "standard": "standard iec 62443 etsi 303645 norme",
    "norme": "standard iec 62443 etsi 303645",
    "iec": "iec 62443 standard",
    "etsi": "etsi 303645 standard",
    "conformite": "standard compliance",
    "conformité": "standard compliance",

    "modele": "modele anomalie ml ia",
    "modèle": "modele anomalie ml ia",
    "ml": "modele anomalie ia",
    "ia": "modele anomalie ia",
    "isolation forest": "anomalie modele score ocsvm",
    "score": "risk score risque decomposition",
    "risque": "risk score severity severite",
    "severite": "risk score severity",
    "sévérité": "risk score severity",
    "capteur": "capteur sensor",
    "capteurs": "capteur sensor",
    "sensor": "capteur sensor",
    "device": "device equipement capteur",
    "equipement": "device iot capteur",
    "équipement": "device iot capteur",
    "reseau": "network traffic trafic",
    "trafic": "network traffic debits saturation",
    "mqtt": "mqtt broker traffic messages",
    "modbus": "modbus scada",
    "scada": "modbus scada industriel",
}


def expand_query(query: str, max_added: int = 40) -> str:
    """
    Enrichit une requête avec les termes du glossaire IoT/cybersécurité.

    L'expansion se fait par correspondance de sous-chaîne sur la requête
    normalisée (minuscules). Les termes ajoutés sont dédupliqués, exclus
    s'ils sont déjà présents dans la requête, et plafonnés (max_added)
    pour ne pas diluer les scores. Les termes qui n'existent pas dans le
    vocabulaire de la KB sont automatiquement ignorés par le vectoriseur.
    """
    if not query:
        return query
    lowered = query.lower()
    existing = set(lowered.split())
    additions = []
    seen: set[str] = set()
    for key, value in QUERY_EXPANSION.items():
        if key in lowered:
            for tok in value.split():
                if tok in seen or tok in existing:
                    continue
                seen.add(tok)
                additions.append(tok)
    if not additions:
        return query
    return f"{query} {' '.join(additions[:max_added])}"


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

        # ── Index BM25 (mêmes termes que le vectoriseur TF-IDF, sans sublinear_tf)
        self._count_vec = CountVectorizer(
            vocabulary=self._vectorizer.vocabulary_,
            strip_accents="unicode",
            lowercase=True,
        )
        self._count_matrix = self._count_vec.transform(self._corpus)     # fréquences brutes
        self._bm25_idf, self._bm25_avgdl, self._bm25_dl = self._build_bm25_index()

        # ── Matrice de similarité inter-documents (pour le MMR)
        self._doc_sim_matrix = cosine_similarity(self._tfidf_matrix)

        print(
            f"[RAGRetriever] Index hybride construit : {len(self._documents)} documents, "
            f"{self._tfidf_matrix.shape[1]} features TF-IDF + BM25 + MMR"
        )

    def _build_bm25_index(self) -> tuple[np.ndarray, float, np.ndarray]:
        """Calcule les idf BM25, la longueur moyenne et les longueurs des documents."""
        n_docs = self._count_matrix.shape[0]
        df = np.asarray((self._count_matrix > 0).sum(axis=0)).ravel()          # doc frequencies
        idf = np.log(1 + (n_docs - df + 0.5) / (df + 0.5))
        dl = np.asarray(self._count_matrix.sum(axis=1)).ravel()                # longueurs (termes)
        avgdl = float(dl.mean())
        return idf, avgdl, dl

    def _bm25_scores(self, query_text: str) -> np.ndarray:
        """Scores BM25 (k1=1.5, b=0.75) de chaque document pour une requête brute."""
        q_vec = self._count_vec.transform([query_text])
        q_terms = q_vec.indices
        if q_terms.size == 0:
            return np.zeros(self._count_matrix.shape[0])
        q_counts = np.asarray(q_vec.sum(axis=0)).ravel()
        # Sparse column slices optimisent l'accès aux termes de la requête
        k1, b = 1.5, 0.75
        scores = np.zeros(self._count_matrix.shape[0])
        for t in q_terms:
            if q_counts[t] <= 0:
                continue
            tf_col = np.asarray(self._count_matrix[:, t].toarray()).ravel()    # tf du terme par doc
            denom = tf_col + k1 * (1 - b + b * self._bm25_dl / self._bm25_avgdl)
            scores += self._bm25_idf[t] * (tf_col * (k1 + 1)) / denom
        return scores

    def retrieve(
        self,
        query: str,
        top_k: int = 4,
        min_score: float = 0.05,
        category_filter: str | None = None,
        hybrid_alpha: float = 0.6,
        mmr_lambda: float = 0.7,
    ) -> list[dict]:
        """
        Trouve les documents les plus pertinents pour une requête.

        Pipeline hybride :
          1. EXPANSION de la requête via le glossaire IoT/cybersécurité.
          2. TF-IDF (cosinus) et BM25 → fusion des scores normalisés.
          3. Reranking MMR pour diversifier les documents sélectionnés.

        Args:
            query           : texte de la requête (alerte, question, description)
            top_k           : nombre maximum de documents à retourner
            min_score       : seuil minimum de similarité (0 à 1)
            category_filter : limiter à une catégorie (attack, sensor...)
            hybrid_alpha    : poids du TF-IDF dans la fusion (1−α = poids BM25)
            mmr_lambda      : poids de la pertinence dans le MMR (1−λ = pénalité redondance)

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

        # ── 1. Expansion de la requête ────────────────────────────────────────
        expanded_query = expand_query(query)

        # ── 2. Scores : cosinus brut (filtre, comme l'ancien retriever) ───────
        #        et cosinus expansé + BM25 (tri hybride)
        raw_vec = self._vectorizer.transform([query.lower()])
        tfidf_raw = cosine_similarity(raw_vec, self._tfidf_matrix).flatten()
        exp_vec = self._vectorizer.transform([expanded_query.lower()])
        tfidf_exp = cosine_similarity(exp_vec, self._tfidf_matrix).flatten()
        # BM25 borné par la plus forte similarité lexicale de la requête :
        # un doc marginal ne peut pas « surpasser » la pertinence lexicale brute.
        cos_max = float(tfidf_exp.max()) if tfidf_exp.size else 0.0
        bm25_norm = self._normalize(self._bm25_scores(expanded_query)) * cos_max

        # ── 3. Filtrage : seuil sur le cosinus de la requête non expansée ─────
        ranked = np.argsort(tfidf_raw)[::-1]
        candidates: list[tuple[float, int]] = []      # (score hybride, idx doc)
        for idx in ranked:
            if float(tfidf_raw[idx]) < min_score:
                break
            doc = self._documents[idx]
            if category_filter and doc["category"] != category_filter:
                continue
            hybrid = hybrid_alpha * float(tfidf_exp[idx]) + (1 - hybrid_alpha) * float(bm25_norm[idx])
            candidates.append((hybrid, idx))
            if len(candidates) >= max(top_k * 3, top_k):
                break

        # ── 4. Reranking MMR (diversité) ──────────────────────────────────────
        selected: list[int] = []
        remaining = list(candidates)
        for _ in range(top_k):
            if not remaining:
                break
            if not selected:
                best_pos = 0
            else:
                best_score, best_pos = -1.0, 0
                for pos, (score, idx) in enumerate(remaining):
                    redundancy = max(
                        self._doc_sim_matrix[idx][s] for s in selected
                    )
                    mmr_score = mmr_lambda * score - (1 - mmr_lambda) * redundancy
                    if mmr_score > best_score:
                        best_score, best_pos = mmr_score, pos
            selected.append(remaining.pop(best_pos)[1])

        # ── 5. Assemblage du résultat ─────────────────────────────────────────
        score_by_idx = {idx: float(h) for h, idx in candidates}
        results = []
        for idx in selected:
            doc = self._documents[idx]
            results.append(
                {
                    "id": doc["id"],
                    "category": doc["category"],
                    "title": doc["title"],
                    "content": doc["content"].strip(),
                    "relevance_score": round(score_by_idx[idx], 4),
                }
            )
        return results

    @staticmethod
    def _normalize(scores: np.ndarray) -> np.ndarray:
        """Normalisation /max vers [0, 1] (retourne des zéros si max nul)."""
        smax = float(scores.max()) if scores.size else 0.0
        if smax < 1e-9:
            return np.zeros_like(scores, dtype=float)
        return scores / smax

    def build_query_from_alert(self, alert_context: dict) -> str:
        """
        Construit une requête de recherche enrichie à partir d'une alerte IoT.

        On combine :
          - la règle ou la détection déclenchée
          - le type de device
          - le score de risque et sa sévérité
          - les facteurs de risque dominants

        Cette requête est ensuite utilisée pour récupérer les documents
        les plus pertinents de la Knowledge Base.
        """
        parts = []

        # Règle / détection
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

        return expand_query(" ".join(parts))

    @property
    def stats(self) -> dict:
        """Statistiques sur l'index hybride."""
        by_category: dict[str, int] = {}
        for d in self._documents:
            cat = d["category"]
            by_category[cat] = by_category.get(cat, 0) + 1
        return {
            "total_documents": len(self._documents),
            "vocabulary_size": self._tfidf_matrix.shape[1],
            "by_category": by_category,
            "scorer": "hybrid TF-IDF + BM25 + MMR",
            "query_expansion": f"{len(QUERY_EXPANSION)} entrées de glossaire",
        }


# Singleton — construit l'index une seule fois au démarrage
retriever = RAGRetriever()
