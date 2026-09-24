from typing import List, Optional
from sqlalchemy import select, desc
from app.db.base_repository import BaseRepository
from app.domains.ml.entities import MLModel, ModelMetric


class MLModelRepository(BaseRepository[MLModel]):
    def __init__(self, session):
        super().__init__(MLModel, session)

    async def get_by_sensor(self, sensor: str, status: Optional[str] = None) -> List[MLModel]:
        query = select(MLModel).where(MLModel.sensor == sensor)
        if status:
            query = query.where(MLModel.status == status)
        query = query.order_by(desc(MLModel.trained_at))
        result = await self.session.execute(query)
        return result.scalars().all()

    async def get_latest_by_sensor(self, sensor: str) -> Optional[MLModel]:
        query = (
            select(MLModel)
            .where(MLModel.sensor == sensor)
            .order_by(desc(MLModel.trained_at))
            .limit(1)
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_all_summary(self) -> List[MLModel]:
        query = select(MLModel).order_by(desc(MLModel.trained_at))
        result = await self.session.execute(query)
        return result.scalars().all()

    async def get_deployed(self) -> List[MLModel]:
        query = select(MLModel).where(MLModel.status == "deployed")
        result = await self.session.execute(query)
        return result.scalars().all()


class ModelMetricRepository(BaseRepository[ModelMetric]):
    def __init__(self, session):
        super().__init__(ModelMetric, session)

    async def get_by_model(self, model_id: str) -> List[ModelMetric]:
        query = (
            select(ModelMetric)
            .where(ModelMetric.model_id == model_id)
            .order_by(desc(ModelMetric.taux_detection))
        )
        result = await self.session.execute(query)
        return result.scalars().all()

    async def get_stats_by_model(self, model_id: str) -> dict:
        metrics = await self.get_by_model(model_id)
        if not metrics:
            return {}
        taux = [m.taux_detection for m in metrics]
        return {
            "total_attacks": len(metrics),
            "detection_moyenne": sum(taux) / len(taux),
            "meilleure_attaque": max(metrics, key=lambda m: m.taux_detection).attack_type,
            "meilleur_taux": max(taux),
            "pire_attaque": min(metrics, key=lambda m: m.taux_detection).attack_type,
            "pire_taux": min(taux),
            "n_au_dela_80": sum(1 for t in taux if t >= 80),
            "n_entre_50_80": sum(1 for t in taux if 50 <= t < 80),
            "n_sous_50": sum(1 for t in taux if t < 50),
        }

    async def delete_by_model(self, model_id: str) -> None:
        query = select(ModelMetric).where(ModelMetric.model_id == model_id)
        result = await self.session.execute(query)
        for metric in result.scalars().all():
            await self.session.delete(metric)
        await self.session.flush()
