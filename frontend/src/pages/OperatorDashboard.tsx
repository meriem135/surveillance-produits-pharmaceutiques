import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, AlertTriangle, Monitor, Cpu, CheckCircle,
  Thermometer, Snowflake, CloudSun,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import type { Device, Alert } from '../types';

const API = '/api/v1';

async function fetchJsonOrEmpty<T>(url: string, headers: Record<string, string>): Promise<T[]> {
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function getToken() {
  return localStorage.getItem('token');
}

interface SeasonData {
  season: string;
  label: string;
  emoji: string;
  normal: number;
  attack: number;
  detected: number;
  total: number;
  recall: number;
  precision: number;
}

interface SensorInfo {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  gradient: [string, string];
  count: number;
  description: string;
}

const SEASON_KEYS = ['hiver', 'printemps', 'ete', 'automne'] as const;
const SEASON_LABELS: Record<string, string> = {
  hiver: 'Hiver', printemps: 'Printemps', ete: 'Été', automne: 'Automne',
};
const SEASON_EMOJIS: Record<string, string> = {
  hiver: '❄', printemps: '🌸', ete: '☀', automne: '🍂',
};

function SecurityGauge({ score }: { score: number }) {
  const color = score >= 80 ? '#22C55E' : score >= 50 ? '#F97316' : '#EF4444';
  const label = score >= 80 ? 'SÉCURISÉ' : score >= 50 ? 'ATTENTION' : 'CRITIQUE';
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-32">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="8" />
          <motion.circle
            cx="60" cy="60" r="52" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 326.7} 326.7`}
            initial={{ strokeDasharray: '0 326.7' }}
            animate={{ strokeDasharray: `${(score / 100) * 326.7} 326.7` }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black" style={{ color }}>{score}</span>
          <span className="text-[9px] font-mono tracking-wider" style={{ color: 'var(--text-secondary)' }}>/ 100</span>
        </div>
      </div>
      <span className="mt-2 text-xs font-bold font-mono tracking-wider" style={{ color }}>{label}</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; color: string; sub?: string }) {
  return (
    <motion.div
      className="p-4 rounded-xl flex items-center gap-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      whileHover={{ y: -2 }}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold truncate" style={{ color: 'var(--text-primary)' }}>{value}</div>
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
        {sub && <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--accent-primary)' }}>{sub}</div>}
      </div>
    </motion.div>
  );
}

function SensorCard({ sensor }: { sensor: SensorInfo }) {
  const Icon = sensor.icon;
  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl p-5"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${sensor.color} 6%, var(--bg-card)), var(--bg-card))`,
        border: `1px solid color-mix(in srgb, ${sensor.color} 20%, var(--border))`,
      }}
      whileHover={{ y: -3, boxShadow: `0 8px 32px color-mix(in srgb, ${sensor.color} 15%, transparent)` }}
      transition={{ duration: 0.25 }}
    >
      <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full opacity-[0.07]"
        style={{ background: sensor.color }} />
      <div className="flex items-start justify-between relative z-10">
        <div>
          <div className="text-[10px] font-mono font-bold tracking-widest uppercase mb-1"
            style={{ color: sensor.color }}>
            {sensor.label}
          </div>
          <div className="text-3xl font-black" style={{ color: 'var(--text-primary)' }}>
            {sensor.count}
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            {sensor.description}
          </div>
        </div>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${sensor.color} 12%, transparent)` }}>
          <Icon className="w-5 h-5" style={{ color: sensor.color }} />
        </div>
      </div>
      <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${sensor.gradient[0]}, ${sensor.gradient[1]})` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, (sensor.count / Math.max(sensor.count, 1)) * 100)}%` }}
          transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
        />
      </div>
    </motion.div>
  );
}

interface TooltipPayloadItem {
  color: string;
  name: string;
  value: number;
}

function SeasonalTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-2xl backdrop-blur-md"
      style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-bold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <span>{SEASON_EMOJIS[label || ''] || ''}</span> {SEASON_LABELS[label || ''] || label}
      </div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>
            {p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function DetectionTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-2xl backdrop-blur-md"
      style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        {SEASON_EMOJIS[label || ''] || ''} {SEASON_LABELS[label || ''] || label}
      </div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>
            {(p.value * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export default function OperatorDashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [seasonData, setSeasonData] = useState<SeasonData[]>([]);

  const fetchData = (isInitial = false) => {
    const token = getToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    Promise.all([
      fetchJsonOrEmpty<Device>(`${API}/devices`, headers),
      fetchJsonOrEmpty<Alert>(`${API}/alerts?limit=10`, headers),
    ]).then(([d, a]) => {
      setDevices(d);
      setAlerts(a);
    }).finally(() => { if (isInitial) setLoading(false); });
  };

  useEffect(() => {
    fetchData(true);
    const controller = new AbortController();
    (async () => {
      const token = getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const results: SeasonData[] = [];
      for (const sk of SEASON_KEYS) {
        if (controller.signal.aborted) break;
        try {
          const r = await fetch(`${API}/phase2/timeline?sensor=weather&season=${sk}&limit=200`, { headers });
          if (!r.ok) continue;
          const res = await r.json();
          if (res?.summary) {
            results.push({
              season: sk,
              label: SEASON_LABELS[sk],
              emoji: SEASON_EMOJIS[sk],
              normal: res.summary.normal ?? 0,
              attack: res.summary.attack ?? 0,
              detected: res.summary.detected ?? 0,
              total: res.summary.total ?? 0,
              recall: res.summary.recall ?? 0,
              precision: res.summary.precision ?? 0,
            });
          }
        } catch { /* ignore */ }
      }
      if (results.length > 0 && !controller.signal.aborted) setSeasonData(results);
    })();
    const interval = setInterval(() => fetchData(), 5000);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  const online = devices.filter(d => d.status === 'online').length;
  const quarantined = devices.filter(d => d.status === 'quarantined').length;
  const avgRisk = devices.length ? Math.round(devices.reduce((s, d) => s + d.risk_score, 0) / devices.length) : 0;
  const criticalAlerts = alerts.filter(a => (a.rule?.level || 0) >= 10).length;
  const securityScore = Math.max(0, 100 - avgRisk - criticalAlerts * 5);

  const sensorCounts = useMemo(() => {
    const counts: Record<string, number> = { thermostat: 0, fridge: 0, weather: 0 };
    devices.forEach(d => {
      const t = d.device_type?.toLowerCase() || '';
      if (t in counts) counts[t]++;
    });
    return counts;
  }, [devices]);

  const sensors: SensorInfo[] = useMemo(() => [
    {
      key: 'thermostat', label: 'Thermostat', icon: Thermometer, color: '#FF9100',
      gradient: ['#FF9100', '#FF6D00'] as [string, string],
      count: sensorCounts.thermostat, description: 'Température ambiante',
    },
    {
      key: 'fridge', label: 'Fridge', icon: Snowflake, color: '#00E676',
      gradient: ['#00E676', '#00C853'] as [string, string],
      count: sensorCounts.fridge, description: 'Réfrigérateur industriel',
    },
    {
      key: 'weather', label: 'Weather', icon: CloudSun, color: '#38BDF8',
      gradient: ['#38BDF8', '#0EA5E9'] as [string, string],
      count: sensorCounts.weather, description: 'Station météo',
    },
  ], [sensorCounts]);

  const chartData = useMemo(() =>
    seasonData.map(s => ({
      season: s.season,
      label: s.label,
      Normal: s.normal,
      Attaque: s.attack,
      Détecté: s.detected,
      recall: s.recall,
      precision: s.precision,
    })),
    [seasonData],
  );

  const radarData = useMemo(() =>
    seasonData.map(s => ({
      season: s.label,
      'Détection': Math.round(s.recall * 100),
      'Précision': Math.round(s.precision * 100),
      fullMark: 100,
    })),
    [seasonData],
  );

  const totalNormal = seasonData.reduce((s, d) => s + d.normal, 0);
  const totalAttack = seasonData.reduce((s, d) => s + d.attack, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>
            Tableau de bord opérateur
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Vue simplifiée de la sécurité de l'usine
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-mono"
          style={{ background: 'color-mix(in srgb, var(--accent-success) 10%, transparent)', color: 'var(--accent-success)', border: '1px solid color-mix(in srgb, var(--accent-success) 25%, transparent)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          {devices.length} appareils suivis
        </div>
      </div>

      {/* Row 1: Security Gauge + KPI Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-1 flex items-center justify-center p-4 rounded-xl"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <SecurityGauge score={securityScore} />
        </div>
        <div className="lg:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={Monitor} label="Appareils en ligne" value={online} color="#22C55E" sub={quarantined > 0 ? `${quarantined} en quarantaine` : undefined} />
          <StatCard icon={AlertTriangle} label="Alertes critiques" value={criticalAlerts} color="#EF4444" sub={alerts.length > 0 ? `${alerts.length} totales` : undefined} />
          <StatCard icon={Shield} label="Risque moyen" value={`${avgRisk}%`} color={avgRisk >= 70 ? '#EF4444' : avgRisk >= 30 ? '#F97316' : '#22C55E'} />
          <StatCard icon={Cpu} label="Types d'appareils" value={new Set(devices.map(d => d.device_type)).size} color="#818cf8" sub={`${devices.length} total`} />
        </div>
      </div>

      {/* Row 2: Sensor Count Cards */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-4 rounded-full" style={{ background: 'var(--accent-primary)' }} />
          <h2 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>
            Nombre de capteurs par type
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {sensors.map(s => <SensorCard key={s.key} sensor={s} />)}
        </div>
      </div>

      {/* Row 3: Seasonal Attack vs Normal Charts (one per sensor) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-4 rounded-full" style={{ background: 'var(--accent-danger)' }} />
          <h2 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>
            Attaque vs Normal par capteur & saison
          </h2>
          <span className="text-[10px] font-mono ml-2 px-2 py-0.5 rounded-full"
            style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            {totalNormal.toLocaleString()} normal · {totalAttack.toLocaleString()} attaques
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {sensors.map((sensor) => {
            const Icon = sensor.icon;
            return (
              <motion.div
                key={sensor.key}
                className="rounded-2xl p-5"
                style={{
                  background: `linear-gradient(160deg, color-mix(in srgb, ${sensor.color} 4%, var(--bg-card)), var(--bg-card))`,
                  border: `1px solid color-mix(in srgb, ${sensor.color} 15%, var(--border))`,
                }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: `color-mix(in srgb, ${sensor.color} 12%, transparent)` }}>
                      <Icon className="w-4 h-4" style={{ color: sensor.color }} />
                    </div>
                    <div>
                      <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{sensor.label}</div>
                      <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {sensor.count} capteurs
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                    style={{ background: `color-mix(in srgb, ${sensor.color} 10%, transparent)`, color: sensor.color }}>
                    Saisonnier
                  </div>
                </div>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }} barCategoryGap="20%">
                      <defs>
                        <linearGradient id={`normalGrad-${sensor.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22C55E" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#22C55E" stopOpacity={0.5} />
                        </linearGradient>
                        <linearGradient id={`attackGrad-${sensor.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#EF4444" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#EF4444" stopOpacity={0.5} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        stroke="var(--text-secondary)"
                        tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="var(--text-secondary)"
                        tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                      />
                      <Tooltip content={<SeasonalTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                      <Legend
                        wrapperStyle={{ fontSize: 10, color: 'var(--text-secondary)' }}
                        iconType="plainline"
                        iconSize={12}
                      />
                      <Bar dataKey="Normal" fill={`url(#normalGrad-${sensor.key})`} radius={[4, 4, 0, 0]} name="Normal" />
                      <Bar dataKey="Attaque" fill={`url(#attackGrad-${sensor.key})`} radius={[4, 4, 0, 0]} name="Attaque" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Row 4: Detection Rate + Radar + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Detection Rate Line Chart */}
        <motion.div
          className="rounded-2xl p-5"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>
                Taux de détection
              </div>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                Recall par saison
              </div>
            </div>
          </div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="recallGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A855F7" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#A855F7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="precisionGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00FFA3" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#00FFA3" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="var(--text-secondary)"
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, 1]}
                  stroke="var(--text-secondary)"
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                />
                <Tooltip content={<DetectionTooltip />} />
                <Area
                  type="monotone"
                  dataKey="recall"
                  stroke="#A855F7"
                  strokeWidth={2.5}
                  fill="url(#recallGrad)"
                  dot={{ r: 4, fill: '#A855F7', strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: '#A855F7', strokeWidth: 2, stroke: 'var(--bg-base)' }}
                  name="Détection"
                />
                <Area
                  type="monotone"
                  dataKey="precision"
                  stroke="#00FFA3"
                  strokeWidth={2.5}
                  fill="url(#precisionGrad)"
                  dot={{ r: 4, fill: '#00FFA3', strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: '#00FFA3', strokeWidth: 2, stroke: 'var(--bg-base)' }}
                  name="Précision"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Radar Chart */}
        <motion.div
          className="rounded-2xl p-5"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>
                Performance saisonnière
              </div>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                Radar multi-métriques
              </div>
            </div>
          </div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis
                  dataKey="season"
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                />
                <PolarRadiusAxis
                  angle={30}
                  domain={[0, 100]}
                  tick={{ fontSize: 9, fill: 'var(--text-secondary)' }}
                  axisLine={false}
                />
                <Radar
                  name="Détection"
                  dataKey="Détection"
                  stroke="#A855F7"
                  fill="#A855F7"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
                <Radar
                  name="Précision"
                  dataKey="Précision"
                  stroke="#00FFA3"
                  fill="#00FFA3"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Legend
                  wrapperStyle={{ fontSize: 10, color: 'var(--text-secondary)' }}
                  iconType="plainline"
                  iconSize={10}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Detected Attacks Stacked Bar */}
        <motion.div
          className="rounded-2xl p-5"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-bold font-display" style={{ color: 'var(--text-primary)' }}>
                Attaques détectées
              </div>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                Détecté vs non-détecté
              </div>
            </div>
          </div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }} layout="vertical" barCategoryGap="25%">
                <defs>
                  <linearGradient id="detectedGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#00FFA3" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#00E676" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="missedGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="#DC2626" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="var(--text-secondary)"
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  stroke="var(--text-secondary)"
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                />
                <Tooltip content={<SeasonalTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Legend
                  wrapperStyle={{ fontSize: 10, color: 'var(--text-secondary)' }}
                  iconType="plainline"
                  iconSize={10}
                />
                <Bar dataKey="Détecté" stackId="a" fill="url(#detectedGrad)" name="Détecté" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Attaque" stackId="a" fill="url(#missedGrad)" name="Non-détecté" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Row 5: Risk Devices + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>Appareils à risque</h2>
          </div>
          <div className="space-y-2">
            {devices.filter(d => d.risk_score >= 30).slice(0, 6).map(device => (
              <div key={device.id}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{
                    background: device.risk_score >= 70 ? '#EF4444' : device.risk_score >= 30 ? '#F97316' : '#22C55E'
                  }} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{device.name}</div>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{device.device_type} · {device.location}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono font-bold" style={{
                    color: device.risk_score >= 70 ? '#EF4444' : device.risk_score >= 30 ? '#F97316' : '#22C55E'
                  }}>{device.risk_score}</span>
                  {device.status === 'quarantined' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{
                      background: 'color-mix(in srgb, #EF4444 15%, transparent)',
                      color: '#EF4444', border: '1px solid color-mix(in srgb, #EF4444 30%, transparent)'
                    }}>Q</span>
                  )}
                </div>
              </div>
            ))}
            {devices.filter(d => d.risk_score >= 30).length === 0 && (
              <div className="flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--text-secondary)' }}>
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm">Tous les appareils sont à faible risque</span>
              </div>
            )}
          </div>
        </div>

        <div className="p-5 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>Dernières alertes</h2>
          </div>
          <div className="space-y-2">
            {alerts.slice(0, 6).map((alert, i) => {
              const level = alert.rule?.level || 0;
              const color = level >= 10 ? '#EF4444' : level >= 5 ? '#F97316' : '#818cf8';
              return (
                <div key={alert.id || i}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg"
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                  <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{alert.rule?.description || alert.description || 'Alerte'}</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {alert.rule?.id || 'N/A'} · {alert.data?.device || alert.device || 'Inconnu'}
                    </div>
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{
                    background: `color-mix(in srgb, ${color} 15%, transparent)`,
                    color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`
                  }}>{level}</span>
                </div>
              );
            })}
            {alerts.length === 0 && (
              <div className="flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--text-secondary)' }}>
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm">Aucune alerte récente</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
