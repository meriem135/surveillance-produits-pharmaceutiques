/** Entraînement (administrateur) — réentraîne le modèle retenu par l'étude de référence (hyperparamètres,
 *  seuil et persistance lus en base) sur la répétition 0, suit la progression
 *  en interrogeant chaque seconde GET /api/v1/transmission/training-status ; chaque entraînement est enregistré en base
 *  (transmission_runs, transmission_model_results, transmission_metrics, transmission_shap…). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Crosshair, FileUp, Loader2, Play, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { authHeaders } from '../../lib/auth';
import { toast } from '@/components/ui/use-toast';
import { Empty, MODEL_FR, clearApiCache, Note, PageHeader, Section, State, Table, dateFr, minutes, nf, pct, tooltipStyle, useApi, usePalette } from '../../components/etude/kit';

interface Res { nom: string; recall: number; precision: number; f1: number; fausses_alarmes_evenements_par_heure: number;
  episodes: number; episodes_detectes: number; delai_median_min: number | null; val_recall?: number; val_precision?: number;
  val_fausses_alarmes_par_heure?: number; point_fonctionnement?: { seuil: number; k: number; n: number; contrainte_tenue: boolean | null };
  par_role?: { alarme: Record<'train' | 'val' | 'test', RoleM> } }
interface RoleM { recall: number; precision: number; f1: number; fausses_alarmes_evenements_par_heure: number; episodes: number; episodes_detectes: number; delai_median_min: number | null }
interface Msg { seq: number; step: string; progress: number; message: string; model?: string; result?: Res; run_id?: number; curve_point?: { arbres: number; ap_train: number; ap_validation: number } }
interface HistoryRun { id: number; debut: string; statut: string; lance_par: string | null; duree_s: number | null; meilleur_modele: string | null;
  jeu_de_donnees?: string | null; importe?: boolean;
  modeles: { modele: string; recall: number | null; precision: number | null; fausses_alarmes_par_heure: number | null;
    delai_median_min: number | null; meilleur: boolean }[] }
interface Settings { valeurs: { precision_min: number; fa_max: number } }
interface Imported { fichier: string; lignes: number; colonnes: number; attaques: number; episodes: number;
  episodes_par_role: Record<'train' | 'val' | 'test', number>; scenarios: string[]; debut: string; fin: string; importe_le: string }
const ROLES = [['train', 'Entraînement'], ['val', 'Validation'], ['test', 'Test']] as const;

export default function EntrainementPage() {
  const pal = usePalette();
  const history = useApi<{ runs: HistoryRun[] }>('/api/v1/transmission/history?limit=50');
  const settings = useApi<Settings>('/api/v1/parametres');
  const summary = useApi<{ modele_retenu?: { cle: string; nom: string; seuil: number; k: number; n: number } }>('/api/v1/transmission/training-target');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Msg | null>(null);
  const [log, setLog] = useState<Msg[]>([]);
  const [results, setResults] = useState<Record<string, Res>>({});
  const [curve, setCurve] = useState<{ arbres: number; ap_train: number; ap_validation: number }[]>([]);
  // Jeu de données importé (bouton « Importer un CSV ») et choix du jeu utilisé pour l'entraînement.
  const imported = useApi<{ importe: Imported | null }>('/api/v1/transmission/dataset');
  const [uploading, setUploading] = useState(false);
  const [useImport, setUseImport] = useState(true);
  const [savedRun, setSavedRun] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Progression : la page interroge l'API chaque seconde et reçoit les messages arrivés depuis le dernier lu.
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const reloadHistory = useRef(history.reload);
  useEffect(() => { reloadHistory.current = history.reload; }, [history.reload]);

  const handle = useCallback((msg: Msg) => {
    if (!msg.step) return;
    setProgress(msg);
    setLog(l => [...l.slice(-14), msg]);
    if (msg.curve_point) setCurve(c => (c.some(p => p.arbres === msg.curve_point!.arbres) ? c : [...c, msg.curve_point!]));
    if (msg.model && msg.result) setResults(r => ({ ...r, [msg.model!]: msg.result! }));
    if (msg.step === 'saved' && msg.run_id) { setSavedRun(msg.run_id); clearApiCache(); reloadHistory.current(); return; }
    if (msg.step === 'done' || msg.step === 'error') {
      toast({ title: msg.step === 'done' ? 'Entraînement terminé' : 'Erreur', description: msg.message, variant: msg.step === 'done' ? undefined : 'destructive' });
      clearApiCache();
      reloadHistory.current();
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (timer.current != null) { window.clearInterval(timer.current); timer.current = null; }
  }, []);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/transmission/training-status?depuis=${seq.current}`, { headers: authHeaders() });
      if (!r.ok) return;
      const s = await r.json() as { running: boolean; messages: Msg[]; seq: number };
      for (const m of s.messages) { if (m.seq > seq.current) { seq.current = m.seq; handle(m); } }
      if (!s.running) { setRunning(false); stopPolling(); }
    } catch { /* réseau indisponible : nouvel essai à la seconde suivante */ }
  }, [handle, stopPolling]);

  const startPolling = useCallback(() => {
    if (timer.current == null) timer.current = window.setInterval(poll, 1000);
  }, [poll]);

  useEffect(() => {
    // Page ouverte pendant un entraînement : on rejoue les messages déjà émis puis on suit la suite.
    fetch('/api/v1/transmission/training-status?depuis=0', { headers: authHeaders() }).then(r => r.ok ? r.json() : null).then(s => {
      if (s?.running) { seq.current = 0; setRunning(true); startPolling(); }
    }).catch(() => undefined);
    return stopPolling;
  }, [startPolling, stopPolling]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const r = await fetch('/api/v1/transmission/dataset', { method: 'POST', headers: authHeaders(), body });
      const json = await r.json().catch(() => ({})) as { importe?: Imported; detail?: string };
      if (!r.ok) { toast({ title: 'Fichier refusé', description: json.detail ?? `HTTP ${r.status}`, variant: 'destructive' }); return; }
      toast({ title: 'Jeu de données importé', description: `${json.importe?.fichier} : ${nf(json.importe?.lignes)} lignes, ${json.importe?.episodes} épisodes d'attaque.` });
      setUseImport(true);
      imported.reload();
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeImport = async () => {
    const r = await fetch('/api/v1/transmission/dataset', { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) { toast({ title: 'Erreur', description: `HTTP ${r.status}`, variant: 'destructive' }); return; }
    imported.reload();
  };

  const imp = imported.data?.importe ?? null;
  const trainOnImport = Boolean(imp && useImport);

  const start = async () => {
    setLog([]); setCurve([]); setResults({}); setProgress(null); setSavedRun(null);
    const r = await fetch(`/api/v1/transmission/train?dataset=${trainOnImport ? 'importe' : 'projet'}`, { method: 'POST', headers: authHeaders() });
    if (r.status === 409) { toast({ title: 'Déjà en cours', description: 'Un entraînement tourne déjà.' }); seq.current = 0; setRunning(true); startPolling(); return; }
    if (!r.ok) {
      const err = await r.json().catch(() => ({})) as { detail?: string };
      toast({ title: 'Erreur', description: err.detail ?? `HTTP ${r.status}`, variant: 'destructive' }); return;
    }
    const body = await r.json().catch(() => ({})) as { depuis?: number };
    seq.current = body.depuis ?? 0;
    setRunning(true);
    startPolling();
    document.getElementById('suivi-entrainement')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Supprime un entraînement de la base après confirmation
  const deleteRun = async (id: number) => {
    if (!window.confirm(`Supprimer l'entraînement n° ${id} ? Ses métriques en base seront effacées définitivement.`)) return;
    const r = await fetch(`/api/v1/transmission/history/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) {
      const err = await r.json().catch(() => ({})) as { detail?: string };
      toast({ title: 'Suppression impossible', description: err.detail ?? `HTTP ${r.status}`, variant: 'destructive' });
      return;
    }
    toast({ title: 'Entraînement supprimé', description: `L'entraînement n° ${id} a été supprimé de la base.` });
    clearApiCache();
    history.reload();
  };

  const cfg = settings.data?.valeurs;
  const target = summary.data?.modele_retenu;
  const [key, res] = Object.entries(results)[0] ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Entraînement" subtitle="Réservé à l'administrateur : importez votre jeu de données, réentraînez le modèle retenu par l'étude de référence avec son réglage, et retrouvez ses métriques réelles dans « Résultats ».">
        <button onClick={start} disabled={running} className="vc-btn vc-btn-primary">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} {running ? 'En cours…' : 'Lancer l’entraînement'}
        </button>
      </PageHeader>
      <Section title="Jeu de données d'entraînement" subtitle="Importez un CSV de la même forme que dataset_transmission_reel.csv (colonnes datetime, températures, label, attack_type, cible, garde…). Les features sont recalculées et les épisodes d'attaque retrouvés à partir des labels.">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" data-testid="input-dataset"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          <button onClick={() => fileInput.current?.click()} disabled={uploading || running} className="vc-btn">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} {uploading ? 'Import en cours…' : 'Importer un CSV'}
          </button>
          {imp && (
            <button onClick={removeImport} disabled={uploading || running} className="vc-btn" title="Revenir au jeu de données du projet">
              <Trash2 className="w-4 h-4" /> Retirer le fichier importé
            </button>
          )}
        </div>
        {imp ? (
          <div className="mt-4 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            <div>Fichier importé : <strong style={{ color: 'var(--text-primary)' }}>{imp.fichier}</strong>, {nf(imp.lignes)} lignes
              ({dateFr(imp.debut)} → {dateFr(imp.fin)}), {nf(imp.attaques)} mesures attaquées, {imp.episodes} épisodes
              (entraînement {imp.episodes_par_role.train} · validation {imp.episodes_par_role.val} · test {imp.episodes_par_role.test}).</div>
            <div className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>Scénarios : {imp.scenarios.join(', ')}</div>
            <div className="mt-3 flex flex-wrap gap-4 text-[14px]" role="radiogroup" aria-label="Jeu de données utilisé">
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={useImport} onChange={() => setUseImport(true)} disabled={running} /> Entraîner sur le fichier importé</label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={!useImport} onChange={() => setUseImport(false)} disabled={running} /> Entraîner sur le jeu du projet (dataset_transmission_reel.csv)</label>
            </div>
          </div>
        ) : (
          <Note>Aucun fichier importé : l'entraînement utilise le jeu de données du projet (data/processed/dataset_transmission_reel.csv).</Note>
        )}
      </Section>

      <div id="suivi-entrainement" className="vc-fiche p-4 sm:p-5 text-[14.5px]" style={{ color: 'var(--text-secondary)' }}>
        {(summary.loading && !summary.data) || target ? (
          <>Modèle entraîné : <strong style={{ color: 'var(--text-primary)' }}>{target?.nom ?? '…'}</strong>, le modèle retenu par l'étude de référence,
            avec ses hyperparamètres et son réglage d'alerte tels quels : score ≥ <strong>{target ? nf(target.seuil, 2) : '…'}</strong> sur au moins{' '}
            <strong>{target ? `${target.k} des ${target.n}` : '…'}</strong> dernières mesures. Aucun nouveau choix n'est fait sur cette répétition.</>
        ) : (
          <>Pas d'étude de référence en base : repli sur Extra Trees, réglage choisi sur la validation (précision ≥{' '}
            <strong>{cfg ? pct(cfg.precision_min, 0) : '—'}</strong>, au plus <strong>{cfg ? nf(cfg.fa_max, 2) : '—'}</strong> fausse alerte par heure).</>
        )}{' '}
        20 répétitions (les 20 rotations du découpage par blocs, comme l'étude de référence) : un entraînement dure environ 6 minutes. Courbe en direct, SHAP et alertes détaillées : répétition 0. La comparaison des 6 modèles est dans « Résultats ».
        {progress && (
          <div className="mt-3">
            <div className="vc-meter" style={{ height: 10 }} role="progressbar" aria-valuenow={progress.progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress.progress}%`, background: 'var(--accent-primary)', transition: 'width .3s' }} />
            </div>
            <div className="mt-1.5 text-[13px] tabular-nums" style={{ color: 'var(--text-muted)' }} aria-live="polite">{progress.progress} % : {progress.message}</div>
          </div>
        )}
        {savedRun && (
          <div className="mt-3">
            <Link to={`/dashboard/resultats?run=${savedRun}`} className="vc-btn vc-btn-primary inline-flex">
              <BarChart3 className="w-4 h-4" /> Voir les métriques dans « Résultats »
            </Link>
            <Link to="/dashboard/detection" className="vc-btn inline-flex ml-2">
              <Crosshair className="w-4 h-4" /> Voir les attaques et le score de risque
            </Link>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title={`${target?.nom ?? 'Modèle'} en direct`} subtitle="Précision moyenne (AP) d'entraînement et de validation à chaque palier d'arbres.">
          {curve.length ? (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curve} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke={pal.grid} vertical={false} />
                  <XAxis dataKey="arbres" tick={{ fill: pal.axis, fontSize: 12 }} />
                  <YAxis domain={[0.4, 1]} tick={{ fill: pal.axis, fontSize: 12 }} />
                  <Tooltip {...tooltipStyle} formatter={(v, n) => [nf(Number(v), 3), n]} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} />
                  <Line dataKey="ap_train" name="AP entraînement" stroke={pal.series[1]} strokeDasharray="5 4" strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="ap_validation" name="AP validation" stroke={pal.series[0]} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>La courbe se trace pendant l'entraînement.</Empty>}
        </Section>
        <Section title="Journal">
          {log.length ? (
            <ol className="text-[13px] max-h-[220px] overflow-y-auto" style={{ color: 'var(--text-secondary)' }}>
              {log.map((m, i) => <li key={i} className="flex gap-3 py-1 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}><span className="tabular-nums w-11 shrink-0 text-right" style={{ color: 'var(--text-muted)' }}>{m.progress} %</span><span>{m.message}</span></li>)}
            </ol>
          ) : <Empty>Aucun entraînement en cours. Cliquez sur « Lancer l’entraînement » pour suivre la progression ici.</Empty>}
        </Section>
      </div>

      {res && key && (
        <Section title={`Résultats de cet entraînement : ${MODEL_FR[key] ?? res.nom}`}
          subtitle={`Cumul des 20 répétitions, réglage « score ≥ ${nf(res.point_fonctionnement?.seuil, 2)}, ${res.point_fonctionnement?.k} sur ${res.point_fonctionnement?.n} mesures ». Test : ${res.episodes} épisodes en tout.`}>
          <Table min={640}>
            <thead><tr><th>Jeu</th><th className="vc-num">Précision</th><th className="vc-num">Fausses alertes/h</th><th className="vc-num">Rappel</th><th className="vc-num">Épisodes</th><th className="vc-num">Délai médian</th></tr></thead>
            <tbody data-testid="table-entrainement">
              {ROLES.map(([r, label]) => {
                const m = res.par_role?.alarme?.[r];
                return (
                  <tr key={r}><td className={r === 'test' ? 'font-semibold' : undefined}>{label}</td>
                    <td className="vc-num">{pct(m?.precision)}</td><td className="vc-num">{nf(m?.fausses_alarmes_evenements_par_heure, 2)}</td>
                    <td className="vc-num">{pct(m?.recall)}</td><td className="vc-num">{m ? `${m.episodes_detectes}/${m.episodes}` : '—'}</td>
                    <td className="vc-num">{minutes(m?.delai_median_min)}</td></tr>
                );
              })}
            </tbody>
          </Table>
        </Section>
      )}

      <Section title="Archive des modèles"
        subtitle="Chaque entraînement lancé depuis le dashboard et ses métriques sur le test. Vous pouvez en supprimer un de la base."
        source="SELECT * FROM transmission_runs r JOIN transmission_model_results m ON m.run_id = r.id WHERE r.source = 'web' ORDER BY r.started_at DESC"
        action={
          <button onClick={start} disabled={running} className="vc-btn vc-btn-primary">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} {running ? 'En cours…' : 'Nouvel entraînement'}
          </button>
        }>
        {history.data?.runs.length ? (
          <Table min={980}>
            <thead><tr><th>#</th><th>Date</th><th>Statut</th><th className="vc-num">Durée</th><th>Jeu de données</th><th>Modèle</th>
              <th className="vc-num">Précision</th><th className="vc-num">Rappel</th><th className="vc-num">FA/h</th><th className="vc-num">Délai</th><th>Actions</th></tr></thead>
            <tbody data-testid="table-archive">
              {(() => {
                const dernier = history.data.runs.find(x => x.statut === 'termine')?.id;
                return history.data.runs.map(r => {
                  const b = r.modeles.find(m => m.meilleur);
                  return (
                    <tr key={r.id}>
                      <td className="font-semibold">{r.id}{r.id === dernier && <span className="ml-1.5 text-[11.5px] font-semibold" style={{ color: 'var(--accent-primary)' }}>dernier</span>}</td>
                      <td className="whitespace-nowrap">{dateFr(r.debut)}<div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{r.lance_par ?? '—'}</div></td>
                      <td>{r.statut === 'termine' ? <State kind="ok">terminé</State> : r.statut === 'erreur' ? <State kind="manque">erreur</State> : <State kind="neutre">{r.statut.replace('_', ' ')}</State>}</td>
                      <td className="vc-num">{r.duree_s == null ? '—' : `${nf(r.duree_s / 60, 1)}\u00a0min`}</td>
                      <td className="text-[13px]">{r.jeu_de_donnees ?? '—'}{r.importe ? ' (importé)' : ''}</td>
                      <td>{r.meilleur_modele ? MODEL_FR[r.meilleur_modele] ?? r.meilleur_modele : '—'}</td>
                      <td className="vc-num">{pct(b?.precision)}</td><td className="vc-num">{pct(b?.recall)}</td>
                      <td className="vc-num">{nf(b?.fausses_alarmes_par_heure, 2)}</td><td className="vc-num">{minutes(b?.delai_median_min)}</td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          {r.statut === 'termine' && <Link to={`/dashboard/resultats?run=${r.id}`} className="underline text-[13px]" style={{ color: 'var(--accent-primary)' }}>Résultats</Link>}
                          <button onClick={() => deleteRun(r.id)} disabled={running} data-testid={`delete-run-${r.id}`}
                            className="inline-flex items-center gap-1 text-[13px] underline disabled:opacity-50" style={{ color: 'var(--danger, #c0392b)' }}
                            title="Supprimer cet entraînement de la base"><Trash2 className="w-3.5 h-3.5" />Supprimer</button>
                        </div>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </Table>
        ) : history.loading ? <div className="h-[220px] animate-pulse rounded-[12px]" style={{ background: 'var(--bg-subtle)' }} aria-busy="true" />
          : <Empty>Aucun entraînement web enregistré. Cliquez sur « Nouvel entraînement » pour en lancer un.</Empty>}
        <Note>Les métriques de tous les entraînements restent en base jusqu'à leur suppression. Un entraînement du seul modèle retenu prend environ 3 minutes.</Note>
      </Section>
    </div>
  );
}
