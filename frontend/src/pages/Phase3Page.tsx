import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Line, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ComposedChart, ReferenceLine,
} from 'recharts';
import {
  Gauge, TrendingUp, Activity,
  Brain, Server, Zap, Target, FileWarning,
  Loader2, Download, BarChart3,
  XCircle, FileText, Sparkles, Lock, Sliders, Database, Orbit,
} from 'lucide-react';
import type { RiskHistoryPoint, CveItem } from '../types';
import { PhaseShell } from '../components/PhaseShell';
import {
  MOCK_DEVICES, mockRiskResponse, mockRiskHistory, mockCveList,
  mockForecast, mockAnomalies, mockWhatIf, mockCorrelation,
  mockSimulateVulnerability, mockPhase2Timeline, mockLlmReport,
} from './mockData';
import { PhaseBridge } from '../components/PhaseBridge';
import { PHASE_CONFIG } from '../components/PhasePipeline';

const API_BASE = '/api/v1';

interface DeviceOption { id: string; name: string; device_type: string; risk_score: number; status: string; }
interface DecomposeItem { factor: string; label: string; raw_value: number; weight: number; contribution: number; contribution_pct: number; }
interface ForecastPoint { date: string; predicted_risk: number; lower_bound: number; upper_bound: number; }
interface AnomalyPoint { timestamp: string; risk_score: number; is_anomaly: boolean; anomaly_score: number; }
interface SimulateResult { scenario: string; current_risk: number; predicted_risk: number; risk_reduction: number; confidence: string; }

function severityColor(s: string) {
  return s === 'critical' ? 'var(--accent-danger)' : s === 'high' ? 'var(--accent-warning)' : s === 'medium' ? 'var(--accent-primary)' : 'var(--accent-success)';
}

function severityBadge(s: string) {
  const map: Record<string, string> = { critical: 'CRITIQUE', high: 'HAUTE', medium: 'MOYENNE', low: 'BASSE' };
  return map[s] ?? s;
}

function RiskGauge({ score, size = 180 }: { score: number; size?: number }) {
  const color = score >= 70 ? 'var(--accent-danger)' : score >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)';
  const r = (size - 40) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const viewBox = `0 0 ${size} ${size / 2 + 20}`;
  const cx = size / 2, cy = size / 2 + 10;

  return (
    <svg width={size} height={size / 2 + 20} viewBox={viewBox} className="drop-shadow-lg">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="oklch(0.28 0.02 250 / 0.2)" strokeWidth="14" strokeLinecap="round" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`} style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: 'stroke-dasharray 1s ease-out' }} />
      <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--text-primary)" fontSize="32" fontFamily="Space Grotesk, sans-serif" fontWeight="700">
        {Math.round(score)}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--text-secondary)" fontSize="11" fontFamily="JetBrains Mono, monospace">
        /100
      </text>
    </svg>
  );
}

// Animated counter that counts up on mount
function AnimatedCounter({ value, suffix = '', decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 1200;
    const steps = 30;
    const increment = end / steps;
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(start);
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);
  return <>{display.toFixed(decimals)}{suffix}</>;
}

// Card entrance variants
const cardVariant = {
  hidden: { opacity: 0, y: 30, scale: 0.96 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.07, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

export default function Phase3Page() {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string>('');
  const [riskScore, setRiskScore] = useState(50);
  const [severity, setSeverity] = useState('MEDIUM');
  const [factors, setFactors] = useState<Record<string, number>>({});
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [decompose, setDecompose] = useState<DecomposeItem[]>([]);
  const [history, setHistory] = useState<RiskHistoryPoint[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyPoint[]>([]);
  const [whatIfScenarios, setWhatIfScenarios] = useState<SimulateResult[]>([]);
  const [cveList, setCveList] = useState<CveItem[]>([]);
  const [correlation, setCorrelation] = useState<Record<string, Record<string, number>>>({});
  const [simulateResult, setSimulateResult] = useState<SimulateResult[]>([]);
  const [trend, setTrend] = useState('stable');
  const [velocity, setVelocity] = useState(0);
  const [ci, setCi] = useState({ low: 0, high: 0 });
  const [timeRange, setTimeRange] = useState<'24h' | '7j' | '30j'>('24h');
  const [selectedAttack, setSelectedAttack] = useState<string>('IoT_MITM_normal');
  const [llmOpen, setLlmOpen] = useState(false);
  const [llmReport, setLlmReport] = useState<string | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Phase 2 filter context from URL
  const filterSensor = searchParams.get('deviceType');
  const filterAttack = searchParams.get('attack');

  // Phase 2 cross-reference data
  const [phase2Timeline, setPhase2Timeline] = useState<Array<{ datetime: string; anomaly_score: number; temperature: number }>>([]);
  const [selectedFeature] = useState<string | null>(null);

  const selectDevice = useCallback((id: string) => { setSelectedId(id); }, []);

  useEffect(() => {
    let cancelled = false;
    const deviceTypeParam = searchParams.get('deviceType');
    fetch(`${API_BASE}/devices`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: DeviceOption[]) => {
        if (cancelled) return;
        setDevices(data);
        if (data.length > 0) {
          const matched = deviceTypeParam
            ? data.find(d =>
                d.device_type?.toLowerCase() === deviceTypeParam.toLowerCase() ||
                d.name?.toLowerCase().includes(deviceTypeParam.toLowerCase())
              )
            : null;
          setSelectedId(matched?.id || data[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDevices(MOCK_DEVICES);
          const matched = deviceTypeParam
            ? MOCK_DEVICES.find(d =>
                d.device_type?.toLowerCase() === deviceTypeParam.toLowerCase() ||
                d.name?.toLowerCase().includes(deviceTypeParam.toLowerCase())
              )
            : null;
          setSelectedId(matched?.id || MOCK_DEVICES[0].id);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const device = devices.find(d => d.id === selectedId);

  // Fetch Phase 2 timeline to overlay anomaly score on risk chart (separate effect)
  useEffect(() => {
    if (!device?.device_type) return;
    let cancelled = false;
    fetch(`/api/v1/phase2/timeline?sensor=${device.device_type}&limit=200`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { points?: Array<{ datetime: string; anomaly_score: number; temperature: number }> }) => {
        if (!cancelled) setPhase2Timeline(data.points ?? []);
      })
      .catch(() => { if (!cancelled) setPhase2Timeline(mockPhase2Timeline(device.device_type)); });
    return () => { cancelled = true; };
  }, [device?.device_type]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const deviceType = device?.device_type ?? 'weather';

    async function fetchAll() {
      try {
        const [riskRes, histRes, whatIfRes, cveRes, forecastRes, anomalyRes, corrRes, simRes] = await Promise.all([
          fetch(`${API_BASE}/risks/${selectedId}`),
          fetch(`${API_BASE}/risks/${selectedId}/history?n=100`),
          fetch(`${API_BASE}/risks/${selectedId}/what-if`, { method: 'POST' }),
          fetch(`${API_BASE}/cves/${deviceType}`),
          fetch(`${API_BASE}/risks/${selectedId}/forecast`),
          fetch(`${API_BASE}/risks/${selectedId}/anomaly`),
          fetch(`${API_BASE}/risks/correlation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_ids: devices.slice(0, 5).map(d => d.id) }),
          }).then(r => r.ok ? r.json() : { correlations: [] }),
          fetch(`${API_BASE}/devices/${selectedId}/simulate-vulnerability?cve_id=CVE-2025-0001`, { method: 'POST' }),
        ]);

        if (cancelled) return;

        if (riskRes.ok) {
          const data = await riskRes.json();
          if (!cancelled) {
            setRiskScore(data.risk_score);
            setSeverity(data.severity);
            setFactors(data.factors ?? {});
            setWeights(data.weights ?? {});
            setTrend(data.trend ?? 'stable');
            setVelocity(data.velocity ?? 0);
            setCi(data.confidence_interval ?? { low: 0, high: 0 });
            if (data.decomposition) setDecompose(data.decomposition);
          }
        } else {
          const mock = mockRiskResponse(selectedId);
          if (!cancelled) {
            setRiskScore(mock.risk_score);
            setSeverity(mock.severity);
            setFactors(mock.factors);
            setWeights(mock.weights);
            setTrend(mock.trend);
            setVelocity(mock.velocity);
            setCi(mock.confidence_interval);
            setDecompose(mock.decomposition);
          }
        }

        if (histRes.ok) {
          const data = await histRes.json();
          if (!cancelled) {
            const points: RiskHistoryPoint[] = (data as Array<{ timestamp: string; risk_score: number }>).map(h => {
              const t = new Date(h.timestamp);
              const time = isNaN(t.getTime()) ? h.timestamp : `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
              return { time, ewma: h.risk_score, raw: h.risk_score + (Math.random() - 0.5) * 8 };
            });
            setHistory(points);
          }
        } else {
          if (!cancelled) setHistory(mockRiskHistory(selectedId));
        }

        if (whatIfRes.ok) {
          const data = await whatIfRes.json();
          if (!cancelled) setWhatIfScenarios(data.scenarios ?? []);
        } else {
          if (!cancelled) setWhatIfScenarios(mockWhatIf(selectedId));
        }

        if (cveRes.ok) {
          const data = await cveRes.json();
          if (!cancelled) {
            setCveList((data.cves ?? []).map((c: any) => ({
              id: c.cve_id ?? c.id,
              severity: (c.cvss_severity ?? c.severity ?? 'MEDIUM').toLowerCase() as CveItem['severity'],
              score: c.cvss_score ?? c.score ?? 0,
              description: c.description ?? '',
              affected: c.affected ?? deviceType,
              status: 'open' as const,
            })));
          }
        } else {
          if (!cancelled) setCveList(mockCveList(deviceType));
        }

        if (forecastRes.ok) {
          const data = await forecastRes.json();
          if (!cancelled) {
            const list = data.forecasts ?? data.forecast ?? data.predictions ?? [];
            setForecast(list.map((f: any) => ({
              date: f.date ?? new Date(Date.now() + f.step * 3600000).toISOString(),
              predicted_risk: f.predicted_risk ?? 50,
              lower_bound: f.ci_low ?? f.lower_bound ?? 0,
              upper_bound: f.ci_high ?? f.upper_bound ?? 100,
            })));
          }
        } else {
          if (!cancelled) setForecast(mockForecast(selectedId));
        }

        if (anomalyRes.ok) {
          const data = await anomalyRes.json();
          if (!cancelled) {
            const point = {
              timestamp: new Date().toISOString(),
              risk_score: data.current_risk ?? riskScore,
              is_anomaly: data.is_risk_anomaly ?? false,
              anomaly_score: Math.abs(data.z_score ?? 0) / 5,
            };
            setAnomalies(prev => [...prev.slice(-49), point]);
          }
        } else {
          if (!cancelled) setAnomalies(mockAnomalies(selectedId));
        }

        if (corrRes.ok && corrRes.status !== 422) {
          const data = await corrRes.json();
          if (!cancelled) {
            const list = data.correlations ?? [];
            const matrix: Record<string, Record<string, number>> = {};
            for (const item of list) {
              if (!matrix[item.device_1]) matrix[item.device_1] = {};
              matrix[item.device_1][item.device_2] = item.risk_correlation ?? 0;
            }
            setCorrelation(matrix);
          }
        } else {
          if (!cancelled) {
            const mock = mockCorrelation();
            const matrix: Record<string, Record<string, number>> = {};
            for (const item of mock.correlations) {
              if (!matrix[item.source]) matrix[item.source] = {};
              matrix[item.source][item.target] = item.value;
            }
            setCorrelation(matrix);
          }
        }

        if (simRes.ok) {
          const data = await simRes.json();
          if (!cancelled) {
            const scenarios = data.scenarios ?? [{
              scenario: 'Simulation vulnérabilité',
              current_risk: data.current_risk ?? riskScore,
              predicted_risk: data.predicted_risk ?? riskScore,
              risk_reduction: (data.predicted_risk ?? riskScore) - (data.current_risk ?? riskScore),
              confidence: data.impact_analysis === 'High' ? 'haute' : 'moyenne',
            }];
            setSimulateResult(scenarios);
          }
        } else {
          if (!cancelled) setSimulateResult(mockSimulateVulnerability(selectedId));
        }
      } catch {
        if (!cancelled) {
          const mock = mockRiskResponse(selectedId);
          setRiskScore(mock.risk_score);
          setSeverity(mock.severity);
          setFactors(mock.factors);
          setWeights(mock.weights);
          setTrend(mock.trend);
          setVelocity(mock.velocity);
          setCi(mock.confidence_interval);
          setDecompose(mock.decomposition);
          setHistory(mockRiskHistory(selectedId));
          setWhatIfScenarios(mockWhatIf(selectedId));
          setCveList(mockCveList(deviceType));
          setForecast(mockForecast(selectedId));
          setAnomalies(mockAnomalies(selectedId));
          const mc = mockCorrelation();
          const matrix: Record<string, Record<string, number>> = {};
          for (const item of mc.correlations) {
            if (!matrix[item.source]) matrix[item.source] = {};
            matrix[item.source][item.target] = item.value;
          }
          setCorrelation(matrix);
          setSimulateResult(mockSimulateVulnerability(selectedId));
        }
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [selectedId, devices]);

  const factorEntries = useMemo(() =>
    Object.entries(factors).map(([key, val]) => {
      const labels: Record<string, string> = {
        ml_anomaly: 'Anomalies IA', cve: 'Vulnérabilités', dpi_alert: 'Alertes DPI',
      };
      return { key, label: labels[key] ?? key, score: val };
    }).sort((a, b) => b.score - a.score),
  [factors]);

  const radarData = useMemo(() =>
    factorEntries.map(f => ({ factor: f.label, value: f.score })),
  [factorEntries]);

  const waterfallData = useMemo(() => {
    if (decompose.length > 0) return decompose.map(d => ({ name: d.label, contribution: d.contribution_pct, color: d.contribution_pct > 30 ? 'var(--accent-danger)' : d.contribution_pct > 15 ? 'var(--accent-warning)' : 'var(--accent-primary)' }));
    return factorEntries.map(f => ({ name: f.label, contribution: f.score * (weights[f.key] ?? 0.15), color: f.score >= 70 ? 'var(--accent-danger)' : f.score >= 40 ? 'var(--accent-warning)' : 'var(--accent-primary)' }));
  }, [decompose, factorEntries, weights]);

  const correlationData = useMemo(() => {
    const entries = Object.entries(correlation);
    if (entries.length === 0) return [];
    return entries.flatMap(([k1, vals]) =>
      Object.entries(vals as Record<string, number>).map(([k2, v]) => ({
        source: devices.find(d => d.id === k1)?.name ?? k1.slice(0, 12),
        target: devices.find(d => d.id === k2)?.name ?? k2.slice(0, 12),
        value: Math.round(Math.abs(v) * 100),
        color: v > 0 ? 'var(--accent-danger)' : 'var(--accent-primary)',
      }))
    ).filter(d => d.source !== d.target && d.value > 0).slice(0, 20);
  }, [correlation, devices]);

  const anomalyChartData = useMemo(() =>
    (Array.isArray(anomalies) ? anomalies : []).slice(-50).map(a => ({
      time: a.timestamp?.slice(11, 16) ?? '',
      score: a.risk_score ?? a.anomaly_score ?? 0,
      anomaly: a.is_anomaly ? (a.risk_score ?? 50) : null,
    })),
  [anomalies]);

  const forecastChartData = useMemo(() =>
    (Array.isArray(forecast) ? forecast : []).map(f => ({
      date: f.date?.slice(5, 10) ?? f.date ?? '',
      predicted: f.predicted_risk ?? 50,
      lower: f.lower_bound ?? 0,
      upper: f.upper_bound ?? 100,
    })),
  [forecast]);

  // Cross-reference data: align Phase 2 anomaly scores with risk history on a shared timeline
  const crossRefData = useMemo(() => {
    const riskPoints = history.slice(-60);
    const anomalyPoints = phase2Timeline.slice(-60);
    const maxLen = Math.max(riskPoints.length, anomalyPoints.length);
    const result: Array<{ time: string; risque: number | null; anomalie: number | null }> = [];
    for (let i = 0; i < maxLen; i++) {
      result.push({
        time: riskPoints[i]?.time ?? anomalyPoints[i]?.datetime?.slice(11, 16) ?? `${i}`,
        risque: riskPoints[i]?.ewma ?? null,
        anomalie: anomalyPoints[i] ? Math.abs(anomalyPoints[i].anomaly_score || 0) * 100 : null,
      });
    }
    return result;
  }, [history, phase2Timeline]);

  // Top 3 Isolation Forest features mapped to risk factors
  const FEATURE_RISK_MAP: Array<{ feature: string; label: string; riskFactor: string; emoji: string; desc: string }> = [
    { feature: 'diff_weather_fridge', label: 'Écart Météo ↔ Frigo', riskFactor: 'ml_anomaly', emoji: '\u{1F4CA}', desc: 'Un grand écart entre météo et frigo = équipement critique' },
    { feature: 'diff_weather_thermostat', label: 'Écart Météo ↔ Thermostat', riskFactor: 'ml_anomaly', emoji: '\u{26A1}', desc: 'Variation rapide = risque de changement brutal' },
    { feature: 'temperature_fridge', label: 'Température Frigo', riskFactor: 'ml_anomaly', emoji: '\u{2744}\uFE0F', desc: 'Température anormale = alerte IA directe' },
  ];

  const attackOptions = ['IoT_MITM_normal', 'IoT_DoS_normal', 'IoT_DDoS_normal', 'IoT_XSS_normal', 'IoT_ransomware_normal', 'IoT_injection_normal'];

  const generateLlmReport = async () => {
    setLlmLoading(true);
    setLlmReport(null);
    const ctxParts: string[] = [];
    if (filterSensor) ctxParts.push(`Capteur Phase 2 : ${filterSensor}`);
    if (filterAttack) ctxParts.push(`Attaque filtrée : ${filterAttack}`);
    const ctxStr = ctxParts.length > 0 ? `\nContexte Phase 2 : ${ctxParts.join(' · ')}.` : '';
    const criticalCount = cveList.filter(c => c.severity === 'critical' || c.severity === 'high').length;
    try {
      const r = await fetch(`${API_BASE}/analyst/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: selectedId,
          rule_id: 'RISK-001',
          rule_name: 'Analyse des risques Phase 3',
          rule_description: `Score risque: ${riskScore}/100, Trend: ${trend}, Velocity: ${velocity}. ${ctxParts.join(' · ')}`,
          attack_type: filterAttack || 'Analyse des risques',
          risk_score: riskScore,
          severity,
          sensor: device?.device_type ?? 'iot',
          force_template: true,
          question: `Analyse détaillée des risques pour ${device?.name ?? selectedId} (score: ${riskScore}/100, tendance: ${trend}).${ctxStr} Facteurs: ${factorEntries.map(f => `${f.label}: ${f.score.toFixed(0)}`).join(', ')}. ${cveList.length} CVEs dont ${criticalCount} critiques/haute sévérité. Que recommandez-vous ?`,
        }),
      });
      if (!r.ok) throw new Error(`Erreur ${r.status}`);
      const data = await r.json();
      setLlmReport(data.report ?? data.analysis ?? mockLlmReport(device, riskScore, severity, trend, factorEntries, cveList, filterSensor, filterAttack));
    } catch {
      setLlmReport(mockLlmReport(device, riskScore, severity, trend, factorEntries, cveList, filterSensor, filterAttack));
    } finally {
      setLlmLoading(false);
    }
  };

  const exportPdf = async () => {
    if (!containerRef.current) return;
    setPdfLoading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF = (await import('jspdf')).default;
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#09091a';
      const canvas = await html2canvas(containerRef.current, {
        scale: 2,
        backgroundColor: bgColor,
        logging: false,
        useCORS: true,
        windowWidth: containerRef.current.scrollWidth,
        windowHeight: containerRef.current.scrollHeight,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a3');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = (canvas.height * pdfW) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
      pdf.save(`phase3-risks-${selectedId}-${new Date().toISOString().slice(0, 10)}.pdf`);
      const { toast: showToast } = await import('@/components/ui/use-toast');
      showToast({ title: 'PDF exporté', description: 'Le rapport a été téléchargé avec succès', variant: 'default' });
    } catch (err) {
      const { toast: showToast } = await import('@/components/ui/use-toast');
      showToast({ title: 'Erreur PDF', description: `Échec de l'export : ${err instanceof Error ? err.message : 'Erreur inconnue'}`, variant: 'destructive' });
    } finally {
      setPdfLoading(false);
    }
  };

  const phaseStats = [
    { icon: <Gauge className="h-3.5 w-3.5" />, label: 'Score Risque', value: `${Math.round(riskScore)}/100`, color: riskScore >= 70 ? 'var(--accent-danger)' : riskScore >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)', sub: severity },
    { icon: <TrendingUp className="h-3.5 w-3.5" />, label: 'Tendance', value: trend, color: trend === 'rapidly_increasing' ? 'var(--accent-danger)' : trend === 'increasing' ? 'var(--accent-warning)' : 'var(--accent-success)', sub: `Vitesse: ${velocity.toFixed(1)}` },
    { icon: <Target className="h-3.5 w-3.5" />, label: 'IC 95%', value: `${Math.round(ci.low)}–${Math.round(ci.high)}`, color: 'var(--accent-primary)', sub: 'confiance' },
    { icon: <FileWarning className="h-3.5 w-3.5" />, label: 'CVEs', value: `${cveList.length}`, color: cveList.filter(c => c.severity === 'critical' || c.severity === 'high').length > 0 ? 'var(--accent-danger)' : 'var(--accent-success)', sub: `${cveList.filter(c => c.severity === 'critical').length} critiques` },
  ];

  return (
    <PhaseShell
      phase={PHASE_CONFIG[2]}
      stats={phaseStats}
    >
      <div ref={containerRef} className="space-y-6">
        {/* Device selector & actions */}
        <motion.div custom={0} variants={cardVariant} initial="hidden" animate="visible" className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            {devices.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-xl px-3 py-2 glass glass-border"
                style={{ borderColor: 'rgba(255,45,120,0.15)' }}>
                <Server className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                <select value={selectedId} onChange={e => selectDevice(e.target.value)}
                  className="text-xs font-semibold bg-transparent border-none outline-none cursor-pointer appearance-none"
                  style={{ color: 'var(--text-primary)' }}>
                  {devices.map(d => <option key={d.id} value={d.id} style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)' }}>{d.name} ({d.risk_score})</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLlmOpen(true)}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl cursor-pointer transition-all hover:brightness-125 glass glass-border"
              style={{ borderColor: 'rgba(168,85,247,0.3)', color: 'var(--accent-purple)' }}>
              <Brain className="h-4 w-4" /> Rapport LLM
            </button>
            <button onClick={exportPdf} disabled={pdfLoading}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl cursor-pointer transition-all hover:brightness-125 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed glass glass-border"
              style={{ borderColor: 'rgba(255,45,120,0.3)', color: 'var(--accent-danger)' }}>
              {pdfLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {pdfLoading ? 'Export...' : 'PDF'}
            </button>
          </div>
        </motion.div>

        {/* Phase 2 filter context banner */}
        <motion.div custom={1} variants={cardVariant} initial="hidden" animate="visible">
        {(filterSensor || filterAttack) && (
          <div className="rounded-2xl p-4 flex items-center gap-3 flex-wrap glass glass-border animate-border-glow" style={{ borderColor: 'rgba(0,255,163,0.12)' }}>
            <span className="text-xs font-semibold px-3 py-0.5 rounded-full" style={{ background: 'rgba(0,255,163,0.1)', color: 'var(--accent-success)' }}>
              🧠 Contexte Phase 2
            </span>
            {filterSensor && (
              <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                Capteur : <strong style={{ color: 'var(--accent-danger)' }}>{filterSensor}</strong>
              </span>
            )}
            {filterAttack && (
              <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                Attaque filtrée : <strong style={{ color: 'var(--accent-warning)' }}>{filterAttack}</strong>
              </span>
            )}
            <span className="ml-auto text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              ← Les analyses ci-dessous reflètent ce contexte
            </span>
          </div>
        )}
        </motion.div>

        {/* Phase Bridge: Phase 2 -> 3 */}
        <motion.div custom={2} variants={cardVariant} initial="hidden" animate="visible">
        {device && (
          <PhaseBridge
            fromPhase={2}
            toPhase={3}
            fromLabel="ML Score"
            toLabel={`${device.name}`}
            value={`${(factors?.ml_anomaly || 0).toFixed(0)}/100`}
            weight={30}
            contribution={(factors?.ml_anomaly || 0) * 0.3}
            isFromDetail={false}
          />
        )}
        </motion.div>

      {/* Stats bar (unified style) */}
      <motion.div custom={3} variants={cardVariant} initial="hidden" animate="visible" className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          { icon: <Gauge className="h-3.5 w-3.5" />, label: 'Score Risque', value: `${Math.round(riskScore)}/100`, color: riskScore >= 70 ? 'var(--accent-danger)' : riskScore >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)', sub: severity },
          { icon: <TrendingUp className="h-3.5 w-3.5" />, label: 'Tendance', value: trend, color: trend === 'rapidly_increasing' ? 'var(--accent-danger)' : trend === 'increasing' ? 'var(--accent-warning)' : 'var(--accent-success)', sub: `Vitesse: ${velocity.toFixed(1)}` },
          { icon: <Target className="h-3.5 w-3.5" />, label: 'Intervalle confiance', value: `${Math.round(ci.low)}–${Math.round(ci.high)}`, color: 'var(--accent-primary)', sub: '95%' },
          { icon: <FileWarning className="h-3.5 w-3.5" />, label: 'CVEs', value: `${cveList.length}`, color: cveList.filter(c => c.severity === 'critical' || c.severity === 'high').length > 0 ? 'var(--accent-danger)' : 'var(--accent-success)', sub: `${cveList.filter(c => c.severity === 'critical').length} critiques` },
          { icon: <Activity className="h-3.5 w-3.5" />, label: 'Anomalies risque', value: `${(Array.isArray(anomalies) ? anomalies : []).filter(a => a.is_anomaly).length}`, color: 'var(--accent-warning)', sub: `/${(Array.isArray(anomalies) ? anomalies : []).length} points` },
          { icon: <Zap className="h-3.5 w-3.5" />, label: 'Sc\u00E9narios What-If', value: `${whatIfScenarios.length}`, color: 'var(--accent-purple)', sub: 'disponibles' },
          { icon: <Lock className="h-3.5 w-3.5" />, label: 'Simulation vuln.', value: simulateResult.length > 0 ? `${Math.round(simulateResult[0].risk_reduction)}%` : '\u2014', color: simulateResult.length > 0 && simulateResult[0].risk_reduction > 30 ? 'var(--accent-danger)' : 'var(--accent-success)', sub: 'impact' },
        ].map((s, i) => (
          <div key={i} className="rounded-xl p-4 glass glass-border animate-border-glow" style={{ borderColor: 'rgba(255,45,120,0.08)' }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
              <span style={{ color: s.color }}>{s.icon}</span>
            </div>
            <div className="font-display text-base font-bold" style={{ color: s.color }}>
              {i === 0 ? <AnimatedCounter value={riskScore} suffix='/100' /> : s.value}
            </div>
            <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>{s.sub}</div>
          </div>
        ))}
      </motion.div>

      {/* Main grid: gauge + simple factor view + trend */}
      <motion.div custom={4} variants={cardVariant} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-[200px_1fr_1fr] gap-4">
        {/* Gauge + Health emoji */}
        <div className={`rounded-2xl p-4 flex flex-col items-center justify-center glass glass-border transition-all duration-300 hover:scale-[1.01] hover:brightness-110 ${riskScore >= 70 ? 'animate-pulse-glow' : riskScore >= 40 ? '' : ''}`}
          style={{ borderColor: riskScore >= 70 ? 'var(--accent-danger)' : 'rgba(255,45,120,0.1)' }}>
          <div className={`text-4xl mb-1 ${riskScore >= 70 ? 'animate-float' : ''}`}>
            {riskScore >= 70 ? '🔴' : riskScore >= 40 ? '🟡' : '🟢'}
          </div>
          <RiskGauge score={riskScore} />
          <div className={`mt-2 px-3 py-1 rounded-full text-[10px] font-bold border ${riskScore >= 70 ? 'animate-pulse-ring' : ''}`} style={{
            background: `color-mix(in srgb, ${riskScore >= 70 ? 'var(--accent-danger)' : riskScore >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)'} 12%, transparent)`,
            borderColor: `color-mix(in srgb, ${riskScore >= 70 ? 'var(--accent-danger)' : riskScore >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)'} 30%, transparent)`,
            color: riskScore >= 70 ? 'var(--accent-danger)' : riskScore >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)',
          }}>
            {riskScore >= 70 ? '⚠️ DANGEREUX' : riskScore >= 40 ? '👀 SURVEILLER' : '✅ OK'}
          </div>
        </div>

        {/* Simple factor traffic-light list (replaces radar) */}
        <div className="rounded-2xl p-4 glass glass-border animate-border-glow transition-all duration-300 hover:scale-[1.01] hover:brightness-110" style={{ borderColor: 'rgba(0,255,163,0.08)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
            <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>État des facteurs</h3>
            <span className="ml-auto text-[9px] flex items-center gap-3">
              <span className="flex items-center gap-1">🟢 <span className="text-xs">OK</span></span>
              <span className="flex items-center gap-1">🟡 <span className="text-xs">Attention</span></span>
              <span className="flex items-center gap-1">🔴 <span className="text-xs">Critique</span></span>
            </span>
          </div>
          <div className="space-y-2.5">
            {factorEntries.map(f => {
              const level = f.score >= 70 ? '🔴' : f.score >= 40 ? '🟡' : '🟢';
              return (
                <div key={f.key} className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <span className="text-xl">{level}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{f.label}</span>
                      <span className="text-xs font-bold font-mono" style={{
                        color: f.score >= 70 ? 'var(--accent-danger)' : f.score >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)',
                      }}>{f.score.toFixed(0)}/100</span>
                    </div>
                    <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{
                        width: `${f.score}%`,
                        background: f.score >= 70 ? 'var(--accent-danger)' : f.score >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)',
                      }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Simple impact view (replaces waterfall + feature map) */}
        <div className="rounded-2xl p-4 glass glass-border" style={{ borderColor: 'rgba(168,85,247,0.08)' }}>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-3.5 w-3.5" style={{ color: 'var(--accent-purple)' }} />
            <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>Quel facteur pèse le plus ?</h3>
          </div>
          <div className="space-y-2.5">
            {waterfallData.sort((a, b) => b.contribution - a.contribution).map(f => (
              <div key={f.name} className="flex items-center gap-3">
                <span className="text-[10px] font-semibold w-28 truncate shrink-0" style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div className="h-full rounded-full flex items-center justify-end px-2 transition-all" style={{
                    width: `${Math.min(f.contribution, 100)}%`,
                    background: f.contribution > 30 ? 'var(--accent-danger)' : f.contribution > 15 ? 'var(--accent-warning)' : 'var(--accent-primary)',
                  }}>
                    <span className="text-[9px] font-bold text-white drop-shadow-md">{f.contribution.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Quick Phase 2 → 3 link */}
          <div className="mt-4 pt-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
            <Database className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
            <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              Liens Phase 2 : {FEATURE_RISK_MAP.map(f => f.emoji).join(' ')}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Row: EWMA History + Forecast — version ouvrier */}
      <motion.div custom={5} variants={cardVariant} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Évolution du risque (simplifié) */}
        <div className="rounded-2xl p-4 glass glass-border animate-border-glow transition-all duration-300 hover:scale-[1.01] hover:brightness-110" style={{ borderColor: 'rgba(0,255,163,0.08)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
              <h3 className="font-display font-semibold text-[12px]" style={{ color: 'var(--text-primary)' }}>📈 Risque dans le temps</h3>
            </div>
            <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              {(['24h', '7j', '30j'] as const).map(r => (
                <button key={r} onClick={() => setTimeRange(r)}
                  className="text-[8px] font-semibold px-2 py-0.5 rounded-md cursor-pointer transition-all"
                  style={{ background: timeRange === r ? 'var(--accent-primary)' : 'transparent', color: timeRange === r ? '#0f172a' : 'var(--text-secondary)' }}>
                  {r}
                </button>
              ))}
            </div>
          </div>
            <div className="flex items-center gap-4 mb-3 text-xs flex-wrap">
              <span className="flex items-center gap-1">🟢 <span>OK (&lt;40)</span></span>
              <span className="flex items-center gap-1">🟡 <span>Surveiller (40-70)</span></span>
              <span className="flex items-center gap-1">🔴 <span>Alerte (≥70)</span></span>
            </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={history.slice(-(timeRange === '24h' ? 24 : timeRange === '7j' ? 28 : 30))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.1} strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="var(--text-secondary)" tick={{ fontSize: 11, fontWeight: 600 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} stroke="var(--text-secondary)" tick={{ fontSize: 11, fontWeight: 600 }} tickLine={false} axisLine={false} />
              <ReferenceLine y={70} stroke="var(--accent-danger)" strokeWidth={1.5} strokeDasharray="4 4" />
              <ReferenceLine y={40} stroke="var(--accent-warning)" strokeWidth={1.5} strokeDasharray="4 4" />
              <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 600 }} />
              <Area type="monotone" dataKey="ewma" stroke="var(--accent-primary)" strokeWidth={2.5} fill="var(--accent-primary)" fillOpacity={0.08} dot={false} name="Tendance" isAnimationActive={true} animationDuration={800} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-between mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>💡 La ligne monte = le risque augmente</span>
            <span className="font-mono">{history.length} points</span>
          </div>
        </div>

        {/* Prévision (simplifié) */}
        <div className="rounded-2xl p-4 glass glass-border animate-border-glow transition-all duration-300 hover:scale-[1.01] hover:brightness-110" style={{ borderColor: 'rgba(255,45,120,0.08)' }}>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-3.5 w-3.5" style={{ color: 'var(--accent-warning)' }} />
            <h3 className="font-display font-semibold text-[12px]" style={{ color: 'var(--text-primary)' }}>🔮 Dans les prochains jours</h3>
          </div>
          {forecastChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={forecastChartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.1} strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--text-secondary)" tick={{ fontSize: 11, fontWeight: 600 }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} stroke="var(--text-secondary)" tick={{ fontSize: 11, fontWeight: 600 }} tickLine={false} axisLine={false} />
                <ReferenceLine y={70} stroke="var(--accent-danger)" strokeWidth={1.5} strokeDasharray="4 4" />
                <ReferenceLine y={40} stroke="var(--accent-warning)" strokeWidth={1.5} strokeDasharray="4 4" />
                <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 600 }} />
                <Area type="monotone" dataKey="upper" stroke="none" fill="var(--accent-warning)" fillOpacity={0.06} isAnimationActive={true} animationDuration={1000} />
                <Area type="monotone" dataKey="lower" stroke="none" fill="var(--accent-warning)" fillOpacity={0.06} isAnimationActive={true} animationDuration={1000} />
                <Line type="monotone" dataKey="predicted" stroke="var(--accent-warning)" strokeWidth={2.5} dot={false} name="Prévision" isAnimationActive={true} animationDuration={800} />
                <ReferenceLine y={riskScore} stroke="var(--accent-danger)" strokeWidth={1} strokeDasharray="4 4" label={{ value: 'Aujourd\'hui', fill: 'var(--text-secondary)', fontSize: 9 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-xs" style={{ color: 'var(--text-secondary)' }}>
              Pas assez de données
            </div>
          )}
          <div className="flex items-center justify-between mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>💡 Zone = marge d'erreur possible</span>
            <span className="flex items-center gap-1">
              Actuel: <strong className="text-sm" style={{ color: 'var(--accent-danger)' }}>{Math.round(riskScore)}</strong>
            </span>
          </div>
        </div>
      </motion.div>

      {/* Row: Cross-reference timeline + What-If + Simulate */}
      <motion.div custom={6} variants={cardVariant} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cross-reference: Phase 2 Anomaly + Phase 3 Risk */}
        <div className="rounded-2xl p-4 glass glass-border" style={{ borderColor: 'rgba(255,45,120,0.12)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-3.5 w-3.5" style={{ color: 'var(--accent-danger)' }} />
            <h3 className="font-display font-semibold text-[12px]" style={{ color: 'var(--text-primary)' }}>📊 Lien Anomalie → Risque</h3>
            <span className="ml-auto text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent-success) 12%, transparent)', color: 'var(--accent-success)' }}>
              Phase 2 + 3
            </span>
          </div>
          {crossRefData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={crossRefData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.1} strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="var(--text-secondary)" tick={{ fontSize: 10, fontWeight: 600 }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} stroke="var(--text-secondary)" tick={{ fontSize: 10, fontWeight: 600 }} tickLine={false} axisLine={false} />
                <ReferenceLine y={70} stroke="var(--accent-danger)" strokeWidth={1.5} strokeDasharray="4 4" />
                <ReferenceLine y={40} stroke="var(--accent-warning)" strokeWidth={1.5} strokeDasharray="4 4" />
                <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, fontWeight: 600 }} />
                <Area type="monotone" dataKey="risque" stroke="var(--accent-danger)" strokeWidth={2.5} fill="var(--accent-danger)" fillOpacity={0.08} dot={false} name="Risque réel" isAnimationActive={true} animationDuration={900} />
                <Line type="monotone" dataKey="anomalie" stroke="var(--accent-primary)" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Anomalie détectée" isAnimationActive={true} animationDuration={900} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-xs" style={{ color: 'var(--text-secondary)' }}>
              Pas assez de données pour le croisement
            </div>
          )}
          <div className="flex items-center justify-between mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="flex items-center gap-3">
              <span><span style={{ color: 'var(--accent-danger)' }}>━</span> Risque réel</span>
              <span><span style={{ color: 'var(--accent-primary)' }}>╌</span> Anomalie Phase 2</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,45,120,0.12)', color: 'var(--accent-danger)' }}>🔴 ≥70</span>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.12)', color: 'var(--accent-warning)' }}>🟡 40-70</span>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--accent-success)' }}>🟢 &lt;40</span>
            </span>
          </div>
        </div>

        {/* What-If */}
        <div className="rounded-2xl p-4 glass glass-border" style={{ borderColor: 'rgba(34,197,94,0.08)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Sliders className="h-3.5 w-3.5" style={{ color: 'var(--accent-success)' }} />
            <h3 className="font-display font-semibold text-[12px]" style={{ color: 'var(--text-primary)' }}>🎯 Et si on agissait ?</h3>
          </div>
          <div className="space-y-3">
            {whatIfScenarios.length > 0 ? whatIfScenarios.map((s, i) => (
              <div key={i} className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{s.scenario}</span>
                  <span className="text-sm font-bold font-mono" style={{
                    color: s.risk_reduction > 20 ? 'var(--accent-success)' : s.risk_reduction > 10 ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  }}>
                    -{s.risk_reduction.toFixed(0)} pts
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span>Actuel: <strong className="text-sm">{Math.round(s.current_risk)}</strong></span>
                  <span>→</span>
                  <span>Après: <strong className="text-sm" style={{ color: s.predicted_risk < 40 ? 'var(--accent-success)' : 'var(--accent-warning)' }}>{Math.round(s.predicted_risk)}</strong></span>
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)' }}>{s.confidence}</span>
                </div>
              </div>
            )) : (
              <div className="flex items-center justify-center h-[80px] text-xs" style={{ color: 'var(--text-secondary)' }}>
                Aucun scénario disponible
              </div>
            )}
          </div>
        </div>

        {/* Vulnerability Simulation */}
        <div className="rounded-2xl p-4 glass glass-border" style={{ borderColor: 'rgba(168,85,247,0.08)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Lock className="h-4 w-4" style={{ color: 'var(--accent-danger)' }} />
            <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>🛡️ Simulation d'attaque</h3>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 mb-3">
              <select value={selectedAttack} onChange={e => setSelectedAttack(e.target.value)}
                className="flex-1 text-xs px-3 py-2 rounded-xl border outline-none cursor-pointer"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                {attackOptions.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            {simulateResult.length > 0 ? simulateResult.map((s, i) => (
              <div key={i} className="rounded-xl border p-4" style={{ background: 'color-mix(in srgb, var(--accent-danger) 6%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-danger) 20%, transparent)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{s.scenario}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent-warning) 12%, transparent)', color: 'var(--accent-warning)' }}>
                    {s.confidence}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                      <span>Risque actuel: <strong className="text-sm">{Math.round(s.current_risk)}</strong></span>
                      <span>Risque prédit: <strong className="text-sm">{Math.round(s.predicted_risk)}</strong></span>
                    </div>
                    <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                      <div className="h-full rounded-full flex">
                        <div className="h-full" style={{ width: `${Math.min(s.current_risk, 100)}%`, background: 'var(--accent-success)' }} />
                        <div className="h-full" style={{ width: `${Math.max(0, Math.min(s.predicted_risk - s.current_risk, 100))}%`, background: 'var(--accent-danger)' }} />
                      </div>
                    </div>
                  </div>
                  <span className="font-display text-lg font-bold" style={{ color: s.risk_reduction > 20 ? 'var(--accent-danger)' : 'var(--accent-warning)' }}>
                    +{Math.round(s.risk_reduction)}
                  </span>
                </div>
              </div>
            )) : (
              <div className="flex items-center justify-center h-[80px] text-xs" style={{ color: 'var(--text-secondary)' }}>
                Lancez une simulation
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Row: CVE + Correlation + Factor detail */}
      <motion.div custom={7} variants={cardVariant} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
        {/* CVE Intelligence */}
        <div className="rounded-2xl p-4 glass glass-border animate-border-glow transition-all duration-300 hover:scale-[1.01] hover:brightness-110" style={{ borderColor: 'rgba(255,45,120,0.08)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileWarning className="h-3.5 w-3.5" style={{ color: 'var(--accent-danger)' }} />
              <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>Intelligence CVEs</h3>
            </div>
            {cveList.length > 0 && (
              <div className="flex items-center gap-1.5">
                {['critical', 'high', 'medium', 'low'].map(s => {
                  const count = cveList.filter(c => c.severity === s).length;
                  return count > 0 ? (
                    <span key={s} className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${severityColor(s)} 12%, transparent)`, color: severityColor(s) }}>
                      {s.slice(0, 3).toUpperCase()} {count}
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </div>
          <div className="space-y-2 max-h-[260px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {cveList.length > 0 ? cveList.map((cve) => (
              <div key={cve.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: severityColor(cve.severity) }} />
                <span className="font-mono text-[10px] font-semibold w-28 shrink-0" style={{ color: 'var(--text-primary)' }}>{cve.id}</span>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0"
                  style={{ background: `color-mix(in srgb, ${severityColor(cve.severity)} 12%, transparent)`, color: severityColor(cve.severity) }}>
                  {severityBadge(cve.severity)}
                </span>
                <span className="font-mono text-[10px] w-8 text-center shrink-0" style={{ color: 'var(--text-secondary)' }}>{cve.score.toFixed(1)}</span>
                <span className="text-[10px] truncate flex-1" style={{ color: 'var(--text-secondary)' }}>{cve.description}</span>
                <span className="text-[9px] font-mono shrink-0" style={{ color: 'var(--text-primary)' }}>{cve.affected}</span>
              </div>
            )) : (
              <div className="flex items-center justify-center h-[200px] text-xs" style={{ color: 'var(--text-secondary)' }}>
                Aucune CVE pour cet équipement
              </div>
            )}
          </div>
        </div>

        {/* Factor Details + Correlation */}
        <div className="space-y-4">
          {/* Factor Details */}
          <div className="rounded-2xl p-4 glass glass-border animate-border-glow transition-all duration-300 hover:scale-[1.01] hover:brightness-110" style={{ borderColor: 'rgba(0,255,163,0.08)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Database className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
              <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>Détail des Facteurs</h3>
              {selectedFeature && (
                <span className="ml-auto text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,255,163,0.1)', color: 'var(--accent-success)' }}>
                  ↳ feature sélectionnée
                </span>
              )}
            </div>
            <div className="space-y-2">
              {factorEntries.map((f) => {
                const isHighlighted = selectedFeature
                  ? FEATURE_RISK_MAP.find(m => m.riskFactor === f.key && m.feature === selectedFeature)
                  : null;
                return (
                  <div key={f.key} className={`transition-all ${isHighlighted ? 'scale-[1.02]' : ''}`}
                    style={{
                      padding: isHighlighted ? '4px 8px' : '0',
                      borderRadius: isHighlighted ? 10 : 0,
                      background: isHighlighted ? 'color-mix(in srgb, var(--accent-primary) 8%, transparent)' : 'transparent',
                    }}>
                    <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: 'var(--text-primary)' }}>
                      <span>
                        {isHighlighted && <span className="mr-1">▶</span>}
                        {f.label}
                        {isHighlighted && <span className="ml-1 text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,255,163,0.15)', color: 'var(--accent-success)' }}>Phase 2</span>}
                      </span>
                      <span className="font-mono font-semibold text-xs" style={{ color: f.score >= 70 ? 'var(--accent-danger)' : f.score >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)' }}>
                        {f.score.toFixed(0)} <span className="text-[8px]" style={{ color: 'var(--text-secondary)' }}>/100</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${f.score}%`, background: f.score >= 70 ? 'var(--accent-danger)' : f.score >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)' }} />
                    </div>
                    {isHighlighted && (
                      <div className="text-[8px] mt-0.5 italic" style={{ color: 'var(--accent-primary)' }}>
                        ← lié à la feature {FEATURE_RISK_MAP.find(m => m.feature === selectedFeature)?.emoji} {FEATURE_RISK_MAP.find(m => m.feature === selectedFeature)?.label}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Correlation mini */}
          {correlationData.length > 0 && (
            <div className="rounded-2xl p-4 glass glass-border" style={{ borderColor: 'rgba(168,85,247,0.08)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Orbit className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} />
                <h3 className="font-display font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>Corrélation</h3>
              </div>
              <div className="space-y-1.5">
                {correlationData.slice(0, 8).map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-[9px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    <span className="truncate max-w-[80px]">{c.source}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                      <div className="h-full rounded-full" style={{ width: `${c.value}%`, background: c.color }} />
                    </div>
                    <span className="truncate max-w-[80px] text-right">{c.target}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* LLM Report Modal */}
      {llmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setLlmOpen(false); }}>
          <div className="rounded-2xl border w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col glass glass-border-strong"
            style={{ borderColor: 'rgba(168,85,247,0.2)' }}>
            <div className="flex items-center justify-between p-5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-purple) 20%, transparent), color-mix(in srgb, var(--accent-primary) 20%, transparent))' }}>
                  <Brain className="h-5 w-5" style={{ color: 'var(--accent-purple)' }} />
                </div>
                <div>
                  <h2 className="font-display font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Rapport LLM — Analyse des Risques</h2>
                  <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{device?.name} · Score {Math.round(riskScore)}/100</div>
                </div>
              </div>
              <button onClick={() => setLlmOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center border cursor-pointer"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <XCircle className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Score Risque', value: `${Math.round(riskScore)}/100`, color: riskScore >= 70 ? 'var(--accent-danger)' : 'var(--accent-warning)' },
                  { label: 'Tendance', value: trend, color: trend === 'rapidly_increasing' ? 'var(--accent-danger)' : 'var(--accent-success)' },
                  { label: 'CVEs critiques', value: `${cveList.filter(c => c.severity === 'critical').length}`, color: 'var(--accent-danger)' },
                ].map((s, i) => (
                  <div key={i} className="p-3 rounded-xl transition-all hover:scale-[1.03] hover:brightness-110" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div className="text-[9px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
                    <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{i === 0 ? <AnimatedCounter value={riskScore} suffix='/100' /> : s.value}</div>
                  </div>
                ))}
              </div>
              <button onClick={generateLlmReport} disabled={llmLoading}
                className="w-full py-3 rounded-xl text-xs font-bold border cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-primary))', borderColor: 'transparent', color: '#fff' }}>
                {llmLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Génération en cours...</> : <><Sparkles className="h-3.5 w-3.5" /> Générer le Rapport LLM</>}
              </button>
              {llmReport && (
                <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2 p-3 text-xs border-b" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                    <FileText className="h-3.5 w-3.5" />
                    <span>Rapport d'analyse · <strong style={{ color: 'var(--text-primary)' }}>{device?.name}</strong></span>
                  </div>
                  <div className="p-4 text-xs leading-relaxed max-h-80 overflow-y-auto" style={{ color: 'var(--text-secondary)', lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>
                    {llmReport}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </PhaseShell>
  );
}
