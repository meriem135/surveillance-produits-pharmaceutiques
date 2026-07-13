export interface ThreeSensors {
  weather_temperature: number;
  fridge_temperature: number;
  thermostat_temperature: number;
}

export interface TelemetryValue {
  normality_score: number;
  is_anomaly: boolean;
  sensors: ThreeSensors;
}

export interface Telemetry {
  id?: number;
  device_id?: number;
  metric_key: string;
  metric_value: TelemetryValue;
  timestamp: string;
}

export interface Device {
  id: string;
  name: string;
  ip_address: string;
  protocol: string;
  risk_score: number;
  status: string;
  device_type: string;
}

export interface Alert {
  id: number;
  rule_id: string;
  level: number;
  description: string;
  device: string;
  timestamp: string;
}

export type AttackType = 'recon' | 'mitm' | 'ddos' | 'ransom';
export type ThemeMode = 'dark' | 'cyberpunk' | 'matrix' | 'light';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
}

export interface RiskFactor {
  name: string;
  key: string;
  score: number;
  weight: number;
  direction: 'higher' | 'lower';
  description: string;
}

export interface RiskHistoryPoint {
  time: string;
  ewma: number;
  raw: number;
  upperBand?: number;
  lowerBand?: number;
  is_anomaly?: boolean;
}

export interface WhatIfAction {
  id: string;
  label: string;
  impact: number;
  color: string;
  description: string;
}

export interface CveItem {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  score: number;
  description: string;
  affected: string;
  status: 'open' | 'mitigated' | 'patched';
}

export interface RiskResponse {
  risk_score: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  factors: Record<string, number>;
  weights: Record<string, number>;
  decomposition: Array<{
    factor: string;
    label: string;
    raw_value: number;
    weight: number;
    contribution: number;
    contribution_pct: number;
  }>;
  confidence_interval: { low: number; high: number };
  trend: string;
  velocity: number;
  status: string;
}

export interface CveResponseItem {
  cve_id: string;
  cvss_score: number | null;
  cvss_severity: string;
  epss_score: number | null;
  description: string;
  published: string;
  risk_score: number;
  days_since_published: number;
  temporal_weight: number;
}

export interface CveSummaryResponse {
  device_type: string;
  total_cves: number;
  max_risk_score: number;
  avg_risk_score: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  top_cves: CveResponseItem[];
  overall_vulnerability_score: number;
}

export interface RiskAnomalyResponse {
  is_risk_anomaly: boolean;
  z_score: number;
  recent_velocity: number;
  mean_velocity: number;
  current_risk: number;
  message: string;
}

export interface MLModelSummary {
  id: string;
  name: string;
  model_type: string;
  sensor: string;
  status: string;
  version: string;
  trained_at: string;
  training_samples: number;
  feature_count: number;
  anomaly_rate_normal: number;
  score_moyen_normal: number;
  detection_moyenne: number | null;
  meilleure_attaque: string | null;
  meilleur_taux: number | null;
  pire_attaque: string | null;
  pire_taux: number | null;
}

export interface ModelMetric {
  id: number;
  model_id: string;
  attack_type: string;
  capteur: string;
  n_total: number;
  n_anomalies: number;
  taux_detection: number;
  score_moyen: number;
  roc_auc: number | null;
  avg_precision: number | null;
  precision_normal: number | null;
  recall_normal: number | null;
  f1_normal: number | null;
  precision_attaque: number | null;
  recall_attaque: number | null;
  f1_attaque: number | null;
}
