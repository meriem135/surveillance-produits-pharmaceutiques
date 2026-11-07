# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/ml/progress.py
#   SUIVI DE L'ENTRAÎNEMENT : messages de progression gardés en mémoire, lus chaque seconde par
#   la page Entraînement.
# ══════════════════════════════════════════════════════════════════════════
# ──────────────────────────────────────────────────────────────────────
# [EN BREF] TrainingProgressManager
#   Rôle   : SUIVI DE L'ENTRAÎNEMENT : garde les messages de progression numérotés ; la page les demande
#            chaque seconde.
# ──────────────────────────────────────────────────────────────────────
class TrainingProgressManager:
    """Progression d'entraînement lue par polling (GET).

    Chaque message est numéroté et gardé en mémoire : le client demande les messages
    reçus depuis le dernier numéro qu'il connaît. Le dernier état reste disponible
    pour une page ouverte en cours d'entraînement.
    """

    MAX_EVENTS = 2000

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] TrainingProgressManager.__init__
    #   Rôle   : Liste de messages vide.
    #   Entrée : rien
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(self):
        self._events: list[dict] = []
        self._seq = 0
        self._latest_status: dict = {}

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] TrainingProgressManager.broadcast
    #   Rôle   : Ajoute un message de progression (numéroté).
    #   Entrée : message
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    async def broadcast(self, message: dict):
        self._seq += 1
        event = {**message, "seq": self._seq}
        self._latest_status = event
        self._events.append(event)
        if len(self._events) > self.MAX_EVENTS:
            del self._events[: len(self._events) - self.MAX_EVENTS]

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] TrainingProgressManager.since
    #   Rôle   : Messages arrivés après le numéro donné.
    #   Entrée : seq : dernier numéro lu
    #   Sortie : liste
    # ──────────────────────────────────────────────────────────────────────
    def since(self, seq: int) -> list[dict]:
        """Messages dont le numéro est strictement supérieur à `seq`."""
        return [e for e in self._events if e["seq"] > seq]

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] TrainingProgressManager.last_seq
    #   Rôle   : Numéro du dernier message.
    #   Entrée : rien
    #   Sortie : entier
    # ──────────────────────────────────────────────────────────────────────
    @property
    def last_seq(self) -> int:
        return self._seq

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] TrainingProgressManager.clear
    #   Rôle   : Vide les messages avant un nouvel entraînement.
    #   Entrée : rien
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def clear(self):
        self._events = []
        self._latest_status = {}
