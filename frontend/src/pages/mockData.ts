interface DeviceOption { id: string; name: string; device_type: string; risk_score: number; status: string; }
interface RiskHistoryPoint { time: string; ewma: number; raw: number; upperBand?: number; lowerBand?: number; is_anomaly?: boolean; }
interface CveItem { id: string; severity: 'critical' | 'high' | 'medium' | 'low'; score: number; description: string; affected: string; status: 'open' | 'mitigated' | 'patched'; }
interface SimulateResult { scenario: string; current_risk: number; predicted_risk: number; risk_reduction: number; confidence: string; }
interface ForecastPoint { date: string; predicted_risk: number; lower_bound: number; upper_bound: number; }
interface AnomalyPoint { timestamp: string; risk_score: number; is_anomaly: boolean; anomaly_score: number; }

export const MOCK_DEVICES: DeviceOption[] = [
  { id: 'd-001', name: 'Station Météo Centrale', device_type: 'weather', risk_score: 72, status: 'critical' },
  { id: 'd-002', name: 'Frigo Entrepôt Nord', device_type: 'fridge', risk_score: 34, status: 'healthy' },
  { id: 'd-003', name: 'Thermostat Bâtiment A', device_type: 'thermostat', risk_score: 55, status: 'warning' },
  { id: 'd-004', name: 'Station Météo Périphérie', device_type: 'weather', risk_score: 18, status: 'healthy' },
  { id: 'd-005', name: 'Frigo Laboratoire', device_type: 'fridge', risk_score: 81, status: 'critical' },
  { id: 'd-006', name: 'Thermostat DataCenter', device_type: 'thermostat', risk_score: 47, status: 'warning' },
];

export function mockRiskResponse(deviceId: string) {
  const profiles: Record<string, { score: number; severity: string; trend: string; velocity: number; factors: Record<string, number> }> = {
    'd-001': {
      score: 72, severity: 'HIGH', trend: 'rapidly_increasing', velocity: 4.2,
      factors: { ml_anomaly: 78, cve: 65, dpi_alert: 45, criticality: 80, velocity: 72, temporal: 55 },
    },
    'd-002': {
      score: 34, severity: 'LOW', trend: 'decreasing', velocity: -1.8,
      factors: { ml_anomaly: 22, cve: 15, dpi_alert: 10, criticality: 45, velocity: 30, temporal: 28 },
    },
    'd-003': {
      score: 55, severity: 'MEDIUM', trend: 'increasing', velocity: 1.5,
      factors: { ml_anomaly: 48, cve: 35, dpi_alert: 60, criticality: 55, velocity: 50, temporal: 42 },
    },
    'd-004': {
      score: 18, severity: 'LOW', trend: 'stable', velocity: 0.3,
      factors: { ml_anomaly: 12, cve: 8, dpi_alert: 5, criticality: 25, velocity: 15, temporal: 10 },
    },
    'd-005': {
      score: 81, severity: 'CRITICAL', trend: 'rapidly_increasing', velocity: 6.7,
      factors: { ml_anomaly: 88, cve: 75, dpi_alert: 70, criticality: 90, velocity: 85, temporal: 72 },
    },
    'd-006': {
      score: 47, severity: 'MEDIUM', trend: 'stable', velocity: 0.8,
      factors: { ml_anomaly: 38, cve: 42, dpi_alert: 30, criticality: 50, velocity: 45, temporal: 35 },
    },
  };
  const p = profiles[deviceId] || profiles['d-001'];
  const weights: Record<string, number> = { ml_anomaly: 0.30, cve: 0.25, dpi_alert: 0.15, criticality: 0.12, velocity: 0.10, temporal: 0.08 };
  const decomposition = Object.entries(p.factors).map(([factor, raw]) => {
    const labels: Record<string, string> = {
      ml_anomaly: 'Anomalie ML', cve: 'Vulnérabilités', dpi_alert: 'Alertes DPI',
      criticality: 'Criticité', velocity: 'Vélocité', temporal: 'Temporel',
    };
    const w = weights[factor] || 0.1;
    const contribution = raw * w;
    const total = Object.entries(p.factors).reduce((s, [, v]) => s + v * (weights[factor] || 0.1), 0);
    return { factor, label: labels[factor] || factor, raw_value: raw, weight: w, contribution, contribution_pct: total > 0 ? (contribution / total) * 100 : 0 };
  });
  const ciMargin = 5 + Math.random() * 8;
  return {
    risk_score: p.score, severity: p.severity,
    factors: p.factors, weights,
    decomposition,
    confidence_interval: { low: Math.max(0, p.score - ciMargin), high: Math.min(100, p.score + ciMargin) },
    trend: p.trend, velocity: p.velocity, status: p.severity,
  };
}

export function mockRiskHistory(deviceId: string, n = 100): RiskHistoryPoint[] {
  const base = deviceId === 'd-002' ? 34 : deviceId === 'd-004' ? 18 : deviceId === 'd-005' ? 81 : deviceId === 'd-003' ? 55 : 72;
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(now - (n - i) * 3600000);
    const noise = (Math.random() - 0.5) * 12;
    const trend = Math.sin(i / 15) * 8 + (i / n) * 6 - 3;
    const raw = Math.max(0, Math.min(100, base + noise + trend));
    return {
      time: t.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      ewma: Math.max(0, Math.min(100, raw * 0.85 + (i > 0 ? Math.random() * 5 : 0))),
      raw,
    };
  });
}

const CVE_TEMPLATES = [
  { id: 'CVE-2025-0012', severity: 'critical' as const, score: 9.8, description: 'Exécution de code à distance dans le firmware IoT', affected: 'Firmware v2.1' },
  { id: 'CVE-2025-0047', severity: 'critical' as const, score: 9.4, description: 'Déni de service par paquets forgés MQTT', affected: 'Broker v3.0' },
  { id: 'CVE-2025-0089', severity: 'high' as const, score: 8.2, description: 'Fuites de données via canal auxiliaire temporel', affected: 'Module Crypto' },
  { id: 'CVE-2025-0112', severity: 'high' as const, score: 7.8, description: 'Injection de commandes dans l\'interface web', affected: 'Web UI v1.4' },
  { id: 'CVE-2025-0034', severity: 'high' as const, score: 7.2, description: 'Bypass d\'authentification sur API REST', affected: 'API Gateway' },
  { id: 'CVE-2025-0056', severity: 'medium' as const, score: 6.1, description: 'Cross-site scripting dans le portail administrateur', affected: 'Portal v2.0' },
  { id: 'CVE-2025-0078', severity: 'medium' as const, score: 5.5, description: 'Déni de service sur le service de télémétrie', affected: 'Telemetry v1.8' },
  { id: 'CVE-2025-0090', severity: 'medium' as const, score: 4.9, description: 'Divulgation d\'informations via les logs', affected: 'Logger Module' },
  { id: 'CVE-2025-0023', severity: 'low' as const, score: 3.2, description: 'Redirection non sécurisée dans l\'interface', affected: 'Auth Module' },
  { id: 'CVE-2025-0067', severity: 'low' as const, score: 2.8, description: 'Version TLS obsolète autorisée', affected: 'Network Stack' },
];

export function mockCveList(deviceType: string): CveItem[] {
  const counts: Record<string, number> = { weather: 6, fridge: 8, thermostat: 4 };
  const count = counts[deviceType] || 5;
  return CVE_TEMPLATES.slice(0, count).map(c => ({ ...c, status: 'open' as const }));
}

export function mockForecast(deviceId: string): ForecastPoint[] {
  const base = deviceId === 'd-002' ? 34 : deviceId === 'd-004' ? 18 : deviceId === 'd-005' ? 81 : deviceId === 'd-003' ? 55 : 72;
  const uptrend = ['d-001', 'd-005'].includes(deviceId) ? 0.8 : ['d-002', 'd-004'].includes(deviceId) ? -0.4 : 0.2;
  return Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.now() + (i + 1) * 86400000);
    const projected = Math.max(0, Math.min(100, base + uptrend * (i + 1) + (Math.random() - 0.5) * 6));
    const band = 8 + i * 0.5;
    return {
      date: date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      predicted_risk: Math.round(projected),
      lower_bound: Math.max(0, Math.round(projected - band)),
      upper_bound: Math.min(100, Math.round(projected + band)),
    };
  });
}

export function mockAnomalies(deviceId: string): AnomalyPoint[] {
  const base = deviceId === 'd-002' ? 34 : deviceId === 'd-004' ? 18 : deviceId === 'd-005' ? 81 : deviceId === 'd-003' ? 55 : 72;
  const now = Date.now();
  return Array.from({ length: 50 }, (_, i) => {
    const t = new Date(now - (50 - i) * 3600000);
    const risk = Math.max(0, Math.min(100, base + (Math.random() - 0.5) * 20 + Math.sin(i / 8) * 10));
    const isAnom = risk > base + 12;
    return {
      timestamp: t.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      risk_score: Math.round(risk),
      is_anomaly: isAnom,
      anomaly_score: isAnom ? 0.7 + Math.random() * 0.3 : Math.random() * 0.3,
    };
  });
}

export function mockWhatIf(deviceId: string): SimulateResult[] {
  const base = deviceId === 'd-002' ? 34 : deviceId === 'd-004' ? 18 : deviceId === 'd-005' ? 81 : deviceId === 'd-003' ? 55 : 72;
  return [
    { scenario: '🔧 Mise à jour firmwares critiques', current_risk: base, predicted_risk: Math.max(0, base - 22), risk_reduction: 22, confidence: 'Élevée (simulation basée sur 15 cas similaires)' },
    { scenario: '🛡️ Activation chiffrement TLS 1.3', current_risk: base, predicted_risk: Math.max(0, base - 14), risk_reduction: 14, confidence: 'Moyenne (8 cas références)' },
    { scenario: '📡 Segmentation réseau IoT', current_risk: base, predicted_risk: Math.max(0, base - 18), risk_reduction: 18, confidence: 'Élevée (recommandation NIST)' },
  ];
}

export function mockCorrelation() {
  const pairs = [
    { source: 'Anomalie ML', target: 'Score Risque', value: 0.87 },
    { source: 'CVEs critiques', target: 'Score Risque', value: 0.72 },
    { source: 'Alertes DPI', target: 'Anomalie ML', value: 0.65 },
    { source: 'Température', target: 'Anomalie ML', value: 0.58 },
    { source: 'Vélocité risque', target: 'Criticité', value: 0.51 },
    { source: 'Temporal', target: 'CVEs', value: 0.44 },
    { source: 'Bande passante', target: 'Alertes DPI', value: 0.39 },
    { source: 'Uptime', target: 'Score Risque', value: -0.35 },
  ];
  return {
    correlations: pairs.map(p => ({
      ...p,
      color: p.value > 0.7 ? 'var(--accent-danger)' : p.value > 0.5 ? 'var(--accent-warning)' : 'var(--accent-primary)',
    })),
  };
}

export function mockSimulateVulnerability(deviceId: string): SimulateResult[] {
  const base = deviceId === 'd-002' ? 34 : deviceId === 'd-004' ? 18 : deviceId === 'd-005' ? 81 : deviceId === 'd-003' ? 55 : 72;
  return [
    { scenario: 'CVE-2025-0012 — Exécution code à distance', current_risk: base, predicted_risk: Math.min(100, base + 28), risk_reduction: 28, confidence: 'Haute' },
    { scenario: 'CVE-2025-0047 — Déni de service MQTT', current_risk: base, predicted_risk: Math.min(100, base + 18), risk_reduction: 18, confidence: 'Moyenne' },
    { scenario: 'CVE-2025-0112 — Injection de commandes', current_risk: base, predicted_risk: Math.min(100, base + 22), risk_reduction: 22, confidence: 'Haute' },
  ];
}

export function mockPhase2Timeline(_sensor: string) {
  void _sensor;
  const now = Date.now();
  return Array.from({ length: 200 }, (_, i) => {
    const t = new Date(now - (200 - i) * 3600000);
    const anomalyScore = Math.max(0, Math.min(1, 0.15 + Math.sin(i / 12) * 0.25 + Math.cos(i / 7) * 0.15 + (Math.random() - 0.5) * 0.2));
    const temperature = 18 + Math.sin(i / 20) * 8 + (Math.random() - 0.5) * 3;
    return {
      datetime: t.toISOString(),
      anomaly_score: anomalyScore,
      temperature: Math.round(temperature * 10) / 10,
    };
  });
}

export function mockCrossRefData(phase2Timeline: Array<{ datetime: string; anomaly_score: number }>, history: RiskHistoryPoint[]) {
  return history.slice(-60).map((h, i) => {
    const p2 = phase2Timeline[Math.min(i * 3, phase2Timeline.length - 1)];
    return {
      time: h.time,
      risque: h.ewma,
      anomalie: p2 ? Math.round(p2.anomaly_score * 100) : 0,
    };
  });
}

export function mockLlmReport(
  device: { name?: string; device_type?: string } | undefined,
  riskScore: number,
  severity: string,
  trend: string,
  factorEntries: Array<{ key: string; label: string; score: number }>,
  cveList: CveItem[],
  filterSensor?: string | null,
  filterAttack?: string | null,
) {
  const danger = riskScore >= 70 ? '🔴 CRITIQUE' : riskScore >= 40 ? '🟡 MODÉRÉ' : '🟢 FAIBLE';
  const trendMap: Record<string, string> = { rapidly_increasing: 'en forte hausse ⬆️', increasing: 'en hausse ↗️', stable: 'stable ➡️', decreasing: 'en baisse ↘️' };
  const criticalCves = cveList.filter(c => c.severity === 'critical').length;
  const highCves = cveList.filter(c => c.severity === 'high').length;
  const topFactors = factorEntries.sort((a, b) => b.score - a.score).slice(0, 3);

  const recommendations = riskScore >= 70
    ? `### 🚨 Recommandations urgentes
1. **Corriger les ${criticalCves} CVEs critiques** en priorité (patch firmwares)
2. **Isoler l'équipement** du réseau principal tant que le score reste > 70
3. **Analyser les alertes DPI** en temps réel — risque de compromission actif
4. **Planifier une mise à jour** de sécurité dans les 48h`
    : riskScore >= 40
    ? `### ⚠️ Recommandations
1. **Surveiller les ${criticalCves + highCves} CVEs haute sévérité** — planifier correctifs
2. **Renforcer la segmentation réseau** de l'équipement
3. **Audit trimestriel** des configurations de sécurité`
    : `### ✅ Bonnes pratiques
1. Maintenir les correctifs de sécurité à jour
2. Surveillance continue recommandée
3. Aucune action urgente requise`;

  const contextSection = (filterSensor || filterAttack)
    ? `\n### 🧠 Contexte Phase 2
| Élément | Valeur |
|---|---|
${filterSensor ? `| Capteur | \`${filterSensor}\` |\n` : ''}${filterAttack ? `| Attaque filtrée | \`${filterAttack}\` |\n` : ''}| Impact | Les anomalies détectées en Phase 2 influencent directement le score de risque (poids 30%) |`
    : '';

  return `## 📊 Rapport de Sécurité — ${device?.name ?? 'Équipement'}

### Résumé
- **Score de risque** : ${riskScore}/100 — ${danger}
- **Tendance** : ${trendMap[trend] || trend}
- **Niveau de sévérité** : ${severity}
- **Type d'équipement** : ${device?.device_type ?? 'N/A'}${contextSection}

### 🔍 Facteurs de risque
Les 3 facteurs les plus impactants :
| Facteur | Score | Impact |
|---|---|---|
${topFactors.map(f => `| ${f.label} | ${f.score.toFixed(0)}/100 | ${f.score >= 70 ? '🔴 Critique' : f.score >= 40 ? '🟡 Modéré' : '🟢 Faible'} |`).join('\n')}

### 📦 Vulnérabilités (CVEs)
- **Total** : ${cveList.length} CVEs
- **Critiques** : ${criticalCves} | **Haute** : ${highCves}
- **Moyenne** : ${cveList.filter(c => c.severity === 'medium').length} | **Basse** : ${cveList.filter(c => c.severity === 'low').length}

${cveList.filter(c => c.severity === 'critical' || c.severity === 'high').map(c => `- **${c.id}** (${c.severity === 'critical' ? '🔴' : '🟠'} ${c.score.toFixed(1)}) : ${c.description}`).join('\n')}

${recommendations}
---
*Rapport généré le ${new Date().toLocaleString('fr-FR')} · Plateforme PeakSoft Security*`;
}
