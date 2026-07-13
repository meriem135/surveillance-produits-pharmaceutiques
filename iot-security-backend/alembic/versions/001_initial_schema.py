"""Initial schema with Device and Telemetry tables

Revision ID: 001
Revises: 
Create Date: 2026-02-09 16:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from datetime import datetime

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create devices table
    op.create_table(
        'devices',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('device_type', sa.String(), nullable=False),
        sa.Column('ip_address', sa.String(), nullable=True),
        sa.Column('mac_address', sa.String(), nullable=True),
        sa.Column('manufacturer', sa.String(), nullable=True),
        sa.Column('firmware_version', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('location', sa.String(), nullable=False),
        sa.Column('last_seen', sa.DateTime(), nullable=False),
        sa.Column('registered_at', sa.DateTime(), nullable=False),
        sa.Column('risk_score', sa.Integer(), nullable=False),
        sa.Column('compliance_score', sa.Integer(), nullable=False),
        sa.Column('compliance_status', sa.String(), nullable=False),
        sa.Column('digital_twin_state', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes
    op.create_index('idx_device_type_status', 'devices', ['device_type', 'status'])
    op.create_index('idx_location_status', 'devices', ['location', 'status'])
    op.create_index(op.f('ix_devices_device_type'), 'devices', ['device_type'])
    op.create_index(op.f('ix_devices_ip_address'), 'devices', ['ip_address'])
    op.create_index(op.f('ix_devices_location'), 'devices', ['location'])
    op.create_index(op.f('ix_devices_mac_address'), 'devices', ['mac_address'], unique=True)
    op.create_index(op.f('ix_devices_name'), 'devices', ['name'])
    
    # Create telemetry table
    op.create_table(
        'telemetry',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.String(), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('metric_key', sa.String(), nullable=False),
        sa.Column('metric_value', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create telemetry indexes
    op.create_index('idx_telemetry_device_time', 'telemetry', ['device_id', sa.text('timestamp DESC')])
    op.create_index('idx_telemetry_metric', 'telemetry', ['device_id', 'metric_key'])
    op.create_index(op.f('ix_telemetry_device_id'), 'telemetry', ['device_id'])
    op.create_index(op.f('ix_telemetry_timestamp'), 'telemetry', ['timestamp'])
    
    # Seed initial devices (weather, fridge, thermostat only)
    now = datetime.utcnow()
    op.execute(f"""
        INSERT INTO devices (id, name, device_type, ip_address, mac_address, manufacturer, firmware_version, 
                            status, location, last_seen, registered_at, risk_score, compliance_score, 
                            compliance_status, digital_twin_state)
        VALUES
        ('dev-weather-01', 'Station Meteo - Paris', 'weather', '192.168.10.10', 'AA:BB:CC:DD:01:01', 'PeakSoft Sensors', 'v1.3.2',
         'online', 'Paris-Factory-01', '{now}', '{now}', 0, 100, 'compliant', 
         '{{"temperature": 36.4, "humidity": 45.2, "pressure": 1013.0}}'),
        
        ('dev-fridge-01', 'Chambre Froide - Stockage A', 'fridge', '192.168.10.20', 'AA:BB:CC:DD:02:02', 'PeakSoft Sensors', 'v2.0.1',
         'online', 'Paris-Factory-01', '{now}', '{now}', 0, 100, 'compliant',
         '{{"fridge_temperature": 7.0, "temp_condition": "high"}}'),
        
        ('dev-thermostat-01', 'Thermostat - Atelier A', 'thermostat', '192.168.10.30', 'AA:BB:CC:DD:03:03', 'PeakSoft Sensors', 'v3.1.0',
         'online', 'Paris-Factory-01', '{now}', '{now}', 0, 100, 'compliant',
         '{{"current_temperature": 28.9, "thermostat_status": true}}')
    """)


def downgrade() -> None:
    op.drop_index(op.f('ix_telemetry_timestamp'), table_name='telemetry')
    op.drop_index(op.f('ix_telemetry_device_id'), table_name='telemetry')
    op.drop_index('idx_telemetry_metric', table_name='telemetry')
    op.drop_index('idx_telemetry_device_time', table_name='telemetry')
    op.drop_table('telemetry')
    
    op.drop_index(op.f('ix_devices_name'), table_name='devices')
    op.drop_index(op.f('ix_devices_mac_address'), table_name='devices')
    op.drop_index(op.f('ix_devices_location'), table_name='devices')
    op.drop_index(op.f('ix_devices_ip_address'), table_name='devices')
    op.drop_index(op.f('ix_devices_device_type'), table_name='devices')
    op.drop_index('idx_location_status', table_name='devices')
    op.drop_index('idx_device_type_status', table_name='devices')
    op.drop_table('devices')
