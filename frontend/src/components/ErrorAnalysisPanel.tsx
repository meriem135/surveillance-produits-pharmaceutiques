import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area, ComposedChart,
} from 'recharts';
import { AlertTriangle, Filter, X } from 'lucide-react';

interface ErrorPoint {
  datetime: string;
  actual_label: number;
  prediction: number;
  anomaly_score: number;
  _sensor?: string;
  temperature?: number;
}

interface Props {
  points: ErrorPoint[];
  attackMetrics?: Array<{ attack_type: string; n_total: number; n_detected?: number; detection_rate?: number; n_anomalies?: number; taux_detection?: number }>;
}

export default function ErrorAnalysisPanel({ points, attackMetrics }: Props) {
  const [errorType, setErrorType] = useState<'all' | 'fp' | 'fn'>('all');
  const [sensorFilter, setSensorFilter] = useState<string | null>(null);

  const errorData = useMemo(() => {
    const fps = points.filter(p => p.actual_label === 0 && p.prediction === 1);
    const fns = points.filter(p => p.actual_label === 1 && p.prediction === 0);
    const totalNormal = points.filter(p => p.actual_label === 0).length || 1;
    const totalAttack = points.filter(p => p.actual_label === 1).length || 1;

    const byHour: Record<number, { fp: number; fn: number; total: number }> = {};
    for (const p of points) {
      const h = new Date(p.datetime).getHours();
      if (!byHour[h]) byHour[h] = { fp: 0, fn: 0, total: 0 };
      byHour[h].total++;
      if (p.actual_label === 0 && p.prediction === 1) byHour[h].fp++;
      if (p.actual_label === 1 && p.prediction === 0) byHour[h].fn++;
    }

    const hourlyData = Array.from({ length: 24 }, (_, h) => ({
      hour: `${h}h`,
      fpRate: byHour[h]?.total ? (byHour[h].fp / byHour[h].total) * 100 : 0,
      fnRate: byHour[h]?.total ? (byHour[h].fn / byHour[h].total) * 100 : 0,
      fpCount: byHour[h]?.fp || 0,
      fnCount: byHour[h]?.fn || 0,
      total: byHour[h]?.total || 0,
    }));

    const bySensor: Record<string, { fp: number; fn: number; total: number }> = {};
    for (const p of points) {
      const s = p._sensor || 'unknown';
      if (!bySensor[s]) bySensor[s] = { fp: 0, fn: 0, total: 0 };
      bySensor[s].total++;
      if (p.actual_label === 0 && p.prediction === 1) bySensor[s].fp++;
      if (p.actual_label === 1 && p.prediction === 0) bySensor[s].fn++;
    }

    return {
      fps, fns, totalNormal, totalAttack,
      fpRate: (fps.length / totalNormal) * 100,
      fnRate: (fns.length / totalAttack) * 100,
      hourlyData,
      bySensor: Object.entries(bySensor).map(([s, d]) => ({
        sensor: s,
        fpRate: d.total ? (d.fp / d.total) * 100 : 0,
        fnRate: d.total ? (d.fn / d.total) * 100 : 0,
      })),
    };
  }, [points]);

  const errorTimeline = useMemo(() => {
    const byDay: Record<string, { fp: number; fn: number }> = {};
    for (const p of points) {
      const key = new Date(p.datetime).toLocaleDateString('fr-FR');
      if (!byDay[key]) byDay[key] = { fp: 0, fn: 0 };
      if (p.actual_label === 0 && p.prediction === 1) byDay[key].fp++;
      if (p.actual_label === 1 && p.prediction === 0) byDay[key].fn++;
    }
    return Object.entries(byDay).slice(-30).map(([date, d]) => ({ date, ...d }));
  }, [points]);

  if (points.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="rounded-2xl overflow-hidden glass glass-border" style={{ borderColor: 'rgba(239,68,68,0.12)' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #EF4444, #FBBF24, transparent)' }} />
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <AlertTriangle className="w-4 h-4" style={{ color: '#EF4444' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>⚠️ Analyse des Erreurs</h3>
          <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: '#FBBF24' }}>
            FP: {errorData.fpRate.toFixed(2)}% · FN: {errorData.fnRate.toFixed(2)}%
          </span>
        </div>
        <div className="p-5">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Faux Positifs', value: errorData.fps.length, color: '#FBBF24', rate: errorData.fpRate, sub: 'alertes normales → attaque' },
              { label: 'Faux Négatifs', value: errorData.fns.length, color: '#EF4444', rate: errorData.fnRate, sub: 'attaques → normales' },
              { label: 'Vrais Positifs', value: points.filter(p => p.actual_label === 1 && p.prediction === 1).length, color: '#22C55E', sub: 'attaques détectées' },
              { label: 'Vrais Négatifs', value: points.filter(p => p.actual_label === 0 && p.prediction === 0).length, color: '#3B82F6', sub: 'normales correctes' },
            ].map(c => (
              <div key={c.label} className="p-3 rounded-xl text-center" style={{ background: `${c.color}10`, border: `1px solid ${c.color}20` }}>
                <div className="text-[18px] font-bold" style={{ color: c.color }}>{c.value.toLocaleString()}</div>
                <div className="text-[9px] font-bold" style={{ color: c.color }}>{(c.rate ?? 0).toFixed(2)}%</div>
                <div className="text-[8px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{c.label}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Filtrer:</span>
            <button onClick={() => setErrorType('all')}
              className="text-[10px] px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-all"
              style={{
                background: errorType === 'all' ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
                color: errorType === 'all' ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
              }}>Tous</button>
            <button onClick={() => setErrorType('fp')}
              className="text-[10px] px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-all flex items-center gap-1"
              style={{
                background: errorType === 'fp' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)',
                color: errorType === 'fp' ? '#FBBF24' : 'var(--color-text-secondary)',
              }}><Filter className="w-3 h-3" /> FP</button>
            <button onClick={() => setErrorType('fn')}
              className="text-[10px] px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-all flex items-center gap-1"
              style={{
                background: errorType === 'fn' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
                color: errorType === 'fn' ? '#EF4444' : 'var(--color-text-secondary)',
              }}><Filter className="w-3 h-3" /> FN</button>
            <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />
            {['weather', 'fridge', 'thermostat'].map(s => (
              <button key={s} onClick={() => setSensorFilter(sensorFilter === s ? null : s)}
                className="text-[10px] px-2.5 py-1 rounded-lg font-bold cursor-pointer"
                style={{
                  background: sensorFilter === s ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
                  color: sensorFilter === s ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
                }}>{s}</button>
            ))}
            {(errorType !== 'all' || sensorFilter) && (
              <button onClick={() => { setErrorType('all'); setSensorFilter(null); }}
                className="text-[9px] px-2 py-0.5 rounded cursor-pointer flex items-center gap-1"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}>
                <X className="w-3 h-3" /> Effacer
              </button>
            )}
          </div>

          {/* Charts grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Hourly error pattern */}
            <div>
              <p className="text-[10px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>Taux d'erreur par heure</p>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={errorData.hourlyData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="hour" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
                  <Bar dataKey="fpRate" name="FP %" fill="#FBBF24" fillOpacity={0.6} maxBarSize={12} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="fnRate" name="FN %" fill="#EF4444" fillOpacity={0.6} maxBarSize={12} radius={[2, 2, 0, 0]} />
                  <Area type="monotone" dataKey="total" name="Total" fill="#3B82F6" fillOpacity={0.05} stroke="#3B82F6" strokeWidth={1} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Error timeline */}
            <div>
              <p className="text-[10px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>Évolution des erreurs (30 derniers jours)</p>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={errorTimeline}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--color-text-secondary)', fontSize: 8 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
                  <Area type="monotone" dataKey="fp" name="FP" fill="#FBBF24" fillOpacity={0.2} stroke="#FBBF24" strokeWidth={2} />
                  <Area type="monotone" dataKey="fn" name="FN" fill="#EF4444" fillOpacity={0.2} stroke="#EF4444" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Per-sensor error rate */}
            <div>
              <p className="text-[10px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>Taux d'erreur par capteur</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={errorData.bySensor} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                  <YAxis dataKey="sensor" type="category" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
                  <Bar dataKey="fpRate" name="FP" fill="#FBBF24" fillOpacity={0.7} radius={[0, 3, 3, 0]} maxBarSize={16} />
                  <Bar dataKey="fnRate" name="FN" fill="#EF4444" fillOpacity={0.7} radius={[0, 3, 3, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Attack detection rates */}
            {attackMetrics && attackMetrics.length > 0 && (
              <div>
                <p className="text-[10px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>Taux de détection par type d'attaque</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={attackMetrics.map(a => ({ name: a.attack_type.replace('IoT_', '').replace('_normal', ''), rate: (a.detection_rate ?? a.taux_detection ?? 0), total: a.n_total }))} layout="vertical" margin={{ left: 70 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                    <YAxis dataKey="name" type="category" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} width={70} />
                    <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, 'Détection']} />
                    <Bar dataKey="rate" name="Détection" fill="#22C55E" fillOpacity={0.7} radius={[0, 3, 3, 0]} maxBarSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
