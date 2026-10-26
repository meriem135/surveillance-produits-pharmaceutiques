import { useState, useCallback, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Upload, Brain, Loader2, AlertTriangle,
  Download, CheckCircle2, X, Clock, Timer, Grid3x3,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { authHeaders } from '../lib/auth';

interface FileInfo { name: string; size: number; }

interface TrainingProgress {
  step: string;
  progress: number;
  message: string;
  result?: any;
  metrics?: any;
  trial?: number;
  total_trials?: number;
  best_score?: number;
  best_params?: any;
  grid_history?: any[];
}

export default function FileUploadPanel({ onTrainingComplete }: { onTrainingComplete?: (result?: any) => void } = {}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [weatherFile, setWeatherFile] = useState<FileInfo | null>(null);
  const [fridgeFile, setFridgeFile] = useState<FileInfo | null>(null);
  const [thermostatFile, setThermostatFile] = useState<FileInfo | null>(null);
  const [weatherBlob, setWeatherBlob] = useState<File | null>(null);
  const [fridgeBlob, setFridgeBlob] = useState<File | null>(null);
  const [thermostatBlob, setThermostatBlob] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [training, setTraining] = useState(false);
  const [trainResult, setTrainResult] = useState<any | null>(null);
  const [trainingElapsed, setTrainingElapsed] = useState(0);

  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trainingRef = useRef(false);
  const progressRef = useRef<TrainingProgress | null>(null);

  useEffect(() => {
    if (!training) return;
    timerRef.current = setInterval(() => setTrainingElapsed(s => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [training]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleFile = useCallback((setter: (f: FileInfo | null) => void, blobSetter: (f: File | null) => void) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) { setter({ name: f.name, size: f.size }); blobSetter(f); }
    }, []);

  const handleDrop = useCallback((e: React.DragEvent, setter: (f: FileInfo | null) => void, blobSetter: (f: File | null) => void) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.endsWith('.csv')) { setter({ name: f.name, size: f.size }); blobSetter(f); }
  }, []);

  const clearFile = useCallback((setter: (f: FileInfo | null) => void, blobSetter: (f: File | null) => void) => {
    setter(null); blobSetter(null);
  }, []);

  const canRun = weatherBlob || fridgeBlob || thermostatBlob;

  const connectWebSocket = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/api/v1/phase2/train-ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => console.log('[WS] Connecte au training stream');

    ws.onmessage = (ev) => {
      try {
        const data: TrainingProgress = JSON.parse(ev.data);
        setProgress(data);
        progressRef.current = data;

        if (data.step === 'done' && data.result) {
          setTrainResult(data.result);
          setTraining(false);
          trainingRef.current = false;
          onTrainingComplete?.(data.result);
        }
        if (data.step === 'error') {
          setError(data.message);
          setTraining(false);
          trainingRef.current = false;
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => console.warn('[WS] Erreur connexion');
    ws.onclose = () => {
      wsRef.current = null;
      // Si l'entraînement est encore en cours quand la connexion se ferme,
      // le serveur s'est probablement arrêté/redémarré — le signaler.
      if (trainingRef.current && !progressRef.current?.result) {
        setError('Connexion au suivi de progression perdue. Vérifiez que le backend (port 8000) est bien démarré.');
        setTraining(false);
      }
    };

    return ws;
  }, [onTrainingComplete]);

  const runTraining = useCallback(async (fromDisk: boolean = false) => {
    setTraining(true);
    trainingRef.current = true;
    setError(null);
    setTrainResult(null);
    setProgress(null);
    progressRef.current = null;
    setTrainingElapsed(0);

    // Pre-flight : vérifier que le backend est joignable AVANT d'ouvrir le WebSocket.
    try {
      const check = await fetch('/api/v1/phase2/training-status', { headers: authHeaders() });
      if (!check.ok) throw new Error(`HTTP ${check.status}`);
    } catch {
      setError('Backend injoignable (port 8000). Démarrez le backend (start_backend.bat) puis réessayez.');
      setTraining(false);
      trainingRef.current = false;
      return;
    }

    const ws = connectWebSocket();

    try {
      const formData = new FormData();
      if (!fromDisk) {
        if (weatherBlob) formData.append('weather_file', weatherBlob);
        if (fridgeBlob) formData.append('fridge_file', fridgeBlob);
        if (thermostatBlob) formData.append('thermostat_file', thermostatBlob);
      }
      const url = fromDisk ? '/api/v1/phase2/train?use_disk=true' : '/api/v1/phase2/train';
      const resp = await fetch(url, { method: 'POST', headers: authHeaders(), body: formData });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let detail = `HTTP ${resp.status}`;
        if (text) {
          try { detail = JSON.parse(text).detail || detail; }
          catch { detail = text.slice(0, 200); } // corps non-JSON (ex: 502 vide) — évite l'erreur "Unexpected end of JSON input"
        }
        throw new Error(detail);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'entraînement");
      setTraining(false);
      trainingRef.current = false;
      ws.close();
    }
  }, [weatherBlob, fridgeBlob, thermostatBlob, connectWebSocket]);

  useEffect(() => {
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const downloadModel = async () => {
    try {
      const resp = await fetch('/api/v1/phase2/model/download', { headers: authHeaders() });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'ocsvm_multivarie.pkl';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl glass glass-border p-5 flex items-center gap-3"
        style={{ borderColor: 'rgba(148,163,184,0.15)' }}>
        <div style={{ fontSize: 22 }}>&#128274;</div>
        <div>
          <div className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
            Entraînement réservé aux administrateurs
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Les resultats du dernier modele entraine restent visibles ci-dessous.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* UPLOAD + TRAIN */}
      <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow"
        style={{
          borderColor: dragOver ? 'rgba(8,145,178,0.5)' : training ? 'rgba(34,197,94,0.5)' : 'rgba(8,145,178,0.12)',
          position: 'relative',
        }}>
        {training && (
          <div className="absolute inset-0 pointer-events-none z-20"
            style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.03), rgba(16,185,129,0.06), rgba(34,197,94,0.03))', animation: 'pulse-glow 2s ease-in-out infinite' }} />
        )}
        <div className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: training ? 'linear-gradient(90deg, transparent, #22C55E, #10B981, #22C55E, transparent)' : 'linear-gradient(90deg, transparent, #0891B2, #8B5CF6, transparent)',
            backgroundSize: training ? '200% 100%' : undefined,
            animation: training ? 'shimmer 2s linear infinite' : undefined,
          }} />
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
          <Upload className="w-4 h-4" style={{ color: training ? '#22C55E' : 'var(--color-accent-cyan)' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
            {training ? 'Entraînement en cours…' : 'Importer et entraîner'}
          </h3>
          {training && (
            <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', animation: 'pulse-text 1.5s ease-in-out infinite' }}>
              <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
              Training...
            </span>
          )}
          {!training && (
            <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: 'var(--color-accent-cyan)' }}>
              One-Class SVM multivarié
            </span>
          )}
        </div>

        <div className="p-5">
          <p className="text-[11px] mb-4" style={{ color: 'var(--color-text-secondary)' }}>
            Importez les CSV des capteurs (météo, chambre froide, thermostat) ou entraînez sur les données déjà présentes sur le serveur.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Station météo', icon: '\u{1F324}\uFE0F', file: weatherFile, setter: setWeatherFile, blobSetter: setWeatherBlob, color: '#FF6B6B' },
              { label: 'Chambre Froide', icon: '\u2744\uFE0F', file: fridgeFile, setter: setFridgeFile, blobSetter: setFridgeBlob, color: '#4ECDC4' },
              { label: 'Thermostat', icon: '\u{1F321}\uFE0F', file: thermostatFile, setter: setThermostatFile, blobSetter: setThermostatBlob, color: '#45B7D1' },
            ].map(slot => (
              <div key={slot.label}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => handleDrop(e, slot.setter, slot.blobSetter)}
                className="relative rounded-xl p-4 text-center cursor-pointer transition-all group"
                style={{
                  background: slot.file ? `${slot.color}10` : 'color-mix(in srgb, var(--text-primary) 3%, transparent)',
                  border: `2px dashed ${slot.file ? slot.color : 'rgba(255,255,255,0.1)'}`,
                }}>
                {slot.file ? (
                  <>
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2" style={{ color: slot.color }} />
                    <div className="text-xs font-bold" style={{ color: 'var(--color-text-primary)' }}>{slot.file.name}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{formatSize(slot.file.size)}</div>
                    <button onClick={e => { e.stopPropagation(); clearFile(slot.setter, slot.blobSetter); }}
                      className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-110"
                      style={{ background: 'rgba(239,68,68,0.2)' }}>
                      <X className="w-3 h-3" style={{ color: '#EF4444' }} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-2xl mb-2">{slot.icon}</div>
                    <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--color-text-secondary)' }}>{slot.label}</div>
                    <div className="text-[9px]" style={{ color: 'var(--color-text-secondary)', opacity: 0.6 }}>Glissez ou cliquez</div>
                  </>
                )}
                <input type="file" accept=".csv"
                  onChange={handleFile(slot.setter, slot.blobSetter)}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => runTraining(!canRun)} disabled={training}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-all"
              style={{
                background: !training ? 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.2))' : 'color-mix(in srgb, var(--text-primary) 5%, transparent)',
                color: !training ? '#22C55E' : 'var(--color-text-secondary)',
                border: `1px solid ${!training ? 'rgba(34,197,94,0.3)' : 'color-mix(in srgb, var(--text-primary) 8%, transparent)'}`,
                opacity: training ? 0.5 : 1,
              }}>
              {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              {training ? 'Entraînement en cours…' : canRun ? 'Entraîner (fichiers importés)' : 'Entraîner (données serveur)'}
            </button>
            {error && (
              <div className="flex items-center gap-1.5 text-[10px]" style={{ color: '#EF4444' }}>
                <AlertTriangle className="w-3 h-3" /> {error}
              </div>
            )}
          </div>
        </div>

        {/* LIVE TRAINING PROGRESS (WebSocket) */}
        {training && progress && progress.step !== 'done' && progress.step !== 'error' && (
          <div className="px-5 pb-5">
            <div className="rounded-xl p-4" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>

              {/* Header + Chrono */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4" style={{ color: '#22C55E', animation: 'pulse-text 1.5s ease-in-out infinite' }} />
                  <span className="text-xs font-bold" style={{ color: '#22C55E' }}>{progress.message}</span>
                </div>
                <div className="flex items-center gap-4">
                  {/* Chrono elapsed */}
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3" style={{ color: 'var(--color-accent-cyan)' }} />
                    <span className="text-[11px] font-mono font-bold tabular-nums" style={{ color: 'var(--color-accent-cyan)' }}>
                      {formatTime(trainingElapsed)}
                    </span>
                  </div>
                  {/* ETA */}
                  {progress.progress > 0 && progress.progress < 100 && (
                    <div className="flex items-center gap-1.5">
                      <Timer className="w-3 h-3" style={{ color: '#F59E0B' }} />
                      <span className="text-[11px] font-mono tabular-nums" style={{ color: '#F59E0B' }}>
                        ETA {formatTime(Math.max(0, Math.ceil(trainingElapsed * (100 - progress.progress) / progress.progress)))}
                      </span>
                    </div>
                  )}
                  {/* Percentage */}
                  <span className="text-[11px] font-mono font-bold tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                    {progress.progress}%
                  </span>
                </div>
              </div>

              {/* Barre de progression */}
              <div className="h-2.5 rounded-full overflow-hidden mb-3" style={{ background: 'color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
                <div className="h-full rounded-full transition-all duration-500 ease-out relative"
                  style={{
                    width: `${progress.progress}%`,
                    background: 'linear-gradient(90deg, #22C55E, #10B981, #34D399)',
                    boxShadow: '0 0 12px rgba(34,197,94,0.5)',
                  }}>
                  <div className="absolute inset-0 rounded-full" style={{
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                    animation: 'shimmer 1.5s linear infinite',
                    backgroundSize: '200% 100%',
                  }} />
                </div>
              </div>

              {/* Step indicators */}
              <div className="flex items-center justify-between mb-3 px-1">
                {[
                  { key: 'upload', label: 'Upload', pct: 15 },
                  { key: 'fusion', label: 'Fusion', pct: 22 },
                  { key: 'features', label: 'Features', pct: 33 },
                  { key: 'grid', label: 'Grille', pct: 60 },
                  { key: 'training', label: 'Train', pct: 70 },
                  { key: 'evaluation', label: 'Eval', pct: 82 },
                  { key: 'shap', label: 'SHAP', pct: 88 },
                  { key: 'analysis', label: 'Analyse', pct: 92 },
                  { key: 'save', label: 'Sauvegarde', pct: 98 },
                ].map(step => {
                  const active = progress.progress >= step.pct;
                  const current = progress.step === step.key;
                  return (
                    <div key={step.key} className="flex flex-col items-center" style={{ flex: 1 }}>
                      <div className="w-2 h-2 rounded-full transition-all duration-500"
                        style={{
                          background: current ? '#22C55E' : active ? '#10B981' : 'rgba(255,255,255,0.1)',
                          boxShadow: current ? '0 0 8px rgba(34,197,94,0.8)' : active ? '0 0 4px rgba(16,185,129,0.4)' : undefined,
                          transform: current ? 'scale(1.5)' : undefined,
                        }} />
                      <span className="text-[7px] mt-1 text-center leading-tight"
                        style={{
                          color: current ? '#22C55E' : active ? '#10B981' : 'var(--color-text-secondary)',
                          opacity: active ? 1 : 0.35,
                          fontWeight: current ? 700 : 400,
                        }}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Grid live */}
              {progress.step === 'grid' && progress.trial && (
                <div className="flex items-center gap-3 flex-wrap p-2 rounded-lg" style={{ background: 'rgba(168,139,250,0.06)' }}>
                  <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(168,139,250,0.15)', color: '#8B5CF6' }}>
                    <Grid3x3 className="w-2.5 h-2.5 inline mr-1" />
                    Config {progress.trial}/{progress.total_trials}
                  </span>
                  {progress.best_score != null && (
                    <span className="text-[9px] font-mono" style={{ color: '#F59E0B' }}>
                      Best AUC: {(progress.best_score * 100).toFixed(2)}%
                    </span>
                  )}
                </div>
              )}

              {/* Metriques live */}
              {progress.metrics && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                  {[
                    { label: 'F1', val: progress.metrics.f1, color: '#22C55E' },
                    { label: 'Recall', val: progress.metrics.recall, color: '#3B82F6' },
                    { label: 'Precision', val: progress.metrics.precision, color: '#8B5CF6' },
                    { label: 'ROC-AUC', val: progress.metrics.roc_auc, color: '#F59E0B' },
                  ].map(m => (
                    <div key={m.label} className="rounded-lg p-2 text-center" style={{ background: `${m.color}10`, border: `1px solid ${m.color}30` }}>
                      <div className="text-[8px]" style={{ color: 'var(--color-text-secondary)' }}>{m.label}</div>
                      <div className="text-xs font-bold font-mono" style={{ color: m.color }}>{((m.val || 0) * 100).toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* TRAINING RESULT */}
      {trainResult && (
        <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow"
          style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #22C55E, #10B981, transparent)' }} />
          <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
            <Brain className="w-4 h-4" style={{ color: '#22C55E' }} />
            <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
              Entraînement terminé
            </h3>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: '#22C55E' }}>
                {trainResult.training_info?.duration_seconds}s
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(168,139,250,0.15)', color: '#8B5CF6' }}>
                One-Class SVM
              </span>
            </span>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'F1 Score', value: trainResult.model_metrics?.f1, color: '#22C55E' },
                { label: 'Recall', value: trainResult.model_metrics?.recall, color: '#3B82F6' },
                { label: 'Precision', value: trainResult.model_metrics?.precision, color: '#8B5CF6' },
                { label: 'ROC-AUC', value: trainResult.model_metrics?.roc_auc, color: '#F59E0B' },
              ].map(m => (
                <div key={m.label} className="rounded-xl p-3 text-center" style={{ background: `${m.color}10`, border: `1px solid ${m.color}30` }}>
                  <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--color-text-secondary)' }}>{m.label}</div>
                  <div className="text-lg font-bold" style={{ color: m.color }}>{((m.value || 0) * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] mb-4" style={{ color: 'var(--color-text-secondary)' }}>
              <div>Samples: <span style={{ color: 'var(--color-text-primary)' }}>{trainResult.training_info?.n_total_samples?.toLocaleString()}</span></div>
              <div>Normaux: <span style={{ color: 'var(--color-text-primary)' }}>{trainResult.training_info?.n_normal_samples?.toLocaleString()}</span></div>
              <div>Attaques: <span style={{ color: '#EF4444' }}>{trainResult.training_info?.n_attack_samples?.toLocaleString()}</span></div>
              <div>CV ROC-AUC: <span style={{ color: '#F59E0B' }}>{trainResult.model_metrics?.cv_roc_auc}</span></div>
            </div>

            {trainResult.grid_search && (
              <div className="mb-4 p-3 rounded-xl" style={{ background: 'rgba(168,139,250,0.06)', border: '1px solid rgba(168,139,250,0.15)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Grid3x3 className="w-3.5 h-3.5" style={{ color: '#8B5CF6' }} />
                  <span className="text-xs font-bold" style={{ color: '#8B5CF6' }}>Grille manuelle hyperparamètres</span>
                  <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(168,139,250,0.15)', color: '#8B5CF6' }}>
                    {trainResult.grid_search.n_trials} configs
                  </span>
                </div>
                <div className="text-[9px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  {trainResult.grid_search.search_type || '3 nu × 4 gamma'}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  {Object.entries(trainResult.grid_search.best_params || {}).map(([k, v]) => (
                    <div key={k}>{k}: <span style={{ color: '#8B5CF6', fontFamily: 'monospace' }}>{String(v)}</span></div>
                  ))}
                </div>
                {trainResult.grid_search.history?.length > 0 && (
                  <div className="h-24">
                    <BarChart data={trainResult.grid_search.history.slice(0, 15).map((t: any) => ({ trial: `C${t.config}`, value: t.value }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--text-primary) 6%, transparent)" />
                      <XAxis dataKey="trial" tick={{ fontSize: 8, fill: 'var(--color-text-secondary)' }} />
                      <YAxis tick={{ fontSize: 8, fill: 'var(--color-text-secondary)' }} domain={['dataMin - 0.01', 'dataMax + 0.01']} />
                      <Bar dataKey="value" fill="#8B5CF6" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </div>
                )}
              </div>
            )}

            {trainResult.shap?.available && (
              <div className="mb-4 p-3 rounded-xl" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-3.5 h-3.5" style={{ color: '#F59E0B' }} />
                  <span className="text-xs font-bold" style={{ color: '#F59E0B' }}>SHAP Explainability</span>
                  <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>
                    {trainResult.shap.n_samples_explained} echantillons
                  </span>
                </div>
                <div className="space-y-1 mb-3">
                  {trainResult.shap.global_importance?.slice(0, 10).map((f: any) => {
                    const maxVal = trainResult.shap.global_importance[0]?.shap_importance || 1;
                    const pct = (f.shap_importance / maxVal) * 100;
                    return (
                      <div key={f.feature} className="flex items-center gap-2 text-[10px]">
                        <span className="w-32 truncate" style={{ color: 'var(--color-text-secondary)' }}>{f.feature}</span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #F59E0B, #F97316)' }} />
                        </div>
                        <span className="w-12 text-right" style={{ color: '#F59E0B', fontFamily: 'monospace' }}>{f.shap_importance.toFixed(4)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {trainResult.best_params && (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 p-2 rounded-lg text-[10px]" style={{ background: 'color-mix(in srgb, var(--text-primary) 3%, transparent)', color: 'var(--color-text-secondary)' }}>
                  <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>Hyperparams: </span>
                  {JSON.stringify(trainResult.best_params)}
                  <span className="ml-3">Registry: <span style={{ color: '#8B5CF6' }}>{trainResult.registry_version || 'N/A'}</span></span>
                </div>
                <button onClick={downloadModel}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold cursor-pointer transition-all hover:scale-105 no-underline"
                  style={{ background: 'rgba(34,197,94,0.1)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.25)' }}>
                  <Download className="w-3.5 h-3.5" />
                  Telecharger .pkl
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
