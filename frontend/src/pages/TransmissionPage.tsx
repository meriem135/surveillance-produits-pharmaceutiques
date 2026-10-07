import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Activity, AlertTriangle, CheckCircle2, Database, Download, FileText, Loader2, Play, Radio, Sparkles } from 'lucide-react';
import { PhaseShell } from '../components/PhaseShell';
import type { PhaseItem } from '../components/PhasePipeline';
import { authHeaders } from '../lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */
interface PerAttack { n: number; detected: number; rate: number }
interface ModelResult {
  nom: string; type?: string; precision: number; recall: number; f1: number; val_f1?: number;
  roc_auc?: number; avg_precision?: number; fausses_alarmes_evenements_par_heure: number;
  episodes: number; episodes_detectes: number; delai_median_min: number | null;
  per_attack?: Record<string, PerAttack>;
}
interface ShapFeature { feature: string; label?: string; importance: number }
interface ShapData { n_lignes: number; global: ShapFeature[]; par_scenario: Record<string, ShapFeature[]> }
interface CurvePoint { arbres: number; f1_validation: number; auc_validation: number }
interface WebResults {
  generated_at: string; duree_s: number; meilleur: string; classement_validation: string[];
  modeles: Record<string, ModelResult>; courbe_random_forest: CurvePoint[]; shap: ShapData | null;
  dataset: { lignes: number; features: number; episodes: number; train: number; val: number; test: number };
}
interface Summary {
  dataset: { lignes: number; attaques: number; heures: number; episodes: number; scenarios: string[] } | null;
  traces: { fusion?: { debut: string; fin: string }; profil?: Record<string, { moyenne: number; ecart_type: number; autocorr_5s: number }> } | null;
  reference: { repetitions: number; meilleur: string; modeles: Record<string, ModelResult> } | null;
  shap_reference: ShapData | null;
  web: WebResults | null;
  scenarios: Array<{ nom: string; capteur_fr: string; description: string }>;
}
interface ReportScenario {
  scenario: string; capteur: string; description: string; famille: string; taux_detection: number | null;
  niveau: string; episodes: string; ce_que_le_modele_regarde: string[]; risque: string; actions: string[];
}
interface Report {
  titre: string; date: string; source: string; message?: string; markdown: string;
  modele: { nom: string; type: string; precision: number; recall: number; f1: number; fausses_alertes_par_heure: number; episodes: string; lecture: string } | null;
  scenarios: ReportScenario[]; regles_generales: string[];
}
interface HistoryRun {
  id: number; debut: string; fin: string | null; statut: string; lance_par: string | null; duree_s: number | null;
  lignes: number; meilleur_modele: string | null; meilleur_f1: number | null; erreur: string | null;
}
interface ProgressMsg {
  step: string; progress: number; message: string; model?: string;
  result?: ModelResult; curve_point?: CurvePoint; results?: WebResults; dataset?: WebResults['dataset'];
}

const MODEL_ORDER = ['IsolationForest', 'OCSVM', 'RandomForest', 'XGBoost'];
const MODEL_LABEL: Record<string, string> = {
  IsolationForest: 'Isolation Forest', OCSVM: 'One-Class SVM', RandomForest: 'Random Forest', XGBoost: 'XGBoost', Statistique: 'Réf. statistique',
};
const SCENARIO_LABEL: Record<string, string> = {
  MITM_gel: 'Gel', MITM_rejeu: 'Rejeu', Injection_nominale: 'Injection nominale', 'Injection_biais_0.5': 'Biais −0,5 °C',
  'Injection_biais_1.0': 'Biais −1 °C', 'Injection_biais_2.0': 'Biais −2 °C', Injection_derive: 'Dérive',
  MITM_gel_thermostat: 'Gel thermostat', Injection_biais_thermostat: 'Biais thermostat',
};
const PHASE: PhaseItem = {
  num: 2, label: 'Attaques de transmission', subtitle: 'Traces réelles TON_IoT · MITM & injection · 4 modèles',
  icon: '\u{1F4E1}', color: '#00FFA3', status: 'active', progress: 100,
};

const pct = (v: number | undefined | null) => (v == null ? '—' : `${Math.round(v * 100)} %`);
const num = (v: number | undefined | null, d = 2) => (v == null ? '—' : v.toFixed(d));

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? (JSON.parse(t) as T) : null;
  } catch { return null; }
}

/* ═══════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════ */
export default function TransmissionPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressMsg | null>(null);
  const [log, setLog] = useState<ProgressMsg[]>([]);
  const [liveResults, setLiveResults] = useState<Record<string, ModelResult>>({});
  const [curve, setCurve] = useState<CurvePoint[]>([]);
  const [view, setView] = useState<'web' | 'reference'>('web');
  const wsRef = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    const [s, r, h] = await Promise.all([
      getJson<Summary>('/api/v1/transmission/summary'), getJson<Report>('/api/v1/transmission/report'),
      getJson<{ runs: HistoryRun[] }>('/api/v1/transmission/history?limit=10'),
    ]);
    setSummary(s); setReport(r); setHistory(h?.runs ?? []);
    if (s && !s.web && s.reference) setView('reference');
  }, []);
  useEffect(() => { load(); }, [load]);

  const connectWs = useCallback(() => {
    if (wsRef.current) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/v1/transmission/train-ws`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ProgressMsg;
      if (!msg.step) return;
      setProgress(msg);
      setLog((l) => [...l.slice(-11), msg]);
      if (msg.curve_point) setCurve((c) => (c.some((p) => p.arbres === msg.curve_point!.arbres) ? c : [...c, msg.curve_point!]));
      if (msg.model && msg.result) setLiveResults((r) => ({ ...r, [msg.model!]: msg.result! }));
      if (msg.step === 'done' || msg.step === 'error') {
        setRunning(false);
        if (msg.step === 'done') { toast({ title: 'Entraînement terminé', description: msg.message }); load(); setView('web'); }
        else toast({ title: 'Erreur', description: msg.message, variant: 'destructive' });
      }
    };
    ws.onclose = () => { wsRef.current = null; };
  }, [load]);
  useEffect(() => () => { wsRef.current?.close(); }, []);

  const startTraining = async () => {
    setLog([]); setCurve([]); setLiveResults({}); setProgress(null);
    connectWs();
    const r = await fetch('/api/v1/transmission/train', { method: 'POST', headers: authHeaders() });
    if (r.status === 409) { toast({ title: 'Déjà en cours', description: 'Un entraînement tourne déjà.' }); setRunning(true); return; }
    if (!r.ok) { toast({ title: 'Erreur', description: `HTTP ${r.status}`, variant: 'destructive' }); return; }
    setRunning(true);
  };

  const models: Record<string, ModelResult> | null = useMemo(() => {
    if (view === 'web') return summary?.web?.modeles ?? (Object.keys(liveResults).length ? liveResults : null);
    return summary?.reference?.modeles ?? null;
  }, [view, summary, liveResults]);
  const bestKey = view === 'web' ? summary?.web?.meilleur : summary?.reference?.meilleur;
  const shap: ShapData | null = view === 'web' ? summary?.web?.shap ?? null : summary?.shap_reference ?? null;
  const rfCurve = curve.length ? curve : summary?.web?.courbe_random_forest ?? [];

  const scenarioRows = useMemo(() => {
    const m = models && bestKey ? models[bestKey] : null;
    if (!m?.per_attack) return [];
    return Object.entries(m.per_attack).filter(([, v]) => v.n > 0).map(([k, v]) => ({ scenario: SCENARIO_LABEL[k] ?? k, taux: v.rate, episodes: `${v.detected}/${v.n}` }))
      .sort((a, b) => b.taux - a.taux);
  }, [models, bestKey]);

  const stats = [
    { icon: <Database className="w-4 h-4" />, label: 'Mesures réelles', value: summary?.dataset ? summary.dataset.lignes.toLocaleString('fr-FR') : '—', color: '#00FFA3', sub: summary?.dataset ? `${summary.dataset.heures} h, pas de 5 s` : 'jeu non construit' },
    { icon: <AlertTriangle className="w-4 h-4" />, label: 'Épisodes d’attaque', value: summary?.dataset?.episodes ?? '—', color: '#FF2D78', sub: summary?.dataset ? `${summary.dataset.scenarios.length} scénarios` : '' },
    { icon: <Activity className="w-4 h-4" />, label: 'Meilleur modèle', value: bestKey ? MODEL_LABEL[bestKey] ?? bestKey : '—', color: '#00F5FF', sub: models && bestKey ? `F1 ${num(models[bestKey]?.f1)}` : '' },
    { icon: <Sparkles className="w-4 h-4" />, label: 'Fausses alertes / h', value: models && bestKey ? num(models[bestKey]?.fausses_alarmes_evenements_par_heure, 1) : '—', color: '#A855F7', sub: 'alertes distinctes à tort' },
  ];

  const downloadReport = () => {
    if (!report?.markdown) return;
    const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'rapport_operateur_transmission.md'; a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <PhaseShell phase={PHASE} hidePipeline stats={stats} trained={!!models}>
      {/* ── Entraînement en temps réel ── */}
      <Card className="glass glass-border">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2"><Radio className="w-4 h-4" style={{ color: '#00FFA3' }} />Entraînement en temps réel des 4 modèles candidats</CardTitle>
          <Button size="sm" onClick={startTraining} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {running ? 'Entraînement en cours…' : 'Lancer l’entraînement'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Jeu : traces réelles TON_IoT avec attaques de transmission injectées (répétition 0). Les non-supervisés apprennent le normal seul ;
            les supervisés apprennent sur les attaques étiquetées. Seuil choisi sur la validation, résultat mesuré sur le test.
          </p>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full transition-all duration-500" style={{ width: `${progress?.progress ?? (summary?.web ? 100 : 0)}%`, background: 'linear-gradient(90deg,#00FFA3,#00F5FF)' }} />
          </div>
          <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {progress?.message ?? (summary?.web ? `Dernier entraînement : ${new Date(summary.web.generated_at).toLocaleString('fr-FR')} (${summary.web.duree_s} s)` : 'Aucun entraînement lancé.')}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {MODEL_ORDER.map((k) => {
              const r = liveResults[k] ?? (running ? undefined : summary?.web?.modeles?.[k]);
              const active = running && progress?.model === k && !r;
              return (
                <div key={k} className="rounded-xl p-3 glass-border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: r ? '#00FFA340' : 'rgba(255,255,255,0.08)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{MODEL_LABEL[k]}</span>
                    {r ? <CheckCircle2 className="w-4 h-4" style={{ color: '#00FFA3' }} /> : active ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-[10px] opacity-50">en attente</span>}
                  </div>
                  <div className="text-lg font-mono font-bold mt-1">{r ? `F1 ${num(r.f1)}` : '—'}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {r ? `précision ${pct(r.precision)} · rappel ${pct(r.recall)} · ${num(r.fausses_alarmes_evenements_par_heure, 1)} FA/h` : r === undefined && !running ? 'non entraîné' : ''}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-bold mb-2">Random Forest : F1 de validation pendant l’apprentissage</div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rfCurve} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="arbres" tick={{ fontSize: 10 }} label={{ value: 'arbres', position: 'insideBottomRight', fontSize: 10, offset: -4 }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => Number(v).toFixed(3)} />
                    <Line type="monotone" dataKey="f1_validation" name="F1 validation" stroke="#00FFA3" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="auc_validation" name="AUC validation" stroke="#00F5FF" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <div className="text-xs font-bold mb-2">Journal</div>
              <div className="rounded-xl p-3 h-52 overflow-auto text-[11px] font-mono space-y-1" style={{ background: 'rgba(0,0,0,0.25)' }}>
                {log.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>Les étapes s’affichent ici pendant l’entraînement.</div>}
                {log.map((m, i) => <div key={i}><span style={{ color: '#00FFA3' }}>[{String(m.progress).padStart(3, ' ')} %]</span> {m.message}</div>)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Résultats ── */}
      <Card className="glass glass-border">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm">Résultats sur le test</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant={view === 'web' ? 'default' : 'outline'} onClick={() => setView('web')} disabled={!summary?.web && !Object.keys(liveResults).length}>Cet entraînement</Button>
            <Button size="sm" variant={view === 'reference' ? 'default' : 'outline'} onClick={() => setView('reference')} disabled={!summary?.reference}>
              Référence ({summary?.reference?.repetitions ?? 9} répétitions)
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!models ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Aucun résultat : lancez un entraînement, ou exécutez <code>backend/scripts/transmission_models.py</code> pour la référence.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                    <th className="py-2 pr-3">Modèle</th><th className="pr-3">Type</th><th className="pr-3">Précision</th><th className="pr-3">Rappel</th>
                    <th className="pr-3">F1</th><th className="pr-3">AUC</th><th className="pr-3">Fausses alertes / h</th><th className="pr-3">Épisodes</th><th>Délai médian</th>
                  </tr>
                </thead>
                <tbody>
                  {[...MODEL_ORDER, 'Statistique'].filter((k) => models[k]).map((k) => {
                    const r = models[k]; const best = k === bestKey;
                    return (
                      <tr key={k} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)', background: best ? 'rgba(0,255,163,0.06)' : undefined }}>
                        <td className="py-2 pr-3 font-bold">{MODEL_LABEL[k] ?? r.nom} {best && <Badge className="ml-1" variant="secondary">retenu</Badge>}</td>
                        <td className="pr-3">{r.type ?? (k === 'Statistique' ? 'règles' : '')}</td>
                        <td className="pr-3 font-mono">{pct(r.precision)}</td><td className="pr-3 font-mono">{pct(r.recall)}</td>
                        <td className="pr-3 font-mono font-bold">{num(r.f1)}</td><td className="pr-3 font-mono">{num(r.roc_auc)}</td>
                        <td className="pr-3 font-mono">{num(r.fausses_alarmes_evenements_par_heure, 1)}</td>
                        <td className="pr-3 font-mono">{r.episodes_detectes}/{r.episodes}</td>
                        <td className="font-mono">{r.delai_median_min == null ? '—' : `${r.delai_median_min.toFixed(1)} min`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[11px] mt-3" style={{ color: 'var(--text-secondary)' }}>
                Précision : part des alertes qui sont de vraies attaques. Rappel : part des mesures falsifiées signalées. Un détecteur qui signalerait tout aurait un F1 d’environ 0,25.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Par scénario + SHAP ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="glass glass-border">
          <CardHeader><CardTitle className="text-sm">Détection par scénario — {bestKey ? MODEL_LABEL[bestKey] ?? bestKey : ''}</CardTitle></CardHeader>
          <CardContent>
            {scenarioRows.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>—</p> : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scenarioRows} layout="vertical" margin={{ top: 4, right: 40, left: 40, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} unit=" %" />
                    <YAxis type="category" dataKey="scenario" width={110} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v, _n, p) => [`${Number(v).toFixed(1)} % des mesures · épisodes ${(p.payload as { episodes: string }).episodes}`, 'signalé']} />
                    <Bar dataKey="taux" fill="#00FFA3" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 10, formatter: (v) => `${Math.round(Number(v))} %` }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass glass-border">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: '#A855F7' }} />SHAP — ce que le modèle regarde</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!shap ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>SHAP disponible après un entraînement d’un modèle arborescent.</p> : (
              <>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={shap.global.slice(0, 8).map((f) => ({ name: f.label ?? f.feature, importance: f.importance }))} layout="vertical" margin={{ top: 0, right: 30, left: 80, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 9 }} />
                      <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => Number(v).toFixed(3)} />
                      <Bar dataKey="importance" fill="#A855F7" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table className="w-full text-[11px]">
                  <thead><tr className="text-left" style={{ color: 'var(--text-secondary)' }}><th className="py-1 pr-2">Scénario</th><th>Features décisives</th></tr></thead>
                  <tbody>
                    {Object.entries(shap.par_scenario).map(([sc, feats]) => (
                      <tr key={sc} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <td className="py-1 pr-2 font-bold whitespace-nowrap">{SCENARIO_LABEL[sc] ?? sc}</td>
                        <td>{feats.slice(0, 3).map((f) => f.label ?? f.feature).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Historique (entraînements enregistrés en base) ── */}
      <Card className="glass glass-border">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Database className="w-4 h-4" style={{ color: '#38BDF8' }} />Historique des entraînements</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Aucun entraînement enregistré en base pour l’instant.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                  <th className="py-1.5 pr-3">Date</th><th className="pr-3">Lancé par</th><th className="pr-3">Statut</th>
                  <th className="pr-3">Durée</th><th className="pr-3">Meilleur modèle</th><th>F1 (test)</th>
                </tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }} title={h.erreur ?? undefined}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(`${h.debut}Z`).toLocaleString('fr-FR')}</td>
                      <td className="pr-3">{h.lance_par ?? '—'}</td>
                      <td className="pr-3"><Badge variant={h.statut === 'termine' ? 'default' : h.statut === 'en_cours' ? 'secondary' : 'destructive'}>{h.statut.replace('_', ' ')}</Badge></td>
                      <td className="pr-3">{h.duree_s != null ? `${Math.round(h.duree_s)} s` : '—'}</td>
                      <td className="pr-3">{h.meilleur_modele ? MODEL_LABEL[h.meilleur_modele] ?? h.meilleur_modele : '—'}</td>
                      <td>{pct(h.meilleur_f1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Rapport opérateur ── */}
      <Card className="glass glass-border">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" style={{ color: '#00F5FF' }} />Rapport de recommandation pour l’opérateur</CardTitle>
          <Button size="sm" variant="outline" onClick={downloadReport} disabled={!report?.markdown}><Download className="w-4 h-4 mr-2" />Télécharger (.md)</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!report || !report.modele ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{report?.message ?? 'Rapport indisponible.'}</p> : (
            <>
              <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(0,245,255,0.05)' }}>
                <div className="font-bold mb-1">Modèle en service : {report.modele.nom} ({report.modele.type}) · source : {report.source}</div>
                <div>{report.modele.lecture}</div>
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                {report.scenarios.map((s) => (
                  <div key={s.scenario} className="rounded-xl p-3 glass-border text-[11px] space-y-1" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{SCENARIO_LABEL[s.scenario] ?? s.scenario} <span className="opacity-60">· {s.capteur}</span></span>
                      <Badge variant={s.taux_detection != null && s.taux_detection >= 80 ? 'default' : s.taux_detection != null && s.taux_detection >= 40 ? 'secondary' : 'destructive'}>
                        {s.taux_detection == null ? 'n/a' : `${Math.round(s.taux_detection)} %`}
                      </Badge>
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>{s.description}</div>
                    <div><span className="font-bold">Niveau :</span> {s.niveau}</div>
                    <div><span className="font-bold">Le modèle regarde :</span> {s.ce_que_le_modele_regarde.join(', ')}</div>
                    <div><span className="font-bold">Risque :</span> {s.risque}</div>
                    <ol className="list-decimal pl-4 space-y-0.5">{s.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
                  </div>
                ))}
              </div>
              <div className="text-[11px]">
                <div className="font-bold mb-1">Règles générales</div>
                <ul className="list-disc pl-4 space-y-0.5">{report.regles_generales.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PhaseShell>
  );
}
