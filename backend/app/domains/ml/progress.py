from fastapi import WebSocket


class TrainingProgressManager:
    """Gestionnaire de progression d'entraînement via WebSocket.

    Il diffuse les messages de progression aux clients connectés et conserve le
    dernier état pour l'envoyer aux nouveaux abonnés.
    """

    def __init__(self):
        self._connections: list[WebSocket] = []
        self._latest_status: dict = {}

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.append(ws)
        if self._latest_status:
            try:
                await ws.send_json(self._latest_status)
            except Exception:
                pass

    def disconnect(self, ws: WebSocket):
        if ws in self._connections:
            self._connections.remove(ws)

    async def broadcast(self, message: dict):
        self._latest_status = message
        dead = []
        for ws in self._connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.remove(ws)

    def clear(self):
        self._latest_status = {}
