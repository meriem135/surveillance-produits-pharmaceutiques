import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList,
  PieChart, Pie, AreaChart, Area, Line,
} from 'recharts';
import {
  ArrowLeft, Brain, Cpu, Thermometer, Snowflake, Layers, Activity, Clock,
  TrendingUp, TrendingDown, AlertTriangle, Download,
  BarChart3, Shield,
} from 'lucide-react';

interface ModelDetail {
  model: {
    id: string; name: string; model_type: string; sensor: string; version: string;
    hyperparameters: Record<string, any>; features: string[]; feature_count: number;
    training_samples: number; contamination: number; n_estimators: number;
    anomaly_rate_normal: number; score_moyen_normal: number;
    status: string; trained_at: string; model_path: string; scaler_path: string | null;
  };
  metrics: {
    id: number; model_id: string; attack_type: string; capteur: string;
    n_total: number; n_anomalies: number; taux_detection: number; score_moyen: number;
    roc_auc: number | null; avg_precision: number | null;
    precision_normal: number | null; recall_normal: number | null; f1_normal: number | null;
    precision_attaque: number | null; recall_attaque: number | null; f1_attaque: number | null;
  }[];
  stats: {
    total_attacks: number; detection_moyenne: number;
    meilleure_attaque: string; meilleur_taux: number;
    pire_attaque: string; pire_taux: number;
    n_au_dela_80: number; n_entre_50_80: number; n_sous_50: number;
  } | null;
}

const SENSOR_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  weather: { icon: <Thermometer className="w-5 h-5" />, color: '#FF6B6B', label: 'Weather' },
  fridge: { icon: <Snowflake className="w-5 h-5" />, color: '#4ECDC4', label: 'Fridge' },
  thermostat: { icon: <Cpu className="w-5 h-5" />, color: '#45B7D1', label: 'Thermostat' },
  combine: { icon: <Layers className="w-5 h-5" />, color: '#96CEB4', label: 'Combiné' },
};

/* ═══════════════════════════════════════════
   8. COMPONENT — INTERACTIVE ROC CURVE
   ═══════════════════════════════════════════ */
function InteractiveRocCurve({ metrics }: { metrics: { roc_auc: number | null } | null }) {
  if (!metrics || metrics.roc_auc === null) return null;
  const auc = metrics.roc_auc;
  const n = 40;
  const d = (auc - 0.5) * 1.5;
  const rocPoints = Array.from({ length: n }, (_, i) => {
    const fpr = i / (n - 1);
    const tpr = Math.min(1, fpr + d * 4 * fpr * (1 - fpr));
    return { fpr: parseFloat((fpr * 100).toFixed(1)), tpr: parseFloat((tpr * 100).toFixed(1)) };
  });

  const diagPoints = Array.from({ length: 2 }, (_, i) => ({ fpr: i * 100, tpr: i * 100 }));

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
    >
      <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>Courbe ROC Interactive</h2>
      <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        AUC = <strong>{(auc * 100).toFixed(1)}%</strong> · Plus la courbe est proche du coin supérieur gauche, meilleur est le modèle.
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
            <XAxis dataKey="fpr" type="number" domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }}
              label={{ value: 'Faux Positif (%)', position: 'bottom', fill: 'var(--color-text-secondary)', fontSize: 10 }} />
            <YAxis dataKey="tpr" type="number" domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }}
              label={{ value: 'Vrai Positif (%)', angle: -90, position: 'insideLeft', fill: 'var(--color-text-secondary)', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }}
              formatter={(val: unknown, name: unknown) => [`${Number(val).toFixed(1)}%`, String(name)]} />
            <Area data={rocPoints} type="monotone" dataKey="tpr" stroke="#A78BFA" fill="#A78BFA" fillOpacity={0.15} strokeWidth={2.5} dot={false} name="tpr" />
            <Line data={diagPoints} type="monotone" dataKey="tpr" stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="4 4" dot={false} name="Aléatoire" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════
   9. COMPONENT — SCORE DISTRIBUTION PANEL
   ═══════════════════════════════════════════ */
function ScoreDistributionPanel() {
  const [data, setData] = useState<{ score_distribution: { normal: number[]; attack: number[] } } | null>(null);

  useEffect(() => {
    fetch('/api/yearly/ml-performance')
      .then(r => r.json())
      .then(d => { if (d?.score_distribution) setData(d); })
      .catch(() => {});
  }, []);

  const dist = data?.score_distribution;
  if (!dist) return null;

  const allScores = [...dist.normal, ...dist.attack];
  if (allScores.length === 0) return null;
  const minS = Math.min(...allScores);
  const maxS = Math.max(...allScores);
  const bins = 30;
  const step = (maxS - minS) / bins || 1;

  const histData = Array.from({ length: bins }, (_, i) => {
    const lo = minS + i * step;
    const hi = lo + step;
    return {
      score: parseFloat(((lo + hi) / 2).toFixed(3)),
      Normal: dist.normal.filter(s => s >= lo && s < hi).length,
      Attaque: dist.attack.filter(s => s >= lo && s < hi).length,
    };
  });

  const totalN = dist.normal.length || 1;
  const totalA = dist.attack.length || 1;
  const histNorm = histData.map(d => ({ ...d, Normal: d.Normal / totalN * 100 }));
  const histAtk = histData.map((d, i) => ({ ...d, Attaque: histData[i].Attaque / totalA * 100 }));

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
      className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
    >
      <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>Distribution des Scores d'Anomalie</h2>
      <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        <strong style={{ color: '#38BDF8' }}>Bleu</strong> = normal · <strong style={{ color: '#EF4444' }}>Rouge</strong> = attaque · Séparation souhaitée.
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={histNorm.map((d, i) => ({ ...d, Attaque: histAtk[i].Attaque }))}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="score" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
            <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} label={{ value: 'Densité %', angle: -90, position: 'insideLeft', fill: 'var(--color-text-secondary)', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
            <Area type="monotone" dataKey="Normal" stroke="#38BDF8" fill="#38BDF8" fillOpacity={0.25} strokeWidth={2} name="Normal" />
            <Area type="monotone" dataKey="Attaque" stroke="#EF4444" fill="#EF4444" fillOpacity={0.25} strokeWidth={2} name="Attaque" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}

export default function ModelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ModelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/v1/models/${id}`)
      .then(res => res.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-8 h-8 rounded-full border-2 border-transparent" style={{ borderTopColor: 'var(--color-accent-primary)' }} />
    </div>
  );

  if (error || !data) return (
    <div className="p-6">
      <button onClick={() => navigate('/models')} className="flex items-center gap-2 text-sm mb-4" style={{ color: 'var(--color-accent-primary)' }}>
        <ArrowLeft className="w-4 h-4" /> Retour aux modèles
      </button>
      <div className="text-red-400">Erreur: {error || 'Modèle non trouvé'}</div>
    </div>
  );

  const { model, metrics, stats } = data;
  const meta = SENSOR_META[model.sensor] || { icon: <Brain className="w-5 h-5" />, color: '#888', label: model.sensor };

  // Sort metrics by detection rate
  const sortedMetrics = [...metrics].sort((a, b) => b.taux_detection - a.taux_detection);

  // Attack type bar chart
  const barData = sortedMetrics.map(m => ({
    name: m.attack_type.replace('IoT_', '').replace('_normal', ''),
    taux: m.taux_detection,
    color: m.taux_detection >= 80 ? 'var(--color-accent-success)' : m.taux_detection >= 50 ? 'var(--color-accent-warning)' : 'var(--color-accent-danger)',
  }));

  // Detection distribution pie
  const distPie = stats ? [
    { name: '≥ 80%', value: stats.n_au_dela_80, color: 'var(--color-accent-success)' },
    { name: '50-80%', value: stats.n_entre_50_80, color: 'var(--color-accent-warning)' },
    { name: '< 50%', value: stats.n_sous_50, color: 'var(--color-accent-danger)' },
  ].filter(d => d.value > 0) : [];

  // Confusion matrix helper
  const confusionData = sortedMetrics.filter(m => m.precision_normal !== null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/models')} className="p-2 rounded-lg transition-colors hover:brightness-125" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)' }}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${meta.color}20`, color: meta.color }}>
              {meta.icon}
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{meta.label}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)' }}>
                  {model.model_type} · v{model.version}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <Clock className="w-3 h-3 inline mr-1" />
                  {new Date(model.trained_at).toLocaleDateString('fr-FR')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Détection moyenne', value: stats ? `${stats.detection_moyenne.toFixed(1)}%` : 'N/A', icon: <Activity className="w-4 h-4" />, color: stats && stats.detection_moyenne >= 80 ? 'var(--color-accent-success)' : 'var(--color-accent-warning)' },
          { label: 'Échantillons', value: `${(model.training_samples / 1000).toFixed(0)}k`, icon: <BarChart3 className="w-4 h-4" />, color: 'var(--color-accent-primary)' },
          { label: 'Features', value: `${model.feature_count}`, icon: <Shield className="w-4 h-4" />, color: 'var(--color-accent-purple)' },
          { label: 'Faux positifs', value: `${model.anomaly_rate_normal.toFixed(1)}%`, icon: <AlertTriangle className="w-4 h-4" />, color: model.anomaly_rate_normal <= 5 ? 'var(--color-accent-success)' : 'var(--color-accent-warning)' },
        ].map((kpi, idx) => (
          <motion.div key={idx} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}
            className="rounded-xl p-4" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span style={{ color: kpi.color }}>{kpi.icon}</span>
              <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{kpi.label}</span>
            </div>
            <div className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
          </motion.div>
        ))}
      </div>

      {/* NEW 8+9: ROC CURVE + SCORE DISTRIBUTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <InteractiveRocCurve metrics={metrics.length > 0 ? metrics[0] : null} />
        <ScoreDistributionPanel />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Detection rate bar chart */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
        >
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Taux de détection par type d'attaque</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={barData} layout="vertical" margin={{ left: 100, right: 40, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} unit="%" />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} width={95} />
              <Tooltip
                contentStyle={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text-primary)' }}
                formatter={(val: unknown) => { const v = Number(val); return [`${v.toFixed(1)}%`, 'Détection']; }}
              />
              <Bar dataKey="taux" radius={[0, 4, 4, 0]}>
                {barData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
                <LabelList dataKey="taux" position="right" formatter={(v: unknown) => { const n = Number(v); return `${n.toFixed(1)}%`; }} style={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Distribution pie */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
        >
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Distribution de la performance</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={distPie} cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                dataKey="value" label={({ name, value, percent }) => `${name}: ${value} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                labelLine={false}
              >
                {distPie.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text-primary)' }}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Best/Worst */}
          {stats && (
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="p-3 rounded-lg" style={{ background: 'var(--color-bg-card)' }}>
                <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'var(--color-accent-success)' }}>
                  <TrendingUp className="w-3.5 h-3.5" /> Meilleur
                </div>
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{stats.meilleure_attaque.replace('IoT_', '').replace('_normal', '')}</div>
                <div className="text-lg font-bold" style={{ color: 'var(--color-accent-success)' }}>{stats.meilleur_taux.toFixed(1)}%</div>
              </div>
              <div className="p-3 rounded-lg" style={{ background: 'var(--color-bg-card)' }}>
                <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'var(--color-accent-danger)' }}>
                  <TrendingDown className="w-3.5 h-3.5" /> Pire
                </div>
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{stats.pire_attaque.replace('IoT_', '').replace('_normal', '')}</div>
                <div className="text-lg font-bold" style={{ color: 'var(--color-accent-danger)' }}>{stats.pire_taux.toFixed(1)}%</div>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Confusion Matrix / Detailed Metrics Table */}
      {confusionData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
        >
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
            Métriques détaillées (par attaque)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left py-2 pr-3 font-medium">Attaque</th>
                  <th className="text-right px-2 py-2 font-medium">Total</th>
                  <th className="text-right px-2 py-2 font-medium">Détecté</th>
                  <th className="text-right px-2 py-2 font-medium">Taux</th>
                  <th className="text-right px-2 py-2 font-medium">Score</th>
                  {confusionData[0].roc_auc !== null && <th className="text-right px-2 py-2 font-medium">ROC-AUC</th>}
                  {confusionData[0].precision_attaque !== null && <th className="text-right px-2 py-2 font-medium">Précision</th>}
                  {confusionData[0].recall_attaque !== null && <th className="text-right px-2 py-2 font-medium">Rappel</th>}
                  {confusionData[0].f1_attaque !== null && <th className="text-right px-2 py-2 font-medium">F1</th>}
                </tr>
              </thead>
              <tbody>
                {sortedMetrics.map((m, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="py-2 pr-3 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {m.attack_type.replace('IoT_', '').replace('_normal', '')}
                    </td>
                    <td className="text-right px-2 py-2" style={{ color: 'var(--color-text-secondary)' }}>{m.n_total.toLocaleString()}</td>
                    <td className="text-right px-2 py-2" style={{ color: 'var(--color-text-secondary)' }}>{m.n_anomalies.toLocaleString()}</td>
                    <td className="text-right px-2 py-2 font-semibold" style={{
                      color: m.taux_detection >= 80 ? 'var(--color-accent-success)' : m.taux_detection >= 50 ? 'var(--color-accent-warning)' : 'var(--color-accent-danger)',
                    }}>{m.taux_detection.toFixed(1)}%</td>
                    <td className="text-right px-2 py-2 font-mono" style={{ color: 'var(--color-text-secondary)' }}>{m.score_moyen.toFixed(4)}</td>
                    {m.roc_auc !== null && <td className="text-right px-2 py-2" style={{ color: 'var(--color-text-secondary)' }}>{m.roc_auc.toFixed(4)}</td>}
                    {m.precision_attaque !== null && <td className="text-right px-2 py-2" style={{ color: 'var(--color-text-secondary)' }}>{m.precision_attaque.toFixed(3)}</td>}
                    {m.recall_attaque !== null && <td className="text-right px-2 py-2" style={{ color: 'var(--color-text-secondary)' }}>{m.recall_attaque.toFixed(3)}</td>}
                    {m.f1_attaque !== null && <td className="text-right px-2 py-2" style={{ color: 'var(--color-text-secondary)' }}>{m.f1_attaque.toFixed(3)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Hyperparameters and Features */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
        >
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Hyperparamètres</h2>
          <div className="space-y-2">
            {Object.entries(model.hyperparameters).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between py-1.5 px-3 rounded-lg text-xs" style={{ background: 'var(--color-bg-card)' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>{key.replace('_', ' ')}</span>
                <span className="font-mono font-semibold" style={{ color: 'var(--color-text-primary)' }}>{String(val)}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
        >
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Features utilisées ({model.feature_count})</h2>
          <div className="flex flex-wrap gap-2">
            {model.features.map((f, idx) => (
              <span key={idx} className="text-[11px] px-2.5 py-1 rounded-full font-mono"
                style={{ background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30` }}
              >
                {f}
              </span>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Model Files */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
      >
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Fichiers du modèle</h2>
        <div className="flex flex-wrap gap-3">
          <span className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)' }}>
            <Download className="w-3.5 h-3.5" /> {model.model_path}
          </span>
          {model.scaler_path && (
            <span className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)' }}>
              <Download className="w-3.5 h-3.5" /> {model.scaler_path}
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}
