/** Entraînement (administrateur) — lance les 6 modèles supervisés sur la répétition 0, suit la progression
 *  en direct (WS /api/v1/transmission/train-ws) ; chaque entraînement est enregistré en base
 *  (transmission_runs, transmission_model_results, transmission_metrics, transmission_shap…). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2, Play } from 'lucide-react';
import { authHeaders } from '../../lib/auth';
import { toast } from '@/components/ui/use-toast';
import { Empty, MODEL_FR, Note, PageHeader, Section, State, Table, dateFr, minutes, nf, pct, tooltipStyle, useApi, usePalette } from '../../components/etude/kit';

interface Res { nom: string; recall: number; precision: number; f1: number; fausses_alarmes_evenements_par_heure: number;
  episodes: number; episodes_detectes: number; delai_median_min: number | null; val_recall?: number; val_precision?: number;
  val_fausses_alarmes_par_heure?: number; point_fonctionnement?: { seuil: number; k: number; n: number; contrainte_tenue: boolean } }
interface Msg { step: string; progress: number; message: string; model?: string; result?: Res; curve_point?: { arbres: number; ap_train: number; ap_validation: number } }
interface HistoryRun { id: number; debut: string; statut: string; lance_par: string | null; duree_s: number | null; meilleur_modele: string | null;
  modeles: { modele: string; recall: number | null; precision: number | null; fausses_alarmes_par_heure: number | null; meilleur: boolean }[] }
interface Settings { valeurs: { precision_min: number; fa_max: number } }

export default function EntrainementPage() {
  const pal = usePalette();
  const history = useApi<{ runs: HistoryRun[] }>('/api/v1/transmission/history?limit=10');
  const settings = useApi<Settings>('/api/v1/parametres');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Msg | null>(null);
  const [log, setLog] = useState<Msg[]>([]);
  const [results, setResults] = useState<Record<string, Res>>({});
  const [curve, setCurve] = useState<{ arbres: number; ap_train: number; ap_validation: number }[]>([]);
  const ws = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (ws.current) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/api/v1/transmission/train-ws`);
    ws.current = sock;
    sock.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as Msg;
      if (!msg.step) return;
      setProgress(msg);
      setLog(l => [...l.slice(-14), msg]);
      if (msg.curve_point) setCurve(c => (c.some(p => p.arbres === msg.curve_point!.arbres) ? c : [...c, msg.curve_point!]));
      if (msg.model && msg.result) setResults(r => ({ ...r, [msg.model!]: msg.result! }));
      if (msg.step === 'done' || msg.step === 'error') {
        setRunning(false);
        toast({ title: msg.step === 'done' ? 'Entraînement terminé' : 'Erreur', description: msg.message, variant: msg.step === 'done' ? undefined : 'destructive' });
        history.reload();
      }
    };
    sock.onclose = () => { ws.current = null; };
  }, [history]);
  useEffect(() => {
    fetch('/api/v1/transmission/training-status', { headers: authHeaders() }).then(r => r.ok ? r.json() : null).then(s => {
      if (s?.running) { setRunning(true); connect(); }
    }).catch(() => undefined);
    return () => ws.current?.close();
  }, [connect]);

  const start = async () => {
    setLog([]); setCurve([]); setResults({}); setProgress(null);
    connect();
    const r = await fetch('/api/v1/transmission/train', { method: 'POST', headers: authHeaders() });
    if (r.status === 409) { toast({ title: 'Déjà en cours', description: 'Un entraînement tourne déjà.' }); setRunning(true); return; }
    if (!r.ok) { toast({ title: 'Erreur', description: `HTTP ${r.status}`, variant: 'destructive' }); return; }
    setRunning(true);
  };

  const cfg = settings.data?.valeurs;
  return (
    <div className="space-y-6">
      <PageHeader title="Entraînement" subtitle="Réservé à l'administrateur : réentraîne les 6 modèles supervisés sur la répétition 0 et enregistre le résultat en base.">
        <button onClick={start} disabled={running} className="vc-btn vc-btn-primary">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} {running ? 'En cours…' : 'Lancer l’entraînement'}
        </button>
      </PageHeader>
      <div className="vc-fiche p-4 sm:p-5 text-[14.5px]" style={{ color: 'var(--text-secondary)' }}>
        Réglage d'alerte appliqué : rappel maximal sur la validation sous précision ≥ <strong>{cfg ? pct(cfg.precision_min, 0) : '—'}</strong> et
        au plus <strong>{cfg ? nf(cfg.fa_max, 2) : '—'}</strong> fausse alerte par heure (modifiable dans « Paramètres »). Une seule répétition :
        les chiffres de référence (20 répétitions) sont dans « Résultats ».
        {progress && (
          <div className="mt-3">
            <div className="vc-meter" style={{ height: 10 }} role="progressbar" aria-valuenow={progress.progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress.progress}%`, background: 'var(--accent-primary)', transition: 'width .3s' }} />
            </div>
            <div className="mt-1.5 text-[13px] tabular-nums" style={{ color: 'var(--text-muted)' }} aria-live="polite">{progress.progress} % : {progress.message}</div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Random Forest en direct" subtitle="AP d'entraînement et de validation à chaque palier de 30 arbres.">
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

      {Object.keys(results).length > 0 && (
        <Section title="Résultats de cet entraînement" subtitle="Test de la répétition 0, au réglage choisi sur sa validation.">
          <Table>
            <thead><tr><th>Modèle</th><th>Réglage</th><th className="vc-num">Épisodes</th><th className="vc-num">FA/h</th><th className="vc-num">Précision</th><th className="vc-num">Rappel</th><th className="vc-num">Délai</th></tr></thead>
            <tbody>
              {Object.entries(results).map(([k, r]) => (
                <tr key={k}><td>{MODEL_FR[k] ?? r.nom}</td><td className="text-[13px]">{r.point_fonctionnement ? `≥ ${nf(r.point_fonctionnement.seuil, 3)}, ${r.point_fonctionnement.k} sur ${r.point_fonctionnement.n}` : '—'}</td>
                  <td className="vc-num">{r.episodes_detectes}/{r.episodes}</td><td className="vc-num">{nf(r.fausses_alarmes_evenements_par_heure, 2)}</td>
                  <td className="vc-num">{pct(r.precision)}</td><td className="vc-num">{pct(r.recall)}</td><td className="vc-num">{minutes(r.delai_median_min)}</td></tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <Section title="Historique des entraînements" subtitle="Entraînements lancés depuis le dashboard." source="SELECT * FROM transmission_runs WHERE source = 'web' ORDER BY started_at DESC">
        {history.data?.runs.length ? (
          <Table>
            <thead><tr><th>#</th><th>Date</th><th>Statut</th><th>Lancé par</th><th className="vc-num">Durée</th><th>Meilleur</th><th className="vc-num">Précision</th><th className="vc-num">FA/h</th></tr></thead>
            <tbody>
              {history.data.runs.map(r => {
                const b = r.modeles.find(m => m.meilleur);
                return (
                  <tr key={r.id}><td>{r.id}</td><td className="whitespace-nowrap">{dateFr(r.debut)}</td><td>{r.statut === 'termine' ? <State kind="ok">terminé</State> : r.statut === 'erreur' ? <State kind="manque">erreur</State> : <State kind="neutre">{r.statut.replace('_', ' ')}</State>}</td><td>{r.lance_par ?? '—'}</td>
                    <td className="vc-num">{r.duree_s == null ? '—' : `${nf(r.duree_s / 60, 1)}\u00a0min`}</td><td>{r.meilleur_modele ? MODEL_FR[r.meilleur_modele] ?? r.meilleur_modele : '—'}</td>
                    <td className="vc-num">{pct(b?.precision)}</td><td className="vc-num">{nf(b?.fausses_alarmes_par_heure, 2)}</td></tr>
                );
              })}
            </tbody>
          </Table>
        ) : <Empty>Aucun entraînement web enregistré.</Empty>}
        <Note>Un entraînement prend quelques minutes (3 cœurs au plus, le serveur héberge d'autres sites).</Note>
      </Section>
    </div>
  );
}
