import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, PieChart, Pie, Sector, LineChart, Line, Legend,
} from 'recharts';
import { Brain, Sparkles, Info, Thermometer, Waves, Gauge, Clock, CloudSun } from 'lucide-react';

interface ShapGlobal {
  feature: string; shap_importance: number;
}

interface ShapSample {
  index: number; anomaly_score: number;
  top_features_anomaly: Array<{ feature: string; shap_value: number; feature_value: number }>;
  top_features_normal: Array<{ feature: string; shap_value: number; feature_value: number }>;
}

interface ShapData {
  available: boolean;
  global_importance: ShapGlobal[];
  sample_explanations: ShapSample[];
  n_samples_explained: number;
  full_matrix?: Array<{ sample_index: number; values: Record<string, number> }>;
  feature_names?: string[];
  timestamps?: string[];
  seasonal_breakdown?: Record<string, { count: number; importance: ShapGlobal[] }>;
}

const CAPTORS: { key: string; label: string; icon: typeof Brain; color: string; prefix: string[] }[] = [
  { key: 'weather', label: 'Weather', icon: CloudSun, color: '#60A5FA', prefix: ['weather_'] },
  { key: 'fridge', label: 'Fridge', icon: Thermometer, color: '#34D399', prefix: ['fridge_'] },
  { key: 'thermostat', label: 'Thermostat', icon: Gauge, color: '#F97316', prefix: ['thermostat_'] },
  { key: 'cross', label: 'Cross-sensor', icon: Waves, color: '#A78BFA', prefix: ['weather_fridge_diff', 'weather_thermostat_diff', 'fridge_thermostat_diff'] },
  { key: 'time', label: 'Temporal', icon: Clock, color: '#FBBF24', prefix: ['hour_sin', 'hour_cos', 'season_sin', 'season_cos'] },
  { key: 'status', label: 'Status', icon: Info, color: '#F472B6', prefix: ['fridge_cond_enc', 'thermo_status'] },
];

function captorKey(feature: string): string {
  if (feature.startsWith('weather_') && !feature.includes('diff')) return 'weather';
  if (feature.startsWith('fridge_') && !feature.includes('diff') && feature !== 'fridge_cond_enc') return 'fridge';
  if (feature.startsWith('thermostat_') && feature !== 'thermo_status') return 'thermostat';
  if (['weather_fridge_diff', 'weather_thermostat_diff', 'fridge_thermostat_diff'].includes(feature)) return 'cross';
  if (['hour_sin', 'hour_cos', 'season_sin', 'season_cos'].includes(feature)) return 'time';
  return 'status';
}

function CaptorDonut({ globalImportance }: { globalImportance: ShapGlobal[] }) {
  const groups = new Map<string, number>();
  for (const f of globalImportance) {
    const ck = captorKey(f.feature);
    groups.set(ck, (groups.get(ck) || 0) + f.shap_importance);
  }
  const total = [...groups.values()].reduce((a, b) => a + b, 0) || 1;
  const data = [...groups.entries()].map(([k, v]) => {
    const c = CAPTORS.find(c => c.key === k)!;
    return { key: k, label: c.label, value: Math.round((v / total) * 100), fill: c.color };
  });
  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie activeShape={(p: any) => {
            const RAD = Math.PI / 180;
            const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = p;
            const sin = Math.sin(-RAD * midAngle);
            const cos = Math.cos(-RAD * midAngle);
            const sx = cx + (outerRadius + 10) * cos;
            const sy = cy + (outerRadius + 10) * sin;
            const mx = cx + (outerRadius + 30) * cos;
            const my = cy + (outerRadius + 30) * sin;
            const ex = mx + (cos >= 0 ? 1 : -1) * 22;
            const ey = my;
            return (
              <g>
                <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius} startAngle={startAngle} endAngle={endAngle} fill={fill} />
                <Sector cx={cx} cy={cy} innerRadius={outerRadius + 4} outerRadius={outerRadius + 10} startAngle={startAngle} endAngle={endAngle} fill={fill} />
                <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" />
                <circle cx={ex} cy={ey} r={2} fill={fill} />
                <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey} textAnchor={cos >= 0 ? 'start' : 'end'} fill={fill} fontSize={10}>{payload.label} {(percent * 100).toFixed(0)}%</text>
              </g>
            );
          }} data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={55} outerRadius={80}>
            {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
          </Pie>
          <Tooltip formatter={(v) => `${v}%`} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 justify-center mt-1">
        {CAPTORS.map(c => {
          const v = groups.get(c.key) || 0;
          return <div key={c.key} className="flex items-center gap-1.5 text-[10px]"><div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} /><span style={{ color: 'var(--color-text-secondary)' }}>{c.label}</span><span className="font-bold font-mono" style={{ color: c.color }}>{(v / total * 100).toFixed(0)}%</span></div>;
        })}
      </div>
    </div>
  );
}

function CaptorBreakdown({ globalImportance }: { globalImportance: ShapGlobal[] }) {
  const groups = new Map<string, { label: string; color: string; features: { name: string; imp: number }[] }>();
  for (const f of globalImportance) {
    const ck = captorKey(f.feature);
    const c = CAPTORS.find(c => c.key === ck)!;
    if (!groups.has(ck)) groups.set(ck, { label: c.label, color: c.color, features: [] });
    groups.get(ck)!.features.push({ name: f.feature, imp: f.shap_importance });
  }
  const maxGroup = Math.max(...[...groups.values()].map(g => g.features.reduce((a, b) => a + b.imp, 0)), 0.001);
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([key, g]) => {
        const total = g.features.reduce((a, b) => a + b.imp, 0);
        return (
          <div key={key}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: g.color }} />
                <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{g.label}</span>
              </div>
              <span className="text-[9px] font-mono" style={{ color: g.color }}>{(total / maxGroup * 100).toFixed(0)}%</span>
            </div>
            <div className="space-y-0.5">
              {g.features.map(f => (
                <div key={f.name} className="flex items-center gap-1.5 pl-4">
                  <span className="text-[8px] w-[120px] truncate font-mono" style={{ color: 'var(--color-text-secondary)' }}>{f.name}</span>
                  <div className="flex-1 h-2.5 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="h-full rounded" style={{ width: `${Math.max((f.imp / maxGroup) * 100, 2)}%`, background: `linear-gradient(90deg, ${g.color}30, ${g.color})` }} />
                  </div>
                  <span className="text-[7px] font-mono" style={{ color: g.color }}>{f.imp.toFixed(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ForcePlot({ sample }: { sample: ShapSample }) {
  const pos = (sample.top_features_anomaly || []).slice(0, 5);
  const neg = (sample.top_features_normal || []).slice(0, 5);
  const maxVal = Math.max(...[...pos, ...neg].map(t => Math.abs(t.shap_value)), 0.001);
  const combined = [
    ...pos.map(t => ({ ...t, dir: 'anomaly' as const })),
    ...neg.map(t => ({ ...t, dir: 'normal' as const })),
  ].sort((a, b) => b.shap_value - a.shap_value);
  return (
    <div className="space-y-1.5">
      {combined.map(t => {
        const pct = (Math.abs(t.shap_value) / maxVal) * 100;
        const isPos = t.dir === 'anomaly';
        return (
          <div key={t.feature} className="flex items-center gap-2">
            <span className="text-[9px] w-[120px] truncate font-mono text-right" style={{ color: 'var(--color-text-secondary)' }}>{t.feature}</span>
            <div className="flex-1 flex" style={{ direction: isPos ? 'ltr' : 'rtl' }}>
              <div className={`h-4 rounded ${isPos ? 'rounded-r' : 'rounded-l'}`} style={{
                width: `${pct}%`,
                background: isPos
                  ? `linear-gradient(90deg, #EF444420, #EF4444)`
                  : `linear-gradient(270deg, #22C55E20, #22C55E)`,
                borderTopRightRadius: isPos ? 4 : 0,
                borderBottomRightRadius: isPos ? 4 : 0,
                borderTopLeftRadius: !isPos ? 4 : 0,
                borderBottomLeftRadius: !isPos ? 4 : 0,
              }} />
            </div>
            <span className="text-[9px] font-mono w-16 text-left" style={{ color: isPos ? '#EF4444' : '#22C55E' }}>
              {isPos ? '+' : ''}{t.shap_value.toFixed(4)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ShapHeatmap({ matrix, featureNames }: { matrix: NonNullable<ShapData['full_matrix']>; featureNames?: string[] }) {
  const [selectedFeat, setSelectedFeat] = useState<string | null>(null);
  const names = featureNames || (matrix.length > 0 ? Object.keys(matrix[0].values) : []);
  const maxSamples = Math.min(matrix.length, 80);
  const displayFeatures = selectedFeat ? [selectedFeat] : names;
  const allVals = matrix.slice(0, maxSamples).flatMap(r => displayFeatures.map(f => Math.abs(r.values[f] || 0)));
  const globalMax = Math.max(...allVals, 0.0001);

  const rowH = Math.max(6, Math.min(14, 300 / maxSamples));
  const colW = Math.max(12, Math.min(60, 600 / displayFeatures.length));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <button onClick={() => setSelectedFeat(null)} className={`text-[9px] px-2 py-0.5 rounded-full ${!selectedFeat ? 'font-bold' : ''}`} style={{ background: !selectedFeat ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)', color: !selectedFeat ? '#F59E0B' : 'var(--color-text-secondary)' }}>Toutes</button>
        {names.map(f => (
          <button key={f} onClick={() => setSelectedFeat(selectedFeat === f ? null : f)} className="text-[9px] px-2 py-0.5 rounded-full font-mono" style={{ background: selectedFeat === f ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)', color: selectedFeat === f ? '#F59E0B' : 'var(--color-text-secondary)' }}>{f.split('_')[0]}</button>
        ))}
      </div>
      <div className="overflow-auto max-h-72">
        <div style={{ minWidth: displayFeatures.length * colW }}>
          {/* Header row */}
          <div className="flex" style={{ marginBottom: 2 }}>
            <div className="text-[7px] font-mono" style={{ width: 40, color: 'var(--color-text-secondary)' }}>#</div>
            {displayFeatures.map(f => (
              <div key={f} className="text-[7px] font-mono truncate text-center" style={{ width: colW, color: 'var(--color-text-secondary)', writingMode: 'vertical-lr' as any, transform: 'rotate(180deg)', height: 40 }}>{f}</div>
            ))}
          </div>
          {/* Data rows */}
          {Array.from({ length: maxSamples }).map((_, rowIdx) => {
            const row = matrix[rowIdx];
            return (
              <div key={rowIdx} className="flex items-center" style={{ height: rowH }}>
                <div className="text-[6px] font-mono" style={{ width: 40, color: 'var(--color-text-secondary)' }}>{rowIdx}</div>
                {displayFeatures.map(f => {
                  const v = row.values[f] || 0;
                  const intensity = Math.abs(v) / globalMax;
                  const isPos = v > 0;
                  const r = isPos ? 239 : 34;
                  const g = isPos ? 68 : 197;
                  const b = isPos ? 68 : 94;
                  return (
                    <div key={f} className="rounded-sm" title={`${f}: ${v.toFixed(4)}`} style={{
                      width: colW, height: rowH - 1,
                      background: `rgba(${r},${g},${b},${Math.max(0.08, intensity)})`,
                      border: v === 0 ? '1px solid rgba(255,255,255,0.04)' : undefined,
                    }} />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-2">
        <span className="text-[8px]" style={{ color: '#22C55E' }}>normale</span>
        <div className="w-16 h-2 rounded" style={{ background: 'linear-gradient(90deg, #22C55E, #1a1a2e, #EF4444)' }} />
        <span className="text-[8px]" style={{ color: '#EF4444' }}>anomalie</span>
      </div>
    </div>
  );
}

function ShapTimeline({ matrix, timestamps, featureNames }: { matrix: NonNullable<ShapData['full_matrix']>; timestamps?: string[]; featureNames?: string[] }) {
  const names = featureNames || (matrix.length > 0 ? Object.keys(matrix[0].values) : []);
  const topFeats = names.slice(0, 5);
  const maxPts = Math.min(matrix.length, 100);
  const data = Array.from({ length: maxPts }).map((_, i) => {
    const row: Record<string, any> = { idx: i, ts: timestamps?.[i]?.slice(5, 16) || `#${i}` };
    for (const f of topFeats) {
      row[f] = matrix[i].values[f] || 0;
    }
    return row;
  });
  const colors = ['#EF4444', '#34D399', '#60A5FA', '#F97316', '#A78BFA', '#FBBF24'];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="ts" tick={{ fontSize: 8, fill: 'var(--color-text-secondary)' }} interval={Math.max(1, Math.floor(maxPts / 15))} />
        <YAxis tick={{ fontSize: 8, fill: 'var(--color-text-secondary)' }} />
        <Tooltip contentStyle={{ background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 10 }} />
        <Legend wrapperStyle={{ fontSize: 9 }} />
        {topFeats.map((f, i) => (
          <Line key={f} type="monotone" dataKey={f} stroke={colors[i % colors.length]} dot={false} strokeWidth={1.5} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function SeasonalShap({ seasonal }: { seasonal: NonNullable<ShapData['seasonal_breakdown']> }) {
  const seasons = ['winter', 'spring', 'summer', 'autumn'];
  const labels: Record<string, string> = { winter: 'Hiver', spring: 'Printemps', summer: 'Été', autumn: 'Automne' };
  const colors = ['#60A5FA', '#34D399', '#FBBF24', '#F97316'];
  const allFeats = new Set<string>();
  for (const s of seasons) {
    (seasonal[s]?.importance || []).forEach((f: ShapGlobal) => allFeats.add(f.feature));
  }
  const featList = [...allFeats].slice(0, 8);
  const chartData = featList.map(feat => {
    const row: Record<string, any> = { feature: feat };
    for (const s of seasons) {
      const found = (seasonal[s]?.importance || []).find((f: ShapGlobal) => f.feature === feat);
      row[s] = found ? found.shap_importance : 0;
    }
    return row;
  });

  return (
    <div>
      <div className="flex gap-3 mb-2">
        {seasons.map((s, i) => (
          <div key={s} className="flex items-center gap-1 text-[9px]">
            <div className="w-2.5 h-2.5 rounded" style={{ background: colors[i] }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>{labels[s]}</span>
            <span className="font-mono" style={{ color: colors[i] }}>{seasonal[s]?.count || 0} éch.</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }} layout="vertical">
          <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 8, fill: 'var(--color-text-secondary)' }} />
          <YAxis type="category" dataKey="feature" tick={{ fontSize: 8, fill: 'var(--color-text-secondary)' }} width={120} />
          <Tooltip contentStyle={{ background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 10 }} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          {seasons.map((s, i) => (
            <Bar key={s} dataKey={s} fill={colors[i]} name={labels[s]} stackId="a" />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ShapBeeswarm({ shapData }: { shapData?: ShapData | null }) {
  const [data, setData] = useState<ShapData | null>(null);
  const [view, setView] = useState<'global' | 'captor' | 'force' | 'heatmap' | 'timeline' | 'seasonal'>('global');
  const [selectedSample, setSelectedSample] = useState<ShapSample | null>(null);

  useMemo(() => {
    if (shapData) setData(shapData);
  }, [shapData]);

  if (!data?.available || !data.global_importance?.length) return null;

  const maxImp = Math.max(...data.global_importance.map(f => f.shap_importance), 0.0001);
  const topFeatures = data.global_importance.slice(0, 15);

  const tabs = [
    { key: 'global' as const, label: 'Globale', icon: Sparkles },
    { key: 'captor' as const, label: 'Capteurs', icon: Thermometer },
    { key: 'force' as const, label: 'Force Plot', icon: Info },
    { key: 'heatmap' as const, label: 'Heatmap', icon: Waves },
    { key: 'timeline' as const, label: 'Timeline', icon: Clock },
    { key: 'seasonal' as const, label: 'Saisonnier', icon: CloudSun },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="rounded-2xl overflow-hidden glass glass-border" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #F59E0B, #F97316, transparent)' }} />
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Brain className="w-4 h-4" style={{ color: '#F59E0B' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>🔬 SHAP — 6 vues d'interprétabilité</h3>
          <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: '#F59E0B' }}>
            {data.n_samples_explained} éch.
          </span>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setView(t.key)}
                className="text-[10px] px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-all flex items-center gap-1"
                style={{
                  background: view === t.key ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
                  color: view === t.key ? '#F59E0B' : 'var(--color-text-secondary)',
                  border: `1px solid ${view === t.key ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                <t.icon className="w-3 h-3" /> {t.label}
              </button>
            ))}
          </div>

          {view === 'global' && (
            <>
              <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                Impact moyen absolu de chaque feature sur la décision du modèle.
              </p>
              <div className="space-y-1.5">
                {topFeatures.map((f, i) => {
                  const pct = (f.shap_importance / maxImp) * 100;
                  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#D4A5E8', '#A78BFA', '#F97316', '#FBBF24', '#60A5FA', '#34D399', '#F472B6', '#818CF8', '#F59E0B', '#06B6D4', '#EC4899'];
                  return (
                    <div key={f.feature} className="flex items-center gap-2">
                      <span className="text-[9px] min-w-[110px] font-mono truncate" style={{ color: 'var(--color-text-secondary)' }}>
                        {f.feature}
                      </span>
                      <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <div className="h-full rounded flex items-center justify-end pr-1.5 transition-all duration-300"
                          style={{
                            width: `${Math.max(pct, 4)}%`,
                            background: `linear-gradient(90deg, ${colors[i % colors.length]}40, ${colors[i % colors.length]})`,
                          }}>
                          <span className="text-[7px] font-bold text-white">{f.shap_importance.toFixed(5)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {view === 'captor' && (
            <>
              <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                Répartition de l'importance SHAP par capteur et sous-système.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CaptorDonut globalImportance={data.global_importance} />
                <CaptorBreakdown globalImportance={data.global_importance} />
              </div>
            </>
          )}

          {view === 'force' && (
            <>
              <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                Impact individuel par anomalie. <span style={{ color: '#EF4444' }}>Rouge → pousse vers anomalie</span>, <span style={{ color: '#22C55E' }}>vert → pousse vers normale</span>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                {(data.sample_explanations || []).slice(0, 12).map(exp => (
                  <div key={exp.index}
                    onClick={() => setSelectedSample(selectedSample?.index === exp.index ? null : exp)}
                    className="p-3 rounded-xl cursor-pointer transition-all"
                    style={{
                      background: selectedSample?.index === exp.index ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${selectedSample?.index === exp.index ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold" style={{ color: '#EF4444' }}>Anomalie #{exp.index}</span>
                      <span className="text-[9px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>score: {exp.anomaly_score.toFixed(4)}</span>
                    </div>
                    {(selectedSample?.index === exp.index) ? (
                      <ForcePlot sample={exp} />
                    ) : (
                      <div className="space-y-1">
                        {exp.top_features_anomaly?.slice(0, 2).map(tf => (
                          <div key={tf.feature} className="flex items-center gap-1.5 text-[9px]">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#EF4444' }} />
                            <span className="font-mono truncate flex-1" style={{ color: 'var(--color-text-secondary)' }}>{tf.feature}</span>
                            <span style={{ color: '#EF4444' }}>+{tf.shap_value.toFixed(4)}</span>
                          </div>
                        ))}
                        {exp.top_features_normal?.slice(0, 1).map(tf => (
                          <div key={tf.feature} className="flex items-center gap-1.5 text-[9px]">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#22C55E' }} />
                            <span className="font-mono truncate flex-1" style={{ color: 'var(--color-text-secondary)' }}>{tf.feature}</span>
                            <span style={{ color: '#22C55E' }}>{tf.shap_value.toFixed(4)}</span>
                          </div>
                        ))}
                        <div className="text-[8px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>👆 Cliquez pour le force plot complet</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {view === 'heatmap' && data.full_matrix && data.full_matrix.length > 0 && (
            <>
              <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                Matrice SHAP complète : chaque ligne = un échantillon, chaque colonne = une feature. <span style={{ color: '#EF4444' }}>Rouge</span> = pousse vers anomalie, <span style={{ color: '#22C55E' }}>vert</span> = pousse vers normale.
              </p>
              <ShapHeatmap matrix={data.full_matrix} featureNames={data.feature_names} />
            </>
          )}

          {view === 'timeline' && data.full_matrix && data.full_matrix.length > 0 && (
            <>
              <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                Évolution temporelle des valeurs SHAP pour les 5 features les plus importantes.
              </p>
              <ShapTimeline matrix={data.full_matrix} timestamps={data.timestamps} featureNames={data.feature_names} />
            </>
          )}

          {view === 'seasonal' && data.seasonal_breakdown && Object.keys(data.seasonal_breakdown).length > 0 && (
            <>
              <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                Importance SHAP par saison. Comparez comment l'influence des features varie entre hiver, printemps, été et automne.
              </p>
              <SeasonalShap seasonal={data.seasonal_breakdown} />
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
