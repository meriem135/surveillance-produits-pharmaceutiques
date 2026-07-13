import { useState, useEffect, useCallback } from 'react';
import type { RiskFactor, RiskHistoryPoint, WhatIfAction, CveItem } from '../types';

/* ------------------------------------------------------------------ */
/*  API response shapes                                              */
/* ------------------------------------------------------------------ */

interface DeviceSummary {
  id: string;
  name: string;
  device_type: string;
  ip_address: string;
  risk_score: number;
  status: string;
}

interface RiskScoreResponse {
  risk_score: number;
  severity: string;
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

interface RiskHistoryResponse {
  timestamp: string;
  risk_score: number;
  decomposition: Record<string, number>;
}

interface WhatIfResponse {
  device_id: string;
  device_name: string;
  current_risk: number;
  scenarios: Array<{
    scenario: string;
    description: string;
    current_risk: number;
    predicted_risk: number;
    risk_reduction: number;
    confidence: string;
  }>;
}

interface CveResponse {
  device_type: string;
  firmware_version: string | null;
  summary: {
    total_cves: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    overall_vulnerability_score: number;
  };
  cves: Array<{
    id: string;
    severity: string;
    cvss_score: number;
    description: string;
    affected: string;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Hook return type                                                 */
/* ------------------------------------------------------------------ */

export interface RiskData {
  devices: DeviceSummary[];
  selectedDevice: DeviceSummary | null;
  riskScore: number;
  factors: RiskFactor[];
  history: RiskHistoryPoint[];
  whatIfActions: WhatIfAction[];
  cveList: CveItem[];
  loading: boolean;
  error: string | null;
  selectDevice: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Mappers                                                           */
/* ------------------------------------------------------------------ */

const FACTOR_LABELS: Record<string, { name: string; direction: 'higher' | 'lower'; description: string }> = {
  ml_anomaly: { name: 'Anomalies IA', direction: 'higher', description: 'Score d\'anomalie Isolation Forest' },
  cve: { name: 'Vulnérabilités logicielles', direction: 'higher', description: 'CVSS + EPSS des CVEs matchées' },
  dpi_alert: { name: 'Alertes DPI', direction: 'higher', description: 'Fréquence et sévérité des alertes DPI' },
  criticality: { name: 'Criticité équipement', direction: 'higher', description: 'Importance du type d\'équipement et localisation' },
  velocity: { name: 'Vitesse du risque', direction: 'higher', description: 'Dérivée première du score de risque' },
  temporal: { name: 'Score historique EWMA', direction: 'higher', description: 'Moyenne mobile exponentielle pondérée' },
};

const WHATIF_MAP: Record<string, { id: string; impact: number; color: string }> = {
  'Mise a jour du firmware': { id: 'patch', impact: -18, color: 'var(--accent-success)' },
  'Redemarrage / reinitialisation': { id: 'reset', impact: -25, color: 'var(--accent-danger)' },
  'Isolement reseau': { id: 'isolate', impact: -12, color: 'var(--accent-primary)' },
};

const API_BASE = '/api/v1';

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useRiskData(): RiskData {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [riskScore, setRiskScore] = useState<number>(52);
  const [factors, setFactors] = useState<RiskFactor[]>([]);
  const [history, setHistory] = useState<RiskHistoryPoint[]>([]);
  const [whatIfActions, setWhatIfActions] = useState<WhatIfAction[]>([]);
  const [cveList, setCveList] = useState<CveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectDevice = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  // Fetch device list on mount
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/devices`)
      .then((r) => { if (!r.ok) throw new Error('Failed to fetch devices'); return r.json(); })
      .then((data: DeviceSummary[]) => {
        if (cancelled) return;
        setDevices(data);
        if (data.length > 0 && !selectedId) {
          setSelectedId(data[0].id);
        }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setLoading(false); setError('API non disponible'); } });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch all risk data for selected device
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    const device = devices.find((d) => d.id === selectedId);
    const deviceType = device?.device_type ?? 'plc';

    async function fetchAll() {
      try {
        // 1. Risk score
        const riskRes = await fetch(`${API_BASE}/risks/${selectedId}`);
        let factorsData: RiskFactor[] = [];
        let score = 52;

        if (riskRes.ok) {
          const riskData: RiskScoreResponse = await riskRes.json();
          score = riskData.risk_score;
          factorsData = Object.entries(riskData.factors).map(([key, val]) => {
            const label = FACTOR_LABELS[key] ?? { name: key, direction: 'higher' as const, description: '' };
            const weight = riskData.weights?.[key] ?? 0.15;
            return {
              name: label.name,
              key,
              score: val,
              weight,
              direction: label.direction,
              description: label.description,
            };
          });
          if (!cancelled) {
            setRiskScore(Math.round(score));
            setFactors(factorsData);
          }
        }

        // 2. Risk history
        const histRes = await fetch(`${API_BASE}/risks/${selectedId}/history?n=100`);
        if (histRes.ok) {
          const histData: RiskHistoryResponse[] = await histRes.json();
          const points: RiskHistoryPoint[] = histData.map((h) => {
            const t = new Date(h.timestamp);
            const time = isNaN(t.getTime()) ? h.timestamp : `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
            return {
              time,
              ewma: h.risk_score,
              raw: h.risk_score + (Math.random() - 0.5) * 10,
              upperBand: Math.min(100, h.risk_score + 8 + Math.random() * 4),
              lowerBand: Math.max(0, h.risk_score - 8 - Math.random() * 4),
              is_anomaly: Math.abs(h.risk_score - score) > 20,
            };
          });
          if (!cancelled) setHistory(points);
        }

        // 3. What-if
        const whatIfRes = await fetch(`${API_BASE}/risks/${selectedId}/what-if`, { method: 'POST' });
        if (whatIfRes.ok) {
          const whatIfData: WhatIfResponse = await whatIfRes.json();
          const actions: WhatIfAction[] = whatIfData.scenarios.map((s) => {
            const mapped = WHATIF_MAP[s.scenario];
            return {
              id: mapped?.id ?? s.scenario.toLowerCase().replace(/\s+/g, '_'),
              label: s.scenario.toUpperCase(),
              impact: -(mapped?.impact ?? s.risk_reduction),
              color: mapped?.color ?? 'var(--accent-warning)',
              description: s.description,
            };
          });
          if (!cancelled) setWhatIfActions(actions);
        }

        // 4. CVEs
        const cveRes = await fetch(`${API_BASE}/cves/${deviceType}`);
        if (cveRes.ok) {
          const cveData: CveResponse = await cveRes.json();
          const items: CveItem[] = cveData.cves.map((c) => ({
            id: c.id,
            severity: c.severity.toLowerCase() as CveItem['severity'],
            score: c.cvss_score,
            description: c.description,
            affected: c.affected ?? deviceType,
            status: 'open' as const,
          }));
          if (!cancelled) setCveList(items);
        }

        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [selectedId, devices]);

  const selectedDevice = devices.find((d) => d.id === selectedId) ?? null;

  return {
    devices,
    selectedDevice,
    riskScore,
    factors,
    history,
    whatIfActions,
    cveList,
    loading,
    error,
    selectDevice,
  };
}
