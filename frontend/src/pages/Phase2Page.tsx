import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { authHeaders } from '../lib/auth';
import {
  X,
  Eye, RefreshCw,
} from 'lucide-react';

import { PhaseShell } from '../components/PhaseShell';
import { PHASE_CONFIG } from '../components/PhasePipeline';
import FileUploadPanel from '../components/FileUploadPanel';
import ErrorAnalysisPanel from '../components/ErrorAnalysisPanel';
import { toast } from '@/components/ui/use-toast';

const staggerItem = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};
/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */
interface ModelResult {
  precision: number; recall: number; f1: number; roc_auc: number; ap?: number;
  fpr: number; tp: number; fp: number; fn: number; tn: number;
  best_threshold_cont?: number | null;
  best_recall?: number | null; best_precision?: number | null; best_f1?: number | null;
}

interface AttackMetric {
  id: number; model_id: string; model_name: string | null; model_sensor: string | null;
  attack_type: string; capteur: string; n_total: number; n_anomalies: number;
  taux_detection: number; score_moyen: number; roc_auc: number | null; avg_precision: number | null;
  precision_attaque: number | null; recall_attaque: number | null; f1_attaque: number | null;
}

interface TimelinePoint {
  datetime: string; temperature: number;
  actual_label: number; prediction: number; anomaly_score: number;
  tp: number; fp: number; fn: number; tn: number;
  _sensor?: string;
}

interface TimelineResponse {
  sensor: string; points: TimelinePoint[]; total_points: number;
  summary: { total: number; normal: number; attack: number; detected: number; fp: number; fn: number; recall: number; precision: number; fpr: number };
  filters_applied: Record<string, unknown>;
}

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */
const SENSOR_ORDER = ['OCSVM_Multivarie', 'Autoencodeur_PCA', 'GNN_Correlation', 'Forecasting_LSTM'];

const SEASON_MONTHS: Record<string, number[]> = { winter: [12, 1, 2], spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11] };

async function safeFetchJson(url: string) {
  try { const r = await fetch(url, { headers: authHeaders() }); if (!r.ok) return null; const t = await r.text(); return t ? JSON.parse(t) : null; }
  catch { return null; }
}

/* ═══════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════ */
export default function Phase2Page() {
  const [results, setResults] = useState<Record<string, ModelResult> | null>(null);
  const [_loading, setLoading] = useState(true);
  const [attackMetrics, setAttackMetrics] = useState<AttackMetric[]>([]);
  const [rawTimelinePoints, setRawTimelinePoints] = useState<TimelinePoint[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [sensor] = useState(searchParams.get('sensor') || 'all');

  const [showTrainingViz, setShowTrainingViz] = useState(() => {
    const saved = localStorage.getItem('phase2_training_viz');
    return saved === 'true';
  });
  const [trainResult, setTrainResult] = useState<any | null>(() => {
    try {
      const saved = sessionStorage.getItem('phase2_train_result');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [uploadKey, setUploadKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const appliedFilters = useRef({ year: '2019', season: null as string | null, month: null as number | null, shift: null as string | null, dayType: null as string | null, startHour: null as number | null, endHour: null as number | null, sensor: 'all' });
  const [filterVersion] = useState(0);

  const handleTrainingComplete = useCallback((result?: any) => {
    setShowTrainingViz(true);
    localStorage.setItem('phase2_training_viz', 'true');
    if (result) {
      setTrainResult(result);
      try { sessionStorage.setItem('phase2_train_result', JSON.stringify(result)); } catch (e) { console.warn('[Phase2] sessionStorage save failed', e); }

      // Update results with real model metrics
      if (result.model_metrics) {
        setResults(prev => ({
          ...prev,
          OCSVM_Multivarie: {
            precision: result.model_metrics.precision ?? 0,
            recall: result.model_metrics.recall ?? 0,
            f1: result.model_metrics.f1 ?? 0,
            roc_auc: result.model_metrics.roc_auc ?? 0,
            ap: result.model_metrics.average_precision ?? 0,
            fpr: result.model_metrics.fpr ?? 0,
            tp: result.model_metrics.tp ?? 0,
            fp: result.model_metrics.fp ?? 0,
            fn: result.model_metrics.fn ?? 0,
            tn: result.model_metrics.tn ?? 0,
          },
        }));
      }
      if (result.attack_metrics) setAttackMetrics(result.attack_metrics);

      // Show toast notification
      const metrics = result.model_metrics;
      if (metrics) {
        toast({
          title: 'Entraînement terminé ✓',
          description: `F1: ${(metrics.f1 * 100).toFixed(1)}% · Recall: ${(metrics.recall * 100).toFixed(1)}% · ROC-AUC: ${(metrics.roc_auc * 100).toFixed(1)}%`,
        });
      } else {
        toast({ title: 'Entraînement terminé ✓', description: 'Les visualisations sont prêtes.' });
      }

      // Navigate to the results tab (keep sessionStorage for SHAP on Phase2Page)
      setTimeout(() => {
        navigate('/dashboard/results');
      }, 500);
    }
    refreshVizData();
  }, []);

  const refreshVizData = useCallback(() => {
    safeFetchJson('/api/v1/phase2/results').then(data => {
      if (data && !data.error) setResults(prev => ({ ...prev, ...data }));
    });
    safeFetchJson('/api/v1/phase2/attack-metrics').then(data => {
      if (data?.metrics) setAttackMetrics(data.metrics);
    });
  }, []);

  // Auto-refresh polling every 30s while viz are visible
  useEffect(() => {
    if (!showTrainingViz) return;
    const interval = setInterval(refreshVizData, 30000);
    return () => clearInterval(interval);
  }, [showTrainingViz, refreshVizData]);

  useEffect(() => {
    // Restore trainResult from sessionStorage (survives tab switches)
    const savedResult = sessionStorage.getItem('phase2_train_result');
    if (savedResult) {
      try {
        const parsed = JSON.parse(savedResult);
        setTrainResult(parsed);
        setShowTrainingViz(true);
        localStorage.setItem('phase2_training_viz', 'true');
        if (parsed.model_metrics) {
          setResults(prev => ({
            ...prev,
            OCSVM_Multivarie: {
              precision: parsed.model_metrics.precision ?? 0,
              recall: parsed.model_metrics.recall ?? 0,
              f1: parsed.model_metrics.f1 ?? 0,
              roc_auc: parsed.model_metrics.roc_auc ?? 0,
              ap: parsed.model_metrics.average_precision ?? 0,
              fpr: parsed.model_metrics.fpr ?? 0,
              tp: parsed.model_metrics.tp ?? 0,
              fp: parsed.model_metrics.fp ?? 0,
              fn: parsed.model_metrics.fn ?? 0,
              tn: parsed.model_metrics.tn ?? 0,
            },
          }));
        }
        if (parsed.attack_metrics) setAttackMetrics(parsed.attack_metrics);
      } catch { /* ignore */ }
    }
    safeFetchJson('/api/v1/phase2/results').then((data: any) => {
      setResults(data && !data.error ? data : null);
      setLoading(false);
    });
    safeFetchJson('/api/v1/phase2/attack-metrics').then(data => {
      if (data?.metrics) setAttackMetrics(data.metrics);
    });
  }, []);

  // Fetch all timeline data once on mount — filters apply client-side for instant display
  useEffect(() => {
    async function fetchAllTimeline() {
      const sensors = ['weather', 'fridge', 'thermostat'];
      const allPoints: TimelinePoint[] = [];
      for (const s of sensors) {
        const params = new URLSearchParams({ sensor: s, limit: '10000' });
        const data = await safeFetchJson(`/api/v1/phase2/timeline?${params}`) as TimelineResponse | null;
        if (data?.points) {
          allPoints.push(...data.points.map(p => ({ ...p, _sensor: s })));
        }
      }
      setRawTimelinePoints(allPoints);
    }
    fetchAllTimeline();
  }, []);

  // Client-side filtering — triggered only on "Appliquer" click
  const timelinePoints = useMemo(() => {
    const f = appliedFilters.current;
    let filtered = rawTimelinePoints;
    if (f.year) filtered = filtered.filter(p => new Date(p.datetime).getFullYear().toString() === f.year);
    const seasonVal = f.season as string | null;
    if (seasonVal) {
      filtered = filtered.filter(p => (SEASON_MONTHS as Record<string, number[]>)[seasonVal]?.includes(new Date(p.datetime).getMonth() + 1));
    }
    if (f.month != null) {
      filtered = filtered.filter(p => new Date(p.datetime).getMonth() + 1 === f.month);
    }
    const shiftVal = f.shift as string | null;
    if (shiftVal) {
      filtered = filtered.filter(p => {
        const h = new Date(p.datetime).getHours();
        return shiftVal === 'matin' ? h >= 6 && h < 12 : shiftVal === 'apres-midi' ? h >= 12 && h < 18 : h >= 0 && h < 6;
      });
    }
    const dayTypeVal = f.dayType as string | null;
    if (dayTypeVal) {
      filtered = filtered.filter(p => {
        const d = new Date(p.datetime).getDay();
        return dayTypeVal === 'ouvre' ? d >= 1 && d <= 5 : d === 0 || d === 6;
      });
    }
    const startH = f.startHour as number | null;
    const endH = f.endHour as number | null;
    if (startH != null) filtered = filtered.filter(p => new Date(p.datetime).getHours() >= startH);
    if (endH != null) filtered = filtered.filter(p => new Date(p.datetime).getHours() <= endH);
    if (f.sensor !== 'all') filtered = filtered.filter(p => p._sensor === f.sensor);
    return filtered;
  }, [rawTimelinePoints, filterVersion]);

  // Sync sensor selection to URL params so Phase 3 can read it
  useEffect(() => {
    const current = searchParams.get('sensor') || 'all';
    if (sensor !== current) {
      const params = new URLSearchParams(searchParams);
      if (!sensor || sensor === 'all') params.delete('sensor');
      else params.set('sensor', sensor);
      setSearchParams(params, { replace: true });
    }
  }, [sensor]);

  const bestModelId = useMemo(() => {
    if (!results) return 'OCSVM_Multivarie';
    return SENSOR_ORDER.filter(id => results[id]).reduce((a, b) => (results[a]?.f1 || 0) > (results[b]?.f1 || 0) ? a : b, 'OCSVM_Multivarie');
  }, [results]);

  const bestModel = results?.[bestModelId];

  const trained = !!(trainResult || bestModel);

  return (
    <PhaseShell
      phase={PHASE_CONFIG[1]}
      hidePipeline
      trained={trained}
    >
      <div ref={containerRef} className="relative z-10 space-y-4 pb-8 px-1">

        {/* ═══ UPLOAD & TRAINING ═══ */}
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,255,163,0.15)' }}>
          <FileUploadPanel key={uploadKey} onTrainingComplete={handleTrainingComplete} />
        </div>

        {/* ═══ TRAINING VISUALIZATIONS ═══ */}
        {showTrainingViz && (
          <motion.div
            id="training-viz-section"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
            }}
            className="space-y-4"
          >
            <motion.div variants={staggerItem} className="flex items-center gap-2 px-1">
              <Eye className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent-cyan)' }}>
                Visualisations Data Science
              </span>
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(0,245,255,0.3), transparent)' }} />
              <button onClick={refreshVizData}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold cursor-pointer transition-all hover:scale-105"
                style={{
                  background: 'rgba(0,245,255,0.08)',
                  color: 'var(--color-accent-cyan)',
                  border: '1px solid rgba(0,245,255,0.2)',
                }}>
                <RefreshCw className="w-3 h-3" />
                Recharger
              </button>
              <button onClick={() => { setShowTrainingViz(false); localStorage.removeItem('phase2_training_viz'); }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-bold cursor-pointer transition-all hover:scale-105"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  color: '#EF4444',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}>
                <X className="w-3 h-3" />
                Masquer
              </button>
              <button onClick={() => { sessionStorage.removeItem('phase2_train_result'); setTrainResult(null); setShowTrainingViz(false); localStorage.removeItem('phase2_training_viz'); setUploadKey(k => k + 1); }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold cursor-pointer transition-all hover:scale-105"
                style={{
                  background: 'rgba(34,197,94,0.08)',
                  color: '#22C55E',
                  border: '1px solid rgba(34,197,94,0.2)',
                }}>
                <RefreshCw className="w-3 h-3" />
                Nouvel entraînement
              </button>
            </motion.div>

            {/* 1. Error Analysis */}
            {rawTimelinePoints.length > 0 && attackMetrics.length > 0 && (
              <motion.div variants={staggerItem}>
                <ErrorAnalysisPanel points={timelinePoints} attackMetrics={attackMetrics} />
              </motion.div>
            )}
          </motion.div>
        )}
      </div>
    </PhaseShell>
  );
}
