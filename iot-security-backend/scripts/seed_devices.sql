-- Seed devices for IoT Security Platform (weather, fridge, thermostat only)
INSERT INTO devices (id, name, device_type, ip_address, mac_address, manufacturer, firmware_version, 
                     status, location, last_seen, registered_at, risk_score, compliance_score, 
                     compliance_status, digital_twin_state)
VALUES
('dev-weather-01', 'Station Meteo - Paris', 'weather', '192.168.10.10', 'AA:BB:CC:DD:01:01', 'PeakSoft Sensors', 'v1.3.2',
 'online', 'Paris-Factory-01', NOW(), NOW(), 0, 100, 'compliant',
 '{"temperature": 36.4, "humidity": 45.2, "pressure": 1013.0}'),

('dev-fridge-01', 'Chambre Froide - Stockage A', 'fridge', '192.168.10.20', 'AA:BB:CC:DD:02:02', 'PeakSoft Sensors', 'v2.0.1',
 'online', 'Paris-Factory-01', NOW(), NOW(), 0, 100, 'compliant',
 '{"fridge_temperature": 7.0, "temp_condition": "high"}'),

('dev-thermostat-01', 'Thermostat - Atelier A', 'thermostat', '192.168.10.30', 'AA:BB:CC:DD:03:03', 'PeakSoft Sensors', 'v3.1.0',
 'online', 'Paris-Factory-01', NOW(), NOW(), 0, 100, 'compliant',
 '{"current_temperature": 28.9, "thermostat_status": true}');
