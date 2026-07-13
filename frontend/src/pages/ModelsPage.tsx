import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList,
} from 'recharts';
import {
  Brain, Cpu, Thermometer, Snowflake, Layers, TrendingUp, TrendingDown,
  Activity, CheckCircle2, XCircle,
} from 'lucide-react';

interface ModelSummary {
  id: string;
  name: string;
  model_type: string;
  sensor: string;
  status: string;
  version: string;
  trained_at: string;
  training_samples: number;
  feature_count: number;
  anomaly_rate_normal: number;
  detection_moyenne: number | null;
  meilleure_attaque: string | null;
  meilleur_taux: number | null;
  pire_attaque: string | null;
  pire_taux: number | null;
}

const SENSOR_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  weather: { icon: <Thermometer className="w-5 h-5" />, color: '#FF6B6B', label: 'Weather' },
  fridge: { icon: <Snowflake className="w-5 h-5" />, color: '#4ECDC4', label: 'Fridge' },
  thermostat: { icon: <Cpu className="w-5 h-5" />, color: '#45B7D1', label: 'Thermostat' },
  combine: { icon: <Layers className="w-5 h-5" />, color: '#96CEB4', label: 'Combiné' },
};

export default function ModelsPage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/models/')
      .then(res => res.json())
      .then(data => { setModels(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const getStatusBadge = (status: string) => {
    if (status === 'deployed') return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: 'Déployé', color: 'var(--color-accent-success)' };
    if (status === 'trained') return { icon: <Activity className="w-3.5 h-3.5" />, label: 'Entraîné', color: 'var(--color-accent-primary)' };
    return { icon: <XCircle className="w-3.5 h-3.5" />, label: 'Archivé', color: 'var(--color-text-secondary)' };
  };

  const chartData = models.map(m => ({
    name: m.name.split('-')[1]?.trim() || m.sensor,
    detection: m.detection_moyenne ?? 0,
    sensor: m.sensor,
    fill: SENSOR_META[m.sensor]?.color || '#888',
  }));

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-8 h-8 rounded-full border-2 border-transparent" style={{ borderTopColor: 'var(--color-accent-primary)' }} />
    </div>
  );

  if (error) return <div className="text-red-400 p-6">Erreur: {error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Modèles ML</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Modèles Isolation Forest entraînés sur les données IoT — Détection d'attaques en temps réel
        </p>
      </div>

      {/* Chart bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Taux de détection moyen par modèle</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
            <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} unit="%" />
            <Tooltip
              contentStyle={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text-primary)' }}
              formatter={(val: unknown) => { const v = Number(val); return [`${v.toFixed(1)}%`, 'Détection']; }}
            />
            <Bar dataKey="detection" radius={[6, 6, 0, 0]}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={entry.fill} />
              ))}
              <LabelList dataKey="detection" position="top" formatter={(v: unknown) => { const n = Number(v); return `${n.toFixed(1)}%`; }} style={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Model cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {models.map((model, idx) => {
          const meta = SENSOR_META[model.sensor] || { icon: <Brain className="w-5 h-5" />, color: '#888', label: model.sensor };
          const badge = getStatusBadge(model.status);
          return (
            <motion.div
              key={model.id}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.08 }}
              onClick={() => navigate(`/models/${model.id}`)}
              className="rounded-xl p-5 cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}20`, color: meta.color }}>
                    {meta.icon}
                  </div>
                  <div>
                    <div className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{meta.label}</div>
                    <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{model.model_type} · v{model.version}</div>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-medium" style={{
                  color: badge.color,
                  border: `1px solid ${badge.color}30`,
                  background: `${badge.color}10`,
                }}>
                  {badge.icon} {badge.label}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="text-center p-2 rounded-lg" style={{ background: 'var(--color-bg-card)' }}>
                  <div className="text-lg font-bold" style={{ color: model.detection_moyenne !== null && model.detection_moyenne >= 80 ? 'var(--color-accent-success)' : model.detection_moyenne !== null && model.detection_moyenne >= 50 ? 'var(--color-accent-warning)' : 'var(--color-accent-danger)' }}>
                    {model.detection_moyenne !== null ? `${model.detection_moyenne.toFixed(1)}%` : 'N/A'}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Détection moy.</div>
                </div>
                <div className="text-center p-2 rounded-lg" style={{ background: 'var(--color-bg-card)' }}>
                  <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>{(model.training_samples / 1000).toFixed(0)}k</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Échantillons</div>
                </div>
                <div className="text-center p-2 rounded-lg" style={{ background: 'var(--color-bg-card)' }}>
                  <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>{model.feature_count}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Features</div>
                </div>
              </div>

              {model.meilleure_attaque && (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <TrendingUp className="w-3 h-3" style={{ color: 'var(--color-accent-success)' }} />
                  <span>Meilleur: <strong style={{ color: 'var(--color-text-primary)' }}>{model.meilleure_attaque}</strong> ({model.meilleur_taux?.toFixed(1)}%)</span>
                  <span className="mx-1">·</span>
                  <TrendingDown className="w-3 h-3" style={{ color: 'var(--color-accent-danger)' }} />
                  <span>Pire: <strong style={{ color: 'var(--color-text-primary)' }}>{model.pire_attaque}</strong> ({model.pire_taux?.toFixed(1)}%)</span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
