import React, { useState, useEffect, useMemo, Component, type ReactNode } from 'react';
import {
  Database, Calendar, Thermometer, Snowflake, CloudSun,
  BarChart2, TrendingUp, Target, GitBranch, Layers, Activity,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, Line, ComposedChart,
  XAxis, YAxis, Tooltip,   ResponsiveContainer, CartesianGrid, Legend,
  ScatterChart, Scatter as RScatter,
} from 'recharts';
import { authHeaders } from '../lib/auth';

const API = '/api/v1';

class ErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

interface TooltipItem { color: string; name: string; value: number }
function Tip({ active, payload, label }: { active?: boolean; payload?: TooltipItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
      {label && <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>
            {typeof p.value === 'number' ? p.value.toLocaleString() : String(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PctTip({ active, payload, label }: { active?: boolean; payload?: TooltipItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
      {label && <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>
            {typeof p.value === 'number' ? `${p.value.toFixed(2)}%` : String(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface DatasetPayload {
  filename: string;
  global: {
    total: number; normal: number; attack: number; attack_pct: number;
    start: string; end: string; duration_days: number;
    sensors: string[];
    stats: Record<string, { min: number; max: number; mean: number; std: number; median: number }>;
  };
  seasonal: Array<{ season: string; label: string; normal: number; attack: number; total: number }>;
  monthly: Array<{ month: number; label: string; normal: number; attack: number; total: number; attack_pct: number }>;
  hourly: Array<{ hour: number; label: string; normal: number; attack: number; total: number }>;
  heatmap_dom_attack: Array<{ day: number; values: number[] }>;
  heatmap_dom_max: number;
  heatmap_hour_pct: Array<{ month: number; label: string; values: number[] }>;
  profiles: { hourly_attack_pct: number[]; seasonal_attack_pct: number[] };
  trends: {
    weather: Array<{ datetime: string; value: number; label: number }>;
    fridge: Array<{ datetime: string; value: number; label: number }>;
    thermostat: Array<{ datetime: string; value: number; label: number }>;
  };
  split_stats: Record<string, { normal: { mean: number; std: number }; attack: { mean: number; std: number } }>;
  scatter: Array<{ weather: number; fridge: number; thermostat: number; label: number }>;
  histograms: Record<string, { bin_centers: number[]; bin_edges: number[]; normal: number[]; attack: number[] }>;
  correlations: { labels: string[]; matrix: number[][] };
  rolling: Array<{ index: number; label: string; attack_rate: number; count: number }>;
  seasonal_sensors: Array<Record<string, string | number>>;
}

interface SeasonCorrSeason { season: string; label: string; matrix: number[][]; pairs: { weather_fridge: number; weather_thermostat: number; fridge_thermostat: number } }
interface SeasonCorrData { seasons: SeasonCorrSeason[]; labels: string[] }
interface ConfusionM { labels: string[]; matrix: number[][]; threshold: number; tpr: number; fpr: number }
interface FusionExtra {
  seasonal_corr: SeasonCorrData | null;
  confusion_matrix: ConfusionM | null;
}

type TabId = 'vue' | 'tendances' | 'distributions' | 'correlations' | 'profils';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'vue', label: 'Vue globale', icon: <Layers className="w-4 h-4" /> },
  { id: 'distributions', label: 'Distributions', icon: <BarChart2 className="w-4 h-4" /> },
  { id: 'tendances', label: 'Tendances capteurs', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'correlations', label: 'Corrélations', icon: <GitBranch className="w-4 h-4" /> },
  { id: 'profils', label: 'Profils saisonniers', icon: <Activity className="w-4 h-4" /> },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-4 rounded-full" style={{ background: 'var(--accent-primary)' }} />
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

function StatCard({ icon: Icon, label, value, color, sub }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className="p-4 rounded-xl flex items-center gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold truncate" style={{ color: 'var(--text-primary)' }}>{value}</div>
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
        {sub && <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--accent-primary)' }}>{sub}</div>}
      </div>
    </div>
  );
}

function SensorCard({ k, stats, split }: { k: string; stats: { min: number; max: number; mean: number; std: number; median: number }; split: { normal: { mean: number; std: number }; attack: { mean: number; std: number } } }) {
  const colors: Record<string, string> = { weather: '#0284C7', fridge: '#16A34A', thermostat: '#EA580C' };
  const labels: Record<string, string> = { weather: 'Weather', fridge: 'Fridge', thermostat: 'Thermostat' };
  const icons: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = { weather: CloudSun, fridge: Snowflake, thermostat: Thermometer };
  const Icon = icons[k] || Database;
  const c = colors[k] || '#6366F1';
  return (
    <div className="rounded-2xl p-5" style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${c} 4%, var(--bg-card)), var(--bg-card))`, border: `1px solid color-mix(in srgb, ${c} 15%, var(--border))` }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `color-mix(in srgb, ${c} 12%, transparent)` }}>
          <Icon className="w-4 h-4" style={{ color: c }} />
        </div>
        <div className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>{labels[k]}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="space-y-1">
          {(['min', 'max', 'mean', 'std'] as const).map(f => (
            <div key={f} className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
              <span>{f === 'std' ? 'σ' : f.charAt(0).toUpperCase() + f.slice(1)}</span>
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{stats[f]}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-bold" style={{ color: c }}>N vs A</div>
          <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
            <span>N</span><span className="font-mono" style={{ color: '#22C55E' }}>{split.normal.mean} ± {split.normal.std}</span>
          </div>
          <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
            <span>A</span><span className="font-mono" style={{ color: '#EF4444' }}>{split.attack.mean} ± {split.attack.std}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════ TAB SECTIONS ═══════════════

function VueGlobale({ data }: { data: DatasetPayload }) {
  const g = data.global;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard icon={Database} label="Total" value={g.total.toLocaleString()} color="#6366F1" />
        <StatCard icon={Target} label="Normal" value={g.normal.toLocaleString()} color="#22C55E" sub={`${(100 - g.attack_pct).toFixed(1)}%`} />
        <StatCard icon={TrendingUp} label="Attaques" value={g.attack.toLocaleString()} color="#EF4444" sub={`${g.attack_pct}%`} />
        <StatCard icon={Calendar} label="Durée" value={`${g.duration_days}j`} color="#F97316" />
        <StatCard icon={BarChart2} label="Capteurs" value={g.sensors.length} color="#0284C7" sub={g.sensors.join(', ')} />
      </div>
      <SectionTitle>Statistiques par capteur</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Object.entries(g.stats).map(([k, s]) => (
          <SensorCard key={k} k={k} stats={s} split={data.split_stats[k]} />
        ))}
      </div>
      <SectionTitle>Distribution par saison</SectionTitle>
      <Card>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.seasonal} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="normBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22C55E" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="#22C55E" stopOpacity={0.3} />
                </linearGradient>
                <linearGradient id="atkBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#EF4444" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#EF4444" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="color-mix(in srgb, var(--text-primary) 5%, transparent)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <Tooltip content={<Tip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
              <Bar dataKey="normal" stackId="a" fill="url(#normBar)" name="Normal" radius={[0, 0, 0, 0]} />
              <Bar dataKey="attack" stackId="a" fill="url(#atkBar)" name="Attaque" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <SectionTitle>Attaques par mois</SectionTitle>
      <Card>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.monthly} margin={{ top: 10, right: 30, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="atkBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#EF4444" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#EF4444" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="color-mix(in srgb, var(--text-primary) 5%, transparent)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} label={{ value: 'Attaques', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'var(--text-secondary)' } }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} label={{ value: '% Attaque', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: 'var(--text-secondary)' } }} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                    <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{d?.label}</div>
                    <div className="text-[11px] font-mono" style={{ color: '#EF4444' }}>Attaques : {d?.attack}</div>
                    <div className="text-[11px] font-mono" style={{ color: '#22C55E' }}>Normal : {d?.normal}</div>
                    <div className="text-[11px] font-mono mt-1" style={{ color: '#7C3AED' }}>% Attaque : {d?.attack_pct}%</div>
                  </div>
                );
              }} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
              <Bar yAxisId="left" dataKey="attack" fill="url(#atkBarGrad)" name="Attaques" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="attack_pct" stroke="#7C3AED" strokeWidth={2.5} dot={{ r: 3, fill: '#7C3AED', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#7C3AED', strokeWidth: 2, stroke: 'var(--bg-base)' }} name="% Attaque" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Tendances({ data }: { data: DatasetPayload }) {
  const trendData = useMemo(() => {
    const w = data.trends.weather || [];
    return w.map((pt, i) => {
      const dt = pt.datetime;
      const short = dt.length > 10 ? dt.substring(5, 16).replace('T', ' ') : dt;
      return {
        label: short,
        Weather: pt.value,
        Fridge: data.trends.fridge[i]?.value ?? 0,
        Thermostat: data.trends.thermostat[i]?.value ?? 0,
        isAttack: pt.label === 1,
      };
    });
  }, [data]);

  const sensors = [
    { key: 'Weather', color: '#0284C7', grad: '#0EA5E9', icon: <CloudSun className="w-4 h-4" /> },
    { key: 'Fridge', color: '#1F5FA6', grad: '#1F5FA6', icon: <Snowflake className="w-4 h-4" /> },
    { key: 'Thermostat', color: '#8F5300', grad: '#8F5300', icon: <Thermometer className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-5">
      <SectionTitle>Tendances des 3 capteurs</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {sensors.map(s => (
          <Card key={s.key}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span style={{ color: s.color }}>{s.icon}</span>
                <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>{s.key}</div>
              </div>
              <div className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${s.color} 10%, transparent)`, color: s.color }}>Area</div>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 5, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`trend-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={s.grad} stopOpacity={0} />
                    </linearGradient>
                    <filter id={`glow-${s.key}`}>
                      <feGaussianBlur stdDeviation="2" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid stroke="color-mix(in srgb, var(--text-primary) 5%, transparent)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={80} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload;
                    return (
                      <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                        <div className="text-[10px] font-mono mb-1" style={{ color: 'var(--text-secondary)' }}>{d?.label}</div>
                        <div className="text-sm font-bold" style={{ color: s.color }}>{d?.[s.key]?.toFixed(2)}</div>
                        {d?.isAttack && <div className="text-[10px] font-bold mt-1" style={{ color: '#EF4444' }}>● ATTAQUE</div>}
                      </div>
                    );
                  }} />
                  <Area type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#trend-${s.key})`}
                    dot={false} activeDot={{ r: 5, fill: s.color, strokeWidth: 2, stroke: 'var(--bg-base)', filter: `url(#glow-${s.key})` }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        ))}
      </div>

    </div>
  );
}

function Distributions({ data }: { data: DatasetPayload }) {
  const sensorMeta: Record<string, { color: string; grad: string; label: string }> = {
    weather: { color: '#0284C7', grad: '#0EA5E9', label: 'Weather' },
    fridge: { color: '#16A34A', grad: '#00C853', label: 'Fridge' },
    thermostat: { color: '#EA580C', grad: '#EA580C', label: 'Thermostat' },
  };

  return (
    <div className="space-y-5">
      <SectionTitle>Distribution des températures (Normal vs Attaque)</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Object.entries(data.histograms).map(([k, h]) => {
          const m = sensorMeta[k]!;
          const chartData = h.bin_centers.map((c, i) => ({
            bin: c.toFixed(1),
            Normal: h.normal[i],
            Attaque: h.attack[i],
          }));
          return (
            <Card key={k}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: m.color }} />
                  <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>{m.label}</div>
                </div>
                <div className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${m.color} 10%, transparent)`, color: m.color }}>KDE</div>
              </div>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`normGrad-${k}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22C55E" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#22C55E" stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id={`atkGrad-${k}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#EF4444" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#EF4444" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="color-mix(in srgb, var(--text-primary) 5%, transparent)" vertical={false} />
                    <XAxis dataKey="bin" tick={{ fontSize: 8 }} tickLine={false} axisLine={false} interval={3} />
                    <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<Tip />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
                    <Bar dataKey="Normal" fill={`url(#normGrad-${k})`} name="Normal" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Attaque" fill={`url(#atkGrad-${k})`} name="Attaque" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          );
        })}
      </div>

      <SectionTitle>% d'attaques par heure</SectionTitle>
      <Card>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.profiles.hourly_attack_pct.map((v, i) => ({ hour: `${i}h`, pct: v }))} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="atkPctGrad3" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#EF4444" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#EF4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="color-mix(in srgb, var(--text-primary) 5%, transparent)" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={3} />
              <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
              <Tooltip content={<PctTip />} />
              <Area type="monotone" dataKey="pct" stroke="#EF4444" strokeWidth={2.5} fill="url(#atkPctGrad3)"
                dot={{ r: 2.5, fill: '#EF4444', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#EF4444', strokeWidth: 2, stroke: 'var(--bg-base)' }}
                name="Attaque %" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Correlations({ data }: { data: DatasetPayload }) {
  const corr = data.correlations;
  const scatterPairs = [
    { x: 'weather', y: 'fridge', xLabel: 'Weather', yLabel: 'Fridge', color1: '#0284C7', color2: '#16A34A', corrVal: corr.matrix[0][1] },
    { x: 'weather', y: 'thermostat', xLabel: 'Weather', yLabel: 'Thermostat', color1: '#0284C7', color2: '#EA580C', corrVal: corr.matrix[0][2] },
    { x: 'fridge', y: 'thermostat', xLabel: 'Fridge', yLabel: 'Thermostat', color1: '#16A34A', color2: '#EA580C', corrVal: corr.matrix[1][2] },
  ];

  const scatterSeries = useMemo(() => {
    const cap = 400;
    const sample = (arr: typeof data.scatter) => {
      if (arr.length <= cap) return arr;
      const step = Math.ceil(arr.length / cap);
      return arr.filter((_, i) => i % step === 0);
    };
    const normal = sample(data.scatter.filter(p => p.label === 0));
    const attack = sample(data.scatter.filter(p => p.label === 1));
    return scatterPairs.map(pair => ({
      ...pair,
      normalData: normal.map(p => ({ x: p[pair.x as keyof typeof data.scatter[number]] as number, y: p[pair.y as keyof typeof data.scatter[number]] as number })),
      attackData: attack.map(p => ({ x: p[pair.x as keyof typeof data.scatter[number]] as number, y: p[pair.y as keyof typeof data.scatter[number]] as number })),
    }));
  }, [data, scatterPairs]);

  return (
    <div className="space-y-5">
      <SectionTitle>Scatter plots — paires de capteurs (Normal vert, Attaque rouge)</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {scatterSeries.map(pair => {
          const corrColor = pair.corrVal > 0 ? '#22C55E' : '#EF4444';
          return (
            <Card key={`${pair.x}-${pair.y}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>{pair.xLabel} vs {pair.yLabel}</div>
                <div className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${corrColor} 15%, transparent)`, color: corrColor }}>
                  r = {pair.corrVal.toFixed(2)}
                </div>
              </div>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 10, left: -15, bottom: 10 }}>
                    <CartesianGrid stroke="color-mix(in srgb, var(--text-primary) 5%, transparent)" />
                    <XAxis type="number" dataKey="x" name={pair.xLabel} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                    <YAxis type="number" dataKey="y" name={pair.yLabel} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      return (
                        <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                          <div className="text-[11px] font-mono" style={{ color: pair.color1 }}>{pair.xLabel}: {d?.x?.toFixed(2)}</div>
                          <div className="text-[11px] font-mono" style={{ color: pair.color2 }}>{pair.yLabel}: {d?.y?.toFixed(2)}</div>
                        </div>
                      );
                    }} />
                    <RScatter name="Normal" data={pair.normalData} fill="#22C55E" fillOpacity={0.45} r={2.5} />
                    <RScatter name="Attaque" data={pair.attackData} fill="#EF4444" fillOpacity={0.7} r={3.5} />
                    <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </Card>
          );
        })}
      </div>
      <SectionTitle>Matrice de corrélation</SectionTitle>
      <Card>
        <div className="flex justify-center">
          <div className="grid gap-1" style={{ gridTemplateColumns: `80px repeat(${corr.labels.length}, 80px)` }}>
            <div />
            {corr.labels.map(l => <div key={l} className="text-center text-[10px] font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>{l}</div>)}
            {corr.matrix.map((row, i) => (
              <React.Fragment key={i}>
                <div className="text-[10px] font-mono font-bold text-right pr-2 flex items-center justify-end" style={{ color: 'var(--text-secondary)' }}>{corr.labels[i]}</div>
                {row.map((v, j) => {
                  const abs = Math.abs(v);
                  const bg = i === j ? 'rgba(124,58,237,0.3)' : v > 0 ? `rgba(34,197,94,${0.15 + abs * 0.6})` : `rgba(239,68,68,${0.15 + abs * 0.6})`;
                  return (
                    <div key={j} className="h-10 rounded flex items-center justify-center text-[11px] font-mono font-bold" style={{ background: bg, color: abs > 0.5 ? '#fff' : 'var(--text-primary)' }}>
                      {v.toFixed(2)}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Profils({ data, fusion }: { data: DatasetPayload; fusion: FusionExtra | null }) {
  const seasonCorr = fusion?.seasonal_corr ?? null;

  return (
    <div className="space-y-5">
      <SectionTitle>Valeurs moyennes par capteur et par saison</SectionTitle>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left py-2 px-3 font-bold" style={{ color: 'var(--text-primary)' }}>Saison</th>
                {['weather', 'fridge', 'thermostat'].map(k => (
                  <th key={k} colSpan={3} className="text-center py-2 px-3 font-bold" style={{ color: k === 'weather' ? '#0284C7' : k === 'fridge' ? '#16A34A' : '#EA580C' }}>{k}</th>
                ))}
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th />
                {['weather', 'fridge', 'thermostat'].map(k => (
                  <React.Fragment key={k}>
                    <th className="text-center py-1 px-2 font-normal" style={{ color: 'var(--text-secondary)' }}>Moy</th>
                    <th className="text-center py-1 px-2 font-normal" style={{ color: 'var(--text-secondary)' }}>σ</th>
                    <th className="text-center py-1 px-2 font-normal" style={{ color: 'var(--text-secondary)' }}>Med</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.seasonal_sensors.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="py-2 px-3 font-bold" style={{ color: 'var(--text-primary)' }}>{String(row.season)}</td>
                  {['weather', 'fridge', 'thermostat'].map(k => (
                    <React.Fragment key={k}>
                      <td className="text-center py-2 px-2 font-mono" style={{ color: 'var(--text-primary)' }}>{String(row[`${k}_mean`])}</td>
                      <td className="text-center py-2 px-2 font-mono" style={{ color: 'var(--text-secondary)' }}>{String(row[`${k}_std`])}</td>
                      <td className="text-center py-2 px-2 font-mono" style={{ color: 'var(--text-secondary)' }}>{String(row[`${k}_median`])}</td>
                    </React.Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <SectionTitle>Répartition saisonnière — Normal vs Attaque + % attaque</SectionTitle>
      <Card>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.seasonal.map(s => ({ ...s, pct: s.total > 0 ? +(s.attack / s.total * 100).toFixed(1) : 0 }))} margin={{ top: 10, right: 30, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="seasonNormGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22C55E" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="#22C55E" stopOpacity={0.25} />
                </linearGradient>
                <linearGradient id="seasonAtkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#EF4444" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#EF4444" stopOpacity={0.25} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="color-mix(in srgb, var(--text-primary) 5%, transparent)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                    <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{d?.label}</div>
                    <div className="text-[11px] font-mono" style={{ color: '#22C55E' }}>Normal : {d?.normal}</div>
                    <div className="text-[11px] font-mono" style={{ color: '#EF4444' }}>Attaques : {d?.attack}</div>
                    <div className="text-[11px] font-mono mt-1" style={{ color: '#7C3AED' }}>% Attaque : {d?.pct}%</div>
                  </div>
                );
              }} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
              <Bar yAxisId="left" dataKey="normal" stackId="a" fill="url(#seasonNormGrad)" name="Normal" />
              <Bar yAxisId="left" dataKey="attack" stackId="a" fill="url(#seasonAtkGrad)" name="Attaque" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="pct" stroke="#7C3AED" strokeWidth={2.5} dot={{ r: 4, fill: '#7C3AED', strokeWidth: 0 }} activeDot={{ r: 6, fill: '#7C3AED', strokeWidth: 2, stroke: 'var(--bg-base)' }} name="% Attaque" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <SectionTitle>Matrices 3×3 par saison (Fusion Insights)</SectionTitle>
      <Card>
        {!seasonCorr || !seasonCorr.seasons?.length ? (
          <div className="text-xs py-6 text-center" style={{ color: 'var(--text-secondary)' }}>Matrices non disponibles</div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {seasonCorr.seasons.map(s => (
                <div key={s.season}>
                  <div className="text-[10px] font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
                  <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(3, minmax(34px, 1fr))` }}>
                    {s.matrix.map((rowArr, i) => rowArr.map((v, j) => {
                      const abs = Math.abs(v);
                      const bg = i === j ? 'rgba(124,58,237,0.3)' : v > 0 ? `rgba(34,197,94,${0.12 + abs * 0.55})` : `rgba(239,68,68,${0.12 + abs * 0.55})`;
                      return (
                        <div key={`${i}-${j}`} className="h-7 rounded flex items-center justify-center text-[9px] font-mono font-bold"
                          style={{ background: bg, color: abs > 0.5 ? '#fff' : 'var(--text-primary)' }}>
                          {v.toFixed(2)}
                        </div>
                      );
                    }))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[9px] justify-end" style={{ color: 'var(--text-secondary)' }}>
              <span className="w-2 h-2 rounded-sm" style={{ background: 'rgba(34,197,94,0.5)' }} /> positive
              <span className="w-2 h-2 rounded-sm ml-2" style={{ background: 'rgba(239,68,68,0.5)' }} /> négative
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ═══════════════ MAIN ═══════════════

export default function DatasetOverview() {
  const [data, setData] = useState<DatasetPayload | null>(null);
  const [fusion, setFusion] = useState<FusionExtra | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('vue');
  const [visibleTab, setVisibleTab] = useState<TabId>('vue');

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisibleTab(tab));
    return () => cancelAnimationFrame(id);
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    const headers = authHeaders();
    fetch(`${API}/phase2/dataset-overview`, { headers })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    fetch(`${API}/phase2/fusion-insights`, { headers })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => {
        if (cancelled) return;
        setFusion({
          seasonal_corr: d?.seasonal_corr ?? null,
          confusion_matrix: d?.comparison?.confusion_matrix ?? null,
        });
      })
      .catch(() => { if (!cancelled) setFusion(null); });

    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} /></div>;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <Database className="w-12 h-12" style={{ color: 'var(--text-secondary)' }} />
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Impossible de charger le dataset</div>
        {error && <div className="text-[10px] font-mono" style={{ color: 'var(--accent-danger)' }}>{error}</div>}
      </div>
    );
  }

  const g = data.global;

  return (
    <ErrorBoundary fallback={<div className="text-sm text-center p-8" style={{ color: 'var(--accent-danger)' }}>Erreur de rendu</div>}>
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>Vue globale du dataset</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {data.filename} — {g.start} → {g.end} — {g.duration_days} jours — {g.total.toLocaleString()} échantillons
            </p>
          </div>
        </div>

        {/* Horizontal Tabs */}
        <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold font-display whitespace-nowrap transition-all"
              style={{
                background: tab === t.id ? 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'transparent',
                color: tab === t.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                border: tab === t.id ? '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)' : '1px solid transparent',
              }}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {visibleTab === 'vue' && <VueGlobale data={data} />}
        {visibleTab === 'tendances' && <Tendances data={data} />}
        {visibleTab === 'distributions' && <Distributions data={data} />}
        {visibleTab === 'correlations' && <Correlations data={data} />}
        {visibleTab === 'profils' && <Profils data={data} fusion={fusion} />}
      </div>
    </ErrorBoundary>
  );
}
