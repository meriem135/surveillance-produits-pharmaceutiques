import { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, TrendingUp, TrendingDown, AlertTriangle,
  Server, XCircle, Zap, Target, Brain, Gauge,
  BarChart3, ArrowRight, Info, Box, RefreshCw, FileWarning,
  Clock, FileText, Download, CheckCircle2, Loader2
} from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  ResponsiveContainer, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, ComposedChart, Line,
  ReferenceLine
} from 'recharts';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type TimeRange = '24h' | '7j' | '30j' | '1an';

interface RiskFactor {
  name: string;         // human label
  key: string;          // machine key
  score: number;        // 0–100
  weight: number;       // relative importance
  direction: 'higher' | 'lower';
  description: string;
}

interface RiskHistoryPoint {
  time: string;
  ewma: number;
  raw: number;
  upperBand?: number;
  lowerBand?: number;
  is_anomaly?: boolean;
}

interface WhatIfAction {
  id: string;
  label: string;
  icon?: typeof Zap;
  impact: number;       // delta on overall score (-20 … +20)
  description: string;
  color: string;
}

interface CveItem {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  score: number;        // CVSS 0–10
  description: string;
  affected: string;
  status: 'open' | 'mitigated' | 'patched';
}

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface DeviceOption {
  id: string;
  name: string;
  device_type: string;
  risk_score: number;
  status: string;
}

interface RiskPanelProps {
  riskScore?: number;
  prevRiskScore?: number;
  factors?: RiskFactor[];
  history?: RiskHistoryPoint[];
  whatIfActions?: WhatIfAction[];
  cveList?: CveItem[];
  loading?: boolean;
  error?: string | null;
  devices?: DeviceOption[];
  selectedDevice?: DeviceOption | null;
  onSelectDevice?: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Time range config                                                 */
/* ------------------------------------------------------------------ */

const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '7j',  label: '7 jours' },
  { key: '30j', label: '30 jours' },
  { key: '1an', label: '1 an' },
];

/* ------------------------------------------------------------------ */
/*  Mock data generators per range                                    */
/* ------------------------------------------------------------------ */

function generateHistory(range: TimeRange): RiskHistoryPoint[] {
  const seeds: Record<TimeRange, { n: number; ewmaBase: number; rawBase: number; variance: number; labelFn: (i: number) => string }> = {
    '24h': { n: 24, ewmaBase: 38, rawBase: 40, variance: 14, labelFn: (i) => `${String(i).padStart(2, '0')}:00` },
    '7j':  { n: 28, ewmaBase: 40, rawBase: 42, variance: 10, labelFn: (i) => `J${Math.floor(i / 4) + 1} ${(i % 4) * 6}h` },
    '30j': { n: 30, ewmaBase: 42, rawBase: 44, variance: 7,  labelFn: (i) => `J${i + 1}` },
    '1an': { n: 52, ewmaBase: 44, rawBase: 46, variance: 5,  labelFn: (i) => `S${i + 1}` },
  };

  const cfg = seeds[range];
  const points: RiskHistoryPoint[] = [];
  let ewma = cfg.ewmaBase;

  for (let i = 0; i < cfg.n; i++) {
    const trend = Math.sin((i / cfg.n) * Math.PI * 2) * (cfg.variance * 0.3);
    const spike = Math.random() < 0.08 ? 12 + Math.random() * 10 : 0;
    const raw = Math.max(0, cfg.rawBase + trend + (Math.random() - 0.5) * cfg.variance + spike);
    ewma = 0.94 * ewma + 0.06 * raw;
    const band = cfg.variance * 0.7 + Math.abs(raw - ewma) * 0.5;
    points.push({
      time: cfg.labelFn(i),
      ewma: Math.round(ewma * 10) / 10,
      raw: Math.round(raw * 10) / 10,
      upperBand: Math.round((ewma + band) * 10) / 10,
      lowerBand: Math.max(0, Math.round((ewma - band) * 10) / 10),
      is_anomaly: spike > 10 || (i > 1 && Math.abs(raw - points[i - 1].raw) > cfg.variance * 0.8),
    });
  }
  return points;
}

function generateFactors(range: TimeRange): RiskFactor[] {
  const multiplier = range === '24h' ? 1 : range === '7j' ? 0.95 : range === '30j' ? 0.92 : 0.88;
  const base: RiskFactor[] = [
    { name: 'Vulnérabilités logicielles', key: 'software_vulns',            score: 72, weight: 0.30, direction: 'higher', description: 'CVEs non patchés sur les composants critiques' },
    { name: 'Anomalies comportementales', key: 'behavioral_anomalies',       score: 34, weight: 0.25, direction: 'higher', description: 'Écarts détectés par l’Isolation Forest' },
    { name: 'Score de normalité',         key: 'normality_score',            score: 82, weight: 0.20, direction: 'lower',  description: 'Conformité au profil comportemental attendu' },
    { name: 'Exposition réseau',          key: 'network_exposure',           score: 58, weight: 0.15, direction: 'higher', description: 'Surface d’attaque exposée sur le bus OT' },
    { name: 'Volatilité EWMA',            key: 'ewma_volatility',            score: 41, weight: 0.10, direction: 'higher', description: 'Dérive récente du risque lissé' },
  ];
  return base.map((f) => {
    const drift = (Math.random() - 0.5) * 10 * (1 - multiplier);
    let adjusted = Math.round((f.score - (100 - f.score) * (1 - multiplier) + drift) * 10) / 10;
    adjusted = Math.max(0, Math.min(100, adjusted));
    if (f.direction === 'lower') adjusted = Math.min(adjusted, 85);
    return { ...f, score: adjusted };
  });
}

const DEFAULT_WHATIF: WhatIfAction[] = [
  { id: 'patch',    label: 'PATCH CRIT',    icon: Zap,        impact: -18, color: 'var(--accent-success)', description: 'Appliquer les correctifs de sécurité sur les 3 CVEs critiques' },
  { id: 'isolate',  label: 'ISOLER NŒUD',   icon: Box,        impact: -12, color: 'var(--accent-primary)', description: 'Isoler l’automate à risque du bus OT principal' },
  { id: 'rollback', label: 'ROLLBACK FW',   icon: RefreshCw,  impact: -8,  color: 'var(--accent-warning)', description: 'Revenir au firmware stable précédent (v2.3.1)' },
  { id: 'reset',    label: 'RÉINITIALISER',  icon: XCircle,    impact: -25, color: 'var(--accent-danger)',  description: 'Réinitialisation complète avec perte de données court terme' },
];

const DEFAULT_CVE: CveItem[] = [
  { id: 'CVE-2025-3842', severity: 'critical', score: 9.8, description: 'Exécution de code à distance dans le service OPC-UA',                affected: 'Automate #7',  status: 'open' },
  { id: 'CVE-2025-2911', severity: 'high',      score: 8.5, description: 'Déni de service sur le protocole Modbus/TCP',                         affected: 'BUS OT',       status: 'open' },
  { id: 'CVE-2025-1029', severity: 'high',      score: 7.9, description: 'Fuite d’informations via les logs de diagnostic',                     affected: 'Automate #3',  status: 'mitigated' },
  { id: 'CVE-2025-4103', severity: 'medium',    score: 5.6, description: 'Cross-site scripting dans l’IHM supervision',                          affected: 'IHM #2',       status: 'patched' },
  { id: 'CVE-2025-2234', severity: 'medium',    score: 4.2, description: 'Lecture non autorisée des paramètres de configuration',               affected: 'Automate #7',  status: 'open' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const severityColor = (s: string) =>
  s === 'critical' ? 'var(--accent-danger)' : s === 'high' ? 'var(--accent-warning)' : s === 'medium' ? 'var(--accent-primary)' : 'var(--accent-success)';

const severityBadge = (s: string) => {
  const map = { critical: 'CRITIQUE', high: 'HAUTE', medium: 'MOYENNE', low: 'BASSE' };
  return map[s as keyof typeof map] ?? s;
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

/** Circular risk gauge */
function RiskGauge({ score, prevScore }: { score: number; prevScore?: number }) {
  const color = score >= 70 ? 'var(--accent-danger)' : score >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)';

  return (
    <div className="relative flex flex-col items-center justify-center py-2">
      <svg width="160" height="120" viewBox="0 0 160 120" className="drop-shadow-lg">
        <path d="M 18 100 A 62 62 0 0 1 142 100" fill="none" stroke="oklch(0.28 0.02 250 / 0.3)" strokeWidth="10" strokeLinecap="round" />
        <path d="M 18 100 A 62 62 0 0 1 142 100" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 195} 195`} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
        <text x="80" y="78" textAnchor="middle" fill="var(--text-primary)" fontSize="28" fontFamily="Space Grotesk, sans-serif" fontWeight="700">
          {score.toFixed(0)}
        </text>
        <text x="80" y="98" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="JetBrains Mono, monospace" fontWeight="500">
          /100
        </text>
      </svg>
      {prevScore !== undefined && (
        <div className="flex items-center gap-1 text-[10px] mt-[-2px]"
          style={{ color: score > prevScore ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
          {score > prevScore ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {Math.abs(score - prevScore).toFixed(1)} pts
        </div>
      )}
    </div>
  );
}

/** Factor breakdown horizontal bars */
function FactorBreakdown({ factors }: { factors: RiskFactor[] }) {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  return (
    <div className="space-y-2.5">
      {factors.map((f) => {
        const contrib = (f.score * f.weight) / totalWeight;
        return (
          <div key={f.key}>
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="font-semibold truncate mr-2" style={{ color: 'var(--text-primary)' }}>{f.name}</span>
              <span className="tabular-nums font-mono" style={{ color: contrib > 40 ? 'var(--accent-danger)' : 'var(--text-secondary)' }}>
                {f.score.toFixed(0)}
                <span className="text-[8px]" style={{ color: 'var(--text-secondary)' }}> /100</span>
              </span>
            </div>
            <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
              <motion.div
                initial={{ width: 0 }} animate={{ width: `${f.score}%` }}
                transition={{ duration: 1, ease: 'easeOut' as const }}
                className="h-full rounded-full"
                style={{
                  background: f.score >= 70 ? 'var(--accent-danger)' : f.score >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)',
                  boxShadow: f.score >= 70 ? '0 0 8px var(--accent-danger)' : 'none',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** EWMA history chart */
function RiskHistoryChart({ data }: { data: RiskHistoryPoint[] }) {
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="oklch(0.30 0.03 250 / 0.2)" strokeDasharray="3 3" />
          <XAxis dataKey="time" stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 'auto']} stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}`} />
          <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} />
          <Area type="monotone" dataKey="upperBand" stroke="none" fill="oklch(0.66 0.22 20 / 0.06)" />
          <Area type="monotone" dataKey="lowerBand" stroke="none" fill="oklch(0.66 0.22 20 / 0.06)" />
          <Line type="monotone" dataKey="ewma" stroke="var(--accent-primary)" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="raw" stroke="oklch(0.65 0.02 230 / 0.4)" strokeWidth={1} dot={false} strokeDasharray="3 3" />
          {data.filter(d => d.is_anomaly).map((d, i) => (
            <ReferenceLine key={i} x={d.time} stroke="var(--accent-danger)" strokeWidth={1} strokeDasharray="4 2" />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** What-If action cards */
function WhatIfPanel({ actions }: { actions: WhatIfAction[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((a) => {
        const active = selected === a.id;
        const Icon = a.icon;
        return (
          <motion.button
            key={a.id}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setSelected(active ? null : a.id)}
            className="relative rounded-xl border p-3 text-left cursor-pointer transition-all duration-200"
            style={{
              background: active ? 'color-mix(in srgb, var(--accent-primary) 8%, var(--bg-panel))' : 'var(--bg-panel)',
              borderColor: active ? 'var(--accent-primary)' : 'var(--border)',
            }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ background: active ? 'color-mix(in srgb, var(--accent-primary) 20%, transparent)' : 'var(--bg-card)' }}>
                {Icon && <Icon className="h-3 w-3" style={{ color: a.color }} />}
              </div>
              <span className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>{a.label}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`font-display text-lg font-bold ${a.impact < 0 ? '[color:var(--accent-success)]' : '[color:var(--accent-danger)]'}`}>
                {a.impact > 0 ? '+' : ''}{a.impact}
              </span>
              <span className="text-[9px]" style={{ color: 'var(--text-secondary)' }}>pts</span>
            </div>
            <AnimatePresence>
              {active && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden">
                  <div className="text-[9px] mt-1.5 pt-1.5 border-t" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>
                    {a.description}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </div>
  );
}

/** CVE table */
function CveTable({ cves }: { cves: CveItem[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      {cves.map((cve) => {
        const open = expanded === cve.id;
        return (
          <motion.div
            key={cve.id}
            layout="position"
            className="rounded-lg border overflow-hidden cursor-pointer"
            style={{ borderColor: open ? severityColor(cve.severity) : 'var(--border)', background: open ? 'color-mix(in srgb, var(--accent-primary) 3%, var(--bg-panel))' : 'var(--bg-panel)' }}
            onClick={() => setExpanded(open ? null : cve.id)}
          >
            <div className="flex items-center gap-2.5 px-3 py-2">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: severityColor(cve.severity) }} />
              <span className="font-mono text-[10px] font-semibold w-28 shrink-0" style={{ color: 'var(--text-primary)' }}>{cve.id}</span>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0"
                style={{
                  background: `color-mix(in srgb, ${severityColor(cve.severity)} 15%, transparent)`,
                  color: severityColor(cve.severity),
                }}>
                {severityBadge(cve.severity)}
              </span>
              <span className="font-mono text-[10px] w-8 text-center shrink-0" style={{ color: 'var(--text-secondary)' }}>{cve.score.toFixed(1)}</span>
              <span className="text-[10px] truncate flex-1 min-w-0" style={{ color: 'var(--text-secondary)' }}>{cve.description}</span>
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0`}
                style={{
                  background: cve.status === 'open' ? 'color-mix(in srgb, var(--accent-danger) 15%, transparent)' : 'color-mix(in srgb, var(--accent-success) 15%, transparent)',
                  color: cve.status === 'open' ? 'var(--accent-danger)' : 'var(--accent-success)',
                }}>
                {cve.status === 'open' ? 'Ouvert' : cve.status === 'mitigated' ? 'Atténué' : 'Corrigé'}
              </span>
              <Info className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--text-secondary)' }} />
            </div>
            <AnimatePresence>
              {open && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden">
                  <div className="px-3 pb-2 pt-1 border-t text-[10px] space-y-1" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                    <div><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Équipement :</span> {cve.affected}</div>
                    <div><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Statut :</span> {cve.status === 'open' ? 'Aucune action corrective appliquée' : cve.status === 'mitigated' ? 'Mesure d\'atténuation temporaire en place' : 'Correctif installé et vérifié'}</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export default function RiskPanel({
  riskScore: _riskScore,
  prevRiskScore: _prevRiskScore,
  factors: _factors,
  history: _history,
  whatIfActions = DEFAULT_WHATIF,
  cveList = DEFAULT_CVE,
  loading: externalLoading,
  error: externalError,
  devices,
  selectedDevice,
  onSelectDevice,
}: RiskPanelProps) {

  const containerRef = useRef<HTMLDivElement>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [animKey, setAnimKey] = useState(0);
  const [exportState, setExportState] = useState<'idle' | 'loading' | 'done'>('idle');

  const handleRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range);
    setAnimKey((k) => k + 1);
  }, []);

  const factors = useMemo(() => {
    if (_factors && _factors.length > 0) return _factors;
    return generateFactors(timeRange);
  }, [_factors, timeRange]);

  const history = useMemo(() => {
    if (_history && _history.length > 0) return _history;
    return generateHistory(timeRange);
  }, [_history, timeRange]);

  const riskScore = _riskScore ?? Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0));
  const prevRiskScore = _prevRiskScore ?? Math.round(riskScore - 6 + Math.random() * 12);

  const anomalyCount = history.filter(h => h.is_anomaly).length;
  const ewmaVolatility = Math.round(history.reduce((s, h) => s + Math.abs(h.ewma - h.raw), 0) / history.length);

  const rangeLabels: Record<TimeRange, string> = { '24h': '24 heures', '7j': '7 jours', '30j': '30 jours', '1an': '1 an' };

  const generatePdfReport = useCallback(async () => {
    if (!containerRef.current) return;
    setExportState('loading');
    try {
      const el = containerRef.current;
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: '#0a0e17',
        logging: false,
        allowTaint: false,
        useCORS: true,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a3');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = (canvas.height * pdfW) / canvas.width;
      let heightLeft = pdfH;
      let position = 0;
      const pageH = pdf.internal.pageSize.getHeight();

      pdf.addImage(imgData, 'PNG', 0, position, pdfW, pdfH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position -= pageH;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfW, pdfH);
        heightLeft -= pageH;
      }

      pdf.save(`rapport-risques-${timeRange}-${new Date().toISOString().slice(0, 10)}.pdf`);
      setExportState('done');
      setTimeout(() => setExportState('idle'), 2500);
    } catch {
      setExportState('idle');
    }
  }, [timeRange]);

  const waterfallData = useMemo(() => {
    const sorted = [...factors].sort((a, b) => b.weight - a.weight);
    let running = 50;
    return sorted.map((f) => {
      const contribution = (f.score / 100) * (f.weight * 100);
      const start = running;
      running += (contribution - 50 * f.weight) / 2;
      return { name: f.name, contribution, start, color: f.score >= 70 ? 'var(--accent-danger)' : f.score >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)' };
    });
  }, [factors]);

  const sectionAnim = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.5, ease: 'easeOut' as const } }),
  };

  return (
    <motion.div ref={containerRef} key={animKey} initial="hidden" animate="visible" className="space-y-4 relative">

      {/* ---- Header ---- */}
      <motion.div custom={0} variants={sectionAnim} className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent-danger) 15%, transparent)' }}>
            <Gauge className="h-4 w-4" style={{ color: 'var(--accent-danger)' }} />
          </div>
          <div>
            <h2 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              Analyse des risques · Phase 3
            </h2>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              Modèle EWMA · Matrice de risque · Simulation de scénarios
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Device selector (when API available) */}
          {devices && devices.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border px-2 py-1" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <Server className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
              <select
                value={selectedDevice?.id ?? ''}
                onChange={(e) => onSelectDevice?.(e.target.value)}
                className="text-[9px] font-semibold bg-transparent border-none outline-none cursor-pointer appearance-none"
                style={{ color: 'var(--text-primary)' }}
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id} style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)' }}>
                    {d.name} ({d.risk_score})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Time range selector */}
          <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <Clock className="h-3 w-3 ml-1.5" style={{ color: 'var(--text-secondary)' }} />
            {TIME_RANGES.map((r) => (
              <motion.button
                key={r.key}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => handleRangeChange(r.key)}
                className="text-[9px] font-semibold px-2 py-1 rounded-md cursor-pointer transition-all"
                style={{
                  background: timeRange === r.key ? 'var(--accent-primary)' : 'transparent',
                  color: timeRange === r.key ? '#0f172a' : 'var(--text-secondary)',
                }}
              >
                {r.label}
              </motion.button>
            ))}
          </div>

          {/* Report button */}
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={generatePdfReport}
            disabled={exportState !== 'idle'}
            className="flex items-center gap-1.5 text-[9px] font-semibold px-3 py-1.5 rounded-lg border cursor-pointer transition-all"
            style={{
              background: exportState === 'done'
                ? 'color-mix(in srgb, var(--accent-success) 15%, transparent)'
                : 'color-mix(in srgb, var(--accent-danger) 10%, transparent)',
              borderColor: exportState === 'done' ? 'var(--accent-success)' : 'var(--accent-danger)',
              color: exportState === 'done' ? 'var(--accent-success)' : 'var(--accent-danger)',
            }}
          >
            {exportState === 'loading' ? <Loader2 className="h-3 w-3 animate-spin" /> :
             exportState === 'done' ? <CheckCircle2 className="h-3 w-3" /> :
             <FileText className="h-3 w-3" />}
            {exportState === 'loading' ? 'Génération...' :
             exportState === 'done' ? 'Rapport prêt ✓' :
             'Rapport PDF'}
          </motion.button>

          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: 'var(--accent-danger)' }}>
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            {anomalyCount} anomalies
          </span>
        </div>
      </motion.div>

      {/* ---- Report summary bar ---- */}
      <motion.div custom={1} variants={sectionAnim}
        className="flex items-center justify-between rounded-lg border px-4 py-2 text-[9px]"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
      >
        <div className="flex items-center gap-4">
          <span className="font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
            Rapport · {rangeLabels[timeRange]}
          </span>
          <span>Score risque : <strong style={{ color: riskScore >= 70 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>{riskScore}/100</strong></span>
          <span>Anomalies : <strong style={{ color: anomalyCount > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>{anomalyCount}</strong></span>
          <span>Volatilité EWMA : <strong style={{ color: 'var(--accent-primary)' }}>{ewmaVolatility}%</strong></span>
          <span>CVEs ouvertes : <strong style={{ color: cveList.filter(c => c.status === 'open').length > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
            {cveList.filter(c => c.status === 'open').length}
          </strong></span>
        </div>
        <Download className="h-3 w-3 opacity-50" />
      </motion.div>

      {/* ---- Loading / Error states ---- */}
      {externalLoading && (
        <motion.div custom={2} variants={sectionAnim}
          className="flex items-center justify-center gap-3 rounded-xl border p-8 text-xs"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--accent-primary)' }} />
          Chargement des données de risque...
        </motion.div>
      )}

      {externalError && !externalLoading && (
        <motion.div custom={2} variants={sectionAnim}
          className="flex items-center justify-center gap-2 rounded-xl border p-6 text-xs"
          style={{ background: 'color-mix(in srgb, var(--accent-warning) 8%, var(--bg-panel))', borderColor: 'var(--accent-warning)', color: 'var(--accent-warning)' }}
        >
          <AlertTriangle className="h-4 w-4" />
          {externalError} — Données simulées affichées
        </motion.div>
      )}

      {/* ---- Row 2: Gauge + Factor breakdown + EWMA chart ---- */}
      <motion.div custom={3} variants={sectionAnim} className="grid grid-cols-1 lg:grid-cols-[220px_1fr_1fr] gap-4">

        {/* Risk score gauge */}
        <div className="rounded-xl border p-4 flex flex-col items-center" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Score de risque global</div>
          <RiskGauge score={riskScore} prevScore={prevRiskScore} />
          <div className="text-[9px] text-center mt-1 px-2" style={{ color: 'var(--text-secondary)' }}>
            {riskScore >= 70 ? 'Risque critique — action immédiate requise' :
             riskScore >= 40 ? 'Risque modéré — surveillance renforcée' :
             'Risque faible — fonctionnement nominal'}
          </div>
        </div>

        {/* Factor breakdown */}
        <div className="rounded-xl border p-4" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
            <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>Décomposition des risques</h3>
          </div>
          <FactorBreakdown factors={factors} />
        </div>

        {/* EWMA history */}
        <div className="rounded-xl border p-4" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
              <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>Volatilité EWMA</h3>
            </div>
            <div className="flex items-center gap-2 text-[8px] font-mono">
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded" style={{ background: 'var(--accent-primary)' }} /> EWMA</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded" style={{ background: 'oklch(0.65 0.02 230 / 0.4)' }} /> Brut</span>
            </div>
          </div>
          <RiskHistoryChart data={history} />
        </div>

      </motion.div>

      {/* ---- Row 3: What-If + CVE ---- */}
      <motion.div custom={4} variants={sectionAnim} className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-4">

        {/* What-If simulation */}
        <div className="rounded-xl border p-4" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-3.5 w-3.5" style={{ color: 'var(--accent-warning)' }} />
            <div>
              <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>Analyse What-If</h3>
              <div className="text-[8px] font-mono" style={{ color: 'var(--text-secondary)' }}>Simulation d’impact des actions correctives</div>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-3 px-2 py-1.5 rounded-lg text-[10px]" style={{ background: 'var(--bg-card)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Score actuel</span>
            <span className="font-display text-lg font-bold" style={{ color: riskScore >= 70 ? 'var(--accent-danger)' : 'var(--text-primary)' }}>
              {riskScore.toFixed(0)}
            </span>
            <ArrowRight className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Projeté</span>
            <span className="font-display text-lg font-bold" style={{ color: 'var(--accent-success)' }}>
              {(riskScore - 18).toFixed(0)}
            </span>
            <span className="text-[9px]" style={{ color: 'var(--accent-success)' }}>–18 pts</span>
          </div>

          <WhatIfPanel actions={whatIfActions} />
        </div>

        {/* CVE summary */}
        <div className="rounded-xl border p-4" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileWarning className="h-3.5 w-3.5" style={{ color: 'var(--accent-danger)' }} />
              <div>
                <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>Correspondance CVEs</h3>
                <div className="text-[8px] font-mono" style={{ color: 'var(--text-secondary)' }}>Vulnérabilités actives sur le périmètre OT</div>
              </div>
            </div>
            <span className="font-display text-lg font-bold tabular-nums" style={{ color: cveList.filter(c => c.status === 'open').length > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
              {cveList.filter(c => c.status === 'open').length}
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>/{cveList.length} ouvertes</span>
            </span>
          </div>
          <CveTable cves={cveList} />
        </div>

      </motion.div>

      {/* ---- Row 4: Waterfall decomposition + Risk summary radar ---- */}
      <motion.div custom={5} variants={sectionAnim} className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">

        {/* Waterfall */}
        <div className="rounded-xl border p-4" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-3.5 w-3.5" style={{ color: 'var(--accent-purple)' }} />
            <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>Décomposition en cascade</h3>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfallData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} layout="vertical">
                <CartesianGrid stroke="oklch(0.30 0.03 250 / 0.15)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={100} />
                <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 10 }}
                  formatter={(v: unknown) => [v !== undefined ? `${Number(v).toFixed(1)} pts` : '0 pts', 'Contribution']} />
                <Bar dataKey="contribution" radius={[0, 3, 3, 0]} maxBarSize={18}>
                  {waterfallData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Risk summary metrics */}
        <div className="rounded-xl border p-4" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-3.5 w-3.5" style={{ color: 'var(--accent-success)' }} />
            <h3 className="font-display font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>Métriques clés</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Score risque', value: `${riskScore.toFixed(0)}/100`, color: riskScore >= 70 ? 'var(--accent-danger)' : riskScore >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)' },
              { label: 'Volatilité EWMA', value: `${ewmaVolatility}%`, color: 'var(--accent-primary)' },
              { label: 'CVEs ouvertes', value: cveList.filter(c => c.status === 'open').length.toString(), color: 'var(--accent-danger)' },
              { label: 'Pondération max', value: `${(Math.max(...factors.map(f => f.weight)) * 100).toFixed(0)}%`, color: 'var(--accent-warning)' },
              { label: 'Anomalies EWMA', value: anomalyCount.toString(), color: 'var(--accent-purple)' },
              { label: 'Facteurs critiques', value: factors.filter(f => f.score >= 70).length.toString(), color: 'var(--accent-danger)' },
            ].map((m) => (
              <div key={m.label} className="rounded-lg p-2.5" style={{ background: 'var(--bg-card)' }}>
                <div className="text-[8px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-secondary)' }}>{m.label}</div>
                <div className="font-display text-sm font-bold" style={{ color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>

      </motion.div>

    </motion.div>
  );
}
