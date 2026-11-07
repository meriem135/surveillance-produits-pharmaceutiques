export interface Device {
  id: string;
  name: string;
  ip_address: string;
  protocol: string;
  risk_score: number;
  status: string;
  device_type: string;
  location?: string;
  compliance_score: number;
  compliance_status: string;
  firmware_version?: string;
  manufacturer?: string;
  last_seen?: string;
  registered_at?: string;
}

export type AttackType = 'recon' | 'mitm' | 'ddos' | 'ransom';
export type ThemeMode = 'light' | 'dark';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  roles?: string[];
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

export interface RiskAnomalyResponse {
  is_risk_anomaly: boolean;
  z_score: number;
  recent_velocity: number;
  mean_velocity: number;
  current_risk: number;
  message: string;
}

/* ---- Advanced Analytics (/api/v1/advanced-analytics) ---- */

export interface CurvePoint {
  x: number;
  y: number;
}

export interface OperatingPoint {
  x: number;
  y: number;
  fpr?: number;
  tpr?: number;
  recall?: number;
  precision?: number;
}

export interface RocCurve {
  points: CurvePoint[];
  auc: number | null;
  op: OperatingPoint | null;
}

export interface PrCurve {
  points: CurvePoint[];
  ap: number | null;
  op: OperatingPoint | null;
}

export interface ScoreDistribution {
  bins: number[];
  normal: number[];
  attack: number[];
  threshold_bin: number | null;
  threshold_value: number | null;
}

export interface CorrNode {
  id: string;
  label: string;
  group: 'sensor' | 'delta';
}

export interface CorrEdge {
  source: string;
  target: string;
  label: string;
  label_target: string;
  weight: number;
}

export interface ModelAnalysis {
  available: boolean;
  error?: string | null;
  sampled?: { n_total: number; n_normal: number; n_attack: number };
  roc?: RocCurve;
  pr?: PrCurve;
  distribution?: ScoreDistribution;
  model_meta?: {
    model_type: string;
    params: Record<string, unknown>;
    threshold: number | null;
    n_samples_total: number;
    trained_at?: string | null;
    metrics: {
      f1: number | null;
      roc_auc: number | null;
      recall: number | null;
      precision: number | null;
      ap: number | null;
      fpr: number | null;
    };
  };
  correlations?: { nodes: CorrNode[]; edges: CorrEdge[] };
}

export interface HistoryRun {
  id: string;
  name: string;
  model_type: string;
  trained_at: string | null;
  f1: number;
  roc_auc: number;
  precision: number;
  recall: number;
  ap: number;
  fpr: number;
}

export interface MetricsHistory {
  available: boolean;
  runs: HistoryRun[];
}

export interface GlobalSearchItem {
  key: string;
  title: string;
  subtitle: string;
  meta?: string;
  level?: number;
  status?: string;
  risk?: number;
  href?: string;
}

export interface GlobalSearchGroup {
  key: 'alerts' | 'devices' | 'models';
  label: string;
  items: GlobalSearchItem[];
}

export interface GlobalSearchResponse {
  query: string;
  total: number;
  groups: GlobalSearchGroup[];
}

export type AlertTriageStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';

export interface AlertTriageEntry {
  status: AlertTriageStatus;
  note: string;
  updated_at?: string;
}

export type AlertTriageMap = Record<string, AlertTriageEntry>;
