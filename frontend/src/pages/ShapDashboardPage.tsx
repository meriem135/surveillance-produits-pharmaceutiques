import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import {
  Brain,
  Sparkles,
  Thermometer,
  Clock,
  CloudSun,
  AlertTriangle,
  TrendingUp,
  Download,
  Loader2,
  Zap,
  Info,
  Filter,
  X,
  ShieldAlert,
  Database,
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { authHeaders } from '../lib/auth';
import ShapPointReport from '../components/ShapPointReport';
interface ShapGlobalItem {
  feature: string;
  label: string;
  group: string;
  shap_importance: number;
}
interface ShapMonthly {
  month: number;
  month_name: string;
  count: number;
  [key: string]: number | string;
}
interface ShapSeasonal {
  [season: string]: {
    count: number;
    importance: Array<{
      feature: string;
      label: string;
      shap_importance: number;
    }>;
  };
}
interface ShapCause {
  feature: string;
  label?: string;
  shap_value: number;
  feature_value: number;
  interpretation?: string;
  group?: string;
}
interface ShapPointResponse {
  available: boolean;
  error?: string;
  timestamp: string;
  requested_timestamp?: string;
  index: number;
  is_anomaly: boolean;
  anomaly_score: number;
  prediction: number;
  label: number;
  month: number;
  season: string;
  risk_score_per_100: number;
  sensor_values: Record<string, number>;
  group_shap: Record<string, number>;
  dominant_group: string;
  dominant_sensor: string;
  top_causes: ShapCause[];
  top_normal: ShapCause[];
  model_kind: string;
  shap_method: string;
}
interface PharmaReportResponse {
  report: string;
  guardian: string;
  sensor: string;
  sensor_label: string;
  domain: 'production' | 'stock' | 'logistics';
  domain_label: string;
  sensor_role: string;
  product_impact: string;
  attack_id: string | null;
  attack_name: string | null;
  attack_category: string | null;
  severity: string;
  risk_score_per_100: number;
  label: number;
  is_anomaly: boolean;
  season: string | null;
  device: string | null;
  sensor_values: Record<string, number>;
  why: string;
  shap_causes_summary: string[];
  impact: { production_impact: number; stock_impact: number; effect: string };
  actions: string[];
  disposition: { label: string; description: string };
  regulatory: string[];
  mitigation: string[];
  ai_context_enabled: boolean;
  error?: string;
}
interface DetectionMetrics {
  tp: number;
  fp: number;
  fn: number;
  recall: number;
  precision: number;
  f1: number;
  scored_n: number;
  scored_on: string;
}
interface ShapYearlyResponse {
  available: boolean;
  n_samples: number;
  n_anomalies: number;
  shap_method?: string;
  model_kind?: string;
  n_attacks_sample?: number;
  n_normals_sample?: number;
  n_anomalies_pool?: number;
  stratified?: boolean;
  sampling_note?: string;
  n_real_attacks?: number;
  n_real_days?: number;
  detection_metrics?: DetectionMetrics;
  attack_importance?: ShapGlobalItem[];
  normal_importance?: ShapGlobalItem[];
  low_sample_warning?: string | null;
  global_importance: ShapGlobalItem[];
  group_importance: Record<string, number>;
  monthly_shap: ShapMonthly[];
  seasonal_breakdown: ShapSeasonal;
  shap_feature_correlation: Record<string, number>;
  feature_names: string[];
  filter?: {
    day?: number;
    month?: number;
    season?: string;
    start_doy?: number;
    end_doy?: number;
    hour?: number;
  };
}
interface ShapHourlyResponse {
  available: boolean;
  n_samples: number;
  shap_method?: string;
  low_sample_warning?: string | null;
  hours: ShapMonthly[];
  feature_names: string[];
}
interface AttackDatasetRow {
  datetime: string;
  weather_temp: number;
  fridge_temp: number;
  thermostat_temp: number;
  weather_fridge_diff: number;
  weather_thermostat_diff: number;
  fridge_thermostat_diff: number;
  label: number;
  prediction: number;
  anomaly_score: number;
  sensor_values?: Record<string, number>;
}
interface AttackDatasetResponse {
  available: boolean;
  rows: AttackDatasetRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  error?: string;
  summary?: {
    total: number;
    normal: number;
    attack: number;
    detected: number;
    recall: number;
  };
  filters_applied?: Record<string, unknown>;
}
const GROUP_COLORS: Record<string, string> = {
  weather: '#00E5FF',
  fridge: '#00FFA3',
  thermostat: '#A855F7',
  time: '#FF2D78',
  cross: '#FFB830',
  other: '#8B80B0',
};
const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
const GROUP_LABELS: Record<string, string> = {
  weather: 'Météo',
  fridge: 'Frigo',
  thermostat: 'Thermostat',
  time: 'Temporel',
  cross: 'Inter-Capteurs',
};
const SEASON_LABELS: Record<string, string> = {
  winter: 'Hiver',
  spring: 'Printemps',
  summer: 'Été',
  autumn: 'Automne',
};
const SEASON_COLORS: Record<string, string> = {
  winter: '#00E5FF',
  spring: '#00FFA3',
  summer: '#FFB830',
  autumn: '#FF2D78',
};
function KpiCard({
  label,
  value,
  color,
  icon,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      className="rounded-2xl p-4 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${color}08 0%, ${color}12 100%)`,
        border: `1px solid ${color}20`,
        minWidth: 140,
      }}
    >
      {' '}
      <div
        className="absolute inset-0 opacity-15"
        style={{
          background: `radial-gradient(circle at 80% 20%, ${color}30, transparent 60%)`,
        }}
      />{' '}
      <div className="relative flex items-center justify-between mb-1.5">
        {' '}
        <span
          className="text-[9px] font-semibold uppercase tracking-widest"
          style={{ color: `${color}CC` }}
        >
          {label}
        </span>{' '}
        <span style={{ color }}>{icon}</span>{' '}
      </div>{' '}
      <div
        className="relative font-display text-lg font-black tracking-tight"
        style={{ color }}
      >
        {value}
      </div>{' '}
      {sub && (
        <div
          className="relative text-[9px] font-mono mt-0.5"
          style={{ color: `${color}88` }}
        >
          {sub}
        </div>
      )}{' '}
    </motion.div>
  );
}
function BackgroundOrbs() {
  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {' '}
      <div
        className="absolute w-[600px] h-[600px] rounded-full -top-40 -left-40 animate-orb"
        style={{
          background:
            'radial-gradient(circle, rgba(0,229,255,0.06) 0%, transparent 70%)',
        }}
      />{' '}
      <div
        className="absolute w-[500px] h-[500px] rounded-full top-1/3 -right-32 animate-orb-reverse"
        style={{
          background:
            'radial-gradient(circle, rgba(168,85,247,0.05) 0%, transparent 70%)',
        }}
      />{' '}
      <div
        className="absolute w-[450px] h-[450px] rounded-full bottom-10 left-1/4 animate-orb-slow"
        style={{
          background:
            'radial-gradient(circle, rgba(0,255,163,0.04) 0%, transparent 70%)',
        }}
      />{' '}
      <div
        className="absolute w-[300px] h-[300px] rounded-full top-2/3 right-1/3 animate-orb"
        style={{
          background:
            'radial-gradient(circle, rgba(255,45,120,0.03) 0%, transparent 70%)',
        }}
      />{' '}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(rgba(0,229,255,0.03) 0.5px, transparent 0.5px)',
          backgroundSize: '40px 40px',
        }}
      />{' '}
    </div>
  );
}
function Section({
  title,
  desc,
  children,
  color = '#FFB830',
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden relative"
      style={{
        background:
          'linear-gradient(160deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.015) 100%)',
        border: `1px solid ${color}25`,
        boxShadow: `0 0 30px ${color}08, inset 0 1px 0 ${color}10`,
      }}
    >
      {' '}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          boxShadow: `0 0 12px ${color}`,
        }}
      />{' '}
      <div
        className="px-5 py-3.5 flex items-center gap-2"
        style={{ borderBottom: `1px solid ${color}15` }}
      >
        {' '}
        <Brain
          className="w-4 h-4"
          style={{ color, filter: `drop-shadow(0 0 5px ${color}80)` }}
        />{' '}
        <h3
          className="font-display font-bold text-sm"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {title}
        </h3>{' '}
        {desc && (
          <span
            className="ml-auto text-[9px] px-2 py-0.5 rounded-full"
            style={{
              color,
              background: `${color}12`,
              border: `1px solid ${color}25`,
            }}
          >
            {desc}
          </span>
        )}{' '}
      </div>{' '}
      <div className="p-5">{children}</div>{' '}
    </motion.div>
  );
}
function ShapImportanceTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ShapGlobalItem }> }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload as ShapGlobalItem;
  const color = GROUP_COLORS[item.group] || '#8B80B0';
  return (
    <div
      className="px-3 py-2 rounded-lg text-[10px]"
      style={{
        background: 'rgba(0,0,0,0.88)',
        border: `1px solid ${color}55`,
        boxShadow: `0 0 16px ${color}30`,
      }}
    >
      <div className="font-bold" style={{ color }}>
        {item.label}
      </div>
      <div className="mt-0.5 font-mono" style={{ color: 'var(--color-text-secondary)' }}>
        {GROUP_LABELS[item.group] || item.group} · {item.shap_importance.toFixed(6)}
      </div>
    </div>
  );
}
function GlobalImportanceChart({ data }: { data: ShapGlobalItem[] }) {
  const height = Math.max(120, data.length * 32 + 10);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 32, left: 0, bottom: 0 }}
      >
        {' '}
        <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 9, fill: 'var(--color-text-secondary)' }}
          tickLine={false}
          axisLine={false}
        />{' '}
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 9, fill: 'var(--color-text-secondary)' }}
          tickLine={false}
          axisLine={false}
          width={100}
        />{' '}
        <Tooltip content={<ShapImportanceTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Bar dataKey="shap_importance" name="Importance SHAP" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={GROUP_COLORS[entry.group] || '#8B80B0'} />
          ))}
        </Bar>{' '}
      </BarChart>{' '}
    </ResponsiveContainer>
  );
}
function GlobalImportanceGallery({ data }: { data: ShapGlobalItem[] }) {
  const variants = [
    {
      key: 'barres',
      title: 'Barres horizontales',
      desc: 'Comparaison linéaire par feature',
      node: <GlobalImportanceChart data={data} />,
    },
  ];
  return (
    <div>
      {' '}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {' '}
        {variants.map((v) => (
          <div
            key={v.key}
            className="rounded-xl p-3"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {' '}
            <div className="mb-2">
              {' '}
              <div className="text-[10px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {v.title}
              </div>{' '}
              <div className="text-[8px]" style={{ color: 'var(--color-text-secondary)' }}>
                {v.desc}
              </div>{' '}
            </div>{' '}
            {v.node}{' '}
          </div>
        ))}{' '}
      </div>{' '}
    </div>
  );
}
function MonthlyShapHeatmap({
  data,
  features,
}: {
  data: ShapMonthly[];
  features: string[];
}) {
  const maxVal = Math.max(
    ...data.flatMap((r) => features.map((f) => Math.abs(Number(r[f]) || 0))),
    0.0001,
  );
  return (
    <div className="overflow-x-auto">
      {' '}
      <div className="flex gap-0.5" style={{ minWidth: features.length * 60 }}>
        {' '}
        <div className="w-12 shrink-0" />{' '}
        {data.map((m, mi) => (
          <div
            key={mi}
            className="text-[7px] font-mono text-center"
            style={{ width: 60, color: 'var(--color-text-secondary)' }}
          >
            {' '}
            {m.month_name}{' '}
          </div>
        ))}{' '}
      </div>{' '}
      {features.map((feat) => {
        const group = feat.startsWith('weather')
          ? 'weather'
          : feat.startsWith('fridge')
            ? 'fridge'
            : feat.startsWith('thermostat')
              ? 'thermostat'
              : feat.includes('cross') || feat.includes('diff')
                ? 'cross'
                : 'time';
        return (
          <div
            key={feat}
            className="flex items-center gap-0.5 mt-0.5"
            style={{ minWidth: features.length * 60 }}
          >
            {' '}
            <div className="flex items-center gap-1 w-12 shrink-0">
              {' '}
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: GROUP_COLORS[group] }}
              />{' '}
              <span
                className="text-[7px] font-mono truncate"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {feat.split('_')[0]}
              </span>{' '}
            </div>{' '}
            {data.map((m) => {
              const val = Math.abs(Number(m[feat]) || 0);
              const intensity = val / maxVal;
              return (
                <div
                  key={m.month}
                  className="rounded-sm"
                  title={`${feat}: ${val.toFixed(5)}`}
                  style={{
                    width: 60,
                    height: 18,
                    background: `rgba(${hexToRgb(GROUP_COLORS[group] || '#8B80B0')}, ${Math.max(0.08, intensity)})`,
                    border:
                      val === 0
                        ? '1px solid rgba(255,255,255,0.04)'
                        : undefined,
                  }}
                />
              );
            })}{' '}
          </div>
        );
      })}{' '}
      <div className="flex items-center justify-end gap-1.5 mt-2">
        {' '}
        <span
          className="text-[8px]"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Faible
        </span>{' '}
        <div
          className="w-20 h-2 rounded"
          style={{
            background:
              'linear-gradient(90deg, rgba(255,255,255,0.04), #FFB830)',
            boxShadow: '0 0 6px #FFB83040',
          }}
        />{' '}
        <span className="text-[8px]" style={{ color: '#FFB830' }}>
          Fort
        </span>{' '}
      </div>{' '}
    </div>
  );
}
function HourlyShapHeatmap({
  data,
  features,
}: {
  data: ShapMonthly[];
  features: string[];
}) {
  const maxVal = Math.max(
    ...data.flatMap((r) => features.map((f) => Math.abs(Number(r[f]) || 0))),
    0.0001,
  );
  const groupOf = (feat: string) =>
    feat.startsWith('weather')
      ? 'weather'
      : feat.startsWith('fridge')
        ? 'fridge'
        : feat.startsWith('thermostat')
          ? 'thermostat'
          : feat.includes('diff')
            ? 'cross'
            : 'time';
  const rgbOf = (group: string) => hexToRgb(GROUP_COLORS[group] || '#8B80B0');
  return (
    <div className="overflow-x-auto">
      {' '}
      <div style={{ minWidth: 80 + features.length * 46 }}>
        {' '}
        <div className="flex items-center gap-0.5">
          {' '}
          <div
            className="w-[52px] shrink-0 text-[8px] font-mono"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Heure
          </div>{' '}
          {features.map((f) => (
            <div
              key={f}
              className="text-[7px] font-mono text-center truncate"
              style={{ width: 46, color: 'var(--color-text-secondary)' }}
              title={f}
            >
              {' '}
              {FEATURE_SHORT[f] || f.split('_')[0]}{' '}
            </div>
          ))}{' '}
        </div>{' '}
        {data.map((r) => (
          <div key={r.hour} className="flex items-center gap-0.5 mt-0.5">
            {' '}
            <div
              className="w-[52px] shrink-0 text-[8px] font-mono"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {' '}
              {r.hour_label}{' '}
            </div>{' '}
            {features.map((f) => {
              const val = Math.abs(Number(r[f]) || 0);
              const intensity = val / maxVal;
              return (
                <div
                  key={f}
                  className="rounded-sm"
                  title={`${f} @ ${r.hour_label}: ${val.toFixed(5)} (n=${r.count})`}
                  style={{
                    width: 46,
                    height: 18,
                    background: `rgba(${rgbOf(groupOf(f))}, ${Math.max(0.08, intensity)})`,
                    border:
                      val === 0
                        ? '1px solid rgba(255,255,255,0.04)'
                        : undefined,
                  }}
                />
              );
            })}{' '}
          </div>
        ))}{' '}
        <div className="flex items-center justify-end gap-1.5 mt-2">
          {' '}
          <span
            className="text-[8px]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Faible
          </span>{' '}
          <div
            className="w-20 h-2 rounded"
            style={{
              background:
                'linear-gradient(90deg, rgba(255,255,255,0.04), #FFB830)',
              boxShadow: '0 0 6px #FFB83040',
            }}
          />{' '}
          <span className="text-[8px]" style={{ color: '#FFB830' }}>
            Fort
          </span>{' '}
        </div>{' '}
      </div>{' '}
    </div>
  );
}
function SeasonalShapChart({ data }: { data: ShapSeasonal }) {
  const seasons = ['winter', 'spring', 'summer', 'autumn'];
  const allFeats = new Set<string>();
  for (const s of seasons) {
    (data[s]?.importance || []).forEach((f: any) => allFeats.add(f.feature));
  }
  const featList = [...allFeats].slice(0, 7);
  const chartData = featList.map((feat) => {
    const row: Record<string, any> = { feature: FEATURE_SHORT[feat] || feat };
    for (const s of seasons) {
      const found = (data[s]?.importance || []).find(
        (f: any) => f.feature === feat,
      );
      row[s] = found ? found.shap_importance : 0;
    }
    return row;
  });
  return (
    <div>
      {' '}
      <div className="flex gap-3 mb-3 flex-wrap">
        {' '}
        {seasons.map((s) => (
          <div key={s} className="flex items-center gap-1 text-[9px]">
            {' '}
            <div
              className="w-2.5 h-2.5 rounded"
              style={{ background: SEASON_COLORS[s] }}
            />{' '}
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {SEASON_LABELS[s]}
            </span>{' '}
            <span className="font-mono" style={{ color: SEASON_COLORS[s] }}>
              {data[s]?.count || 0}
            </span>{' '}
          </div>
        ))}{' '}
      </div>{' '}
      <ResponsiveContainer width="100%" height={260}>
        {' '}
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
        >
          {' '}
          <CartesianGrid
            stroke="rgba(255,255,255,0.04)"
            horizontal={false}
          />{' '}
          <XAxis
            type="number"
            tick={{ fontSize: 9, fill: 'var(--color-text-secondary)' }}
          />{' '}
          <YAxis
            type="category"
            dataKey="feature"
            tick={{ fontSize: 9, fill: 'var(--color-text-secondary)' }}
            width={100}
          />{' '}
          <Tooltip
            contentStyle={{
              background: 'rgba(0,0,0,0.85)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 10,
            }}
          />{' '}
          {seasons.map((s) => (
            <Bar
              key={s}
              dataKey={s}
              fill={SEASON_COLORS[s]}
              name={SEASON_LABELS[s]}
              stackId="a"
            />
          ))}{' '}
        </BarChart>{' '}
      </ResponsiveContainer>{' '}
    </div>
  );
}
const FEATURE_SHORT: Record<string, string> = {
  weather_temp: 'Weather T°',
  fridge_temp: 'Fridge T°',
  weather_diff_1: 'Weather Δ₁',
  weather_roll_mean_10: 'Weather μ₁₀',
  weather_roll_std_10: 'Weather σ₁₀',
  fridge_diff_1: 'Fridge Δ₁',
  fridge_roll_mean_10: 'Fridge μ₁₀',
  fridge_roll_std_10: 'Fridge σ₁₀',
  thermostat_diff_1: 'Thermo Δ₁',
  thermostat_roll_std_10: 'Thermo σ₁₀',
  weather_fridge_diff: 'W↔F Diff',
  weather_thermostat_diff: 'W↔T Diff',
  fridge_thermostat_diff: 'F↔T Diff',
  season_sin: 'Season Sin',
  season_cos: 'Season Cos',
};
const MONTHS = [
  'Jan',
  'Fev',
  'Mar',
  'Avr',
  'Mai',
  'Jun',
  'Jul',
  'Aou',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
export default function ShapDashboardPage() {
  const [yearlyData, setYearlyData] = useState<ShapYearlyResponse | null>(null);
  const [hourlyData, setHourlyData] = useState<ShapHourlyResponse | null>(null);
  const [pointModal, setPointModal] = useState<{
    point: ShapPointResponse;
    pharma: PharmaReportResponse;
  } | null>(null);
  const [openPointLoading, setOpenPointLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    | 'global'
    | 'monthly'
    | 'seasonal'
    | 'hourly'
  >('global');
  const [division, setDivision] = useState<'analysis' | 'dataset'>(
    'analysis',
  );
  const [impView, setImpView] = useState<'all' | 'attacks' | 'normals'>(
    'attacks',
  );
  const [filterDay, setFilterDay] = useState<number | ''>('');
  const [filterMonth, setFilterMonth] = useState<number | ''>('');
  const [filterSeason, setFilterSeason] = useState<string>('');
  const [filterHour, setFilterHour] = useState<number | ''>('');
  const [appliedFilters, setAppliedFilters] = useState<{
    day: number | '';
    month: number | '';
    season: string;
    hour: number | '';
  }>({ day: '', month: '', season: '', hour: '' });
  const [attackData, setAttackData] = useState<AttackDatasetResponse | null>(
    null,
  );
  const [attackError, setAttackError] = useState<string | null>(null);
  const [attackLoading, setAttackLoading] = useState(false);
  const [attackPage, setAttackPage] = useState(1);
  const [showAllRows, setShowAllRows] = useState(false);
  const buildAttackUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set('only_attacks', String(!showAllRows));
    params.set('page', String(attackPage));
    params.set('page_size', '25');
    if (appliedFilters.month !== '')
      params.set('month', String(appliedFilters.month));
    if (appliedFilters.season) {
      const sMap: Record<string, string> = {
        winter: 'hiver',
        spring: 'printemps',
        summer: 'ete',
        autumn: 'automne',
      };
      params.set('season', sMap[appliedFilters.season] || appliedFilters.season);
    }
    if (appliedFilters.day !== '')
      params.set('doy', String(appliedFilters.day));
    if (appliedFilters.hour !== '')
      params.set('hour', String(appliedFilters.hour));
    const qs = params.toString();
    return `/api/v1/phase2/attack-dataset${qs ? '?' + qs : ''}`;
  }, [attackPage, appliedFilters, showAllRows]);
  const fetchAttackData = useCallback(async () => {
    setAttackLoading(true);
    setAttackError(null);
    try {
      const r = await fetch(buildAttackUrl());
      if (r.ok) {
        const data = await r.json();
        setAttackData(data);
      } else if (r.status === 404) {
        setAttackError('Endpoint du dataset indisponible — redémarrez le backend (port 8000)');
        setAttackData(null);
      } else {
        setAttackError(`HTTP ${r.status}`);
        setAttackData(null);
      }
    } catch {
      setAttackError('Backend injoignable — lancez start_backend.bat (port 8000)');
      setAttackData(null);
    }
    setAttackLoading(false);
  }, [buildAttackUrl]);
  useEffect(() => {
    fetchAttackData();
  }, [fetchAttackData]);
  const openPointModal = async (row: AttackDatasetRow) => {
    if (openPointLoading) return;
    setOpenPointLoading(true);
    try {
      const p = await fetch(
        `/api/shap/point?timestamp=${encodeURIComponent(row.datetime)}`,
      );
      if (!p.ok) {
        const d = await p.json().catch(() => null);
        throw new Error(d?.error || `HTTP ${p.status}`);
      }
      const point: ShapPointResponse = await p.json();
      if (!point.available) throw new Error(point.error || 'SHAP indisponible');
      const sov = point.sensor_values || {};
      const r = await fetch('/api/v1/pharma/point-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          sensor: point.dominant_sensor || 'thermostat',
          attack_id: null,
          risk_score: point.risk_score_per_100,
          is_anomaly: point.is_anomaly,
          label: point.label,
          season: point.season,
          sensor_values: {
            weather: sov.weather,
            fridge: sov.fridge,
            thermostat: sov.thermostat,
          },
          top_causes: point.top_causes.slice(0, 5),
        }),
      });
      const pharma: PharmaReportResponse = await r.json();
      if (pharma.report !== 'ok')
        throw new Error(pharma.error || 'Rapport indisponible');
      setPointModal({ point, pharma });
    } catch {
      toast({
        title: 'Point indisponible',
        description:
          "Impossible d'ouvrir l'analyse SHAP / rapport pour ce point (backend 8000).",
        variant: 'destructive',
      });
    } finally {
      setOpenPointLoading(false);
    }
  };
  const buildUrl = () => {
    const params = new URLSearchParams();
    if (appliedFilters.day !== '')
      params.set('day', String(appliedFilters.day));
    if (appliedFilters.month !== '')
      params.set('month', String(appliedFilters.month));
    if (appliedFilters.season) params.set('season', appliedFilters.season);
    if (appliedFilters.hour !== '')
      params.set('hour', String(appliedFilters.hour));
    const qs = params.toString();
    return `/api/shap/yearly${qs ? '?' + qs : ''}`;
  };
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(buildUrl());
      if (r.ok) {
        const yearly = await r.json();
        if (yearly?.available) {
          setYearlyData(yearly);
          setLoading(false);
          return;
        }
        throw new Error(yearly?.error || `HTTP ${r.status}`);
      }
      if (r.status === 500)
        throw new Error('Erreur serveur — redémarrez le backend');
      throw new Error(`HTTP ${r.status}`);
    } catch (e: any) {
      setError(
        e?.message?.includes('fetch')
          ? 'Backend injoignable — lancez start_backend.bat (port 8000)'
          : e.message,
      );
    }
    setLoading(false);
  }, [
    appliedFilters.day,
    appliedFilters.month,
    appliedFilters.season,
    appliedFilters.hour,
  ]);
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  const applyFilters = () => {
    setAttackPage(1);
    setAppliedFilters({
      day: filterDay,
      month: filterMonth,
      season: filterSeason,
      hour: filterHour,
    });
  };
  const buildHourlyUrl = () => {
    const params = new URLSearchParams();
    if (appliedFilters.month !== '')
      params.set('month', String(appliedFilters.month));
    if (appliedFilters.season) params.set('season', appliedFilters.season);
    const qs = params.toString();
    return `/api/shap/hourly${qs ? '?' + qs : ''}`;
  };
  const fetchHourly = useCallback(async () => {
    setHourlyLoading(true);
    try {
      const r = await fetch(buildHourlyUrl());
      if (r.ok) {
        const data = await r.json();
        if (data?.available) setHourlyData(data);
      }
    } catch {
      setHourlyData(null);
    }
    setHourlyLoading(false);
  }, [appliedFilters.month, appliedFilters.season]);
  useEffect(() => {
    if (activeTab === 'hourly') fetchHourly();
  }, [activeTab, fetchHourly]);
  const hasFilterChanges = () =>
    filterDay !== appliedFilters.day ||
    filterMonth !== appliedFilters.month ||
    filterSeason !== appliedFilters.season ||
    filterHour !== appliedFilters.hour;
  const anyFilterSet = () =>
    filterDay !== '' || filterMonth !== '' || filterSeason || filterHour !== '';
  const resetFilters = () => {
    setAttackPage(1);
    setFilterDay('');
    setFilterMonth('');
    setFilterSeason('');
    setFilterHour('');
    setAppliedFilters({ day: '', month: '', season: '', hour: '' });
  };
  const exportPdf = async () => {
    try {
      if (!yearlyData) return;
      const { jsPDF } = await import('jspdf');
      await import('jspdf-autotable');
      const doc = new jsPDF('p', 'mm', 'a4');
      const now = new Date().toLocaleDateString('fr-FR');
      let y = 20;
      /* Titre */ doc.setFontSize(16);
      doc.setTextColor(20, 20, 40);
      doc.text('Analyse SHAP — Interprétabilité IA', 20, y);
      y += 7;
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Généré le ${now} · OneClassSVM · Bridge Phase 2 → Phase 3`,
        20,
        y,
      );
      y += 12;
      /* KPIs */ const kpiRows = [
        ['Échantillons analysés', String(yearlyData.n_samples)],
        [
          'Anomalies détectées',
          `${yearlyData.n_anomalies} (${((yearlyData.n_anomalies / yearlyData.n_samples) * 100).toFixed(1)}%)`,
        ],
        [
          'Top Feature',
          `${yearlyData.global_importance[0]?.label || 'N/A'} (${yearlyData.global_importance[0]?.shap_importance.toFixed(5) || ''})`,
        ],
        ['Méthode SHAP', yearlyData.shap_method || 'KernelExplainer'],
      ];
      (doc as any).autoTable({
        startY: y,
        head: [['KPI', 'Valeur']],
        body: kpiRows,
        theme: 'grid',
        headStyles: { fillColor: [255, 184, 48] },
        margin: { left: 20, right: 20 },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
      /* Importance globale */ const impRows = yearlyData.global_importance.map(
        (f) => [f.label, f.group, f.shap_importance.toFixed(6)],
      );
      (doc as any).autoTable({
        startY: y,
        head: [['Feature', 'Groupe', 'Importance SHAP']],
        body: impRows,
        theme: 'grid',
        headStyles: { fillColor: [0, 229, 255] },
        margin: { left: 20, right: 20 },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
      doc.save(`shap-analyse-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({ title: 'PDF exporté', description: 'Rapport SHAP téléchargé' });
    } catch (err) {
      toast({
        title: 'Erreur PDF',
        description: `Échec: ${err instanceof Error ? err.message : ''}`,
        variant: 'destructive',
      });
    }
  };
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        {' '}
        <Loader2
          className="w-6 h-6 animate-spin"
          style={{ color: '#00E5FF' }}
        />{' '}
        <span
          className="text-xs text-center px-8"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {' '}
          Chargement de l'analyse SHAP...{' '}
        </span>{' '}
      </div>
    );
  }
  if (error || !yearlyData) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        {' '}
        <AlertTriangle className="w-6 h-6" style={{ color: '#FF2D78' }} />{' '}
        <span
          className="text-xs text-center px-8 max-w-md"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {' '}
          {error || 'Aucune donnée SHAP disponible'}{' '}
        </span>{' '}
        <button
          onClick={() => window.location.reload()}
          className="text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer"
          style={{
            color: '#FFB830',
            background: 'rgba(255,184,48,0.1)',
            border: '1px solid rgba(255,184,48,0.3)',
          }}
        >
          {' '}
          Recharger{' '}
        </button>{' '}
      </div>
    );
  }
  const yearly = yearlyData;
  const features = yearly?.feature_names || [];
  const groupEntries = yearly ? Object.entries(yearly.group_importance) : [];
  const topFeature = yearly?.global_importance?.[0];
  return (
    <div className="relative">
      {' '}
      <BackgroundOrbs />{' '}
      <div
        id="shap-dashboard-content"
        className="relative space-y-6"
        style={{ zIndex: 1 }}
      >
        {' '}
        {/* Header */}{' '}
        <div className="flex items-center justify-between flex-wrap gap-3">
          {' '}
          <div>
            {' '}
            <h1
              className="text-xl font-bold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {' '}
              <Brain
                className="w-5 h-5 inline mr-2"
                style={{ color: '#FFB830' }}
              />{' '}
              Analyse SHAP — Interprétabilité IA{' '}
            </h1>{' '}
            <p
              className="text-[11px] mt-0.5"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {' '}
              Explication des décisions du modèle OneClassSVM — Bridge Phase 2 →
              Phase 3{' '}
            </p>{' '}
          </div>{' '}
          <div className="flex items-center gap-2">
            {' '}
            <button
              onClick={exportPdf}
              className="flex items-center gap-1.5 text-[10px] font-bold px-3.5 py-2 rounded-xl cursor-pointer transition-all hover:brightness-110"
              style={{
                background: 'rgba(255,184,48,0.10)',
                border: '1px solid rgba(255,184,48,0.30)',
                color: '#FFB830',
              }}
            >
              {' '}
              <Download className="w-3.5 h-3.5" /> PDF{' '}
            </button>{' '}
          </div>{' '}
        </div>{' '}
        {/* Division bar — type Tableau de bord (KPIs | Dataset | Fusion) */}{' '}
        <div
          className="flex gap-1 p-1 rounded-xl overflow-x-auto"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {' '}
          {[
            {
              id: 'analysis' as const,
              label: 'KPIs / Analyse SHAP',
              icon: Brain,
              color: '#FFB830',
            },
            {
              id: 'dataset' as const,
              label: 'Dataset',
              icon: Database,
              color: '#00FFA3',
            },

          ].map((d) => (
            <button
              key={d.id}
              onClick={() => setDivision(d.id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold font-display whitespace-nowrap transition-all cursor-pointer"
              style={{
                background: division === d.id ? `${d.color}15` : 'transparent',
                color: division === d.id ? d.color : 'var(--color-text-secondary)',
                border:
                  division === d.id
                    ? `1px solid ${d.color}40`
                    : '1px solid transparent',
                boxShadow:
                  division === d.id ? `0 0 12px ${d.color}25` : 'none',
              }}
            >
              {' '}
              <d.icon className="w-4 h-4" /> {d.label}{' '}
            </button>
          ))}{' '}
        </div>{' '}
        {division === 'analysis' && (
          <>{/* KPI Cards */}{' '}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {' '}
          <KpiCard
            label="Échantillons analysés"
            value={yearly?.n_samples.toLocaleString() || '0'}
            color="#00E5FF"
            icon={<Brain className="w-3.5 h-3.5" />}
          />{' '}
          <KpiCard
            label="Anomalies détectées"
            value={
              yearly?.n_anomalies_pool?.toLocaleString() ||
              yearly?.n_anomalies.toLocaleString() ||
              '0'
            }
            color="#FF2D78"
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
            sub={
              yearly?.stratified
                ? 'au sein du pool analysé'
                : yearly
                  ? `${((yearly.n_anomalies / yearly.n_samples) * 100).toFixed(1)}%`
                  : ''
            }
          />{' '}
          <KpiCard
            label="Top Feature"
            value={topFeature?.label || 'N/A'}
            color="#FFB830"
            icon={<Sparkles className="w-3.5 h-3.5" />}
            sub={`SHAP: ${topFeature?.shap_importance.toFixed(5) || ''}`}
          />{' '}
          <KpiCard
            label="Capteur clé"
            value={
              GROUP_LABELS[
                groupEntries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
              ] ||
              groupEntries.sort((a, b) => b[1] - a[1])[0]?.[0] ||
              'N/A'
            }
            color="#00FFA3"
            icon={<Thermometer className="w-3.5 h-3.5" />}
            sub={`Score: ${(groupEntries.sort((a, b) => b[1] - a[1])[0]?.[1] || 0).toFixed(5)}`}
          />{' '}
          <KpiCard
            label="Modèle & Méthode"
            value={(yearly?.model_kind ?? '').toUpperCase() || 'OCSVM'}
            color="#A855F7"
            icon={<Zap className="w-3.5 h-3.5" />}
            sub={yearly?.shap_method || 'KernelExplainer'}
          />{' '}
          <KpiCard
            label="Saison sensible"
            value={
              SEASON_LABELS[
                Object.entries(yearly?.seasonal_breakdown || {}).sort(
                  (a, b) => b[1].count - a[1].count,
                )[0]?.[0] ?? ''
              ] || 'N/A'
            }
            color="#FFB830"
            icon={<CloudSun className="w-3.5 h-3.5" />}
            sub={`${Object.entries(yearly?.seasonal_breakdown || {}).sort((a, b) => b[1].count - a[1].count)[0]?.[1]?.count || 0} éch.`}
          />{' '}
        </div>{' '}
        {yearly?.low_sample_warning && (
          <div
            className="rounded-lg px-3 py-2 text-[9px] flex items-center gap-2"
            style={{
              background: 'rgba(255,184,48,0.06)',
              border: '1px solid rgba(255,184,48,0.20)',
              color: '#FFB830',
            }}
          >
            {' '}
            <AlertTriangle className="w-3 h-3 shrink-0" />{' '}
            {yearly.low_sample_warning}{' '}
          </div>
        )}{' '}
        {/* Tab navigation */}{' '}
        <div className="flex items-center gap-1.5 flex-wrap">
          {' '}
          {[
            {
              key: 'global' as const,
              label: 'Importance Globale',
              icon: Sparkles,
              color: '#FFB830',
            },
            {
              key: 'monthly' as const,
              label: 'Évolution Mensuelle',
              icon: Clock,
              color: '#00E5FF',
            },
            {
              key: 'seasonal' as const,
              label: 'Breakdown Saisonnier',
              icon: CloudSun,
              color: '#00FFA3',
            },
            {
              key: 'hourly' as const,
              label: 'Profil Horaire',
              icon: Clock,
              color: '#00E5FF',
            },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="text-[10px] px-2.5 py-1.5 rounded-lg font-bold cursor-pointer transition-all flex items-center gap-1.5"
              style={{
                background:
                  activeTab === t.key
                    ? `${t.color}15`
                    : 'rgba(255,255,255,0.04)',
                color:
                  activeTab === t.key ? t.color : 'var(--color-text-secondary)',
                border: `1px solid ${activeTab === t.key ? `${t.color}40` : 'rgba(255,255,255,0.06)'}`,
                boxShadow:
                  activeTab === t.key ? `0 0 12px ${t.color}30` : 'none',
              }}
            >
              {' '}
              <t.icon className="w-3 h-3" /> {t.label}{' '}
            </button>
          ))}{' '}
        </div>{' '}
        {/* Content sections based on active tab */}{' '}
        <div className="space-y-4">
            {' '}
            {activeTab === 'global' &&
              yearly &&
              (() => {
                const impData =
                  impView === 'attacks'
                    ? yearly.attack_importance?.length
                      ? yearly.attack_importance
                      : yearly.global_importance
                    : impView === 'normals'
                      ? yearly.normal_importance?.length
                        ? yearly.normal_importance
                        : yearly.global_importance
                      : yearly.global_importance;
                const viewColor =
                  impView === 'attacks'
                    ? '#A855F7'
                    : impView === 'normals'
                      ? '#00FFA3'
                      : '#FFB830';
                const viewTitle =
                  impView === 'attacks'
                    ? 'Importance SHAP — Attaques seules'
                    : impView === 'normals'
                      ? 'Importance SHAP — Points normaux'
                      : 'Importance SHAP — Vue globale';
                return (
                  <>
                    <Section
                    title={viewTitle}
                    desc={`${impData.length} features${impView === 'attacks' ? ` · ${yearly.n_attacks_sample ?? 0} attaques` : impView === 'normals' ? ` · ${yearly.n_normals_sample ?? 0} normaux` : ` · ${yearly.n_samples} pts`}`}
                    color={viewColor}
                  >
                    {' '}
                    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                      {' '}
                      {[
                        {
                          key: 'attacks' as const,
                          label: '🔥 Attaques',
                          color: '#A855F7',
                        },
                        {
                          key: 'normals' as const,
                          label: '✅ Normales',
                          color: '#00FFA3',
                        },
                        {
                          key: 'all' as const,
                          label: '🌐 Tout',
                          color: '#FFB830',
                        },
                      ].map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => setImpView(opt.key)}
                          className="text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                          style={{
                            background:
                              impView === opt.key
                                ? `${opt.color}18`
                                : 'rgba(255,255,255,0.04)',
                            color:
                              impView === opt.key
                                ? opt.color
                                : 'var(--color-text-secondary)',
                            border: `1px solid ${impView === opt.key ? `${opt.color}45` : 'rgba(255,255,255,0.06)'}`,
                            boxShadow:
                              impView === opt.key
                                ? `0 0 10px ${opt.color}30`
                                : 'none',
                          }}
                        >
                          {' '}
                          {opt.label}{' '}
                        </button>
                      ))}{' '}
                      <span
                        className="ml-auto text-[9px] font-mono"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {' '}
                        {impView === 'attacks'
                          ? `Signature des ${yearly.n_attacks_sample ?? 0} anomalies détectées`
                          : impView === 'normals'
                            ? `Contraste sur ${yearly.n_normals_sample ?? 0} points normaux`
                            : `Moyenne mixte sur ${yearly.n_samples} points`}{' '}
                      </span>{' '}
                    </div>{' '}
                    <p
                      className="text-[10px] mb-3"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {' '}
                      {impView === 'attacks' ? (
                        <>
                          Impact SHAP moyen des features{' '}
                          <b style={{ color: '#A855F7' }}>
                            uniquement sur les attaques détectées
                          </b>{' '}
                          — c'est ce qui déclenche réellement le modèle.
                        </>
                      ) : impView === 'normals' ? (
                        <>
                          Impact SHAP moyen des features{' '}
                          <b style={{ color: '#00FFA3' }}>
                            uniquement sur les points normaux
                          </b>{' '}
                          — référence du comportement sain.
                        </>
                      ) : (
                        <>
                          Impact moyen absolu de chaque feature (échantillon
                          stratifié). Préférez la vue{' '}
                          <b style={{ color: '#A855F7' }}>Attaques</b> pour
                          comprendre les attaques.
                        </>
                      )}{' '}
                    </p>{' '}
                    <div className="flex gap-2 mb-3 flex-wrap">
                      {' '}
                      {Object.entries(GROUP_LABELS).map(([k, v]) => (
                        <div
                          key={k}
                          className="flex items-center gap-1 text-[9px]"
                        >
                          {' '}
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ background: GROUP_COLORS[k] }}
                          />{' '}
                          <span
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            {v}
                          </span>{' '}
                        </div>
                      ))}{' '}
                    </div>{' '}
                    <GlobalImportanceGallery data={impData} />{' '}
                    <div
                      className="mt-4 pt-3 flex items-center gap-2"
                      style={{ borderTop: `1px solid ${viewColor}15` }}
                    >
                      {' '}
                      <Info
                        className="w-3 h-3"
                        style={{ color: 'var(--color-text-secondary)' }}
                      />{' '}
                      <span
                        className="text-[9px]"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {' '}
                        Barres les plus longues = features qui poussent le plus
                        la détection d'anomalie{' '}
                      </span>{' '}
                    </div>{' '}
                  </Section>
                  </>
                );
              })()}{' '}
            {activeTab === 'monthly' && yearly && (
              <Section
                title="Évolution Mensuelle SHAP"
                desc="Importance par mois"
                color="#00E5FF"
              >
                {' '}
                <p
                  className="text-[10px] mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {' '}
                  Heatmap de l'importance SHAP de chaque feature mois par mois.
                  Plus la couleur est intense, plus cette feature était
                  importante pour détecter des anomalies ce mois-là.{' '}
                </p>{' '}
                <MonthlyShapHeatmap
                  data={yearly.monthly_shap}
                  features={features}
                />{' '}
                <div
                  className="mt-4 flex items-center gap-3 text-[9px]"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {' '}
                  <TrendingUp className="w-3 h-3" />{' '}
                  <span>
                    Observez quelles features deviennent dominantes selon les
                    mois — idéal pour détecter des tendances saisonnières dans
                    les attaques
                  </span>{' '}
                </div>{' '}
              </Section>
            )}{' '}
            {activeTab === 'seasonal' && yearly?.seasonal_breakdown && (
              <Section
                title="Breakdown Saisonnier SHAP"
                desc="4 saisons"
                color="#00FFA3"
              >
                {' '}
                <p
                  className="text-[10px] mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {' '}
                  Comparaison de l'importance SHAP par saison. Certaines
                  features deviennent plus importantes selon la période de
                  l'année.{' '}
                </p>{' '}
                <SeasonalShapChart data={yearly.seasonal_breakdown} />{' '}
              </Section>
            )}{' '}
            {activeTab === 'hourly' && (
              <Section
                title="Profil Horaire SHAP"
                desc={hourlyData ? `${hourlyData.n_samples} éch.` : ''}
                color="#00E5FF"
              >
                {' '}
                <p
                  className="text-[10px] mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {' '}
                  Importance SHAP moyenne de chaque feature par heure de la
                  journée. La couleur indique à quelle heure chaque capteur pèse
                  le plus dans la détection d'anomalies.{' '}
                </p>{' '}
                {hourlyLoading ? (
                  <div className="flex items-center justify-center h-32">
                    {' '}
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      style={{ color: 'var(--color-text-secondary)' }}
                    />{' '}
                  </div>
                ) : hourlyData && hourlyData.hours.length > 0 ? (
                  <>
                    {' '}
                    {hourlyData.low_sample_warning && (
                      <div
                        className="mb-3 rounded-lg px-3 py-2 text-[9px]"
                        style={{
                          background: 'rgba(255,184,48,0.06)',
                          border: '1px solid rgba(255,184,48,0.20)',
                          color: '#FFB830',
                        }}
                      >
                        {' '}
                        {hourlyData.low_sample_warning}{' '}
                      </div>
                    )}{' '}
                    <HourlyShapHeatmap
                      data={hourlyData.hours}
                      features={hourlyData.feature_names}
                    />{' '}
                    <div
                      className="mt-4 flex items-center gap-3 text-[9px]"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {' '}
                      <Clock className="w-3 h-3" />{' '}
                      <span>
                        Repérez les heures où un capteur devient dominant — par
                        exemple frigo plus actif la nuit quand la porte est
                        fermée
                      </span>{' '}
                    </div>{' '}
                  </>
                ) : (
                  <div
                    className="text-[10px] py-6 text-center"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {' '}
                    Aucune donnée pour ce filtre{' '}
                  </div>
                )}{' '}
              </Section>
            )}
        </div>{' '}
        </>)
        }
        {division === 'dataset' && (
          <>
            <Section
              title="Contenu du Dataset"
              desc={
                attackData
                  ? `${attackData.total} point(s)` +
                    (attackData.summary
                      ? ` · ${attackData.summary.attack} attaques`
                      : '')
                  : ''
              }
              color="#00FFA3"
            >
              {' '}
              <p
                className="text-[10px] mb-3 flex items-center gap-1.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {' '}
                <Database className="w-3.5 h-3.5" style={{ color: '#00FFA3' }} />{' '}
                Données du dataset affichées par défaut. Utilisez les filtres
                ci-dessous (mois, saison, jour 1-365, heure) pour restreindre le
                contenu affiché.{' '}
              </p>{' '}
              {/* Filtres du dataset */}{' '}
              <div
                className="rounded-2xl p-3 mb-3"
                style={{
                  background: 'rgba(0,255,163,0.03)',
                  border: '1px solid rgba(0,255,163,0.12)',
                }}
              >
                {' '}
                <div className="flex items-center gap-2 flex-wrap">
                  {' '}
                  <span
                    className="text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: '#00FFA3' }}
                  >
                    Filtres
                  </span>{' '}
                  <select
                    value={filterMonth}
                    onChange={(e) => {
                      setFilterMonth(e.target.value ? Number(e.target.value) : '');
                      if (e.target.value) setFilterSeason('');
                    }}
                    className="text-[10px] px-2.5 py-1.5 rounded-lg bg-transparent cursor-pointer"
                    style={{
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {' '}
                    <option value="">Tous les mois</option>{' '}
                    {MONTHS.map((m, i) => (
                      <option key={i} value={i + 1}>
                        {m}
                      </option>
                    ))}{' '}
                  </select>{' '}
                  <select
                    value={filterSeason}
                    onChange={(e) => {
                      setFilterSeason(e.target.value);
                      if (e.target.value) setFilterMonth('');
                    }}
                    className="text-[10px] px-2.5 py-1.5 rounded-lg bg-transparent cursor-pointer"
                    style={{
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {' '}
                    <option value="">Toutes les saisons</option>{' '}
                    {SEASONS.map((s) => (
                      <option key={s} value={s}>
                        {SEASON_LABELS[s]}
                      </option>
                    ))}{' '}
                  </select>{' '}
                  <input
                    type="number"
                    min={1}
                    max={365}
                    placeholder="Jour (1-365)"
                    value={filterDay}
                    onChange={(e) =>
                      setFilterDay(e.target.value ? Number(e.target.value) : '')
                    }
                    className="text-[10px] px-2.5 py-1.5 rounded-lg bg-transparent w-28"
                    style={{
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--color-text-secondary)',
                    }}
                  />{' '}
                  <select
                    value={filterHour}
                    onChange={(e) =>
                      setFilterHour(
                        e.target.value !== '' ? Number(e.target.value) : '',
                      )
                    }
                    className="text-[10px] px-2.5 py-1.5 rounded-lg bg-transparent cursor-pointer"
                    style={{
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {' '}
                    <option value="">Toutes les heures</option>{' '}
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}h
                      </option>
                    ))}{' '}
                  </select>{' '}
                  <button
                    onClick={applyFilters}
                    className="flex items-center gap-1.5 text-[10px] font-black px-4 py-1.5 rounded-lg cursor-pointer transition-all hover:brightness-110"
                    style={{
                      background: hasFilterChanges()
                        ? 'linear-gradient(135deg, #00FFA3, #00E5FF)'
                        : 'rgba(0,255,163,0.10)',
                      border: `1px solid ${hasFilterChanges() ? 'transparent' : '#00FFA355'}`,
                      color: hasFilterChanges() ? '#fff' : '#00FFA3',
                    }}
                  >
                    {' '}
                    <Filter className="w-3.5 h-3.5" /> Filtrer{' '}
                  </button>{' '}
                  {anyFilterSet() && (
                    <button
                      onClick={resetFilters}
                      className="flex items-center gap-1 text-[9px] px-2 py-1.5 rounded-lg cursor-pointer hover:brightness-110"
                      style={{
                        color: '#FFB830',
                        background: 'rgba(255,184,48,0.08)',
                        border: '1px solid rgba(255,184,48,0.25)',
                      }}
                    >
                      {' '}
                      <X className="w-3 h-3" /> Réinitialiser{' '}
                    </button>
                  )}{' '}
                  {hasFilterChanges() && anyFilterSet() && (
                    <span
                      className="text-[8px]"
                      style={{ color: '#FFB830' }}
                    >
                      ⚡ Filtres non appliqués — cliquez sur « Filtrer »
                    </span>
                  )}{' '}
                  <span
                    className="ml-auto text-[9px] font-mono"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {' '}
                    {appliedFilters.month !== ''
                      ? `${MONTHS[(appliedFilters.month as number) - 1]} · `
                      : ''}
                    {appliedFilters.season
                      ? `${SEASON_LABELS[appliedFilters.season]} · `
                      : ''}
                    {appliedFilters.day !== '' ? `Jour ${appliedFilters.day} · ` : ''}
                    {appliedFilters.hour !== ''
                      ? `${String(appliedFilters.hour).padStart(2, '0')}h · `
                      : ''}
                    {attackData?.total ?? 0} pts
                  </span>{' '}
                </div>{' '}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {' '}
                  {['attaques', 'toutes'].map((opt) => (
                    <button
                      key={opt}
                      onClick={() => {
                        setShowAllRows(opt === 'toutes');
                        setAttackPage(1);
                      }}
                      className="text-[10px] font-bold px-3 py-1 rounded-lg cursor-pointer transition-all"
                      style={{
                        background:
                          (opt === 'toutes') === showAllRows
                            ? 'rgba(0,255,163,0.15)'
                            : 'rgba(255,255,255,0.04)',
                        color:
                          (opt === 'toutes') === showAllRows
                            ? '#00FFA3'
                            : 'var(--color-text-secondary)',
                        border: `1px solid ${(opt === 'toutes') === showAllRows ? '#00FFA345' : 'rgba(255,255,255,0.06)'}`,
                      }}
                    >
                      {' '}
                      {opt === 'attaques' ? 'Attaques uniquement' : 'Toutes les lignes'}{' '}
                    </button>
                  ))}{' '}
                  <span
                    className="text-[8px]"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    Affiche toutes les lignes ou seulement les attaques réelles
                    (label = 1).
                  </span>{' '}
                </div>{' '}
              </div>{' '}
              {attackLoading ? (
                <div className="flex items-center justify-center h-40">
                  {' '}
                  <Loader2
                    className="w-5 h-5 animate-spin"
                    style={{ color: '#00FFA3' }}
                  />{' '}
                </div>
              ) : attackData && attackData.rows.length > 0 ? (
                <>
                  {' '}
                  {attackData.summary && (
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      {' '}
                      <div
                        className="px-2 py-1 rounded-lg text-[9px] font-bold flex items-center gap-1.5"
                        style={{
                          background: 'rgba(255,45,120,0.10)',
                          border: '1px solid rgba(255,45,120,0.35)',
                          color: '#FF2D78',
                        }}
                      >
                        {' '}
                        <ShieldAlert className="w-3 h-3" />{' '}
                        {attackData.summary.attack} attaque(s){' '}
                      </div>{' '}
                      <div
                        className="px-2 py-1 rounded-lg text-[9px] font-bold flex items-center gap-1.5"
                        style={{
                          background: 'rgba(0,255,163,0.08)',
                          border: '1px solid rgba(0,255,163,0.30)',
                          color: '#00FFA3',
                        }}
                      >
                        {' '}
                        <b>{attackData.summary.detected}</b> détectées · Recall{' '}
                        {Math.round((attackData.summary.recall || 0) * 100)}%
                      </div>{' '}
                      <div
                        className="px-2 py-1 rounded-lg text-[9px] font-bold"
                        style={{
                          background: 'rgba(0,229,255,0.08)',
                          border: '1px solid rgba(0,229,255,0.25)',
                          color: '#00E5FF',
                        }}
                      >
                        {' '}
                        Total : {attackData.summary.total}{' '}
                      </div>{' '}
                    </div>
                  )}{' '}
                  <div className="overflow-x-auto rounded-xl">
                    {' '}
                    <table className="w-full text-left text-[10px] border-collapse min-w-[760px]">
                      {' '}
                      <thead>
                        {' '}
                        <tr
                          style={{
                            background: 'rgba(0,255,163,0.08)',
                            color: '#00FFA3',
                          }}
                        >
                          {' '}
                          <th className="px-3 py-2 font-bold whitespace-nowrap">
                            Date / Heure
                          </th>{' '}
                          <th className="px-3 py-2 font-bold">Weather</th>{' '}
                          <th className="px-3 py-2 font-bold">Frigo</th>{' '}
                          <th className="px-3 py-2 font-bold">Thermostat</th>{' '}
                          <th className="px-3 py-2 font-bold">W↔F|W↔T|F↔T</th>{' '}
                          <th className="px-3 py-2 font-bold">Label</th>{' '}
                          <th className="px-3 py-2 font-bold">Détecté</th>{' '}
                          <th className="px-3 py-2 font-bold">Score anomaly</th>{' '}
                          <th className="px-3 py-2 font-bold">Rapport</th>{' '}
                        </tr>{' '}
                      </thead>{' '}
                      <tbody>
                        {' '}
                        {attackData.rows.map((row, ri) => (
                          <tr
                            key={row.datetime}
                            onClick={() => openPointModal(row)}
                            className="border-t cursor-pointer transition-all hover:brightness-125"
                            title="Cliquer pour ouvrir le rapport de recommandation du point (SHAP, impact, CVE, recommandations)"
                            style={{
                              borderColor: 'rgba(0,255,163,0.08)',
                              background:
                                ri % 2 === 0
                                  ? 'rgba(255,255,255,0.02)'
                                  : 'transparent',
                              color: 'var(--color-text-secondary)',
                            }}
                          >
                            {' '}
                            <td className="px-3 py-2 font-mono whitespace-nowrap">
                              {' '}
                              {row.datetime.replace('T', ' ')}{' '}
                            </td>{' '}
                            <td className="px-3 py-2 font-mono">
                              {row.weather_temp?.toFixed(2)}
                            </td>{' '}
                            <td className="px-3 py-2 font-mono">
                              {row.fridge_temp?.toFixed(2)}
                            </td>{' '}
                            <td className="px-3 py-2 font-mono">
                              {row.thermostat_temp?.toFixed(2)}
                            </td>{' '}
                            <td className="px-3 py-2 font-mono text-[9px]">
                              {' '}
                              {row.weather_fridge_diff?.toFixed(2)} |{' '}
                              {row.weather_thermostat_diff?.toFixed(2)} |{' '}
                              {row.fridge_thermostat_diff?.toFixed(2)}{' '}
                            </td>{' '}
                            <td className="px-3 py-2">
                              {' '}
                              <span
                                className="px-1.5 py-0.5 rounded text-[8px] font-black"
                                style={{
                                  background:
                                    row.label === 1
                                      ? 'rgba(255,45,120,0.15)'
                                      : 'rgba(0,255,163,0.10)',
                                  color:
                                    row.label === 1 ? '#FF2D78' : '#00FFA3',
                                }}
                              >
                                {' '}
                                {row.label === 1 ? 'Attaque' : 'Normal'}{' '}
                              </span>{' '}
                            </td>{' '}
                            <td className="px-3 py-2">
                              {' '}
                              <span
                                className="px-1.5 py-0.5 rounded text-[8px] font-black"
                                style={{
                                  background:
                                    row.prediction === 1
                                      ? 'rgba(168,85,247,0.18)'
                                      : 'rgba(255,255,255,0.05)',
                                  color:
                                    row.prediction === 1
                                      ? '#A855F7'
                                      : 'var(--color-text-muted)',
                                }}
                              >
                                {' '}
                                {row.prediction === 1 ? 'Oui' : 'Non'}{' '}
                              </span>{' '}
                            </td>{' '}
                            <td className="px-3 py-2 font-mono">
                              {row.anomaly_score?.toFixed(3)}
                            </td>{' '}
                            <td className="px-3 py-2">
                              {' '}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPointModal(row);
                                }}
                                className="inline-flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded-lg whitespace-nowrap cursor-pointer hover:brightness-125"
                                style={{
                                  background: 'rgba(0,255,163,0.08)',
                                  border: '1px solid rgba(0,255,163,0.25)',
                                  color: '#00FFA3',
                                }}
                                title="Voir le rapport détaillé du point (SHAP, impact, CVE, recommandations)"
                              >
                                {' '}
                                <Info className="w-2.5 h-2.5" /> Voir le rapport détaillé →{' '}
                              </button>{' '}
                            </td>{' '}
                          </tr>
                        ))}{' '}
                      </tbody>{' '}
                    </table>{' '}
                  </div>{' '}
                  <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                    {' '}
                    <span
                      className="text-[9px] font-mono"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {' '}
                      Page {attackData.page} / {attackData.total_pages} ·{' '}
                      {attackData.total} points{' '}
                    </span>{' '}
                    <div className="flex items-center gap-1.5">
                      {' '}
                      <button
                        onClick={() =>
                          setAttackPage((p) => Math.max(1, p - 1))
                        }
                        disabled={attackData.page <= 1}
                        className="text-[9px] font-bold px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          background: 'rgba(0,255,163,0.08)',
                          border: '1px solid rgba(0,255,163,0.25)',
                          color: '#00FFA3',
                        }}
                      >
                        {' '}
                        ← Préc.{' '}
                      </button>{' '}
                      <button
                        onClick={() =>
                          setAttackPage((p) =>
                            Math.min(attackData.total_pages, p + 1),
                          )
                        }
                        disabled={attackData.page >= attackData.total_pages}
                        className="text-[9px] font-bold px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          background: 'rgba(0,255,163,0.08)',
                          border: '1px solid rgba(0,255,163,0.25)',
                          color: '#00FFA3',
                        }}
                      >
                        {' '}
                        Suiv. →{' '}
                      </button>{' '}
                    </div>{' '}
                  </div>{' '}
                </>
              ) : attackData && attackData.error ? (
                <div
                  className="text-[10px] text-center py-10 flex flex-col items-center gap-2"
                  style={{ color: '#FF2D78' }}
                >
                  {' '}
                  <Database className="w-5 h-5" /> {attackData.error}{' '}
                </div>
              ) : attackError ? (
                <div
                  className="text-[10px] text-center py-10 flex flex-col items-center gap-2"
                  style={{ color: '#FF2D78' }}
                >
                  {' '}
                  <Database className="w-5 h-5" /> {attackError}{' '}
                </div>
              ) : (
                <div
                  className="text-[10px] text-center py-10 flex flex-col items-center gap-2"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {' '}
                  <Database className="w-5 h-5" style={{ color: '#00FFA3' }} />{' '}
                  Aucune donnée pour ces filtres — élargissez les filtres.{' '}
                </div>
              )}{' '}
            </Section>
          </>
        )}
      </div>{' '}
      {pointModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setPointModal(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <ShapPointReport
              point={pointModal.point}
              pharma={pointModal.pharma}
              onClose={() => setPointModal(null)}
            />
          </div>
        </div>
      )}{' '}
    </div>
  );
}
