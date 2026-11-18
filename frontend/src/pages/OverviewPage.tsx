/**
 * Vue d'ensemble — chaque chiffre de cette page vient de GET /api/v1/overview, qui ne lit que
 * la base de données (transmission_runs, transmission_model_results, users, audit_logs).
 * Aucun chiffre écrit en dur.
 */
import { useEffect, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import {
  Empty, Loading, Meter, Readouts, SCENARIO_FR, Section, Stat, Table, Tally, nf, pct, useApi, usePalette,
} from '../components/etude/kit';

// ─── Types de la réponse ─────────────────────────────────────────────────────
interface ModelRow {
  modele: string; nom: string; type: string; meilleur: boolean;
  recall: number | null; precision: number | null; f1: number | null; f2: number | null;
  roc_auc: number | null; avg_precision: number | null; fpr: number | null;
  fausses_alarmes_par_heure: number | null; delai_median_min: number | null;
  episodes: number | null; episodes_detectes: number | null; seuil: number | null;
  val_f1: number | null; val_recall: number | null; val_precision: number | null; val_fausses_alarmes_par_heure: number | null;
}
interface Point { cle: string; libelle: string; seuil: number | null; recall: number | null; precision: number | null;
  f1: number | null; f2: number | null; fausses_alarmes_par_heure: number | null; delai_median_min: number | null }
interface Scenario { scenario: string; lignes: number; detectees: number; taux: number | null; episodes: number;
  episodes_detectes: number; delai_median_min: number | null }
interface Split { lignes: number; attaques: number; part: number }
interface LastRun {
  id: number; debut: string; fin: string | null; duree_s: number | null; lance_par: string | null;
  meilleur_modele: string | null; meilleur_f1: number | null; classement_validation: string[]; cible_rappel?: number | null;
  source?: string; repetitions?: number; critere?: string | null;
  modeles: ModelRow[]; points_meilleur: Point[]; par_scenario: Scenario[];
  donnees: { fichier: string | null; lignes: number; features: number; episodes: number; scenarios: number;
    train: number | null; val: number | null; test: number | null; attaques_train: number | null; attaques_val: number | null;
    attaques_test: number | null; prevalence: Record<string, Split> | null };
}
interface HistoryRow { id: number; date: string; duree_s: number | null; meilleur_modele: string | null; f1: number | null;
  recall: number | null; precision: number | null; fausses_alarmes_par_heure: number | null; delai_median_min: number | null;
  lignes: number; candidats: string[]; episodes?: number | null; episodes_detectes?: number | null; repetitions?: number; mode?: string }
interface Overview {
  entrainements: { total: number; par_statut: Record<string, number>; premier: string | null; dernier: string | null;
    dernier_lancement: null | { id: number; debut: string; fin: string | null; statut: string; lance_par: string | null; duree_s: number | null; erreur: string | null } };
  dernier_entrainement: LastRun | null;
  historique: HistoryRow[];
  comptes: { total: number; actifs: number; par_role: Record<string, number> };
  audit: { actions: number; derniere: string | null };
  sources: Record<string, string>;
}

interface DatasetKpi {
  run: { zone_de_garde_min: number | null };
  total: { lignes: number; debut: string; fin: string; heures: number; attaques: number; exclues_zone_de_garde: number;
    episodes_rep0: number; episodes_toutes_repetitions: number; repetitions: number };
}
const dateCourte = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ─── Formatage (français) ────────────────────────────────────────────────────
const virg = (s: string) => s.replace(/(\d)\.(\d)/g, '$1,$2');

// ─── Page ────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const pal = usePalette();
  const { data, error, loading, reload: load } = useApi<Overview>('/api/v1/overview');
  const { data: jeu } = useApi<DatasetKpi>('/api/v1/etude/dataset');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  useEffect(() => { if (data) setLoadedAt(new Date()); }, [data]);

  if (!data) {
    return (
      <div className="space-y-5">
        <Header loading={loading} loadedAt={loadedAt} onRefresh={load} />
        {error ? <Empty>Lecture de la vue d’ensemble impossible ({error}). Vérifiez que l’API répond, puis cliquez sur « Actualiser ».</Empty> : <Loading />}
      </div>
    );
  }

  const run = data.dernier_entrainement;
  const best = run?.modeles.find(m => m.meilleur) ?? null;
  const scen = run?.par_scenario.filter(s => s.lignes > 0) ?? [];
  const absents = run?.par_scenario.filter(s => s.lignes === 0) ?? [];

  return (
    <div className="space-y-6">
      <Header loading={loading} loadedAt={loadedAt} onRefresh={load} />
      {error && <Empty>Dernière actualisation impossible ({error}) ; les chiffres affichés sont ceux du chargement précédent.</Empty>}

      {/* ── KPI du jeu de données (GET /api/v1/etude/dataset) ── */}
      {jeu && (
        <Readouts cols={5}>
          <Stat label="Mesures au pas de 5 s" value={nf(jeu.total.lignes)} sub={`Du ${dateCourte(jeu.total.debut)} au ${dateCourte(jeu.total.fin)}`} />
          <Stat label="Durée couverte" value={nf(jeu.total.heures, 1)} unit="h" sub="3 capteurs alignés sur une grille commune" />
          <Stat label="Mesures falsifiées" value={nf(jeu.total.attaques)} tone="var(--accent-danger)" sub={`${pct(jeu.total.attaques / jeu.total.lignes)} des mesures`} />
          <Stat label="Épisodes d’attaque" value={nf(jeu.total.episodes_rep0)} sub={`${nf(jeu.total.episodes_toutes_repetitions)} sur les ${jeu.total.repetitions} répétitions`} />
          <Stat label="Zone de garde (exclue)" value={nf(jeu.total.exclues_zone_de_garde)}
            sub={`${nf(jeu.run.zone_de_garde_min ?? 0)} min après chaque épisode et en début de bloc qui change de rôle`} />
        </Readouts>
      )}

      {/* ── Détection par scénario : registre par type d'attaque ────────── */}
      <Section title={best ? `Détection par scénario, ${best.nom}` : 'Détection par scénario'}
        subtitle="Évaluation par scénario d’attaque injecté (le modèle répond seulement « attaque » ou « normal » : il ne reconnaît pas le type). Chaque ligne : les épisodes de ce scénario dans le test, le délai médian et la part des mesures falsifiées signalées."
        source="transmission_model_results.per_attack, per_episode (meilleur modèle)" flush>
        {scen.length ? (
          <div data-testid="table-scenarios">
            <Table min={640}>
              <thead><tr><th className="sm:pl-5">Scénario</th><th>Épisodes</th><th className="vc-num">Délai médian</th><th className="sm:pr-5" style={{ width: '26%' }}>Mesures signalées</th></tr></thead>
              <tbody>
                {scen.map(r => (
                  <tr key={r.scenario}>
                    <td className="sm:pl-5 font-semibold">{SCENARIO_FR[r.scenario] ?? r.scenario}</td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Tally detected={r.episodes_detectes} total={r.episodes} label={`${r.episodes_detectes} sur ${r.episodes} épisodes détectés`} />
                        <span className="tabular-nums text-[13px]" style={{ color: r.episodes_detectes < r.episodes ? 'var(--accent-danger)' : 'var(--text-secondary)' }}>
                          {r.episodes_detectes}/{r.episodes}
                        </span>
                      </div>
                    </td>
                    <td className="vc-num">{r.delai_median_min == null ? 'non détecté' : `${nf(r.delai_median_min, 1)}\u00a0min`}</td>
                    <td className="sm:pr-5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex-1"><Meter value={r.taux} color={pal.series[1]} /></span>
                        <span className="tabular-nums w-14 text-right">{nf(r.taux, 1)}&#8239;%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {absents.length > 0 && (
              <p className="px-4 sm:px-5 py-3 text-[13px]" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                Absents du bloc de test (non mesurés ici) : {absents.map(r => SCENARIO_FR[r.scenario] ?? r.scenario).join(', ')}.
              </p>
            )}
          </div>
        ) : <div className="p-5"><Empty>Pas de détail par scénario en base.</Empty></div>}
      </Section>

      {/* ── Provenance ─────────────────────────────────────────────────── */}
      <details className="vc-panel px-5 py-3 text-sm">
        <summary className="cursor-pointer font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Database className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> Provenance des chiffres (requêtes SQL)
        </summary>
        <dl className="mt-3 space-y-2">
          {Object.entries(data.sources).map(([k, q]) => (
            <div key={k} className="grid sm:grid-cols-[180px_1fr] gap-1">
              <dt className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{k.replace(/_/g, ' ')}</dt>
              <dd className="text-[12.5px] break-words" style={{ color: 'var(--text-muted)' }}><code>{virg(q)}</code></dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function Header({ loading, loadedAt, onRefresh }: { loading: boolean; loadedAt: Date | null; onRefresh: () => void }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[30px] sm:text-[34px] leading-[1.05]" style={{ color: 'var(--text-primary)' }}>Vue d’ensemble</h1>
        <p className="text-[15px] mt-2 max-w-[68ch] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Le détecteur d’attaques en service sur les capteurs de la chaîne du froid et ses résultats sur des heures
          jamais vues, relus dans PostgreSQL à chaque ouverture.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {loadedAt && <span className="text-[13px] tabular-nums" style={{ color: 'var(--text-muted)' }}>Lu à {loadedAt.toLocaleTimeString('fr-FR')}</span>}
        <button onClick={onRefresh} disabled={loading} className="vc-btn">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>
    </header>
  );
}
