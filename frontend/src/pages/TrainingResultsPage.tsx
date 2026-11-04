import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import {
  Brain, Activity, AlertTriangle,
  Zap, Calendar, TrendingUp, Loader2, CheckCircle2,
} from 'lucide-react';

interface ModelMetrics {
  precision: number; recall: number; f1: number; roc_auc: number;
  average_precision: number; fpr: number;
  tp: number; fp: number; fn: number; tn: number;
}

interface AttackMetric {
  attack_type: string; attack_id?: string;
  n_total: number; n_detected: number;
  detection_rate: number; avg_score: number;
}

interface MonthlyData {
  month: number; month_name: string; total: number;
  attacks: number; detected: number;
  precision: number; recall: number; f1: number;
}

interface SeasonalData {
  season: string; total: number; attacks: number;
  detected: number; precision: number; recall: number;
}

interface TimelinePoint {
  datetime: string; weather_temp: number; fridge_temp: number;
  thermostat_temp: number; label: number; prediction: number;
  anomaly_score: number;
}

interface FeatureImportance {
  feature: string; importance: number;
}

interface ShapData {
  available: boolean;
  global_importance: Array<{ feature: string; shap_importance: number }>;
  sample_explanations: Array<{
    index: number; anomaly_score: number;
    top_features_anomaly: Array<{ feature: string; shap_value: number; feature_value: number }>;
    top_features_normal: Array<{ feature: string; shap_value: number; feature_value: number }>;
  }>;
  n_samples_explained: number;
  full_matrix?: Array<{ sample_index: number; values: Record<string, number> }>;
  feature_names?: string[];
  timestamps?: string[];
  seasonal_breakdown?: Record<string, { count: number; importance: Array<{ feature: string; shap_importance: number }> }>;
}

interface TrainingResult {
  status: string;
  training_info: {
    sensors_used: string[];
    total_rows?: number;
    n_total_samples: number;
    n_normal_samples: number;
    n_attack_samples: number;
    date_range?: string[];
    duration_seconds: number;
    n_features_selected?: number;
    n_features_original?: number;
  };
  model_metrics: ModelMetrics;
  attack_metrics: AttackMetric[];
  monthly_breakdown: MonthlyData[];
  seasonal_breakdown: SeasonalData[];
  timeline: TimelinePoint[];
  feature_importance: FeatureImportance[];
  shap?: ShapData;
}

const ATTACK_META: Record<string, { label: string; color: string; severity: string }> = {
  IoT_DDoS_normal: { label: 'DDoS', color: '#EF4444', severity: 'Critique' },
  IoT_DoS_normal: { label: 'DoS', color: '#F97316', severity: 'Élevé' },
  IoT_MITM_normal: { label: 'MITM', color: '#EAB308', severity: 'Élevé' },
  IoT_XSS_normal: { label: 'XSS', color: '#8B5CF6', severity: 'Moyen' },
  IoT_backdoor_normal: { label: 'Backdoor', color: '#DC2626', severity: 'Critique' },
  IoT_Injection_normal: { label: 'Injection', color: '#7C3AED', severity: 'Élevé' },
  IoT_password_normal: { label: 'Password', color: '#F59E0B', severity: 'Moyen' },
  IoT_ransomware_normal: { label: 'Ransomware', color: '#991B1B', severity: 'Critique' },
  IoT_scanning_normal: { label: 'Scanning', color: '#06B6D4', severity: 'Faible' },
  MITM_fridge_freeze: { label: 'MITM · frigo figé', color: '#0EA5E9', severity: 'Critique' },
  Injection_fridge_plausible: { label: 'Injection plausible · frigo', color: '#7C3AED', severity: 'Critique' },
};

const SEASON_LABELS: Record<string, { label: string; color: string }> = {
  winter: { label: 'Hiver', color: '#60A5FA' },
  spring: { label: 'Printemps', color: '#34D399' },
  summer: { label: 'Été', color: '#FBBF24' },
  autumn: { label: 'Automne', color: '#F97316' },
};

export default function TrainingResultsPage() {
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attackFilter, setAttackFilter] = useState<string | null>(null);
  const [expandedAttack, setExpandedAttack] = useState<string | null>(null);

  useEffect(() => {
    // Les résultats viennent toujours de l'API (dernier modèle enregistré en base) : ils restent
    // visibles après une reconnexion ou depuis un autre poste, pas seulement dans l'onglet qui a entraîné.
    const fetchResults = async () => {
      try {
        const r = await fetch('/api/v1/phase2/training-results');
        const text = await r.text(); // read as text: gère les réponses 502/vides sans erreur "Unexpected end of JSON input"
        if (!text) throw new Error('Réponse vide du serveur (backend indisponible ?).');
        const data = JSON.parse(text);
        const saved = sessionStorage.getItem('phase2_train_result');
        if (data.error && saved) setResult(JSON.parse(saved));
        else if (data.error) setError(data.error);
        else setResult(data);
      } catch (e: unknown) {
        // Repli : afficher le résultat déjà sauvegardé par l'entraînement (sessionStorage)
        const saved = sessionStorage.getItem('phase2_train_result');
        if (saved) {
          try { setResult(JSON.parse(saved)); return; } catch { /* ignore */ }
        }
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };
    fetchResults();
  }, []);

  const filteredAttacks = useMemo(() => {
    if (!result) return [];
    let attacks = result.attack_metrics || [];
    if (attackFilter) attacks = attacks.filter(a => a.attack_type === attackFilter);
    return attacks;
  }, [result, attackFilter]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center glass rounded-2xl p-8 glass-border">
          <Loader2 className="w-10 h-10 mx-auto mb-3 animate-spin" style={{ color: 'var(--color-accent-cyan)' }} />
          <p style={{ color: 'var(--color-text-secondary)' }}>Chargement des résultats...</p>
        </div>
      </div>
    );
  }

  const hasResult = !error && !!result;

  const metrics = result?.model_metrics;
  const info = result?.training_info;

  return (
    <div className="space-y-4 pb-8 px-1">
      {!hasResult && (
        <div className="h-full flex items-center justify-center">
          <div className="text-center glass rounded-2xl p-8 glass-border" style={{ maxWidth: 480 }}>
            <AlertTriangle className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--color-accent-warning)' }} />
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>Aucun résultat d'entraînement</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
              {error || "Lancez un entraînement depuis l'onglet ML & Anomalies pour voir les résultats ici."}
            </p>
            <a href="/#/dashboard/phase2"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold no-underline cursor-pointer transition-all"
              style={{
                background: 'linear-gradient(135deg, rgba(8,145,178,0.2), rgba(168,139,250,0.2))',
                color: 'var(--color-accent-cyan)',
                border: '1px solid rgba(8,145,178,0.3)',
              }}>
              <Brain className="w-4 h-4" />
              Aller à ML & Anomalies
            </a>
          </div>
        </div>
      )}

      {hasResult && result && (
      <>
      {/* ═══ HEADER ═══ */}
      <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow"
        style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #22C55E, #10B981, transparent)' }} />
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
          <CheckCircle2 className="w-4 h-4" style={{ color: '#22C55E' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
            Résultats de l'Entraînement
          </h3>
          <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: '#22C55E' }}>
            {info?.duration_seconds?.toFixed(1)}s
          </span>
        </div>

        {/* Summary cards */}
        <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Capteurs', value: info?.sensors_used?.join(', ') },
            { label: 'Échantillons', value: info?.n_total_samples?.toLocaleString() },
            { label: 'Normaux', value: info?.n_normal_samples?.toLocaleString() },
            { label: 'Attaques', value: info?.n_attack_samples?.toLocaleString() },
            { label: 'Features', value: `${info?.n_features_selected}/${info?.n_features_original}` },
          ].map(item => (
            <div key={item.label} className="p-3 rounded-xl text-center" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
              <div className="text-[12.5px]" style={{ color: 'var(--color-text-secondary)' }}>{item.label}</div>
              <div className="text-xs font-bold mt-0.5" style={{ color: 'var(--color-text-primary)' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ MODEL METRICS ═══ */}
      <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow"
        style={{ borderColor: 'rgba(150,206,180,0.12)' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #96CEB4, #0891B2, transparent)' }} />
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
          <Activity className="w-4 h-4" style={{ color: '#96CEB4' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
            Métriques du Modèle
          </h3>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
            {[
              { label: 'F1 Score', value: metrics?.f1, color: '#22C55E' },
              { label: 'Précision', value: metrics?.precision, color: '#8B5CF6' },
              { label: 'Rappel', value: metrics?.recall, color: '#3B82F6' },
              { label: 'ROC-AUC', value: metrics?.roc_auc, color: '#F59E0B' },
              { label: 'FPR', value: metrics?.fpr, color: '#EF4444' },
              { label: 'Avg Precision', value: metrics?.average_precision, color: '#0891B2' },
            ].map(m => (
              <div key={m.label} className="p-3 rounded-xl text-center glass glass-border" style={{ borderColor: `${m.color}25` }}>
                <div className="font-display font-bold text-xl" style={{ color: m.color }}>
                  {m.value != null ? `${(m.value * 100).toFixed(1)}%` : 'N/A'}
                </div>
                <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{m.label}</div>
              </div>
            ))}
          </div>

          {/* Confusion matrix */}
          {metrics && (
            <div className="rounded-xl p-4 glass" style={{ border: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
              <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Matrice de Confusion</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'VP · Attaque détectée', value: metrics.tp, color: '#22C55E' },
                  { label: 'FP · Fausse alerte', value: metrics.fp, color: '#F97316' },
                  { label: 'FN · Attaque manquée', value: metrics.fn, color: '#EF4444' },
                  { label: 'VN · Normal correct', value: metrics.tn, color: '#60A5FA' },
                ].map(c => (
                  <div key={c.label} className="p-3 rounded-xl text-center" style={{ background: `${c.color}12`, border: `1px solid ${c.color}20` }}>
                    <div className="font-bold text-lg" style={{ color: c.color }}>{c.value?.toLocaleString() || 'N/A'}</div>
                    <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{c.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ ATTACK TABLE ═══ */}
      {filteredAttacks.length > 0 && (
        <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow"
          style={{ borderColor: 'rgba(239,68,68,0.12)' }}>
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #EF4444, #F97316, transparent)' }} />
          <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
            <AlertTriangle className="w-4 h-4" style={{ color: '#EF4444' }} />
            <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
              Détection par Attaque
            </h3>
            <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: '#EF4444' }}>
              {filteredAttacks.length} types
            </span>
            <select value={attackFilter || ''} onChange={e => setAttackFilter(e.target.value || null)}
              className="text-[10px] px-2 py-1.5 rounded-lg cursor-pointer outline-none glass glass-border"
              style={{ color: 'var(--color-text-primary)' }}>
              <option value="">Tous</option>
              {filteredAttacks.map(a => (
                <option key={a.attack_type} value={a.attack_type}>
                  {ATTACK_META[a.attack_type]?.label || a.attack_type}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
                  {['Type', 'Sévérité', 'Total', 'Détectées', 'Taux', 'Score Moy.'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-bold text-[9px] uppercase tracking-wider"
                      style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredAttacks.map(atk => {
                  const meta = ATTACK_META[atk.attack_type] || { label: atk.attack_type, color: '#666', severity: '—' };
                  const isOpen = expandedAttack === atk.attack_id || expandedAttack === atk.attack_type;
                  return (
                    <tr key={atk.attack_id || atk.attack_type}
                      onClick={() => setExpandedAttack(isOpen ? null : (atk.attack_id || atk.attack_type))}
                      className="cursor-pointer transition-all"
                      style={{
                        borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 5%, transparent)',
                        background: isOpen ? `${meta.color}08` : undefined,
                      }}>
                      <td className="px-4 py-3">
                        <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold"
                          style={{ background: `${meta.color}18`, color: meta.color }}>
                          {meta.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono" style={{ color: 'var(--color-text-secondary)' }}>{atk.n_total?.toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono font-bold" style={{ color: '#22C55E' }}>{atk.n_detected?.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
                            <div className="h-full rounded-full" style={{
                              width: `${atk.detection_rate || 0}%`,
                              background: (atk.detection_rate || 0) >= 90 ? '#22C55E' : (atk.detection_rate || 0) >= 70 ? '#FBBF24' : '#EF4444',
                            }} />
                          </div>
                          <span className="text-[10px] font-bold font-mono" style={{
                            color: (atk.detection_rate || 0) >= 90 ? '#22C55E' : (atk.detection_rate || 0) >= 70 ? '#FBBF24' : '#EF4444',
                          }}>{(atk.detection_rate || 0).toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{(atk.avg_score || 0).toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ DETECTED ATTACKS LIST ═══ */}
      {result.timeline && result.timeline.filter(p => p.prediction === 1).length > 0 && (
        <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow"
          style={{ borderColor: 'rgba(239,68,68,0.15)' }}>
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #EF4444, #DC2626, transparent)' }} />
          <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
            <Zap className="w-4 h-4" style={{ color: '#EF4444' }} />
            <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
              Attaques Détectées (individuelles)
            </h3>
            <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: '#EF4444' }}>
              {result.timeline.filter(p => p.prediction === 1).length} détectées
            </span>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
                  {['#', 'Date', 'Weather °C', 'Fridge °C', 'Thermo °C', 'Score', 'Réel', 'Statut'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 font-bold text-[9px] uppercase tracking-wider sticky top-0"
                      style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-panel)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.timeline.filter(p => p.prediction === 1).slice(0, 40).map((p, i) => {
                  const isRealAttack = p.label === 1;
                  return (
                    <tr key={i} className="transition-all" style={{
                      borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 5%, transparent)',
                      background: isRealAttack ? 'rgba(34,197,94,0.04)' : 'rgba(239,68,68,0.04)',
                    }}>
                      <td className="px-3 py-2 text-[10px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-[10px]" style={{ color: 'var(--color-text-primary)' }}>
                        {new Date(p.datetime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 font-mono" style={{ color: '#FF6B6B' }}>{p.weather_temp.toFixed(1)}</td>
                      <td className="px-3 py-2 font-mono" style={{ color: '#4ECDC4' }}>{p.fridge_temp.toFixed(1)}</td>
                      <td className="px-3 py-2 font-mono" style={{ color: '#45B7D1' }}>{p.thermostat_temp.toFixed(1)}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono font-bold text-[10px]" style={{
                          color: p.anomaly_score > 0.5 ? '#EF4444' : p.anomaly_score > 0.2 ? '#F97316' : '#22C55E',
                        }}>{p.anomaly_score.toFixed(4)}</span>
                      </td>
                      <td className="px-3 py-2">
                        {isRealAttack ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                            style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>Attaque</span>
                        ) : (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                            style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>FP</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[9px] font-mono" style={{
                          color: isRealAttack ? '#22C55E' : '#EF4444',
                        }}>{isRealAttack ? 'vrai positif' : 'faux positif'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-[9px] flex items-center gap-3" style={{ color: 'var(--color-text-secondary)', borderTop: '1px solid color-mix(in srgb, var(--text-primary) 5%, transparent)' }}>
            <span><span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'rgba(34,197,94,0.5)' }} /> VP = Attaque réelle détectée</span>
            <span><span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'rgba(239,68,68,0.5)' }} /> FP = Fausse alerte (normal classé attaque)</span>
            <span className="ml-auto">{result.timeline.filter(p => p.prediction === 1).slice(0, 40).length} affichées / {result.timeline.filter(p => p.prediction === 1).length} totales</span>
          </div>
        </div>
      )}

      {/* ═══ CHARTS GRID ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly chart */}
        {result.monthly_breakdown && result.monthly_breakdown.length > 0 && (
          <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
            style={{ borderColor: 'rgba(8,145,178,0.12)' }}>
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #0891B2, #22C55E, transparent)' }} />
            <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
              <Calendar className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
              <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Performance Mensuelle</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={result.monthly_breakdown.map(d => ({ ...d, precision: (d.precision || 0) * 100, recall: (d.recall || 0) * 100 }))}>
                  <CartesianGrid stroke="color-mix(in srgb, var(--text-primary) 5%, transparent)" />
                  <XAxis dataKey="month_name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(8,145,178,0.2)', borderRadius: 12, fontSize: 11 }}
                    formatter={(val: unknown) => [`${(Number(val) * 100).toFixed(1)}%`, '']} />
                  <Bar dataKey="precision" name="Précision" fill="#22C55E" fillOpacity={0.7} radius={[4, 4, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="recall" name="Rappel" fill="#0891B2" fillOpacity={0.5} radius={[4, 4, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 justify-center text-[10px]">
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded" style={{ background: '#22C55E' }} /> Précision</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded" style={{ background: '#0891B2' }} /> Rappel</span>
              </div>
            </div>
          </div>
        )}

        {/* Seasonal chart */}
        {result.seasonal_breakdown && result.seasonal_breakdown.length > 0 && (
          <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
            style={{ borderColor: 'rgba(168,139,250,0.12)' }}>
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #8B5CF6, #0891B2, transparent)' }} />
            <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
              <TrendingUp className="w-4 h-4" style={{ color: '#8B5CF6' }} />
              <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Analyse Saisonnière</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={result.seasonal_breakdown.map(d => ({
                  season: SEASON_LABELS[d.season]?.label || d.season,
                  precision: (d.precision || 0) * 100,
                  recall: (d.recall || 0) * 100,
                  detection: d.attacks > 0 ? (d.detected / d.attacks) * 100 : 0,
                }))} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="rgba(168,139,250,0.2)" />
                  <PolarAngleAxis dataKey="season" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 8 }} />
                  <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.92)', border: '1px solid rgba(168,139,250,0.3)', borderRadius: 12, fontSize: 11 }} />
                  <Radar name="Précision" dataKey="precision" stroke="#22C55E" fill="#22C55E" fillOpacity={0.2} strokeWidth={2} />
                  <Radar name="Rappel" dataKey="recall" stroke="#0891B2" fill="#0891B2" fillOpacity={0.15} strokeWidth={2} />
                  <Radar name="Détection" dataKey="detection" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.1} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 justify-center text-[10px]">
                <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: '#22C55E' }} /> Précision</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: '#0891B2' }} /> Rappel</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: '#8B5CF6' }} /> Détection</span>
              </div>
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
