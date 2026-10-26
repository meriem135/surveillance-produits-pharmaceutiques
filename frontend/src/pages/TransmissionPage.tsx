import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { Activity, AlertTriangle, CheckCircle2, Database, Download, FileText, Layers, Loader2, Play, Radio, Sparkles, Target } from 'lucide-react';
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
interface PerEpisode { n: number; detected: number; delai_median_min?: number | null }
interface Metrics {
  recall: number; fausses_alarmes_evenements_par_heure: number; delai_median_min: number | null; precision: number;
  f1: number; f2?: number; fpr?: number; episodes: number; episodes_detectes: number; part_attaques?: number;
  per_attack?: Record<string, PerAttack>; per_episode?: Record<string, PerEpisode>;
}
interface OperatingPoint { libelle: string; seuils: number[]; val: Metrics; test: Metrics }
interface PrCurve { recall: number[]; precision: number[] }
interface ModelResult extends Metrics {
  nom: string; type?: string; val_f1?: number; val_recall?: number; val_precision?: number; val_f2?: number;
  roc_auc?: number; avg_precision?: number;
  points_fonctionnement?: Record<string, OperatingPoint>;
  courbe_pr?: { val: PrCurve; test: PrCurve };
}
interface ShapFeature { feature: string; label?: string; importance: number }
interface ShapData { n_lignes: number; global: ShapFeature[]; par_scenario: Record<string, ShapFeature[]>; modele?: string }
interface CurvePoint { arbres: number; f2_validation?: number; f1_validation?: number; auc_validation: number }
interface RolePrev { lignes: number; attaques: number; part: number; part_min?: number; part_max?: number }
type Prevalence = Record<'train' | 'val' | 'test', RolePrev>;
interface WebResults {
  generated_at: string; duree_s: number; meilleur: string; classement_validation: string[];
  cible_rappel?: number; cibles_rappel?: number[]; classement_validation_par_cible?: Record<string, string[]>;
  modeles: Record<string, ModelResult>; courbe_random_forest: CurvePoint[]; shap: ShapData | null;
  dataset: { lignes: number; features: number; episodes: number; train: number; val: number; test: number; prevalence?: Prevalence };
}
interface CvStat { mean: number; std: number }
interface CvMethod { description: string; blocs_partages: number; modeles: Record<string, Record<'recall' | 'precision' | 'f1' | 'average_precision', CvStat>> }
interface CrossVal { lignes: number; blocs: number; folds: number; seuil: string; methodes: { naif: CvMethod; groupes_blocs: CvMethod } }
interface LongBiasAmp {
  n: number; detectes: number; delai_median_min: number | null;
  par_duree: Record<string, { n: number; detectes: number; delai_median_min: number | null }>;
  detectes_avant_min: Record<string, { n: number; detectes: number; part: number | null }>;
}
interface LongBias {
  protocole: { blocs: string; repetitions: number; seuil: string };
  jeux_features: Record<string, string>;
  resultats: Record<string, { fa_h_test: number; auc_test_moyenne: number; par_amplitude: Record<string, LongBiasAmp> }>;
}
interface Summary {
  dataset: { lignes: number; attaques: number; heures: number; episodes: number; scenarios: string[]; par_role?: Prevalence } | null;
  traces: { fusion?: { debut: string; fin: string }; profil?: Record<string, { moyenne: number; ecart_type: number; autocorr_5s: number }> } | null;
  reference: {
    repetitions: number; meilleur: string; modeles: Record<string, ModelResult>; prevalence?: Prevalence;
    cible_rappel?: number; cibles_rappel?: number[]; classement_validation_par_cible?: Record<string, string[]>;
    protocole?: { couverture?: string };
  } | null;
  validation_croisee: CrossVal | null;
  biais_long: LongBias | null;
  shap_reference: ShapData | null;
  web: WebResults | null;
  scenarios: Array<{ nom: string; capteur_fr: string; description: string }>;
}
interface ReportScenario {
  scenario: string; capteur: string; description: string; famille: string; taux_detection: number | null;
  niveau: string; episodes: string; delai_median_min?: number | null; ce_que_le_modele_regarde: string[]; risque: string; actions: string[];
}
interface Report {
  titre: string; date: string; source: string; message?: string; markdown: string; desequilibre?: string; limites?: string[];
  modele: {
    nom: string; type: string; point_fonctionnement?: string; recall: number; fausses_alertes_par_heure: number;
    delai_median_min?: number | null; precision: number; f1: number; f2?: number; episodes: string; lecture: string; seuil?: string;
  } | null;
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

const MODEL_ORDER = ['RandomForest', 'XGBoost', 'Logistique', 'MLP'];
const MODEL_LABEL: Record<string, string> = {
  RandomForest: 'Random Forest', XGBoost: 'XGBoost', Logistique: 'Régression Logistique', MLP: 'MLP',
};
const SCENARIO_LABEL: Record<string, string> = {
  MITM_gel: 'Gel', MITM_rejeu: 'Rejeu', Injection_nominale: 'Injection nominale', 'Injection_biais_0.5': 'Biais −0,5 °C',
  'Injection_biais_1.0': 'Biais −1 °C', 'Injection_biais_2.0': 'Biais −2 °C', Injection_derive: 'Dérive',
  MITM_gel_thermostat: 'Gel thermostat', Injection_biais_thermostat: 'Biais thermostat',
};
const SMALL_BIASES = ['Injection_biais_0.5', 'Injection_biais_1.0'];
const TARGETS = [0.8, 0.9, 0.95];
const PHASE: PhaseItem = {
  num: 2, label: 'Attaques de transmission', subtitle: 'Traces réelles TON_IoT · MITM & injection · 4 modèles supervisés',
  icon: '\u{1F4E1}', color: '#0D9488', status: 'active', progress: 100,
};

const pct = (v: number | undefined | null) => (v == null ? '—' : `${Math.round(v * 100)} %`);
const pct1 = (v: number | undefined | null) => (v == null ? '—' : `${(v * 100).toFixed(1)} %`);
const num = (v: number | undefined | null, d = 2) => (v == null ? '—' : v.toFixed(d));
const delai = (v: number | undefined | null) => (v == null ? '—' : `${v.toFixed(1)} min`);
const opKey = (t: number) => `rappel_${t.toFixed(2)}`;
const pm = (s?: CvStat) => (s ? `${s.mean.toFixed(3)} ± ${s.std.toFixed(3)}` : '—');

/** Métriques d'un modèle à un point de fonctionnement (anciens résultats : champs à plat = test max F1). */
function metricsAt(m: ModelResult, op: string, role: 'val' | 'test'): Metrics | null {
  const p = m.points_fonctionnement?.[op];
  if (p) return p[role];
  if (op === 'max_f1' && role === 'test') return m;
  return null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? (JSON.parse(t) as T) : null;
  } catch { return null; }
}

const TH = 'pr-3 font-normal';
const cellBorder = { borderColor: 'color-mix(in srgb, var(--text-primary) 8%, transparent)' };

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
  const [view, setView] = useState<'web' | 'reference'>('reference');
  const [target, setTarget] = useState(0.9);
  const wsRef = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    const [s, r, h] = await Promise.all([
      getJson<Summary>('/api/v1/transmission/summary'), getJson<Report>('/api/v1/transmission/report'),
      getJson<{ runs: HistoryRun[] }>('/api/v1/transmission/history?limit=10'),
    ]);
    setSummary(s); setReport(r); setHistory(h?.runs ?? []);
    if (s && !s.reference && s.web) setView('web');
    const c = s?.reference?.cible_rappel ?? s?.web?.cible_rappel;
    if (c) setTarget(c);
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
  const op = opKey(target);
  const hasPoints = !!models && Object.values(models).every((m) => m.points_fonctionnement?.[op]);
  const ranking = view === 'web' ? summary?.web?.classement_validation_par_cible?.[target.toFixed(2)] : summary?.reference?.classement_validation_par_cible?.[target.toFixed(2)];
  const bestKey = ranking?.[0] ?? (view === 'web' ? summary?.web?.meilleur : summary?.reference?.meilleur);
  const best = models && bestKey ? models[bestKey] : null;
  const shap: ShapData | null = view === 'web' ? summary?.web?.shap ?? null : summary?.shap_reference ?? null;
  const rfCurve = curve.length ? curve : summary?.web?.courbe_random_forest ?? [];
  const prevalence: Prevalence | undefined = view === 'web' ? summary?.web?.dataset?.prevalence : summary?.reference?.prevalence;
  const bestTest = best ? metricsAt(best, hasPoints ? op : 'max_f1', 'test') : null;

  const scenarioRows = useMemo(() => {
    if (!best) return [];
    const t = metricsAt(best, hasPoints ? op : 'max_f1', 'test');
    const f = metricsAt(best, 'max_f1', 'test');
    if (!t?.per_attack) return [];
    return Object.keys(SCENARIO_LABEL).filter((k) => t.per_attack![k]?.n).map((k) => ({
      key: k, scenario: SCENARIO_LABEL[k], rate: t.per_attack![k].rate, rateF1: f?.per_attack?.[k]?.rate,
      ep: t.per_episode?.[k], epF1: f?.per_episode?.[k],
    }));
  }, [best, op, hasPoints]);

  const prData = useMemo(() => {
    const c = best?.courbe_pr;
    if (!c) return null;
    const toPts = (pr: PrCurve) => pr.recall.map((r, i) => ({ recall: r, precision: pr.precision[i] })).sort((a, b) => a.recall - b.recall);
    const pt = (o: string, role: 'val' | 'test') => {
      const m = best?.points_fonctionnement?.[o]?.[role];
      return m ? [{ recall: m.recall, precision: m.precision }] : [];
    };
    return { test: toPts(c.test), val: toPts(c.val), f1Test: pt('max_f1', 'test'), f1Val: pt('max_f1', 'val'), tgTest: pt(op, 'test'), tgVal: pt(op, 'val') };
  }, [best, op]);

  const stats = [
    { icon: <Database className="w-4 h-4" />, label: 'Mesures réelles', value: summary?.dataset ? summary.dataset.lignes.toLocaleString('fr-FR') : '—', color: '#0D9488', sub: summary?.dataset ? `${summary.dataset.heures} h, pas de 5 s` : 'jeu non construit' },
    { icon: <AlertTriangle className="w-4 h-4" />, label: 'Part d’attaques (val / test)', value: prevalence ? `${pct1(prevalence.val.part)} / ${pct1(prevalence.test.part)}` : '—', color: '#E11D48', sub: prevalence ? `train ${pct1(prevalence.train.part)} · ${summary?.dataset?.scenarios.length ?? 9} scénarios` : '' },
    { icon: <Activity className="w-4 h-4" />, label: 'Meilleur modèle (validation)', value: bestKey ? MODEL_LABEL[bestKey] ?? bestKey : '—', color: '#0891B2', sub: bestTest ? `test : rappel ${pct(bestTest.recall)} · précision ${pct(bestTest.precision)}` : '' },
    { icon: <Sparkles className="w-4 h-4" />, label: 'Fausses alertes / h', value: bestTest ? num(bestTest.fausses_alarmes_evenements_par_heure, 1) : '—', color: '#7C3AED', sub: `au rappel cible ${target.toFixed(2)} (test)` },
  ];

  const downloadReport = () => {
    if (!report?.markdown) return;
    const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'rapport_operateur_transmission.md'; a.click();
    URL.revokeObjectURL(a.href);
  };

  const cv = summary?.validation_croisee;
  const lb = summary?.biais_long;

  return (
    <PhaseShell phase={PHASE} hidePipeline stats={stats} trained={!!models}>
      {/* ── Entraînement en temps réel ── */}
      <Card className="glass glass-border">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2"><Radio className="w-4 h-4" style={{ color: '#0D9488' }} />Entraînement en temps réel des 4 modèles supervisés</CardTitle>
          <Button size="sm" onClick={startTraining} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {running ? 'Entraînement en cours…' : 'Lancer l’entraînement'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Jeu : traces réelles TON_IoT avec attaques de transmission injectées (répétition 0). Les quatre modèles sont supervisés :
            ils apprennent sur les attaques étiquetées des blocs d’entraînement (~33 % d’attaques). Validation et test gardent une
            prévalence réaliste (≈ 14 %). Seuils choisis sur la validation, résultat mesuré sur le test.
          </p>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--text-primary) 8%, transparent)' }}>
            <div className="h-full transition-all duration-500" style={{ width: `${progress?.progress ?? (summary?.web ? 100 : 0)}%`, background: 'var(--accent-primary)' }} />
          </div>
          <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {progress?.message ?? (summary?.web ? `Dernier entraînement : ${new Date(summary.web.generated_at).toLocaleString('fr-FR')} (${summary.web.duree_s} s)` : 'Aucun entraînement lancé.')}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {MODEL_ORDER.map((k) => {
              const r = liveResults[k] ?? (running ? undefined : summary?.web?.modeles?.[k]);
              const m = r ? metricsAt(r, r.points_fonctionnement?.[op] ? op : 'max_f1', 'test') : null;
              const active = running && progress?.model === k && !r;
              return (
                <div key={k} className="rounded-xl p-3 glass-border" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)', borderColor: r ? '#0D948840' : 'color-mix(in srgb, var(--text-primary) 10%, transparent)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{MODEL_LABEL[k]}</span>
                    {r ? <CheckCircle2 className="w-4 h-4" style={{ color: '#0D9488' }} /> : active ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-[10px] opacity-50">en attente</span>}
                  </div>
                  <div className="text-lg font-mono font-bold mt-1">{m ? `rappel ${pct(m.recall)}` : '—'}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {m ? `${num(m.fausses_alarmes_evenements_par_heure, 1)} FA/h · délai ${delai(m.delai_median_min)} · précision ${pct(m.precision)} · F2 ${num(m.f2)}` : r === undefined && !running ? 'non entraîné' : ''}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-bold mb-2">Random Forest : F2 de validation (au rappel cible) pendant l’apprentissage</div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rfCurve} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--text-primary) 8%, transparent)" />
                    <XAxis dataKey="arbres" tick={{ fontSize: 10 }} label={{ value: 'arbres', position: 'insideBottomRight', fontSize: 10, offset: -4 }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => Number(v).toFixed(3)} />
                    <Line type="monotone" dataKey={rfCurve.some((p) => p.f2_validation != null) ? 'f2_validation' : 'f1_validation'} name="F2 validation" stroke="#0D9488" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="auc_validation" name="AUC validation" stroke="#0891B2" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <div className="text-xs font-bold mb-2">Journal</div>
              <div className="rounded-xl p-3 h-52 overflow-auto text-[11px] font-mono space-y-1" style={{ background: 'var(--bg-subtle)' }}>
                {log.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>Les étapes s’affichent ici pendant l’entraînement.</div>}
                {log.map((m, i) => <div key={i}><span style={{ color: '#0D9488' }}>[{String(m.progress).padStart(3, ' ')} %]</span> {m.message}</div>)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Résultats ── */}
      <Card className="glass glass-border">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2"><Target className="w-4 h-4" style={{ color: '#0891B2' }} />Résultats : validation (choix) et test (confirmation)</CardTitle>
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Rappel cible</span>
            {TARGETS.map((t) => (
              <Button key={t} size="sm" data-testid={`cible-${t}`} variant={Math.abs(target - t) < 1e-9 ? 'default' : 'outline'} onClick={() => setTarget(t)}>{t.toFixed(2).replace('.', ',')}</Button>
            ))}
            <span className="mx-1 opacity-30">|</span>
            <Button size="sm" variant={view === 'web' ? 'default' : 'outline'} onClick={() => setView('web')} disabled={!summary?.web && !Object.keys(liveResults).length}>Cet entraînement</Button>
            <Button size="sm" variant={view === 'reference' ? 'default' : 'outline'} onClick={() => setView('reference')} disabled={!summary?.reference}>
              Référence ({summary?.reference?.repetitions ?? 20} répétitions)
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {prevalence && (
            <div className="flex gap-2 flex-wrap text-[11px]">
              {(['train', 'val', 'test'] as const).map((r) => (
                <Badge key={r} variant="secondary">Part d’attaques mesurée — {r} : {pct1(prevalence[r].part)}{prevalence[r].part_min != null ? ` (${pct1(prevalence[r].part_min)}–${pct1(prevalence[r].part_max)} selon la répétition)` : ''}</Badge>
              ))}
            </div>
          )}
          {!models ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Aucun résultat : lancez un entraînement, ou exécutez <code>backend/scripts/transmission_models.py</code> pour la référence.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[860px] whitespace-nowrap" data-testid="table-resultats">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                    <th className="py-2 pr-3 font-normal">Modèle</th><th className={TH}>Seuil</th><th className={TH}>Rôle</th>
                    <th className={TH}>Rappel</th><th className={TH}>Fausses alertes / h</th><th className={TH}>Délai médian</th>
                    <th className={TH}>Épisodes</th><th className={TH}>Précision</th><th className={TH}>F1</th><th className={TH}>F2</th>
                    <th className="font-normal">Lignes normales signalées</th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_ORDER.filter((k) => models[k]).flatMap((k) => {
                    const r = models[k]; const isBest = k === bestKey;
                    const ops = hasPoints ? [op, 'max_f1'] : ['max_f1'];
                    return ops.flatMap((o) => (['val', 'test'] as const).map((role) => {
                      const m = metricsAt(r, o, role);
                      if (!m) return null;
                      const first = o === ops[0] && role === 'val';
                      return (
                        <tr key={`${k}-${o}-${role}`} className={first ? 'border-t' : ''} style={{ ...cellBorder, background: isBest ? 'rgba(13,148,136,0.06)' : undefined, opacity: o === 'max_f1' ? 0.75 : 1 }}>
                          <td className="py-1 pr-3 font-bold whitespace-nowrap">{first ? <>{MODEL_LABEL[k] ?? r.nom} {isBest && <Badge className="ml-1" variant="secondary">retenu</Badge>}</> : ''}</td>
                          <td className="pr-3 whitespace-nowrap">{role === 'val' ? (o === 'max_f1' ? 'max F1' : `rappel ${target.toFixed(2).replace('.', ',')}`) : ''}</td>
                          <td className="pr-3">{role === 'val' ? 'validation' : 'test'}</td>
                          <td className="pr-3 font-mono font-bold">{pct1(m.recall)}</td>
                          <td className="pr-3 font-mono">{num(m.fausses_alarmes_evenements_par_heure, 2)}</td>
                          <td className="pr-3 font-mono">{delai(m.delai_median_min)}</td>
                          <td className="pr-3 font-mono">{m.episodes_detectes}/{m.episodes}</td>
                          <td className="pr-3 font-mono">{pct1(m.precision)}</td>
                          <td className="pr-3 font-mono">{num(m.f1, 3)}</td>
                          <td className="pr-3 font-mono">{num(m.f2, 3)}</td>
                          <td className="font-mono opacity-70">{pct1(m.fpr)}</td>
                        </tr>
                      );
                    }));
                  })}
                </tbody>
              </table>
              <p className="text-[11px] mt-3" style={{ color: 'var(--text-secondary)' }}>
                Le modèle est choisi sur la <b>validation</b> (F2 au rappel cible) ; le test, jamais utilisé pour choisir, confirme. Seuil « rappel cible » :
                le seuil le plus haut qui atteint ce rappel sur la validation. Fausses alertes / h : alertes distinctes à tort par heure normale.
                La précision dépend de la part d’attaques : elle est mesurée ici à une prévalence réaliste (~14 %), pas à 33 %.
                {summary?.reference?.protocole?.couverture ? ` Répétitions : ${summary.reference.protocole.couverture}.` : ''}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Courbe PR + par scénario ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="glass glass-border">
          <CardHeader><CardTitle className="text-sm">Courbe précision–rappel — {bestKey ? MODEL_LABEL[bestKey] ?? bestKey : ''}</CardTitle></CardHeader>
          <CardContent>
            {!prData ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Courbe disponible après un entraînement.</p> : (
              <div className="h-72" data-testid="courbe-pr">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 16, left: -10, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--text-primary) 8%, transparent)" />
                    <XAxis type="number" dataKey="recall" domain={[0, 1]} tick={{ fontSize: 10 }} label={{ value: 'rappel', position: 'insideBottomRight', fontSize: 10, offset: -4 }} />
                    <YAxis type="number" dataKey="precision" domain={[0, 1]} tick={{ fontSize: 10 }} />
                    <ZAxis range={[60, 60]} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => Number(v).toFixed(3)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Scatter name="test (cumulé)" data={prData.test} line={{ stroke: '#0891B2', strokeWidth: 2 }} shape={() => <g />} fill="#0891B2" isAnimationActive={false} />
                    <Scatter name="validation (cumulé)" data={prData.val} line={{ stroke: '#64748B', strokeWidth: 1, strokeDasharray: '4 3' }} shape={() => <g />} fill="#64748B" isAnimationActive={false} />
                    <Scatter name="max F1 (test)" data={prData.f1Test} fill="#F59E0B" shape="diamond" isAnimationActive={false} />
                    <Scatter name={`rappel cible ${target.toFixed(2)} (test)`} data={prData.tgTest} fill="#0D9488" shape="star" isAnimationActive={false} />
                    <Scatter name="points de validation" data={[...prData.f1Val, ...prData.tgVal]} fill="#94A3B8" shape="circle" isAnimationActive={false} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass glass-border">
          <CardHeader><CardTitle className="text-sm">Détection par scénario (test) — {bestKey ? MODEL_LABEL[bestKey] ?? bestKey : ''}, rappel cible {target.toFixed(2).replace('.', ',')}</CardTitle></CardHeader>
          <CardContent>
            {scenarioRows.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>—</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[520px] whitespace-nowrap" data-testid="table-scenarios">
                  <thead><tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                    <th className="py-1.5 pr-3 font-normal">Scénario</th><th className={TH}>Rappel</th><th className={TH}>Épisodes détectés</th>
                    <th className={TH}>Délai médian</th><th className="font-normal">Rappel au max F1</th>
                  </tr></thead>
                  <tbody>
                    {scenarioRows.map((s) => {
                      const small = SMALL_BIASES.includes(s.key);
                      return (
                        <tr key={s.key} className="border-t" style={{ ...cellBorder, background: small ? 'rgba(225,29,72,0.06)' : undefined }}>
                          <td className="py-1.5 pr-3 font-bold whitespace-nowrap">{s.scenario}{small && <Badge className="ml-1" variant="destructive">limite connue</Badge>}</td>
                          <td className="pr-3 font-mono font-bold">{s.rate.toFixed(1)} %</td>
                          <td className="pr-3 font-mono">{s.ep ? `${s.ep.detected}/${s.ep.n}` : '—'}</td>
                          <td className="pr-3 font-mono">{delai(s.ep?.delai_median_min)}</td>
                          <td className="font-mono opacity-70">{s.rateF1 == null ? '—' : `${s.rateF1.toFixed(1)} %`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-secondary)' }}>
                  Rappel = part des mesures falsifiées signalées. À ce seuil, {pct1(bestTest?.fpr)} des lignes normales sont aussi signalées :
                  un rappel par scénario ne vaut que s’il dépasse nettement ce taux, et un épisode « détecté » peut l’être par une alerte fortuite. Les biais de −0,5 et −1 °C sont très en dessous du bruit du frigo (σ ≈ 3,4 °C par mesure) :
                  non détectables de façon fiable en 15–25 min à ce niveau de bruit (voir l’étude des biais longs ci-dessous).
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Validation croisée + biais longs ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="glass glass-border">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Layers className="w-4 h-4" style={{ color: '#0284C7' }} />Validation croisée de confirmation (5 folds)</CardTitle></CardHeader>
          <CardContent>
            {!cv ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Lancer <code>transmission_models.py</code> (sans SKIP_CV).</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[560px]" data-testid="table-cv">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                      <th className="py-1.5 pr-3 font-normal" rowSpan={2}>Modèle</th>
                      <th className="pr-3 font-normal" colSpan={2}>Groupée par bloc d’1 h (honnête)</th>
                      <th className="font-normal" colSpan={2}>Naïve, lignes mélangées (à ne pas faire)</th>
                    </tr>
                    <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                      <th className={TH}>Rappel</th><th className={TH}>Précision</th><th className={TH}>Rappel</th><th className="font-normal">Précision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MODEL_ORDER.filter((k) => cv.methodes.groupes_blocs.modeles[k]).map((k) => {
                      const g = cv.methodes.groupes_blocs.modeles[k]; const n = cv.methodes.naif.modeles[k];
                      return (
                        <tr key={k} className="border-t" style={cellBorder}>
                          <td className="py-1.5 pr-3 font-bold">{MODEL_LABEL[k]}</td>
                          <td className="pr-3 font-mono whitespace-nowrap">{pm(g.recall)}</td><td className="pr-3 font-mono whitespace-nowrap">{pm(g.precision)}</td>
                          <td className="pr-3 font-mono whitespace-nowrap opacity-60">{pm(n?.recall)}</td><td className="font-mono whitespace-nowrap opacity-60">{pm(n?.precision)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-secondary)' }}>
                  Lignes d’entraînement de la répétition 0 ({cv.lignes.toLocaleString('fr-FR')} lignes, {cv.blocs} blocs), seuil 0,5. Groupe = bloc d’une heure :
                  une attaque et les lignes normales qui partagent ses fenêtres glissantes restent du même côté
                  (blocs partagés entre apprentissage et évaluation : {cv.methodes.groupes_blocs.blocs_partages} contre {cv.methodes.naif.blocs_partages} en naïf).
                  Confirme le protocole par blocs, ne le remplace pas.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass glass-border">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" style={{ color: '#E11D48' }} />Étude complémentaire : petits biais longs (1 à 3 h)</CardTitle></CardHeader>
          <CardContent>
            {!lb ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Lancer <code>backend/scripts/transmission_biais_long.py</code>.</p> : (
              <div className="space-y-2" data-testid="biais-long">
                {(['A', 'B'] as const).filter((j) => lb.resultats[j]).map((j) => (
                  <div key={j}>
                    <div className="text-[11px] font-bold">{j === 'A' ? 'Features actuelles (≤ 15 min)' : '+ moyennes 30 / 60 min, EWMA 1 h'} <span className="opacity-60 font-normal">· {num(lb.resultats[j].fa_h_test, 2)} FA/h au test</span></div>
                    <div className="overflow-x-auto"><table className="w-full text-xs mt-1 min-w-[480px] whitespace-nowrap">
                      <thead><tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                        <th className="py-1 pr-3 font-normal">Biais</th><th className={TH}>Détectés</th>
                        {Object.keys(Object.values(lb.resultats[j].par_amplitude)[0]?.detectes_avant_min ?? {}).map((h) => <th key={h} className={TH}>≤ {h} min</th>)}
                        <th className="font-normal">Délai médian</th>
                      </tr></thead>
                      <tbody>
                        {Object.entries(lb.resultats[j].par_amplitude).map(([amp, v]) => (
                          <tr key={amp} className="border-t" style={cellBorder}>
                            <td className="py-1 pr-3 font-bold">{amp.replace('.', ',')} °C</td>
                            <td className="pr-3 font-mono">{v.detectes}/{v.n}</td>
                            {Object.values(v.detectes_avant_min).map((x, i) => <td key={i} className="pr-3 font-mono">{x.n ? `${x.detectes}/${x.n}` : '—'}</td>)}
                            <td className="font-mono">{delai(v.delai_median_min)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  </div>
                ))}
                <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  Étude séparée (blocs de 4 h pour que chaque épisode de 1 à 3 h reste dans un seul rôle), {lb.protocole.repetitions} répétitions, Random Forest ;
                  seuil : {lb.protocole.seuil}. « ≤ 60 min » : épisodes d’au moins 1 h détectés dans leur première heure. Petit échantillon : ordre de grandeur.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── SHAP ── */}
      <Card className="glass glass-border">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: '#7C3AED' }} />SHAP — ce que le modèle regarde{shap?.modele ? ` (${MODEL_LABEL[shap.modele] ?? shap.modele})` : ''}</CardTitle></CardHeader>
        <CardContent className="grid lg:grid-cols-2 gap-4">
          {!shap ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>SHAP disponible après un entraînement d’un modèle arborescent.</p> : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={shap.global.slice(0, 8).map((f) => ({ name: f.label ?? f.feature, importance: f.importance }))} layout="vertical" margin={{ top: 0, right: 30, left: 80, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 9 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => Number(v).toFixed(3)} />
                    <Bar dataKey="importance" fill="#7C3AED" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="w-full text-[11px]">
                <thead><tr className="text-left" style={{ color: 'var(--text-secondary)' }}><th className="py-1 pr-2 font-normal">Scénario</th><th className="font-normal">Features décisives</th></tr></thead>
                <tbody>
                  {Object.entries(shap.par_scenario).map(([sc, feats]) => (
                    <tr key={sc} className="border-t" style={cellBorder}>
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

      {/* ── Historique (entraînements enregistrés en base) ── */}
      <Card className="glass glass-border">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Database className="w-4 h-4" style={{ color: '#0284C7' }} />Historique des entraînements</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Aucun entraînement enregistré en base pour l’instant.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[560px] whitespace-nowrap">
                <thead><tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                  <th className="py-1.5 pr-3 font-normal">Date</th><th className={TH}>Lancé par</th><th className={TH}>Statut</th>
                  <th className={TH}>Durée</th><th className={TH}>Meilleur modèle</th><th className="font-normal">F1 (test, max F1)</th>
                </tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t" style={cellBorder} title={h.erreur ?? undefined}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(`${h.debut}Z`).toLocaleString('fr-FR')}</td>
                      <td className="pr-3">{h.lance_par ?? '—'}</td>
                      <td className="pr-3"><Badge variant={h.statut === 'termine' ? 'success' : h.statut === 'en_cours' ? 'secondary' : 'destructive'}>{({ termine: 'terminé', en_cours: 'en cours', erreur: 'erreur', interrompu: 'interrompu' } as Record<string, string>)[h.statut] ?? h.statut}</Badge></td>
                      <td className="pr-3">{h.duree_s != null ? `${Math.round(h.duree_s)} s` : '—'}</td>
                      <td className="pr-3">{h.meilleur_modele ? MODEL_LABEL[h.meilleur_modele] ?? h.meilleur_modele : '—'}</td>
                      <td>{num(h.meilleur_f1, 3)}</td>
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
          <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" style={{ color: '#0891B2' }} />Rapport de recommandation pour l’opérateur</CardTitle>
          <Button size="sm" variant="outline" onClick={downloadReport} disabled={!report?.markdown}><Download className="w-4 h-4 mr-2" />Télécharger (.md)</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!report || !report.modele ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{report?.message ?? 'Rapport indisponible.'}</p> : (
            <>
              <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: 'rgba(8,145,178,0.05)' }}>
                <div className="font-bold">Modèle en service : {report.modele.nom} ({report.modele.type}){report.modele.point_fonctionnement ? `, seuil « ${report.modele.point_fonctionnement} »` : ''} · source : {report.source}</div>
                <div>{report.modele.lecture}</div>
                {report.modele.seuil && <div style={{ color: 'var(--text-secondary)' }}>{report.modele.seuil}</div>}
                {report.desequilibre && <div style={{ color: 'var(--text-secondary)' }}><b>Déséquilibre des classes.</b> {report.desequilibre}</div>}
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                {report.scenarios.map((s) => (
                  <div key={s.scenario} className="rounded-xl p-3 glass-border text-[11px] space-y-1" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{SCENARIO_LABEL[s.scenario] ?? s.scenario} <span className="opacity-60">· {s.capteur}</span></span>
                      <Badge variant={s.taux_detection != null && s.taux_detection >= 80 ? 'default' : s.taux_detection != null && s.taux_detection >= 40 ? 'secondary' : 'destructive'}>
                        {s.taux_detection == null ? 'n/a' : `${Math.round(s.taux_detection)} %`}
                      </Badge>
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>{s.description}</div>
                    <div><span className="font-bold">Niveau :</span> {s.niveau} · épisodes {s.episodes} · délai {delai(s.delai_median_min)}</div>
                    <div><span className="font-bold">Le modèle regarde :</span> {s.ce_que_le_modele_regarde.join(', ')}</div>
                    <div><span className="font-bold">Risque :</span> {s.risque}</div>
                    <ol className="list-decimal pl-4 space-y-0.5">{s.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
                  </div>
                ))}
              </div>
              {!!report.limites?.length && (
                <div className="text-[11px]">
                  <div className="font-bold mb-1">Limites connues</div>
                  <ul className="list-disc pl-4 space-y-0.5">{report.limites.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
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
