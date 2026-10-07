import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Database, ShieldAlert, Target, Calendar,
  Clock, Cpu, Brain, Activity, Gauge, AlertTriangle, CheckCircle2,
  Sparkles, Loader2, RefreshCw, Bug, Layers, Thermometer, Snowflake, CloudSun,
} from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { authHeaders } from '../lib/auth';
import DatasetOverview from './DatasetOverview';

const API = '/api/v1';

// ═══════════════════════════════════════════════════════════
// TYPES — KPIs réels du dataset d'entrainement + modele
// ═══════════════════════════════════════════════════════════

interface SensorStat { min: number; max: number; mean: number; std: number; median: number }
interface NormalVsAttack { sensor: string; normal_mean: number; attack_mean: number; delta: number }
interface PeakInfo { label: string; attack: number; attack_pct: number; share_of_dataset: number }
interface MonthlyRow { month: number; label: string; normal: number; attack: number; total: number; attack_pct: number }
interface HourlyRow { hour: number; label: string; normal: number; attack: number; total: number }
interface SeasonalRow { season: string; label: string; normal: number; attack: number; total: number }
interface AttackDetection { attack_type: string; attack_id: string; n_total: number; n_detected: number; detection_rate: number; avg_score: number }
interface ShapFeature { feature: string; shap_importance: number }

interface DatasetKpis {
  filename: string;
  total: number; normal: number; attack: number;
  attack_pct: number; normal_pct: number; imbalance_ratio: number;
  duration_days: number; start: string; end: string; interval_min: number;
  sensors: string[]; features: number;
  sensor_stats: Record<string, SensorStat>;
  normal_vs_attack: NormalVsAttack[];
  peaks: { month: PeakInfo | null; hour: PeakInfo | null; season: PeakInfo | null };
  seasonal: SeasonalRow[];
  monthly: MonthlyRow[];
  hourly: HourlyRow[];
  profiles: { hourly_attack_pct: number[]; seasonal_attack_pct: number[] };
}

interface TrainingKpis {
  available: boolean;
  best_model: string | null;
  metrics: null | {
    precision: number; recall: number; f1: number; roc_auc: number; ap: number; fpr: number;
    tp: number; fp: number; fn: number; tn: number; threshold?: number; cv_roc_auc?: number;
  };
  split: null | { n_train?: number; n_val?: number; n_test?: number; n_attack_val?: number; n_attack_test?: number };
  trained_at: string | null;
  attack_detection: AttackDetection[];
  shap_top_features: ShapFeature[];
  n_total_samples?: number | null;
  n_normal_samples?: number | null;
  n_attack_samples?: number | null;
}

interface KpiResponse {
  dataset: DatasetKpis;
  training: TrainingKpis;
  generated_at?: string;
}

// ═══════════════════════════════════════════════════════════
// HELPERS & META
// ═══════════════════════════════════════════════════════════

const SENSOR_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  weather: { label: 'Weather', color: '#38BDF8', icon: CloudSun },
  fridge: { label: 'Fridge', color: '#00E676', icon: Snowflake },
  thermostat: { label: 'Thermostat', color: '#FF9100', icon: Thermometer },
};

const staggerItem = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

function SectionTitle({ children, color = 'var(--accent-primary)' }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-4 rounded-full" style={{ background: color }} />
      <h2 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>{children}</h2>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={`rounded-2xl p-5 ${className}`}
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

interface KpiCardProps {
  label: string;
  value: string | number;
  color: string;
  icon: React.ReactNode;
  sub?: string;
  delay?: number;
}

function KpiCard({ label, value, color, icon, sub, delay = 0 }: KpiCardProps) {
  return (
    <motion.div
      variants={staggerItem}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.4, delay }}
      className="rounded-2xl p-4 relative overflow-hidden group"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `linear-gradient(135deg, ${color}08 0%, transparent 50%)` }} />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15`, color }}>
            {icon}
          </div>
        </div>
        <div className="font-display text-xl font-black tracking-tight" style={{ color }}>{value}</div>
        <div className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label}</div>
        {sub && <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--text-muted, var(--text-secondary))' }}>{sub}</div>}
      </div>
    </motion.div>
  );
}

interface TooltipItem { color: string; name: string; value: number }
function ChartTip({ active, payload, label, format }: { active?: boolean; payload?: TooltipItem[]; label?: string; format?: 'number' | 'percent' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
      {label && <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>
            {format === 'percent' ? `${p.value.toFixed(1)}%` : p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function PctTip({ active, payload, label }: { active?: boolean; payload?: TooltipItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
      {label && <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>
            {typeof p.value === 'number' ? `${(p.value * 1).toFixed(2)}%` : String(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProgressBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  );
}

function fmt(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(digits)}`;
}

// ═══════════════════════════════════════════════════════════
// TAB: KPIs (valeurs réelles du dataset + modele)
// ═══════════════════════════════════════════════════════════

function TabKpis({ data }: { data: KpiResponse }) {
  const d = data.dataset;
  const t = data.training;
  const m = t.metrics;

  const attackColor = d.attack_pct >= 10 ? '#EF4444' : d.attack_pct >= 5 ? '#F97316' : '#22C55E';

  const sensorChartData = useMemo(() =>
    d.normal_vs_attack.map(n => ({
      name: SENSOR_META[n.sensor]?.label || n.sensor,
      Normal: n.normal_mean,
      Attaque: n.attack_mean,
      delta: n.delta,
    })), [d.normal_vs_attack]);

  const hourlyData = useMemo(() =>
    d.hourly.map(h => ({
      label: h.label,
      pct: h.total > 0 ? +((h.attack / h.total) * 100).toFixed(2) : 0,
    })), [d.hourly]);

  const monthlyData = useMemo(() =>
    d.monthly.map(mn => ({ label: mn.label, attack: mn.attack, attack_pct: mn.attack_pct, normal: mn.normal })),
  [d.monthly]);

  const shapData = useMemo(() =>
    (t.shap_top_features || []).slice(0, 8).map(f => ({ name: f.feature.length > 22 ? f.feature.slice(0, 22) + '…' : f.feature, importance: f.shap_importance })),
  [t.shap_top_features]);

  const avgDetection = useMemo(() => {
    if (!t.attack_detection.length) return 0;
    return t.attack_detection.reduce((s, a) => s + a.detection_rate, 0) / t.attack_detection.length;
  }, [t.attack_detection]);

  const splitRows = t.split ? [
    { label: 'Train (normales)', value: (t.split.n_train ?? 0), color: '#22C55E' },
    { label: 'Validation', value: (t.split.n_val ?? 0), color: '#F59E0B' },
    { label: 'Test', value: (t.split.n_test ?? 0), color: '#818cf8' },
  ] : [];

  const splitMax = Math.max(...splitRows.map(r => r.value), 1);

  return (
    <div className="space-y-5">
      {/* ── KPIs du dataset (valeurs calculées sur dataset_fusionne.csv) ── */}
      <SectionTitle color="#818cf8">Dataset d'entrainement — {d.filename}</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard label="Échantillons" value={d.total.toLocaleString()} color="#818cf8" icon={<Database className="w-4 h-4" />} delay={0} />
        <KpiCard label="Normaux" value={d.normal.toLocaleString()} color="#22C55E" icon={<CheckCircle2 className="w-4 h-4" />} sub={`${d.normal_pct.toFixed(1)}%`} delay={0.05} />
        <KpiCard label="Attaques" value={d.attack.toLocaleString()} color="#EF4444" icon={<AlertTriangle className="w-4 h-4" />} sub={`${d.attack_pct.toFixed(2)}%`} delay={0.1} />
        <KpiCard label="Taux d'attaque" value={`${d.attack_pct.toFixed(2)}%`} color={attackColor} icon={<Target className="w-4 h-4" />} sub={`≈ 1 attaque pour ${d.imbalance_ratio} normaux`} delay={0.15} />
        <KpiCard label="Durée" value={`${d.duration_days}j`} color="#F59E0B" icon={<Calendar className="w-4 h-4" />} sub={`${d.start} → ${d.end}`} delay={0.2} />
        <KpiCard label="Intervalle" value={`${d.interval_min} min`} color="#38BDF8" icon={<Clock className="w-4 h-4" />} delay={0.25} />
        <KpiCard label="Capteurs" value={d.sensors.length} color="#00E676" icon={<Cpu className="w-4 h-4" />} sub={d.sensors.join(', ')} delay={0.3} />
        <KpiCard label="Features ML" value={d.features} color="#A855F7" icon={<Brain className="w-4 h-4" />} sub="multivariées" delay={0.35} />
      </div>

      {/* ── Pics d'attaques ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: "Mois le plus attaqué", peak: d.peaks.month, color: '#EF4444' },
          { title: "Heure la plus attaquée", peak: d.peaks.hour, color: '#F59E0B' },
          { title: "Saison la plus attaquée", peak: d.peaks.season, color: '#A855F7' },
        ].map(({ title, peak, color }) => (
          <Card key={title}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{title}</div>
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: `${color}15`, color }}>
                <Sparkles className="w-3 h-3" />
              </div>
            </div>
            {peak ? (
              <>
                <div className="font-display text-2xl font-black" style={{ color }}>{peak.label}</div>
                <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {peak.attack.toLocaleString()} attaques — {peak.attack_pct.toFixed(1)}% de ce créneau · {peak.share_of_dataset.toFixed(1)}% du total
                </div>
                <div className="mt-2">
                  <ProgressBar value={peak.share_of_dataset} max={Math.max(...(([d.peaks.month, d.peaks.hour, d.peaks.season].filter(Boolean) as PeakInfo[]).map(p => p.share_of_dataset)), 1)} color={color} />
                </div>
              </>
            ) : (
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>—</div>
            )}
          </Card>
        ))}
      </div>

      {/* ── Répartition + profils ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <SectionTitle color="#EF4444">Répartition Normal / Attaque</SectionTitle>
          <div className="h-[220px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {/* Pourcentages dans la légende : des étiquettes autour de l'anneau débordaient de la carte. */}
                <Pie data={[
                  { name: `Normal ${d.normal_pct.toFixed(1)} %`, value: d.normal, color: '#22C55E' },
                  { name: `Attaque ${d.attack_pct.toFixed(1)} %`, value: d.attack, color: '#EF4444' },
                ]} cx="50%" cy="45%" innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value" nameKey="name">
                  {[{ color: '#22C55E' }, { color: '#EF4444' }].map((c, i) => (
                    <Cell key={i} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTip />} />
                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle color="#F59E0B">Attaques par mois (année simulée)</SectionTitle>
          <div className="h-[220px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ top: 10, right: 30, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const dRow = payload[0]?.payload;
                  return (
                    <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
                      <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{dRow?.label}</div>
                      <div className="text-[11px] font-mono" style={{ color: '#EF4444' }}>Attaques : {dRow?.attack}</div>
                      <div className="text-[11px] font-mono" style={{ color: '#22C55E' }}>Normal : {dRow?.normal}</div>
                      <div className="text-[11px] font-mono mt-1" style={{ color: '#A855F7' }}>% attaque : {dRow?.attack_pct}%</div>
                    </div>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
                <Bar yAxisId="left" dataKey="attack" name="Attaques" fill="#EF4444" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="attack_pct" name="% attaque" stroke="#A855F7" strokeWidth={2.5} dot={{ r: 3, fill: '#A855F7', strokeWidth: 0 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <SectionTitle color="#00E5FF">Profil d'attaque par heure</SectionTitle>
          <div className="h-[200px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="hAtk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={3} />
                <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip content={<PctTip />} />
                <Area type="monotone" dataKey="pct" stroke="#EF4444" strokeWidth={2.5} fill="url(#hAtk)"
                  dot={false} activeDot={{ r: 5, fill: '#EF4444', strokeWidth: 2, stroke: 'var(--bg-base)' }} name="Attaques %" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <SectionTitle color="#22C55E">Température moyenne — Normal vs Attaque</SectionTitle>
          <div className="h-[200px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sensorChartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} />
                <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
                <Bar dataKey="Normal" name="Normal" fill="#22C55E" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Attaque" name="Attaque" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ── Statistiques par capteur ── */}
      <div>
        <SectionTitle color="#00E676">Statistiques par capteur</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {d.sensors.map(k => {
            const meta = SENSOR_META[k] || { label: k, color: '#818cf8', icon: Database };
            const Icon = meta.icon;
            const s = d.sensor_stats[k];
            const nv = d.normal_vs_attack.find(n => n.sensor === k);
            if (!s) return null;
            return (
              <Card key={k}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}15` }}>
                    <Icon className="w-4 h-4" style={{ color: meta.color }} />
                  </div>
                  <div className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>{meta.label}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="space-y-1" style={{ color: 'var(--text-secondary)' }}>
                    <div className="flex justify-between"><span>Min</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{s.min}</span></div>
                    <div className="flex justify-between"><span>Max</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{s.max}</span></div>
                    <div className="flex justify-between"><span>Moyenne</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{s.mean}</span></div>
                    <div className="flex justify-between"><span>σ</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{s.std}</span></div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono font-bold" style={{ color: meta.color }}>N vs A</div>
                    <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                      <span>N</span><span className="font-mono" style={{ color: '#22C55E' }}>{nv?.normal_mean}</span>
                    </div>
                    <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                      <span>A</span><span className="font-mono" style={{ color: '#EF4444' }}>{nv?.attack_mean}</span>
                    </div>
                    <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                      <span>Δ</span><span className="font-mono font-bold" style={{ color: '#A855F7' }}>{nv?.delta}</span>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ── Performance du modele (valeurs réelles d'entrainement) ── */}
      <SectionTitle color="#F59E0B">Performance du modele entraîné</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {t.available && m ? (
          <>
            <KpiCard label="Modèle" value={t.best_model || '—'} color="#F59E0B" icon={<Brain className="w-4 h-4" />} delay={0} />
            <KpiCard label="F1 Score" value={`${fmt(m.f1)}%`} color="#22C55E" icon={<Target className="w-4 h-4" />} delay={0.05} />
            <KpiCard label="ROC AUC" value={`${fmt(m.roc_auc)}%`} color="#A855F7" icon={<Activity className="w-4 h-4" />} delay={0.1} />
            <KpiCard label="Precision" value={`${fmt(m.precision)}%`} color="#38BDF8" icon={<Gauge className="w-4 h-4" />} delay={0.15} />
            <KpiCard label="Recall" value={`${fmt(m.recall)}%`} color="#00E676" icon={<Target className="w-4 h-4" />} delay={0.2} />
            <KpiCard label="Taux F.P." value={`${(m.fpr * 100).toFixed(2)}%`} color="#EF4444" icon={<ShieldAlert className="w-4 h-4" />} delay={0.25} />
            <KpiCard label="Détection attaques" value={`${avgDetection.toFixed(1)}%`} color="#F97316" icon={<AlertTriangle className="w-4 h-4" />} delay={0.3} />
            <KpiCard label="Attaques test" value={m.tp + m.fn} color="#DC2626" icon={<Bug className="w-4 h-4" />} sub={`${m.tp} détectées`} delay={0.35} />
          </>
        ) : (
          <Card className="md:col-span-2 lg:col-span-8">
            <div className="flex items-center gap-3 py-4" style={{ color: 'var(--text-secondary)' }}>
              <Brain className="w-5 h-5" />
              <span className="text-sm">Aucun modèle entraîné enregistré — lancez l'entraînement depuis l'onglet ML.</span>
            </div>
          </Card>
        )}
      </div>

      {t.available && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <SectionTitle color="#818cf8">Split train / validation / test</SectionTitle>
            <div className="space-y-3 mt-3">
              {splitRows.map(r => (
                <div key={r.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
                    <span className="text-xs font-mono font-black" style={{ color: r.color }}>{r.value.toLocaleString()}</span>
                  </div>
                  <ProgressBar value={r.value} max={splitMax} color={r.color} />
                </div>
              ))}
              {t.split?.n_attack_test !== undefined && (
                <div className="text-[10px] font-mono mt-2" style={{ color: 'var(--text-secondary)' }}>
                  {t.split.n_attack_test.toLocaleString()} attaques dans le test ({t.split.n_attack_val?.toLocaleString()} en validation)
                </div>
              )}
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <SectionTitle color="#00E5FF">Top features SHAP après entrainement</SectionTitle>
            <div className="h-[200px] mt-2">
              {shapData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={shapData} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(4)} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} width={120} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="importance" name="SHAP" fill="#00E5FF" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--text-secondary)' }}>Aucune donnée SHAP</div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════

type TabId = 'kpis' | 'dataset';

const TABS: { id: TabId; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'kpis', label: 'KPIs', icon: <Gauge className="w-4 h-4" />, color: '#818cf8' },
  { id: 'dataset', label: 'Dataset', icon: <Layers className="w-4 h-4" />, color: '#00E676' },
];

export default function TableauDeBordPage() {
  const [tab, setTab] = useState<TabId>('kpis');
  const [data, setData] = useState<KpiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const loadKpis = useCallback(async () => {
    try {
      const r = await fetch(`${API}/phase2/dataset-kpis`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling de KPIs (mise a jour dans des callbacks async)
    loadKpis();
    const interval = setInterval(loadKpis, 30000);
    return () => clearInterval(interval);
  }, [loadKpis]);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <LayoutDashboard className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
            Tableau de bord
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            KPIs du jeu annuel 2019 (dataset_fusionne.csv), simulé à partir des traces réelles TON_IoT, et performance du modèle One-Class SVM
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadKpis}
            className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-2 rounded-xl cursor-pointer transition-all"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <RefreshCw className="w-3 h-3" /> Actualiser
          </button>
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted, var(--text-secondary))' }}>
            Mis à jour: {lastRefresh.toLocaleTimeString('fr-FR')}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold font-display whitespace-nowrap transition-all"
            style={{
              background: tab === t.id ? `${t.color}15` : 'transparent',
              color: tab === t.id ? t.color : 'var(--text-secondary)',
              border: tab === t.id ? `1px solid ${t.color}30` : '1px solid transparent',
            }}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'kpis' && (
            loading ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Chargement des KPIs...</span>
              </div>
            ) : error || !data ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                <Database className="w-12 h-12" style={{ color: 'var(--text-secondary)' }} />
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Impossible de charger les KPIs du dataset</div>
                {error && <div className="text-[10px] font-mono" style={{ color: 'var(--accent-danger)' }}>{error}</div>}
              </div>
            ) : (
              <TabKpis data={data} />
            )
          )}
          {tab === 'dataset' && <DatasetOverview />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}