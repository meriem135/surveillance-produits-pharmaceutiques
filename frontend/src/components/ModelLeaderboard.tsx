import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  LineChart, Line,
} from 'recharts';
import { Trophy, Brain, TrendingUp, Target, Medal, Cpu, Zap } from 'lucide-react';

interface ModelResult {
  precision: number; recall: number; f1: number; roc_auc: number; ap?: number;
  fpr: number; tp: number; fp: number; fn: number; tn: number;
}

const MODEL_META: Record<string, { label: string; color: string; icon: string }> = {
  OCSVM_Multivarie:  { label: 'OCSVM Multivarie ★', color: '#22D3EE', icon: '🧠' },
  Autoencodeur_PCA:  { label: 'Autoencodeur', color: '#D4A5E8', icon: '🤖' },
  GNN_Correlation:   { label: 'GNN Correlation', color: '#A78BFA', icon: '🔗' },
  Forecasting_LSTM:  { label: 'Forecasting LSTM', color: '#F97316', icon: '📈' },
};

const METRICS_CONFIG = [
  { key: 'f1', label: 'F1', color: '#22C55E' },
  { key: 'precision', label: 'Précision', color: '#3B82F6' },
  { key: 'recall', label: 'Rappel', color: '#A78BFA' },
  { key: 'roc_auc', label: 'ROC-AUC', color: '#F59E0B' },
  { key: 'fpr_neg', label: '1-FPR', color: '#06B6D4' },
];

export default function ModelLeaderboard({
  results: propResults,
  versionHistory: propVersionHistory,
  trainResult,
}: {
  results?: Record<string, ModelResult> | null;
  versionHistory?: any[];
  trainResult?: any;
} = {}) {
  const [fetchedResults, setFetchedResults] = useState<Record<string, ModelResult> | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [sortBy, setSortBy] = useState<'f1' | 'roc_auc' | 'recall'>('f1');
  const [view, setView] = useState<'bar' | 'radar'>('bar');

  // If no props, fetch on mount + poll every 15s pour rester en temps réel
  useEffect(() => {
    if (propResults !== undefined) return; // props provided, don't fetch
    const load = () => {
      fetch('/api/v1/phase2/results').then(r => r.json()).then((res) => {
        if (res && !res.error) {
          setFetchedResults(res);
          setLastUpdate(new Date());
        }
      }).catch(() => {});
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [propResults]);

  // Merge: always ensure OCSVM_Multivarie is present (from trainResult if available)
  const mergedResults = useMemo(() => {
    const source = propResults !== undefined ? propResults : fetchedResults;
    if (!source) return null;
    const merged = { ...source };

    // If trainResult has real metrics, use them for OCSVM_Multivarie
    if (trainResult?.model_metrics) {
      const m = trainResult.model_metrics;
      merged.OCSVM_Multivarie = {
        ...(merged.OCSVM_Multivarie || {}),
        precision: m.precision, recall: m.recall, f1: m.f1, roc_auc: m.roc_auc,
        ap: m.average_precision || 0, fpr: m.fpr,
        tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn,
      };
    }

    return merged;
  }, [propResults, fetchedResults, trainResult]);

  const versionHistory = propVersionHistory ?? [];

  const sortedModels = useMemo(() => {
    if (!mergedResults) return [];
    return Object.entries(mergedResults)
      .filter(([_, r]) => r.f1 > 0)
      .sort(([, a], [, b]) => (b[sortBy] || 0) - (a[sortBy] || 0));
  }, [mergedResults, sortBy]);

  const barData = useMemo(() => {
    return METRICS_CONFIG.map(m => {
      const entry: Record<string, string | number> = { metric: m.label };
      for (const [id, r] of sortedModels) {
        const meta = MODEL_META[id];
        if (!meta) continue;
        const val = m.key === 'fpr_neg' ? (1 - r.fpr) * 100 : (r as any)[m.key] * 100;
        entry[meta.label] = Math.round(val * 10) / 10;
      }
      return entry;
    });
  }, [sortedModels]);

  const radarData = useMemo(() => {
    return sortedModels.slice(0, 5).map(([id, r]) => {
      const meta = MODEL_META[id] || { label: id, color: '#888', icon: '' };
      return {
        model: meta.label,
        F1: (r.f1 * 100).toFixed(1),
        Précision: (r.precision * 100).toFixed(1),
        Rappel: (r.recall * 100).toFixed(1),
        'ROC-AUC': (r.roc_auc * 100).toFixed(1),
      };
    });
  }, [sortedModels]);

  if (!mergedResults || sortedModels.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="rounded-2xl overflow-hidden glass glass-border" style={{ borderColor: 'rgba(255,215,0,0.15)' }}>
          <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <Trophy className="w-5 h-5" style={{ color: '#FFD700' }} />
            <h3 className="font-display font-bold" style={{ color: 'var(--color-text-primary)' }}>🏆 Leaderboard des Modèles</h3>
          </div>
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <Brain className="w-10 h-10 mb-3" style={{ color: 'var(--color-text-secondary)', opacity: 0.5 }} />
            <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Aucun modèle entraîné en live</p>
            <p className="text-[11px] mt-1 max-w-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Ce leaderboard ne contient que des modèles réellement entraînés. Lancez un entraînement
              (<span className="font-mono">/api/v1/phase2/train</span>) pour voir les vrais résultats apparaître en temps réel.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  const best = sortedModels[0];
  const bestMeta = MODEL_META[best[0]];

  const Badge = ({ id: _id }: { id: string }) => {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-wider ml-1.5"
        style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
        <Zap className="w-2 h-2" />
        Temps réel
      </span>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl overflow-hidden glass glass-border" style={{ borderColor: 'rgba(255,215,0,0.15)' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #FFD700, #FF6B6B, transparent)' }} />
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Trophy className="w-5 h-5" style={{ color: '#FFD700' }} />
          <h3 className="font-display font-bold" style={{ color: 'var(--color-text-primary)' }}>🏆 Leaderboard des Modèles</h3>
          <span className="ml-auto flex items-center gap-2">
            {lastUpdate && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-[9px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" style={{ color: '#22C55E' }} />
                Maj: {lastUpdate.toLocaleTimeString('fr-FR')}
              </span>
            )}
            <span className="text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: '#FFD700' }}>
              {sortedModels.length} modèle{sortedModels.length > 1 ? 's' : ''}
            </span>
          </span>
        </div>

        {/* Best Model Spotlight */}
        <div className="p-5">
          <div className="rounded-xl p-4 mb-4 flex items-center gap-4" style={{ background: `linear-gradient(135deg, ${bestMeta?.color}15, transparent)`, border: `1px solid ${bestMeta?.color}30` }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl" style={{ background: `${bestMeta?.color}20` }}>
              {bestMeta?.icon || '🏆'}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Medal className="w-4 h-4" style={{ color: '#FFD700' }} />
                <span className="font-bold" style={{ color: bestMeta?.color }}>{bestMeta?.label || best[0]}</span>
                <Badge id={best[0]} />
                <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,215,0,0.15)', color: '#FFD700' }}>Meilleur modèle</span>
              </div>
              <div className="flex gap-3 mt-2 flex-wrap">
                {METRICS_CONFIG.map(m => {
                  const val = m.key === 'fpr_neg' ? (1 - best[1].fpr) * 100 : (best[1] as any)[m.key] * 100;
                  return (
                    <div key={m.key} className="text-[10px]">
                      <span style={{ color: 'var(--color-text-secondary)' }}>{m.label}: </span>
                      <span className="font-bold font-mono" style={{ color: m.color }}>{val.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
              {(best[1] as any).trained_at && (
                <div className="mt-2 text-[9px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                  Entraîné le {new Date((best[1] as any).trained_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Trier par:</span>
            {(['f1', 'roc_auc', 'recall'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)}
                className="text-[10px] px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-all"
                style={{
                  background: sortBy === s ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
                  color: sortBy === s ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
                  border: `1px solid ${sortBy === s ? 'rgba(0,245,255,0.35)' : 'rgba(255,255,255,0.06)'}`,
                }}>{s.toUpperCase()}</button>
            ))}
            <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <button onClick={() => setView('bar')}
              className="text-[10px] px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-all flex items-center gap-1"
              style={{
                background: view === 'bar' ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
                color: view === 'bar' ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
              }}><BarChart className="w-3 h-3" /> Barres</button>
            <button onClick={() => setView('radar')}
              className="text-[10px] px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-all flex items-center gap-1"
              style={{
                background: view === 'radar' ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
                color: view === 'radar' ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
              }}><Target className="w-3 h-3" /> Radar</button>
          </div>

          {/* Chart */}
          {view === 'bar' ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={barData} margin={{ left: 10, right: 10 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="metric" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.95)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, '']} />
                {sortedModels.map(([id]) => {
                  const meta = MODEL_META[id];
                  return <Bar key={id} dataKey={meta?.label || id} fill={meta?.color || '#888'} radius={[3, 3, 0, 0]} maxBarSize={20} fillOpacity={id === best[0] ? 1 : 0.45} />;
                })}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
                <PolarGrid stroke="rgba(168,139,250,0.15)" />
                <PolarAngleAxis dataKey="model" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 8 }} />
                <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(168,139,250,0.3)', borderRadius: 12, fontSize: 11 }} />
                {(['F1', 'Précision', 'Rappel', 'ROC-AUC'] as const).map((m, i) => {
                  const colors = ['#22C55E', '#3B82F6', '#A78BFA', '#F59E0B'];
                  return <Radar key={m} name={m} dataKey={m} stroke={colors[i]} fill={colors[i]} fillOpacity={0.08} strokeWidth={2} />;
                })}
              </RadarChart>
            </ResponsiveContainer>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 justify-center text-[10px] flex-wrap">
            {sortedModels.slice(0, 6).map(([id]) => {
              const meta = MODEL_META[id];
              return (
                <span key={id} className="flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded" style={{ background: meta?.color || '#888', opacity: id === best[0] ? 1 : 0.5 }} />
                  <span style={{ color: 'var(--color-text-secondary)' }}>{meta?.label || id}</span>
                  <Badge id={id} />
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detailed comparison table */}
      <div className="rounded-2xl overflow-hidden glass glass-border" style={{ borderColor: 'rgba(0,245,255,0.1)' }}>
        <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Cpu className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
          <span className="text-xs font-bold" style={{ color: 'var(--color-text-primary)' }}>Comparaison détaillée</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th className="text-left px-4 py-3 font-bold" style={{ color: 'var(--color-text-secondary)' }}>Modèle</th>
                {METRICS_CONFIG.map(m => (
                  <th key={m.key} className="text-right px-3 py-3 font-bold" style={{ color: m.color }}>{m.label}</th>
                ))}
                <th className="text-right px-3 py-3 font-bold" style={{ color: 'var(--color-text-secondary)' }}>VP/FP/FN/VN</th>
                <th className="text-right px-3 py-3 font-bold" style={{ color: 'var(--color-text-secondary)' }}>Entraîné à</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map(([id, r], i) => {
                const meta = MODEL_META[id];
                return (
                  <tr key={id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i === 0 ? 'rgba(255,215,0,0.04)' : undefined }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {i === 0 && <Medal className="w-3 h-3" style={{ color: '#FFD700' }} />}
                        <span className="font-bold" style={{ color: meta?.color || 'var(--color-text-primary)' }}>{meta?.label || id}</span>
                        <Badge id={id} />
                      </div>
                    </td>
                    {METRICS_CONFIG.map(m => {
                      const val = m.key === 'fpr_neg' ? (1 - r.fpr) * 100 : (r as any)[m.key] * 100;
                      return <td key={m.key} className="text-right px-3 py-3 font-mono font-bold" style={{ color: m.color }}>{val.toFixed(1)}%</td>;
                    })}
                    <td className="text-right px-3 py-3 font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                      {r.tp}/{r.fp}/{r.fn}/{r.tn}
                    </td>
                    <td className="text-right px-3 py-3 font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                      {(r as any).trained_at ? new Date((r as any).trained_at).toLocaleTimeString('fr-FR') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ VERSION EVOLUTION ═══ */}
      {versionHistory.length > 1 && (
        <div className="rounded-2xl overflow-hidden glass glass-border" style={{ borderColor: 'rgba(168,139,250,0.12)' }}>
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <TrendingUp className="w-4 h-4" style={{ color: '#A78BFA' }} />
            <span className="text-xs font-bold" style={{ color: 'var(--color-text-primary)' }}>Évolution des performances (Registry)</span>
            <span className="ml-auto text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
              {versionHistory.length} versions — dernière: {versionHistory[0]?.version}
            </span>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={versionHistory.slice().reverse().map((v: any) => {
                const f1 = v.notes ? parseFloat(v.notes.match(/F1=([\d.]+)/)?.[1] || '0') : 0;
                const recall = v.notes ? parseFloat(v.notes.match(/Recall=([\d.]+)/)?.[1] || '0') : 0;
                const rocAuc = v.notes ? parseFloat(v.notes.match(/ROC-AUC=([\d.]+)/)?.[1] || '0') : 0;
                return {
                  version: v.version,
                  F1: f1 * 100,
                  Rappel: recall * 100,
                  'ROC-AUC': rocAuc * 100,
                };
              })}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="version" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(168,139,250,0.2)', borderRadius: 12, fontSize: 10 }}
                  formatter={(val: any) => `${Number(val).toFixed(1)}%`} />
                <Line type="monotone" dataKey="F1" stroke="#22C55E" strokeWidth={2} dot={{ r: 3, fill: '#22C55E' }} />
                <Line type="monotone" dataKey="Rappel" stroke="#A78BFA" strokeWidth={2} dot={{ r: 3, fill: '#A78BFA' }} />
                <Line type="monotone" dataKey="ROC-AUC" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3, fill: '#F59E0B' }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2 justify-center text-[9px]">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: '#22C55E' }} /> F1</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: '#A78BFA' }} /> Rappel</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: '#F59E0B' }} /> ROC-AUC</span>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}