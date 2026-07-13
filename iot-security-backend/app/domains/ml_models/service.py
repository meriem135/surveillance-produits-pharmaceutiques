import os
import json
from datetime import datetime
from typing import List, Optional
from app.domains.ml_models.models import MLModel, ModelMetric
from app.domains.ml_models.repository import MLModelRepository, ModelMetricRepository
from app.domains.ml_models.schemas import MLModelCreate, ModelMetricCreate


class MLModelService:
    def __init__(self, model_repo: MLModelRepository, metric_repo: ModelMetricRepository):
        self.model_repo = model_repo
        self.metric_repo = metric_repo

    async def register(self, data: MLModelCreate) -> MLModel:
        model = MLModel(
            id=data.id,
            name=data.name,
            model_type=data.model_type,
            sensor=data.sensor,
            version=data.version,
            hyperparameters=data.hyperparameters,
            features=data.features,
            feature_count=data.feature_count,
            training_samples=data.training_samples,
            contamination=data.contamination,
            n_estimators=data.n_estimators,
            anomaly_rate_normal=data.anomaly_rate_normal,
            score_moyen_normal=data.score_moyen_normal,
            status=data.status,
            trained_at=data.trained_at or datetime.utcnow(),
            model_path=data.model_path,
            scaler_path=data.scaler_path,
        )
        return await self.model_repo.create(model)

    async def get_all(self) -> List[MLModel]:
        return await self.model_repo.get_all_summary()

    async def get_by_id(self, model_id: str) -> Optional[MLModel]:
        return await self.model_repo.get(model_id)

    async def get_detail(self, model_id: str) -> Optional[dict]:
        model = await self.model_repo.get(model_id)
        if not model:
            return None
        metrics = await self.metric_repo.get_by_model(model_id)
        stats = await self.metric_repo.get_stats_by_model(model_id)
        return {"model": model, "metrics": metrics, "stats": stats}

    async def add_metric(self, model_id: str, data: ModelMetricCreate) -> ModelMetric:
        metric = ModelMetric(
            model_id=model_id,
            attack_type=data.attack_type,
            capteur=data.capteur,
            n_total=data.n_total,
            n_anomalies=data.n_anomalies,
            taux_detection=data.taux_detection,
            score_moyen=data.score_moyen,
            roc_auc=data.roc_auc,
            avg_precision=data.avg_precision,
            precision_normal=data.precision_normal,
            recall_normal=data.recall_normal,
            f1_normal=data.f1_normal,
            precision_attaque=data.precision_attaque,
            recall_attaque=data.recall_attaque,
            f1_attaque=data.f1_attaque,
        )
        return await self.metric_repo.create(metric)

    async def update_status(self, model_id: str, status: str) -> Optional[MLModel]:
        model = await self.model_repo.get(model_id)
        if not model:
            return None
        return await self.model_repo.update(model, {"status": status})

    async def delete_model(self, model_id: str) -> bool:
        await self.metric_repo.delete_by_model(model_id)
        result = await self.model_repo.delete(model_id)
        return result is not None

    async def get_comparison(self) -> dict:
        models = await self.model_repo.get_all_summary()
        result = []
        sensor_rates = {}
        for m in models:
            stats = await self.metric_repo.get_stats_by_model(m.id)
            if stats:
                sensor = m.sensor
                if sensor not in sensor_rates:
                    sensor_rates[sensor] = []
                sensor_rates[sensor].append(stats["detection_moyenne"])
                result.append({
                    "id": m.id,
                    "name": m.name,
                    "model_type": m.model_type,
                    "sensor": m.sensor,
                    "status": m.status,
                    "version": m.version,
                    "trained_at": m.trained_at.isoformat(),
                    "training_samples": m.training_samples,
                    "feature_count": m.feature_count,
                    "anomaly_rate_normal": m.anomaly_rate_normal,
                    "score_moyen_normal": m.score_moyen_normal,
                    "detection_moyenne": round(stats["detection_moyenne"], 2),
                    "meilleure_attaque": stats["meilleure_attaque"],
                    "meilleur_taux": round(stats["meilleur_taux"], 2),
                    "pire_attaque": stats["pire_attaque"],
                    "pire_taux": round(stats["pire_taux"], 2),
                })
        avg_by_sensor = {
            s: round(sum(rates) / len(rates), 2) for s, rates in sensor_rates.items()
        }
        best = max(avg_by_sensor, key=avg_by_sensor.get) if avg_by_sensor else None
        worst = min(avg_by_sensor, key=avg_by_sensor.get) if avg_by_sensor else None
        return {
            "models": sorted(result, key=lambda x: x["detection_moyenne"], reverse=True),
            "best_sensor": best,
            "worst_sensor": worst,
            "average_detection_by_sensor": avg_by_sensor,
        }

    async def get_sensor_metrics_chart(self, sensor: str) -> dict:
        model = await self.model_repo.get_latest_by_sensor(sensor)
        if not model:
            return {"sensor": sensor, "error": "No model found for this sensor"}
        metrics = await self.metric_repo.get_by_model(model.id)
        return {
            "sensor": sensor,
            "model_id": model.id,
            "model_name": model.name,
            "metrics": [
                {
                    "attack_type": m.attack_type,
                    "taux_detection": m.taux_detection,
                    "score_moyen": m.score_moyen,
                    "n_total": m.n_total,
                    "n_anomalies": m.n_anomalies,
                }
                for m in metrics
            ],
        }
