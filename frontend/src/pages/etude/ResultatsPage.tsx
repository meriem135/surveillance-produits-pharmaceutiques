/** Résultats et métriques — transmission_metrics, transmission_model_results, transmission_learning_curve
 *  (GET /api/v1/etude/metrics). Le modèle est choisi sur la validation ; le test ne fait que confirmer. */
import { useSearchParams } from 'react-router-dom';
import {
  Empty, Loading, MODEL_FR, Note, PageHeader, Readouts, State, ROLE_FR, SCENARIO_FR, Section, Stat, Table, minutes, nf, pct,
  useApi,
} from '../../components/etude/kit';

export interface Metric {
  seuil: number | null; k: number | null; n: number | null; recall: number | null; precision: number | null; f1: number | null;
  roc_auc: number | null; avg_precision: number | null; tp: number | null; fp: number | null; fn: number | null; tn: number | null;
  fausses_alertes_par_heure: number | null; alertes: number | null; fausses_alertes: number | null; episodes: number | null;
  episodes_detectes: number | null; delai_median_min: number | null; delai_p90_min: number | null; part_attaques: number | null;
  per_attack: Record<string, { n: number; detected: number; rate: number }>;
  per_episode: Record<string, { n: number; detected: number; delai_median_min: number | null }>;
}
type ByRole = Partial<Record<'train' | 'val' | 'test', Metric>>;
interface ModelBlock {
  modele: string; nom?: string; meilleur?: boolean; hyperparametres?: Record<string, unknown>;
  point_fonctionnement?: { seuil: number; k: number; n: number; persistance_min: number; contrainte_tenue: boolean; critere: string };
  diagnostic?: { verdict: string; ecart_ap_train_val: number | null; ecart_ap_val_test: number | null };
  duree_entrainement_s?: number; alarme: ByRole; ligne: ByRole;
}
interface CvStat { mean: number; std: number }
interface MetricsResp {
  run: { id: number; source: string; date: string; critere: string | null; repetitions: number; zone_de_garde_min: number | null;
    meilleur_modele: string | null; lignes?: number | null };
  modeles: Record<string, ModelBlock>; classement_validation: string[];
  courbe_apprentissage: { modele: string | null; points: { part_train: number; lignes_train: number; ap_train: number; ap_val: number; f1_train: number | null; f1_val: number | null }[] };
  validation_croisee: null | { lignes: number; blocs: number; folds: number;
    methodes: Record<string, { description: string; blocs_partages: number; modeles: Record<string, Record<string, CvStat>> }> };
  sources: Record<string, string>;
}

interface RunItem { id: number; source: string; date: string; meilleur_modele: string | null; lance_par: string | null;
  jeu_de_donnees: string | null; importe: boolean }

interface EpisodeRow { repetition?: number; scenario: string; debut: string; duree_min: number; detecte: boolean | null; delai_min: number | null }
interface EpisodesResp { role: string; episodes: EpisodeRow[]; episodes_toutes?: (EpisodeRow & { repetition: number })[]; sources: Record<string, string> }

export default function ResultatsPage() {
  const ep = useApi<EpisodesResp>('/api/v1/etude/timeline?role=test&minutes=1');
  // Entraînement affiché : ?run=<id> dans l'adresse, sinon le plus récent terminé (dernier entraînement lancé).
  const [params] = useSearchParams();
  const runs = useApi<{ runs: RunItem[]; defaut: number | null }>('/api/v1/etude/runs');
  const asked = Number(params.get('run')) || null;
  const runId = asked ?? runs.data?.runs[0]?.id ?? null;
  const { data, error, loading, reload } = useApi<MetricsResp>(runId ? `/api/v1/etude/metrics?run_id=${runId}` : '/api/v1/etude/metrics');
  const header = (
    <>
      <PageHeader title="Résultats et métriques" loading={loading} onRefresh={() => { runs.reload(); reload(); }}
        subtitle="Un seul réglage d'alerte par modèle, choisi sur la validation ; les chiffres du test confirment le choix sans y avoir servi." />
    </>
  );
  if (!data) return <div className="space-y-5">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  const ranking = data.classement_validation.filter(k => data.modeles[k]);
  const bestKey = ranking[0];
  const best = data.modeles[bestKey];
  const bt = best?.alarme.test;
  const op = best?.point_fonctionnement;
  const reps = data.run.repetitions;

  return (
    <div className="space-y-6">
      {header}
      {best && bt && op && (
        <section className="vc-fiche overflow-hidden">
          <div className="p-5 sm:p-6">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--accent-primary)' }}>Meilleur modèle, choisi sur la validation</div>
            <h2 className="mt-1 text-[36px] leading-none" style={{ color: 'var(--text-primary)' }}>{MODEL_FR[bestKey] ?? bestKey}</h2>
            <p className="mt-3 text-[15px] max-w-[70ch]" style={{ color: 'var(--text-secondary)' }}>
              Alerte quand au moins <strong style={{ color: 'var(--text-primary)' }}>{op.k} mesures sur les {op.n}</strong> dernières
              ({nf(op.persistance_min, 1)} min) ont un score ≥ <strong style={{ color: 'var(--text-primary)' }}>{nf(op.seuil, 3)}</strong>.
              Critère : {op.critere.replace(/(\d)\.(\d)/g, '$1,$2')}. Cumul de {reps} répétition{reps > 1 ? 's' : ''} ; le test n’a jamais servi à choisir.
            </p>
          </div>
          <div className="border-t" style={{ borderColor: 'var(--border)' }}>
            <Readouts cols={5} className="!border-0 !rounded-none">
              <Stat label="Épisodes détectés (test)" value={`${bt.episodes_detectes}/${bt.episodes}`} tone="var(--accent-primary)" sub={pct((bt.episodes_detectes ?? 0) / Math.max(1, bt.episodes ?? 1))} />
              <Stat label="Fausses alertes par heure" value={nf(bt.fausses_alertes_par_heure, 2)} tone="var(--alarm-amber-fill)" sub={`${nf(bt.fausses_alertes)} fausses sur ${nf(bt.alertes)} alertes`} />
              <Stat label="Précision (mesures)" value={pct(bt.precision)} sub="Mesures signalées vraiment falsifiées" />
              <Stat label="Rappel (mesures)" value={pct(bt.recall)} sub="Mesures falsifiées signalées" />
              <Stat label="Délai médian" value={nf(bt.delai_median_min, 1)} unit="min" sub={`90 % des épisodes en moins de ${minutes(bt.delai_p90_min)}`} />
            </Readouts>
          </div>
        </section>
      )}

      {best && bt && (
        <div>
          <Section title={`Par scénario, ${MODEL_FR[bestKey]} sur le test`} subtitle="Évaluation par scénario injecté : le modèle répond seulement « attaque » ou « normal », il ne reconnaît pas le type. Épisodes détectés, délai médian et part des mesures falsifiées signalées." source={data.sources.modeles}>
            <Table>
              <thead><tr><th>Scénario</th><th className="vc-num">Épisodes</th><th className="vc-num">Délai</th><th className="vc-num">Mesures signalées</th></tr></thead>
              <tbody>
                {Object.entries(bt.per_episode).map(([s, e]) => (
                  <tr key={s}><td>{SCENARIO_FR[s] ?? s}</td><td className="vc-num" style={e.detected < e.n ? { color: 'var(--accent-danger)' } : undefined}>{e.detected}/{e.n}</td>
                    <td className="vc-num">{minutes(e.delai_median_min)}</td><td className="vc-num">{nf(bt.per_attack[s]?.rate, 1)}&#8239;%</td></tr>
                ))}
              </tbody>
            </Table>
          </Section>
        </div>
      )}

      {ep.data && (() => {
        const d = ep.data;
        const toutes = d.episodes_toutes?.length ? d.episodes_toutes : d.episodes.map(e => ({ ...e, repetition: 0 }));
        return (
          <Section title="Épisodes réels et détection" subtitle={toutes.length > d.episodes.length
            ? `${toutes.length} épisodes en ${ROLE_FR[d.role].toLowerCase()}, toutes répétitions confondues (${new Set(toutes.map(e => e.repetition)).size} répétitions).`
            : `${d.episodes.length} épisodes en ${ROLE_FR[d.role].toLowerCase()} (répétition 0).`} source={d.sources.episodes} flush>
            <Table>
              <thead><tr><th className="sm:pl-5">Rép.</th><th>Début</th><th>Scénario</th><th className="vc-num">Durée</th><th>Détection</th><th className="vc-num sm:pr-5">Délai</th></tr></thead>
              <tbody>
                {toutes.map(e => (
                  <tr key={`${e.repetition}-${e.debut}`}><td className="sm:pl-5 tabular-nums">{e.repetition}</td><td className="whitespace-nowrap tabular-nums">{new Date(e.debut).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{SCENARIO_FR[e.scenario] ?? e.scenario}</td><td className="vc-num">{minutes(e.duree_min)}</td>
                    <td>{e.detecte ? <State kind="ok">détecté</State> : <State kind="manque">manqué</State>}</td>
                    <td className="vc-num sm:pr-5">{minutes(e.delai_min)}</td></tr>
                ))}
              </tbody>
            </Table>
          </Section>
        );
      })()}

      {data.validation_croisee && (
        <Section title="Validation croisée : naïve contre groupée par bloc" subtitle={`Lignes d'entraînement de la répétition 0 (${nf(data.validation_croisee.lignes)} lignes, ${data.validation_croisee.blocs} blocs), seuil 0,5.`} source={data.sources.validation_croisee}>
          <Table>
            <thead><tr><th>Modèle</th><th className="vc-num">AP naïve</th><th className="vc-num">AP groupée</th><th className="vc-num">Rappel naïf</th><th className="vc-num">Rappel groupé</th></tr></thead>
            <tbody>
              {Object.keys(data.validation_croisee.methodes.groupes_blocs?.modeles ?? {}).map(k => {
                const nv = data.validation_croisee!.methodes.naif?.modeles[k];
                const gr = data.validation_croisee!.methodes.groupes_blocs.modeles[k];
                return (
                  <tr key={k}><td>{MODEL_FR[k] ?? k}</td><td className="vc-num">{nf(nv?.average_precision.mean, 3)}</td>
                    <td className="vc-num">{nf(gr.average_precision.mean, 3)} ± {nf(gr.average_precision.std, 3)}</td>
                    <td className="vc-num">{nf(nv?.recall.mean, 3)}</td><td className="vc-num">{nf(gr.recall.mean, 3)}</td></tr>
                );
              })}
            </tbody>
          </Table>
          <Note>Mélanger les lignes (naïf) place une même attaque et ses fenêtres glissantes des deux côtés : le score est trop optimiste.
            Grouper par bloc d'une heure retire cette fuite ({data.validation_croisee.methodes.groupes_blocs?.blocs_partages ?? 0} bloc partagé).</Note>
        </Section>
      )}
    </div>
  );
}
