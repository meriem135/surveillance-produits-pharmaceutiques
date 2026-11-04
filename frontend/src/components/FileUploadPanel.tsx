import { useState, useCallback, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { AlertTriangle, Brain, CheckCircle2, CloudSun, Download, Loader2, Lock, Snowflake, Thermometer, X } from 'lucide-react';
import { Empty, Meter, Readouts, Section, Stat, State, Table, nf, pct, tooltipStyle, usePalette } from './etude/kit';
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
  const pal = usePalette();

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

  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${nf(bytes / 1024, 1)}\u00a0Ko` : `${nf(bytes / (1024 * 1024), 1)}\u00a0Mo`;

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
      <Empty>
        <span className="inline-flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Lock className="w-4 h-4" aria-hidden /> Entraînement réservé aux administrateurs
        </span>
        <span className="block mt-1">Les résultats du dernier modèle entraîné restent visibles ci-dessous.</span>
      </Empty>
    );
  }

  const STEPS = [
    { key: 'upload', label: 'Envoi', pct: 15 },
    { key: 'fusion', label: 'Fusion', pct: 22 },
    { key: 'features', label: 'Variables', pct: 33 },
    { key: 'grid', label: 'Grille', pct: 60 },
    { key: 'training', label: 'Entraînement', pct: 70 },
    { key: 'evaluation', label: 'Évaluation', pct: 82 },
    { key: 'shap', label: 'SHAP', pct: 88 },
    { key: 'analysis', label: 'Analyse', pct: 92 },
    { key: 'save', label: 'Sauvegarde', pct: 98 },
  ];
  const slots = [
    { label: 'Station météo', icon: CloudSun, file: weatherFile, setter: setWeatherFile, blobSetter: setWeatherBlob },
    { label: 'Chambre froide', icon: Snowflake, file: fridgeFile, setter: setFridgeFile, blobSetter: setFridgeBlob },
    { label: 'Thermostat', icon: Thermometer, file: thermostatFile, setter: setThermostatFile, blobSetter: setThermostatBlob },
  ];
  const live = training && progress && progress.step !== 'done' && progress.step !== 'error' ? progress : null;
  const m = trainResult?.model_metrics;
  const info = trainResult?.training_info;

  return (
    <div className="space-y-6">
      <Section title={training ? 'Entraînement en cours…' : 'Importer et entraîner'}
        subtitle="Importez les CSV des capteurs (météo, chambre froide, thermostat) ou entraînez sur les données déjà présentes sur le serveur."
        action={training ? <State kind="alerte">En cours</State> : <State kind="neutre">One-Class SVM multivarié</State>}>
        <div className="grid gap-3 sm:grid-cols-3">
          {slots.map(slot => {
            const Icon = slot.icon;
            return (
              <label key={slot.label}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => handleDrop(e, slot.setter, slot.blobSetter)}
                className="relative block rounded-[3px] p-4 text-center cursor-pointer min-w-0"
                style={{
                  background: slot.file ? 'color-mix(in srgb, var(--accent-primary) 8%, var(--bg-panel))' : 'var(--bg-subtle)',
                  border: `1px dashed ${slot.file || dragOver ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
                }}>
                {slot.file ? (
                  <>
                    <CheckCircle2 className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--accent-primary)' }} aria-hidden />
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{slot.file.name}</div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{slot.label} · {formatSize(slot.file.size)}</div>
                  </>
                ) : (
                  <>
                    <Icon className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} aria-hidden />
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{slot.label}</div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Glissez un CSV ou cliquez</div>
                  </>
                )}
                <input type="file" accept=".csv" aria-label={`Fichier CSV : ${slot.label}`}
                  onChange={handleFile(slot.setter, slot.blobSetter)}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
                {slot.file && (
                  <button type="button" aria-label={`Retirer le fichier ${slot.label}`}
                    onClick={e => { e.preventDefault(); e.stopPropagation(); clearFile(slot.setter, slot.blobSetter); }}
                    className="vc-btn absolute top-2 right-2 z-10" style={{ padding: 4 }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </label>
            );
          })}
        </div>

        <div className="flex items-center gap-3 flex-wrap mt-4">
          <button type="button" onClick={() => runTraining(!canRun)} disabled={training} className="vc-btn vc-btn-primary">
            {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            {training ? 'Entraînement en cours…' : canRun ? 'Entraîner (fichiers importés)' : 'Entraîner (données serveur)'}
          </button>
          {error && (
            <span role="alert" className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--accent-danger)' }}>
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </span>
          )}
        </div>

        {live && (
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border)' }} aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{live.message}</span>
              <span className="text-[13px] vc-num" style={{ color: 'var(--text-secondary)' }}>
                Écoulé {formatTime(trainingElapsed)}
                {live.progress > 0 && live.progress < 100 && <> · reste environ {formatTime(Math.max(0, Math.ceil(trainingElapsed * (100 - live.progress) / live.progress)))}</>}
                {' · '}{nf(live.progress)}{' %'}
              </span>
            </div>
            <Meter value={live.progress} />
            <ol className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-x-2 gap-y-1 mt-3 text-[12.5px]">
              {STEPS.map(step => {
                const reached = live.progress >= step.pct;
                const current = live.step === step.key;
                return (
                  <li key={step.key} aria-current={current ? 'step' : undefined} className="flex items-center gap-1.5 min-w-0"
                    style={{ color: current ? 'var(--text-primary)' : reached ? 'var(--text-secondary)' : 'var(--text-muted)', fontWeight: current ? 600 : 400 }}>
                    <span className="w-2 h-2 shrink-0" style={{ background: reached ? 'var(--accent-primary)' : 'transparent', border: '1px solid var(--accent-primary)' }} aria-hidden />
                    <span className="truncate">{step.label}</span>
                  </li>
                );
              })}
            </ol>
            {live.step === 'grid' && live.trial && (
              <p className="text-[13px] mt-3" style={{ color: 'var(--text-secondary)' }}>
                Configuration {live.trial}/{live.total_trials}
                {live.best_score != null && <> · meilleure ROC-AUC {pct(live.best_score, 2)}</>}
              </p>
            )}
            {live.metrics && (
              <Readouts cols={4} className="mt-3">
                <Stat label="F1" value={pct(live.metrics.f1 || 0)} />
                <Stat label="Rappel" value={pct(live.metrics.recall || 0)} />
                <Stat label="Précision" value={pct(live.metrics.precision || 0)} />
                <Stat label="ROC-AUC" value={pct(live.metrics.roc_auc || 0)} />
              </Readouts>
            )}
          </div>
        )}
      </Section>

      {trainResult && (
        <Section title="Entraînement terminé"
          subtitle={`One-Class SVM${info?.duration_seconds != null ? `, ${nf(Number(info.duration_seconds), 1)} s` : ''}`}
          action={trainResult.best_params ? (
            <button type="button" onClick={downloadModel} className="vc-btn"><Download className="w-4 h-4" /> Télécharger le modèle (.pkl)</button>
          ) : undefined}>
          <Readouts cols={4}>
            <Stat label="F1" tone="var(--accent-primary)" value={pct(m?.f1 || 0)} />
            <Stat label="Rappel" value={pct(m?.recall || 0)} />
            <Stat label="Précision" value={pct(m?.precision || 0)} />
            <Stat label="ROC-AUC" value={pct(m?.roc_auc || 0)} sub={m?.cv_roc_auc != null ? `Validation croisée : ${String(m.cv_roc_auc).replace('.', ',')}` : undefined} />
          </Readouts>
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4 text-[13.5px]">
            {[
              ['Échantillons', nf(info?.n_total_samples)],
              ['Normaux', nf(info?.n_normal_samples)],
              ['Attaques', nf(info?.n_attack_samples)],
              ['Version du registre', trainResult.registry_version || '—'],
            ].map(([k, v]) => (
              <div key={k}><dt style={{ color: 'var(--text-secondary)' }}>{k}</dt><dd className="vc-num text-left" style={{ color: 'var(--text-primary)', textAlign: 'left' }}>{v}</dd></div>
            ))}
          </dl>

          <div className="grid gap-6 mt-6 lg:grid-cols-2 3xl:grid-cols-3">
            {trainResult.grid_search && (
              <div className="min-w-0">
                <h3 className="vc-kicker mb-1">Grille d’hyperparamètres ({nf(trainResult.grid_search.n_trials)} configurations)</h3>
                <p className="text-[13px] mb-2" style={{ color: 'var(--text-muted)' }}>{trainResult.grid_search.search_type || '3 nu × 4 gamma'}</p>
                <p className="text-[13px] mb-2" style={{ color: 'var(--text-secondary)' }}>
                  {Object.entries(trainResult.grid_search.best_params || {}).map(([k, v]) => <span key={k} className="mr-3">{k}&nbsp;: <code>{String(v)}</code></span>)}
                </p>
                {trainResult.grid_search.history?.length > 0 && (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={trainResult.grid_search.history.slice(0, 15).map((t: any) => ({ trial: `C${t.config}`, value: t.value }))}>
                      <CartesianGrid stroke={pal.grid} vertical={false} />
                      <XAxis dataKey="trial" tick={{ fontSize: 11, fill: pal.axis }} />
                      <YAxis tick={{ fontSize: 11, fill: pal.axis }} domain={['dataMin - 0.01', 'dataMax + 0.01']} tickFormatter={(v: number) => nf(v, 2)} width={44} />
                      <Tooltip {...tooltipStyle} formatter={(v: unknown) => [nf(Number(v), 4), 'Score']} />
                      <Bar dataKey="value" fill={pal.series[0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}

            {trainResult.shap?.available && (
              <div className="min-w-0">
                <h3 className="vc-kicker mb-2">Importance SHAP ({nf(trainResult.shap.n_samples_explained)} échantillons expliqués)</h3>
                <Table min={320}>
                  <thead><tr><th>Variable</th><th style={{ width: '45%' }}>Importance relative</th><th className="vc-num">SHAP</th></tr></thead>
                  <tbody>
                    {trainResult.shap.global_importance?.slice(0, 10).map((f: any) => {
                      const maxVal = trainResult.shap.global_importance[0]?.shap_importance || 1;
                      return (
                        <tr key={f.feature}>
                          <td className="truncate max-w-[200px]"><code>{f.feature}</code></td>
                          <td><Meter value={(f.shap_importance / maxVal) * 100} /></td>
                          <td className="vc-num">{nf(f.shap_importance, 4)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </div>

          {trainResult.best_params && (
            <p className="text-[13px] mt-4 break-words" style={{ color: 'var(--text-secondary)' }}>
              Hyperparamètres retenus&nbsp;: <code>{JSON.stringify(trainResult.best_params)}</code>
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
