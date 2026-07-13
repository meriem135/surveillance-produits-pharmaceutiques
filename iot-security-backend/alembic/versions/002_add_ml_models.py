"""Add ml_models and model_metrics tables

Revision ID: 002
Revises: 001
Create Date: 2026-06-05 18:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ml_models',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('model_type', sa.String(), nullable=False),
        sa.Column('sensor', sa.String(), nullable=False),
        sa.Column('version', sa.String(), nullable=False),
        sa.Column('hyperparameters', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('features', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('feature_count', sa.Integer(), nullable=False),
        sa.Column('training_samples', sa.Integer(), nullable=False),
        sa.Column('contamination', sa.Float(), nullable=False),
        sa.Column('n_estimators', sa.Integer(), nullable=False),
        sa.Column('anomaly_rate_normal', sa.Float(), nullable=False),
        sa.Column('score_moyen_normal', sa.Float(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('trained_at', sa.DateTime(), nullable=False),
        sa.Column('model_path', sa.String(), nullable=False),
        sa.Column('scaler_path', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ml_models_name'), 'ml_models', ['name'])
    op.create_index(op.f('ix_ml_models_sensor'), 'ml_models', ['sensor'])
    op.create_index('idx_ml_model_sensor', 'ml_models', ['sensor', 'status'])

    op.create_table(
        'model_metrics',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('model_id', sa.String(), nullable=False),
        sa.Column('attack_type', sa.String(), nullable=False),
        sa.Column('capteur', sa.String(), nullable=False),
        sa.Column('n_total', sa.Integer(), nullable=False),
        sa.Column('n_anomalies', sa.Integer(), nullable=False),
        sa.Column('taux_detection', sa.Float(), nullable=False),
        sa.Column('score_moyen', sa.Float(), nullable=False),
        sa.Column('roc_auc', sa.Float(), nullable=True),
        sa.Column('avg_precision', sa.Float(), nullable=True),
        sa.Column('precision_normal', sa.Float(), nullable=True),
        sa.Column('recall_normal', sa.Float(), nullable=True),
        sa.Column('f1_normal', sa.Float(), nullable=True),
        sa.Column('precision_attaque', sa.Float(), nullable=True),
        sa.Column('recall_attaque', sa.Float(), nullable=True),
        sa.Column('f1_attaque', sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(['model_id'], ['ml_models.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_model_metrics_model_id'), 'model_metrics', ['model_id'])
    op.create_index('idx_metric_model_attack', 'model_metrics', ['model_id', 'attack_type'])


def downgrade() -> None:
    op.drop_index('idx_metric_model_attack', table_name='model_metrics')
    op.drop_index(op.f('ix_model_metrics_model_id'), table_name='model_metrics')
    op.drop_table('model_metrics')
    op.drop_index('idx_ml_model_sensor', table_name='ml_models')
    op.drop_index(op.f('ix_ml_models_sensor'), table_name='ml_models')
    op.drop_index(op.f('ix_ml_models_name'), table_name='ml_models')
    op.drop_table('ml_models')
