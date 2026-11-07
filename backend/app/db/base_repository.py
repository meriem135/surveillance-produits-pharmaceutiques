# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/db/base_repository.py
#   ACCÈS GÉNÉRIQUE À LA BASE. Classe de base (lire, lister, créer, modifier, supprimer) dont
#   héritent les repositories des utilisateurs et des équipements.
# ══════════════════════════════════════════════════════════════════════════
from typing import Generic, TypeVar, Type, List, Optional, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlmodel import SQLModel

ModelType = TypeVar("ModelType", bound=SQLModel)

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] BaseRepository
#   Rôle   : BASE COMMUNE d'accès à une table : lire, lister, créer, modifier, supprimer. Les autres
#            repositories en héritent.
# ──────────────────────────────────────────────────────────────────────
class BaseRepository(Generic[ModelType]):
    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] BaseRepository.__init__
    #   Rôle   : Retient la table et la connexion à utiliser.
    #   Entrée : model : table ; session : connexion
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(self, model: Type[ModelType], session: AsyncSession):
        self.model = model
        self.session = session

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] BaseRepository.get
    #   Rôle   : Lit une ligne par son identifiant.
    #   Entrée : id
    #   Sortie : la ligne ou None
    # ──────────────────────────────────────────────────────────────────────
    async def get(self, id: Any) -> Optional[ModelType]:
        query = select(self.model).where(self.model.id == id)
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] BaseRepository.get_multi
    #   Rôle   : Liste les lignes (avec pagination).
    #   Entrée : skip : à sauter ; limit : maximum
    #   Sortie : liste
    # ──────────────────────────────────────────────────────────────────────
    async def get_multi(self, skip: int = 0, limit: int = 100) -> List[ModelType]:
        query = select(self.model).offset(skip).limit(limit)
        result = await self.session.execute(query)
        return result.scalars().all()

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] BaseRepository.create
    #   Rôle   : Ajoute une nouvelle ligne.
    #   Entrée : obj_in : objet à créer
    #   Sortie : l'objet créé
    # ──────────────────────────────────────────────────────────────────────
    async def create(self, obj_in: ModelType) -> ModelType:
        self.session.add(obj_in)
        await self.session.flush()
        return obj_in

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] BaseRepository.update
    #   Rôle   : Modifie les champs d'une ligne.
    #   Entrée : db_obj : ligne ; obj_in : {champ: valeur}
    #   Sortie : ligne modifiée
    # ──────────────────────────────────────────────────────────────────────
    async def update(self, db_obj: ModelType, obj_in: dict) -> ModelType:
        for field, value in obj_in.items():
            setattr(db_obj, field, value)
        self.session.add(db_obj)
        await self.session.flush()
        return db_obj

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] BaseRepository.delete
    #   Rôle   : Supprime une ligne par son identifiant.
    #   Entrée : id
    #   Sortie : la ligne supprimée ou None
    # ──────────────────────────────────────────────────────────────────────
    async def delete(self, id: Any) -> Optional[ModelType]:
        obj = await self.get(id)
        if obj:
            await self.session.delete(obj)
            await self.session.flush()
        return obj
