import { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, Eye, ShieldCheck, GitMerge, Database,
  Calendar, Clock, AlertTriangle, GitBranch,
  Thermometer, Snowflake, CloudSun, Sparkles, CheckCircle2,
} from 'lucide-react';
import {
  BarChart, Bar, ComposedChart, Area, AreaChart, Line, Scatter,
  Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  ReferenceArea,
} from 'recharts';
import { authHeaders } from '../lib/auth';

const API = '/api/v1';

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CmpRow {
  id: string; name: string; color: string;
  f1: number; roc_auc: number; recall: number;
  precision: number; fpr: number; threshold: number;
  tp: number; fp: number; fn: number; tn: number;
}
interface RocPt { threshold: number; tpr: number; tnr: number; fpr: number; precision: number }
interface ConfusionM { labels: string[]; matrix: number[][]; threshold: number; tpr: number; fpr: number }
interface TimelinePt { i: number; datetime: string; weather: number; fridge: number; thermostat: number; label: number }
interface WindowT { i_start: number; i_end: number; start: string; end: string; start_label: string; end_label: string; n_points: number; duration_min: number }
interface BoxStats { box: number[]; mean: number; std: number; n: number }
interface BoxRow { sensor: string; name: string; color: string; normal: BoxStats; attack: BoxStats; cohen_d: number; effect_size: string }
interface CalWeek { week: number; label: string; days: number[]; total: number }
interface CalYear { year: number; weeks: CalWeek[] }
interface SeasonCorr { season: string; label: string; matrix: number[][]; pairs: { weather_fridge: number; weather_thermostat: number; fridge_thermostat: number } }
interface Takeaway { icon: string; title: string; text: string; color: string }

interface FusionPayload {
  comparison: {
    comparison: CmpRow[];
    confusion_matrix: ConfusionM | null;
    roc_curve: RocPt[];
    stored_metrics: { f1: number; roc_auc: number; recall: number; precision: number } | null;
    fused_model_available: boolean;
    n_attack_test: number;
    n_normal_test: number;
    split: { method: string; n_train: number; n_val: number; n_test: number; n_attack_test: number };
    error: string | null;
  };
  timeline: { points: TimelinePt[]; windows: WindowT[]; n_windows: number };
  visibility: {
    z_threshold: number;
    visibility_counts: { '0': number; '1': number; '2': number; '3': number; total: number };
    first_sensor: { weather: number; fridge: number; thermostat: number; equal: number };
    solo_detect: { weather: number; fridge: number; thermostat: number };
    latency_avg_min: { weather: number | null; fridge: number | null; thermostat: number | null };
    normal_profiles: Record<string, { mean: number; std: number }>;
  };
  boxplots: BoxRow[];
  quality: {
    filename: string;
    sources: Record<string, { rows: number; attacks: number }>;
    union_timestamps: number;
    common_timestamps: number;
    alignment_rate: number;
    unique_only: Record<string, number>;
    fused: { rows: number; attacks: number; attack_pct: number; null_cells: Record<string, number>; duplicated_datetime: number; interval_min: number; start: string; end: string; duration_days: number };
  };
  calendar: { years: CalYear[]; max: number };
  seasonal_corr: { seasons: SeasonCorr[]; labels: string[] };
  takeaways: Takeaway[];
  dataset: { filename: string; rows: number; attacks: number; start: string; end: string };
  generated_at: string;
}

// ═══════════════════════════════════════════════════════════════
// UI helpers
// ═══════════════════════════════════════════════════════════════

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
    <div className={`rounded-2xl p-5 ${className}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      {children}
    </div>
  );
}

function PctTip({ active, payload, label, percent }: { active?: boolean; payload?: Array<{ color: string; name: string; value: number }>; label?: string; percent?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
      {label && <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>
            {percent ? `${p.value.toFixed(1)}%` : p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

const TAKEAWAY_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  trend: TrendingUp, eye: Eye, shield: ShieldCheck, algo: GitMerge,
};

function fmtPct(v: number | undefined | null, d = 1): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(d)}%`;
}

// ═══════════════════════════════════════════════════════════════
// Section 1 — Fusion vs capteurs seuls
// ═══════════════════════════════════════════════════════════════

function FusionVsMono({ comparison }: { comparison: FusionPayload['comparison'] }) {
  const chartData = useMemo(() => comparison.comparison.map(r => ({
    name: r.name,
    F1: +(r.f1 * 100).toFixed(1),
    'ROC-AUC': +(r.roc_auc * 100).toFixed(1),
    'Rappel': +(r.recall * 100).toFixed(1),
    'Précision': +(r.precision * 100).toFixed(1),
    id: r.id,
  })), [comparison.comparison]);

  const colors: Record<string, string> = {};
  comparison.comparison.forEach(r => { colors[r.id] = r.color; });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>
              Modèle fusionné vs modèles mono-capteur — même split temporel 70/15/15
            </div>
            <div className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ background: '#A855F715', color: '#A855F7' }}>
              test sans fuite
            </div>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis unit="%" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip content={<PctTip percent />} />
                <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
                <Bar dataKey="F1" fill="#A855F7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="ROC-AUC" fill="#818cf8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Rappel" fill="#22C55E" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Précision" fill="#38BDF8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] mt-2" style={{ color: 'var(--text-secondary)' }}>
            Chaque modèle mono évalue une seule colonne de température ({comparison.split.method}). La fusion utilise les 21 features multivariées.
          </div>
        </Card>

        <Card>
          <SectionTitle color="#A855F7">Détail de la confusion</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left py-1.5" style={{ color: 'var(--text-secondary)' }}>Modèle</th>
                  <th className="text-center py-1.5" style={{ color: '#22C55E' }}>TP</th>
                  <th className="text-center py-1.5" style={{ color: '#38BDF8' }}>FP</th>
                  <th className="text-center py-1.5" style={{ color: '#F59E0B' }}>FN</th>
                  <th className="text-center py-1.5" style={{ color: 'var(--text-secondary)' }}>TN</th>
                </tr>
              </thead>
              <tbody>
                {comparison.comparison.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="py-1.5 font-bold flex items-center gap-1.5" style={{ color: r.color }}>
                      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: r.color }} />
                      {r.name}
                    </td>
                    <td className="text-center font-mono" style={{ color: 'var(--text-primary)' }}>{r.tp.toLocaleString()}</td>
                    <td className="text-center font-mono" style={{ color: 'var(--text-primary)' }}>{r.fp.toLocaleString()}</td>
                    <td className="text-center font-mono" style={{ color: 'var(--text-primary)' }}>{r.fn.toLocaleString()}</td>
                    <td className="text-center font-mono" style={{ color: 'var(--text-primary)' }}>{r.tn.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 space-y-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            <div>Test : <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{comparison.n_attack_test.toLocaleString()} attaques</span> sur <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{comparison.split.n_test.toLocaleString()}</span> échantillons.</div>
            <div>Seuil F1 maximal sur la courbe Precision-Rappel.</div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Section 2 — Timeline annotée
// ═══════════════════════════════════════════════════════════════

function AnnotatedTimeline({ timeline }: { timeline: FusionPayload['timeline'] }) {
  const { points, windows } = timeline;
  const last = points.length ? points[points.length - 1].i : 0;

  const ticksSpec = useMemo(() => {
    const n = Math.min(12, points.length);
    const step = Math.max(1, Math.floor(points.length / n));
    const out: { i: number; label: string }[] = [];
    for (let z = 0; z < points.length; z += step) {
      const pt = points[z];
      const m = parseInt(pt.datetime.slice(5, 7), 10);
      out.push({ i: pt.i, label: MONTHS[(m || 1) - 1] });
    }
    return out;
  }, [points]);

  const tickFormatter = (v: number) => {
    const found = ticksSpec.find(t => Math.abs(t.i - v) < 200000);
    return found?.label ?? '';
  };

  const sensors = [
    { key: 'weather', color: '#38BDF8', label: 'Weather' },
    { key: 'fridge', color: '#00E676', label: 'Fridge' },
    { key: 'thermostat', color: '#FF9100', label: 'Thermostat' },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>
            Les 3 capteurs superposés — zones rouges = fenêtres d'attaque
          </div>
          <div className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ background: '#EF444415', color: '#EF4444' }}>
            {timeline.n_windows} fenêtres
          </div>
        </div>
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <defs>
                {sensors.map(s => (
                  <linearGradient key={s.key} id={`tl-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="i" type="number" domain={[0, last]} ticks={ticksSpec.map(t => t.i)}
                tickFormatter={tickFormatter} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={45} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
                    <div className="text-[10px] font-mono mb-1" style={{ color: 'var(--text-secondary)' }}>{d?.datetime}</div>
                    {sensors.map(s => (
                      <div key={s.key} className="flex items-center gap-2 text-[11px] py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                        <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
                        <span className="font-mono font-bold" style={{ color: s.color }}>{d?.[s.key]?.toFixed(2)}</span>
                      </div>
                    ))}
                    {d?.label === 1 && <div className="text-[10px] font-bold mt-1" style={{ color: '#EF4444' }}>● ATTAQUE</div>}
                  </div>
                );
              }} />
              {windows.map((w, idx) => (
                <ReferenceArea key={idx} x1={w.i_start} x2={w.i_end}
                  stroke="#EF4444" strokeOpacity={0.6} strokeWidth={1}
                  fill="#EF4444" fillOpacity={idx % 2 === 0 ? 0.08 : 0.12} />
              ))}
              {sensors.map(s => (
                <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.5}
                  fill={`url(#tl-${s.key})`} dot={false} activeDot={{ r: 3 }} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[10px] mt-2" style={{ color: 'var(--text-secondary)' }}>
          Échantillonné sur l'année 2019 ({points.length} points). Survolez pour voir les valeurs des 3 capteurs et les points attaqués.
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Section 3 — Visibilité par capteur
// ═══════════════════════════════════════════════════════════════

function Visibility({ vis }: { vis: FusionPayload['visibility'] }) {
  const vc = vis.visibility_counts;
  const nVis = [
    { name: '0 capteur', value: vc['0'], color: '#6B7280' },
    { name: '1 capteur', value: vc['1'], color: '#38BDF8' },
    { name: '2 capteurs', value: vc['2'], color: '#F59E0B' },
    { name: '3 capteurs', value: vc['3'], color: '#22C55E' },
  ];
  const fs = [
    { name: 'Weather', value: vis.first_sensor.weather, color: '#38BDF8' },
    { name: 'Fridge', value: vis.first_sensor.fridge, color: '#00E676' },
    { name: 'Thermostat', value: vis.first_sensor.thermostat, color: '#FF9100' },
    { name: 'Égalité / aucun', value: vis.first_sensor.equal, color: '#6B7280' },
  ];
  const solo = [
    { name: 'Weather', value: vis.solo_detect.weather, color: '#38BDF8' },
    { name: 'Fridge', value: vis.solo_detect.fridge, color: '#00E676' },
    { name: 'Thermostat', value: vis.solo_detect.thermostat, color: '#FF9100' },
  ];
  const latency = [
    { name: 'Weather', value: vis.latency_avg_min.weather, color: '#38BDF8' },
    { name: 'Fridge', value: vis.latency_avg_min.fridge, color: '#00E676' },
    { name: 'Thermostat', value: vis.latency_avg_min.thermostat, color: '#FF9100' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card>
        <SectionTitle color="#38BDF8">Nb de capteurs qui voient l'attaque</SectionTitle>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={nVis} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={70} />
              <Tooltip content={<PctTip />} />
              <Bar dataKey="value" name="Attaques" radius={[0, 4, 4, 0]}>
                {nVis.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
          Proxy statistique : écart &gt; z={vis.z_threshold} de la moyenne normale (~{vis.visibility_counts.total} fenêtres). Les features de différence inter-capteurs rendent visibles les attaques non détectées en température brute.
        </div>
      </Card>

      <Card>
        <SectionTitle color="#00E676">Premier capteur à réagir</SectionTitle>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={fs} margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<PctTip />} />
              <Bar dataKey="value" name="Attaques" radius={[4, 4, 0, 0]}>
                {fs.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
          Sur quelles attaques visibles le capteur est-il le premier à dépasser le seuil z={vis.z_threshold} ?
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-1">
          <SectionTitle color="#FF9100">Détection solo & latence</SectionTitle>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <div className="text-[10px] font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Attaques vues par un seul capteur</div>
            {solo.map(s => (
              <div key={s.name} className="flex items-center gap-2 py-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{s.name}</span>
                <span className="ml-auto font-mono font-bold text-[11px]" style={{ color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="text-[10px] font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Latence moyenne (min)</div>
            {latency.map(s => (
              <div key={s.name} className="flex items-center gap-2 py-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{s.name}</span>
                <span className="ml-auto font-mono font-bold text-[11px]" style={{ color: s.color }}>{s.value === null ? '—' : `${s.value} min`}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 p-3 rounded-xl text-[10px]" style={{ background: `color-mix(in srgb, #FF9100 8%, transparent)`, color: 'var(--text-secondary)' }}>
          <strong style={{ color: '#FF9100' }}>Fridge</strong> réagit en moyenne le plus vite — les dérives de température industrielle sont le signal le plus rapide.
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Section 4 — Courbe de sensibilité + matrice de confusion
// ═══════════════════════════════════════════════════════════════

function Sensitivity({ comparison }: { comparison: FusionPayload['comparison'] }) {
  const cm = comparison.confusion_matrix;
  const best = cm ? { fpr: cm.fpr, tpr: cm.tpr } : null;
  const stored = comparison.stored_metrics;

  const composed = useMemo(() => {
    const curve = comparison.roc_curve || [];
    const s: { fpr: number; tpr: number; modelo: number }[] = curve.map(r => ({ fpr: r.fpr, tpr: r.tpr, modelo: r.fpr }));
    return s;
  }, [comparison.roc_curve]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>
            Taux de détection en fonction du seuil (modèle fusionné)
          </div>
          <div className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ background: '#818cf815', color: '#818cf8' }}>
            test {comparison.n_attack_test.toLocaleString()} attaques
          </div>
        </div>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={composed} margin={{ top: 5, right: 25, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="fpr" type="number" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                label={{ value: 'Taux de faux positifs (FPR)', position: 'insideBottom', offset: -2, style: { fontSize: 9, fill: 'var(--text-secondary)' } }} />
              <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} domain={[0, 1]}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                label={{ value: 'Taux de détection', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: 'var(--text-secondary)' } }} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
                    <div className="text-[11px] font-mono" style={{ color: '#22C55E' }}>Détection : {(d?.tpr * 100).toFixed(1)}%</div>
                    <div className="text-[11px] font-mono" style={{ color: '#EF4444' }}>FPR : {(d?.fpr * 100).toFixed(2)}%</div>
                  </div>
                );
              }} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
              <Line dataKey="tpr" stroke="#A855F7" strokeWidth={2.5} dot={false} name="Détection (Taux de détection)" />
              <Line dataKey="modelo" stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" dot={false} name="Hasard" />
              {best && (
                <Scatter data={[{ fpr: best.fpr, tpr: best.tpr }]} fill="#22C55E">
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                </Scatter>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {best && (
          <div className="text-[10px] mt-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E] inline-block" />
            Seuil optimal (max F1) : {fmtPct(best.tpr, 1)} de détection pour {fmtPct(best.fpr, 2)} de faux positifs.
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle color="#F59E0B">Matrice de confusion (test)</SectionTitle>
        {cm ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-center mt-2">
              {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([r, c]) => {
                const val = cm.matrix[r][c];
                const isTp = r === 1 && c === 1;
                const isTn = r === 0 && c === 0;
                const isFp = r === 0 && c === 1;
                const bg = isTp ? 'rgba(34,197,94,0.18)' : isTn ? 'rgba(34,197,94,0.10)' : isFp ? 'rgba(239,68,68,0.18)' : 'rgba(239,68,68,0.30)';
                const color = (isTp || isTn) ? '#22C55E' : '#EF4444';
                return (
                  <div key={`${r}-${c}`} className="rounded-xl p-3" style={{ background: bg, border: `1px solid ${color}30` }}>
                    <div className="font-display text-lg font-black" style={{ color }}>{val.toLocaleString()}</div>
                    <div className="text-[9px] font-bold mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {isTp ? 'TP · attaque détectée' : isTn ? 'TN · normal ok' : isFp ? 'FP · fausse alerte' : 'FN · attaque manquée'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 space-y-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              <div className="flex justify-between"><span>Seuil</span><span className="font-mono" style={{ color: 'var(--text-primary)' }}>{cm.threshold}</span></div>
              <div className="flex justify-between"><span>Taux de détection</span><span className="font-mono" style={{ color: '#22C55E' }}>{fmtPct(cm.tpr, 1)}</span></div>
              <div className="flex justify-between"><span>Faux positifs</span><span className="font-mono" style={{ color: '#EF4444' }}>{fmtPct(cm.fpr, 2)}</span></div>
            </div>
          </>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Matrice non disponible — modèle fusionné introuvable.</div>
        )}
        {stored && (
          <div className="mt-4 pt-3 border-t space-y-1.5 text-[10px]" style={{ borderColor: 'var(--border)' }}>
            <div className="font-bold" style={{ color: 'var(--text-secondary)' }}>Métriques sauvegardées (entraînement)</div>
            {([['F1', stored.f1], ['ROC-AUC', stored.roc_auc], ['Rappel', stored.recall], ['Précision', stored.precision]] as [string, number][]).map(([l, v]) => (
              <div key={String(l)} className="flex justify-between">
                <span>{String(l)}</span>
                <span className="font-mono" style={{ color: 'var(--accent-primary)' }}>{fmtPct(v, 1)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Section 5 — Boxplots Normal vs Attaque + Cohen's d
// ═══════════════════════════════════════════════════════════════

function BoxplotRow({ boxes }: { boxes: BoxRow[] }) {
  const yMin = useMemo(() => Math.min(...boxes.flatMap(b => [...b.normal.box, ...b.attack.box])), [boxes]);
  const yMax = useMemo(() => Math.max(...boxes.flatMap(b => [...b.normal.box, ...b.attack.box])), [boxes]);
  const W = 150; const H = 150; const PAD = 22;

  const scale = (v: number) => PAD + ((yMax - v) / (yMax - yMin)) * (H - PAD * 2);

  function DBox({ box, cx, color }: { box: BoxStats; cx: number; color: string }) {
    const [mn, q1, md, q3, mx] = box.box;
    const bw = 26;
    return (
      <g>
        <line x1={cx} y1={scale(mn)} x2={cx} y2={scale(mx)} stroke={color} strokeWidth={1.2} strokeOpacity={0.7} />
        <line x1={cx - 6} y1={scale(mn)} x2={cx + 6} y2={scale(mn)} stroke={color} strokeWidth={1.5} />
        <line x1={cx - 6} y1={scale(mx)} x2={cx + 6} y2={scale(mx)} stroke={color} strokeWidth={1.5} />
        <rect x={cx - bw / 2} y={scale(q3)} width={bw} height={Math.max(1, scale(q1) - scale(q3))}
          fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.2} rx={2} />
        <line x1={cx - bw / 2} y1={scale(md)} x2={cx + bw / 2} y2={scale(md)} stroke={color} strokeWidth={2} />
        <circle cx={cx} cy={scale(box.mean)} r={3.5} fill={color} stroke="#fff" strokeWidth={1} />
      </g>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {boxes.map(b => (
        <Card key={b.sensor}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: b.color }} />
              <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>{b.name}</div>
            </div>
            <div className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{
              background: `color-mix(in srgb, ${Math.abs(b.cohen_d) >= 0.5 ? '#A855F7' : Math.abs(b.cohen_d) >= 0.2 ? '#38BDF8' : '#6B7280'} 12%, transparent)`,
              color: Math.abs(b.cohen_d) >= 0.5 ? '#A855F7' : Math.abs(b.cohen_d) >= 0.2 ? '#38BDF8' : '#6B7280',
            }}>
              d = {b.cohen_d} <span className="opacity-70">({b.effect_size})</span>
            </div>
          </div>
          <div className="flex justify-center">
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
              {[0.25, 0.5, 0.75].map(f => (
                <line key={f} x1={0} x2={W} y1={scale(yMin + (yMax - yMin) * f)} y2={scale(yMin + (yMax - yMin) * f)}
                  stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              ))}
              <text x={W - 4} y={scale(yMax) - 4} textAnchor="end" fontSize={8} fill="var(--text-secondary)">{yMax.toFixed(1)}</text>
              <text x={W - 4} y={scale(yMax / 2 + yMin / 2) - 4} textAnchor="end" fontSize={8} fill="var(--text-secondary)">{(yMax / 2 + yMin / 2).toFixed(1)}</text>
              <text x={W - 4} y={scale(yMin) + 8} textAnchor="end" fontSize={8} fill="var(--text-secondary)">{yMin.toFixed(1)}</text>
              <DBox box={b.normal} cx={50} color="#22C55E" />
              <DBox box={b.attack} cx={105} color="#EF4444" />
            </svg>
          </div>
          <div className="flex items-center justify-center gap-4 text-[9px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" /> Normal (n={b.normal.n.toLocaleString()})</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> Attaque (n={b.attack.n.toLocaleString()})</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Section 6 — Qualité de la fusion
// ═══════════════════════════════════════════════════════════════

function FusionQuality({ q }: { q: FusionPayload['quality'] }) {
  const f = q.fused;
  const metrics = [
    { label: 'Créneaux communs', value: q.common_timestamps.toLocaleString(), color: '#22C55E', icon: <CheckCircle2 className="w-4 h-4" /> },
    { label: 'Alignement fusion', value: `${q.alignment_rate}%`, color: '#38BDF8', icon: <GitMerge className="w-4 h-4" /> },
    { label: 'Lignes fusionnées', value: f.rows.toLocaleString(), color: '#A855F7', icon: <Database className="w-4 h-4" /> },
    { label: 'Intervalle', value: `${f.interval_min} min`, color: '#F59E0B', icon: <Clock className="w-4 h-4" /> },
    { label: 'Durée', value: `${f.duration_days} j`, color: '#00E676', icon: <Calendar className="w-4 h-4" /> },
    { label: 'Attaques', value: `${f.attacks.toLocaleString()} (${f.attack_pct}%)`, color: '#EF4444', icon: <AlertTriangle className="w-4 h-4" /> },
  ];
  const sources = [
    { name: 'Weather', rows: q.sources?.weather?.rows, attacks: q.sources?.weather?.attacks, color: '#38BDF8', icon: CloudSun },
    { name: 'Fridge', rows: q.sources?.fridge?.rows, attacks: q.sources?.fridge?.attacks, color: '#00E676', icon: Snowflake },
    { name: 'Thermostat', rows: q.sources?.thermostat?.rows, attacks: q.sources?.thermostat?.attacks, color: '#FF9100', icon: Thermometer },
  ];
  const uniqData = Object.entries(q.unique_only || {}).map(([k, v]) => ({
    name: k === 'weather' ? 'Weather' : k === 'fridge' ? 'Fridge' : 'Thermostat',
    value: v as number,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${m.color}15`, color: m.color }}>{m.icon}</div>
            </div>
            <div className="font-display text-lg font-black" style={{ color: m.color }}>{m.value}</div>
            <div className="text-[9px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-secondary)' }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <SectionTitle color="#00E676">Sources avant fusion</SectionTitle>
          <div className="space-y-2">
            {sources.map(s => (
              <div key={s.name} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: `color-mix(in srgb, ${s.color} 6%, transparent)` }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${s.color}15` }}>
                  <s.icon className="w-4 h-4" style={{ color: s.color }} />
                </div>
                <div>
                  <div className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>{s.name}</div>
                  <div className="text-[9px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {s.rows?.toLocaleString()} lignes · {s.attacks?.toLocaleString()} attaques
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle color="#38BDF8">Complétude du dataset fusionné</SectionTitle>
          <div className="space-y-2">
            {Object.entries(f.null_cells).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-[10px] mb-1">
                  <span style={{ color: 'var(--text-secondary)' }}>{k === 'weather' ? 'Weather' : k === 'fridge' ? 'Fridge' : 'Thermostat'}</span>
                  <span className="font-mono" style={{ color: v === 0 ? '#22C55E' : '#EF4444' }}>{v === 0 ? 'aucune valeur manquante' : `${v} manquants`}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                  <div className="h-full" style={{ width: `${Math.max(5, 100 - (v / f.rows) * 100)}%`, background: v === 0 ? '#22C55E' : '#EF4444' }} />
                </div>
              </div>
            ))}
            <div className="text-[10px] pt-1" style={{ color: 'var(--text-secondary)' }}>
              Timestamps dupliqués : <span className="font-mono" style={{ color: f.duplicated_datetime === 0 ? '#22C55E' : '#EF4444' }}>{f.duplicated_datetime.toLocaleString()}</span> · {f.start} → {f.end}
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle color="#F59E0B">Créneaux portés par un seul capteur</SectionTitle>
          <div className="h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={uniqData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={70} />
                <Tooltip content={<PctTip />} />
                <Bar dataKey="value" name="Créneaux" radius={[0, 4, 4, 0]} fill="#F59E0B" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            L'alignement total ({q.alignment_rate}%) garantit que chaque ligne du dataset fusionné contient les 3 mesures — condition pour des features inter-capteurs fiables.
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Section 7 — Calendrier des attaques (style GitHub)
// ═══════════════════════════════════════════════════════════════

function AttackCalendar({ cal }: { cal: FusionPayload['calendar'] }) {
  const max = Math.max(cal.max, 1);
  const alpha = (v: number) => (v / max) * 0.85 + (v === 0 ? 0 : 0.08);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>
          Empreinte annuelle des attaques (style GitHub)
        </div>
        <div className="flex items-center gap-1.5 text-[9px]" style={{ color: 'var(--text-secondary)' }}>
          <span>Moins</span>
          {[0, 0.25, 0.5, 0.75, 1].map(lvl => (
            <span key={lvl} className="w-3 h-3 rounded-sm" style={{ background: `rgba(239,68,68,${lvl})`, border: '1px solid rgba(239,68,68,0.3)' }} />
          ))}
          <span>Plus ({max}/jour)</span>
        </div>
      </div>
      <div className="space-y-4 overflow-x-auto">
        {cal.years.map(y => (
          <div key={y.year}>
            <div className="text-[10px] font-bold font-mono mb-1" style={{ color: 'var(--text-secondary)' }}>{y.year}</div>
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${Math.max(1, y.weeks.length)}, minmax(10px, 1fr))`, width: '100%' }}>
              {y.weeks.map(w => (
                <div key={w.week} className="flex flex-col gap-[2px]">
                  <div className="h-2 text-[7px] font-mono leading-none text-center" style={{ color: 'var(--text-muted, var(--text-secondary))' }}>{w.week % 4 === 0 ? w.label : ''}</div>
                  {w.days.map((d, di) => (
                    <div key={di} className="aspect-square rounded-[3px]" title={`S${w.week} jour ${di + 1} : ${d} attaque(s)`}
                      style={{ background: d > 0 ? `rgba(239,68,68,${alpha(d)})` : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.03)' }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="text-[10px] mt-3" style={{ color: 'var(--text-secondary)' }}>
        Intensité = nombre d'échantillons attaqués par jour. Les attaques se concentrent en quasi-continu sur quelques fenêtres de l'année.
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// Section 8 — Corrélation inter-capteurs par saison
// ═══════════════════════════════════════════════════════════════

function SeasonalCorr({ corr }: { corr: FusionPayload['seasonal_corr'] }) {
  const barData = useMemo(() => {
    const rows: Record<string, { name: string; long: string } & Record<string, number>> = {};
    corr.seasons.forEach(s => {
      const row = { name: s.label, long: s.label } as { name: string; long: string } & Record<string, number>;
      Object.entries(s.pairs).forEach(([pk, v]) => {
        row[pk] = v;
      });
      rows[s.season] = row;
    });
    return Object.values(rows);
  }, [corr.seasons]);

  const PAIRS = [
    { key: 'weather_fridge', label: 'Weather ↔ Fridge', color: '#38BDF8' },
    { key: 'weather_thermostat', label: 'Weather ↔ Thermostat', color: '#00E676' },
    { key: 'fridge_thermostat', label: 'Fridge ↔ Thermostat', color: '#FF9100' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <SectionTitle color="#818cf8">Corrélation inter-capteurs par saison</SectionTitle>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} domain={[-1, 1]} />
              <Tooltip content={<PctTip />} />
              <Legend wrapperStyle={{ fontSize: 9 }} iconType="plainline" iconSize={10} />
              {PAIRS.map(p => <Bar key={p.key} dataKey={p.key} name={p.label} fill={p.color} radius={[4, 4, 0, 0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[10px] mt-2" style={{ color: 'var(--text-secondary)' }}>
          La corrélation Weather ↔ Thermostat est fortement négative (chauffage = froid extérieur) et varie avec les saisons : informations complémentaires que seule la fusion exploite.
        </div>
      </Card>

      <Card>
        <SectionTitle color="#00E5FF">Matrices 3×3 par saison</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          {corr.seasons.map(s => (
            <div key={s.season}>
              <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(3, minmax(34px, 1fr))` }}>
                {s.matrix.map((rowArr, i) => rowArr.map((v, j) => {
                  const abs = Math.abs(v);
                  const bg = i === j ? 'rgba(168,85,247,0.3)' : v > 0 ? `rgba(34,197,94,${0.12 + abs * 0.55})` : `rgba(239,68,68,${0.12 + abs * 0.55})`;
                  return (
                    <div key={`${i}-${j}`} className="h-7 rounded flex items-center justify-center text-[9px] font-mono font-bold"
                      style={{ background: bg, color: abs > 0.5 ? '#fff' : 'var(--text-primary)' }}>
                      {v.toFixed(2)}
                    </div>
                  );
                }))}
              </div>
              <div className="hidden"></div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[9px] justify-end" style={{ color: 'var(--text-secondary)' }}>
          <span className="w-2 h-2 rounded-sm" style={{ background: 'rgba(34,197,94,0.5)' }} /> positive
          <span className="w-2 h-2 rounded-sm ml-2" style={{ background: 'rgba(239,68,68,0.5)' }} /> négative
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

export default function FusionInsights() {
  const [data, setData] = useState<FusionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/phase2/fusion-insights`, { headers: authHeaders() })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} /></div>;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <GitBranch className="w-12 h-12" style={{ color: 'var(--text-secondary)' }} />
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Impossible de charger les insights de fusion</div>
        {error && <div className="text-[10px] font-mono" style={{ color: 'var(--accent-danger)' }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <GitMerge className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
            La valeur de la fusion
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {data.dataset.filename} — {data.dataset.rows.toLocaleString()} lignes · {data.dataset.attacks.toLocaleString()} attaques · {data.dataset.start} → {data.dataset.end}
          </p>
        </div>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted, var(--text-secondary))' }}>
          Généré: {new Date(data.generated_at).toLocaleTimeString('fr-FR')}
        </span>
      </div>

      {/* Takeaways */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {data.takeaways.map((t, i) => {
          const Icon = TAKEAWAY_ICONS[t.icon] || Sparkles;
          return (
            <div key={i} className="rounded-2xl p-4 relative overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${t.color}10 0%, transparent 55%)` }} />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${t.color}15`, color: t.color }}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <Sparkles className="w-3 h-3 opacity-40" style={{ color: t.color }} />
                </div>
                <div className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>{t.title}</div>
                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{t.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 1. Fusion vs mono */}
      <div>
        <SectionTitle color="#A855F7">1 · La fusion vs les capteurs seuls — la preuve du gain</SectionTitle>
        <FusionVsMono comparison={data.comparison} />
      </div>

      {/* 2. Timeline */}
      <div>
        <SectionTitle color="#38BDF8">2 · Timeline annotée des 3 capteurs</SectionTitle>
        <AnnotatedTimeline timeline={data.timeline} />
      </div>

      {/* 3. Visibilité */}
      <div>
        <SectionTitle color="#00E676">3 · Qui voit l'attaque ? Visibilité & réactivité par capteur</SectionTitle>
        <Visibility vis={data.visibility} />
      </div>

      {/* 4. Seuil + confusion */}
      <div>
        <SectionTitle color="#F59E0B">4 · Sensibilité au seuil & matrice de confusion</SectionTitle>
        <Sensitivity comparison={data.comparison} />
      </div>

      {/* 5. Boxplots */}
      <div>
        <SectionTitle color="#EF4444">5 · Distribution Normal vs Attaque + taille d'effet (Cohen's d)</SectionTitle>
        <BoxplotRow boxes={data.boxplots} />
      </div>

      {/* 6. Qualité */}
      <div>
        <SectionTitle color="#22C55E">6 · Qualité de la fusion</SectionTitle>
        <FusionQuality q={data.quality} />
      </div>

      {/* 7. Calendrier */}
      <div>
        <SectionTitle color="#EF4444">7 · Calendrier des attaques</SectionTitle>
        <AttackCalendar cal={data.calendar} />
      </div>

      {/* 8. Corrélations saison */}
      <div>
        <SectionTitle color="#818cf8">8 · Corrélation inter-capteurs par saison</SectionTitle>
        <SeasonalCorr corr={data.seasonal_corr} />
      </div>
    </div>
  );
}