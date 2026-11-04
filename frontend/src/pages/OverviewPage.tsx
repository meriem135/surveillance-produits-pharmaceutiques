/**
 * Vue d'ensemble — chaque chiffre de cette page vient de GET /api/v1/overview, qui ne lit que
 * la base de données (transmission_runs, transmission_model_results, devices, telemetry,
 * ml_models, model_metrics, users, audit_logs). Aucun chiffre écrit en dur.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { authHeaders } from '../lib/auth';
import {
  Empty, Loading, MODEL_FR, Meter, Readouts, SCENARIO_FR, Section, State, Stat, Table, Tally, TallyLegend, nf, pct, tooltipStyle, usePalette,
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
  lignes: number; candidats: string[] }
interface Overview {
  entrainements: { total: number; par_statut: Record<string, number>; premier: string | null; dernier: string | null;
    dernier_lancement: null | { id: number; debut: string; fin: string | null; statut: string; lance_par: string | null; duree_s: number | null; erreur: string | null } };
  dernier_entrainement: LastRun | null;
  historique: HistoryRow[];
  capteurs: { total: number; en_ligne: number; par_type: Record<string, number>;
    liste: { id: string; nom: string; type: string; statut: string; emplacement: string; vu_le: string | null }[] };
  telemetrie: { mesures: number; appareils: number; debut: string | null; fin: string | null };
  modeles_phase2: { modeles: number; dernier_entrainement: string | null; metriques_par_attaque: number };
  comptes: { total: number; actifs: number; par_role: Record<string, number> };
  audit: { actions: number; derniere: string | null };
  sources: Record<string, string>;
}

// ─── Formatage (français) ────────────────────────────────────────────────────
const dateFr = (iso: string | null | undefined, withTime = true) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
const duree = (s: number | null | undefined) => {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s` : `${Math.round(s)} s`;
};
const virg = (s: string) => s.replace(/(\d)\.(\d)/g, '$1,$2');
const sansPoint = (s: string) => s.replace(/ · /g, ', ');
const STATUT: Record<string, { label: string; color: string }> = {
  termine: { label: 'Terminé', color: 'var(--accent-primary)' },
  erreur: { label: 'Erreur', color: 'var(--accent-danger)' },
  interrompu: { label: 'Interrompu', color: 'var(--accent-warning)' },
  en_cours: { label: 'En cours', color: 'var(--accent-primary)' },
};
const DEVICE_FR: Record<string, string> = { fridge: 'Chambre froide', thermostat: 'Thermostat', weather: 'Météo', gateway: 'Passerelle' };
const ROLE_FR: Record<string, string> = { admin: 'administrateur', operator: 'opérateur' };
const pluriel = (n: number, mot: string) => `${nf(n)} ${mot}${n > 1 ? 's' : ''}`;

// ─── Page ────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const pal = usePalette();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/v1/overview', { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
      setLoadedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

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
  const e = data.entrainements;
  const histo = data.historique.map(h => ({
    ...h,
    label: `n° ${h.id}, ${new Date(h.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`,
    F1: h.f1, Rappel: h.recall, 'Précision': h.precision,
  }));
  const testSplit = run?.donnees.prevalence?.test;
  const scen = run?.par_scenario.filter(s => s.lignes > 0) ?? [];
  const absents = run?.par_scenario.filter(s => s.lignes === 0) ?? [];

  return (
    <div className="space-y-6">
      <Header loading={loading} loadedAt={loadedAt} onRefresh={load} />
      {error && <Empty>Dernière actualisation impossible ({error}) ; les chiffres affichés sont ceux du chargement précédent.</Empty>}

      {/* ── Fiche : le détecteur en service et son registre d'épisodes ── */}
      {run && best ? (
        <section className="vc-fiche overflow-hidden" aria-labelledby="fiche-titre">
          <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="p-5 sm:p-6 lg:border-r" style={{ borderColor: 'var(--border)' }}>
              <div className="text-[13px] font-semibold" style={{ color: 'var(--accent-primary)' }}>Détecteur en service</div>
              <h2 id="fiche-titre" className="mt-1 text-[40px] leading-none" style={{ color: 'var(--text-primary)' }}>{best.nom}</h2>
              <p className="mt-3 text-[14.5px] leading-relaxed max-w-[52ch]" style={{ color: 'var(--text-secondary)' }}>
                Retenu sur la validation parmi {run.modeles.length} modèles. Une alerte part quand le score dépasse{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{nf(best.seuil, 2)}</strong> de façon persistante
                (règle k sur n choisie sur la validation).
              </p>
              <dl className="mt-4 text-[13px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" style={{ color: 'var(--text-secondary)' }}>
                <dt style={{ color: 'var(--text-muted)' }}>Classement</dt>
                <dd>{run.classement_validation.map(k => MODEL_FR[k] ?? k).join(', ') || '—'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Mesuré sur</dt>
                <dd>{testSplit ? `${nf(testSplit.lignes)} lignes de test, dont ${pct(testSplit.part)} attaquées` : 'jeu de test'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Calculé le</dt>
                <dd>{dateFr(run.debut)} en {duree(run.duree_s)}{run.source === 'reference' ? `, ${run.repetitions ?? 20} répétitions` : `, entraînement n° ${run.id}`}</dd>
              </dl>
            </div>
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Registre des épisodes d’attaque du test</div>
                <TallyLegend />
              </div>
              <div className="mt-2 flex items-baseline gap-2" style={{ color: 'var(--text-primary)' }}>
                <span className="vc-readout-value" style={{ fontSize: 52 }}>{nf(best.episodes_detectes)}</span>
                <span className="text-[17px]" style={{ fontFamily: 'var(--display)', color: 'var(--text-secondary)' }}>
                  détectés sur {nf(best.episodes)} épisodes
                </span>
              </div>
              <div className="mt-3"><Tally detected={best.episodes_detectes ?? 0} total={best.episodes ?? 0} animate /></div>
              <p className="mt-3 text-[13px] leading-relaxed max-w-[64ch]" style={{ color: 'var(--text-muted)' }}>
                Un repère par attaque injectée dans des heures jamais vues à l’entraînement. Un épisode compte comme détecté si
                au moins une alerte tombe pendant l’attaque.
              </p>
            </div>
          </div>
          <div className="border-t" style={{ borderColor: 'var(--border)' }}>
            <Readouts className="!border-0 !rounded-none" cols={4}>
              <Stat label="Précision des alertes" value={pct(best.precision)} tone="var(--accent-primary)"
                sub={`Mesures signalées vraiment falsifiées ; validation ${pct(best.val_precision)}`} />
              <Stat label="Fausses alertes par heure" value={nf(best.fausses_alarmes_par_heure, 2)} tone="var(--alarm-amber-fill)"
                sub={`Alertes sans attaque, par heure normale ; validation ${nf(best.val_fausses_alarmes_par_heure, 2)}`} />
              <Stat label="Délai médian de détection" value={nf(best.delai_median_min, 1)} unit="min"
                sub="Entre le début de l’attaque et la première alerte" />
              <Stat label="Rappel (mesures)" value={pct(best.recall)}
                sub={`Mesures falsifiées signalées ; validation ${pct(best.val_recall)}`} />
            </Readouts>
          </div>
        </section>
      ) : (
        <Empty>
          Aucun entraînement terminé n’est enregistré dans <code>transmission_runs</code>.{' '}
          <Link to="/dashboard/entrainement" style={{ color: 'var(--accent-primary)' }}>Lancer un entraînement (administrateur)</Link>.
        </Empty>
      )}

      {/* ── Détection par scénario : registre par type d'attaque ────────── */}
      <Section title={best ? `Détection par scénario, ${best.nom}` : 'Détection par scénario'}
        subtitle="Chaque ligne : les épisodes de ce scénario dans le test, le délai médian et la part des mesures falsifiées signalées."
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

      {/* ── Comparaison des modèles ─────────────────────────────────────── */}
      <Section title={run?.source === 'reference' ? 'Modèles de l’étude de référence' : 'Modèles du dernier entraînement'}
        subtitle="Jeu de test, au réglage d’alerte choisi sur la validation. Le classement se fait sur la validation, jamais sur le test."
        source="transmission_model_results (étude affichée) et transmission_runs.result_json pour la validation" flush>
        {run && run.modeles.length ? (
          <Table min={780}>
            <thead>
              <tr>
                <th className="sm:pl-5">Modèle</th><th className="vc-num">Précision</th><th className="vc-num">Fausses alertes/h</th>
                <th className="vc-num">Épisodes</th><th className="vc-num">Délai médian</th><th className="vc-num">Rappel</th>
                <th className="vc-num">F1</th><th className="vc-num sm:pr-5">Rappel validation</th>
              </tr>
            </thead>
            <tbody data-testid="table-modeles">
              {run.modeles.map(m => (
                <tr key={m.modele} style={m.meilleur ? { background: 'var(--accent-glow)' } : undefined}>
                  <td className="sm:pl-5">
                    <span className="font-semibold">{m.nom}</span>
                    {m.meilleur && <span className="ml-2"><State kind="ok">retenu</State></span>}
                  </td>
                  <td className="vc-num">{pct(m.precision)}</td>
                  <td className="vc-num">{nf(m.fausses_alarmes_par_heure, 2)}</td>
                  <td className="vc-num">{nf(m.episodes_detectes)}/{nf(m.episodes)}</td>
                  <td className="vc-num">{m.delai_median_min == null ? '—' : `${nf(m.delai_median_min, 1)}\u00a0min`}</td>
                  <td className="vc-num">{pct(m.recall)}</td>
                  <td className="vc-num">{nf(m.f1, 3)}</td>
                  <td className="vc-num sm:pr-5">{pct(m.val_recall)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <div className="p-5"><Empty>Aucun résultat de modèle en base pour l’instant.</Empty></div>}
      </Section>

      <div className="grid gap-6 xl:grid-cols-2 items-start">
        <Section title="Effet de la règle de persistance"
          subtitle="Même seuil : alerte à chaque mesure, ou seulement si k mesures sur n le dépassent."
          source="transmission_runs.result_json, modeles.<meilleur>.par_role" flush>
          {run && run.points_meilleur.length ? (
            <Table min={460}>
              <thead><tr><th className="sm:pl-5">Mesure</th><th className="vc-num">Fausses alertes/h</th><th className="vc-num">Précision</th><th className="vc-num sm:pr-5">Rappel</th></tr></thead>
              <tbody data-testid="table-points">
                {run.points_meilleur.map(p => (
                  <tr key={p.cle}>
                    <td className="sm:pl-5">{sansPoint(p.libelle)}</td>
                    <td className="vc-num">{nf(p.fausses_alarmes_par_heure, 2)}</td>
                    <td className="vc-num">{pct(p.precision)}</td>
                    <td className="vc-num sm:pr-5">{pct(p.recall)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <div className="p-5"><Empty>Aucun point de fonctionnement enregistré pour ce modèle.</Empty></div>}
        </Section>

        <Section title="Découpage du jeu de données" subtitle={run?.donnees.fichier ? `Fichier ${run.donnees.fichier}, blocs temporels d’une heure` : undefined}
          source="transmission_runs.dataset (dernier entraînement terminé)">
          {run?.donnees.prevalence ? (
            <div className="space-y-4">
              {(['train', 'val', 'test'] as const).map(k => {
                const s = run.donnees.prevalence?.[k];
                if (!s) return null;
                const max = Math.max(...Object.values(run.donnees.prevalence ?? {}).map(v => v.lignes), 1);
                return (
                  <div key={k}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{k === 'train' ? 'Entraînement' : k === 'val' ? 'Validation' : 'Test'}</span>
                      <span className="tabular-nums text-[13px]" style={{ color: 'var(--text-secondary)' }}>{nf(s.lignes)} lignes, {nf(s.attaques)} attaquées ({pct(s.part)})</span>
                    </div>
                    <div className="mt-1.5 h-3 flex" style={{ width: `${Math.max(8, (s.lignes / max) * 100)}%`, border: '1px solid var(--border-strong)' }}>
                      <div style={{ width: `${(1 - s.part) * 100}%`, background: 'var(--bg-subtle)' }} />
                      <div style={{ width: `${s.part * 100}%`, background: pal.attack, borderLeft: `1.5px solid ${pal.attackLine}` }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-4 text-[12.5px] pt-1" style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-strong)' }} /> lignes normales</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3" style={{ background: pal.attack, border: `1px solid ${pal.attackLine}` }} /> lignes attaquées</span>
              </div>
              <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Lignes cumulées sur les répétitions. Largeur proportionnelle au nombre de lignes ; les lignes de garde entre blocs ne sont pas évaluées.</p>
            </div>
          ) : <Empty>Pas de découpage enregistré pour le dernier entraînement.</Empty>}
        </Section>
      </div>

      {/* ── Historique ─────────────────────────────────────────────────── */}
      <Section title="Historique des entraînements"
        subtitle="Meilleur modèle de chaque entraînement terminé, sur son propre jeu de test. Les candidats et le découpage changent d’un entraînement à l’autre : la courbe montre l’évolution du protocole autant que celle des modèles."
        source="transmission_runs JOIN transmission_model_results (is_best) WHERE status = 'termine'"
        action={<Link to="/dashboard/resultats" className="text-[13.5px] font-semibold underline underline-offset-2" style={{ color: 'var(--accent-primary)' }}>Voir les résultats de référence</Link>}>
        {histo.length ? (
          <div className="space-y-5">
            {histo.length > 1 ? (
              <div className="h-64" data-testid="chart-historique" role="img" aria-label="Évolution du F1, du rappel et de la précision du meilleur modèle par entraînement">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={histo} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} interval={0} padding={{ left: 24, right: 24 }} />
                    <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)} %`} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip {...tooltipStyle} formatter={(v) => pct(typeof v === 'number' ? v : null)} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} />
                    {(['Précision', 'Rappel', 'F1'] as const).map((k, i) => (
                      <Line key={k} type="linear" dataKey={k} stroke={pal.series[i]} strokeWidth={2} strokeDasharray={i === 2 ? '5 4' : undefined}
                        dot={{ r: 3.5, strokeWidth: 2, fill: 'var(--bg-panel)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}
            <Table min={820}>
              <thead><tr><th>Entraînement</th><th>Date</th><th>Meilleur modèle</th><th>Candidats</th><th className="vc-num">Précision</th><th className="vc-num">Fausses alertes/h</th><th className="vc-num">Rappel</th><th className="vc-num">F1</th><th className="vc-num">Durée</th></tr></thead>
              <tbody data-testid="table-historique">
                {[...data.historique].reverse().map(h => (
                  <tr key={h.id}>
                    <td className="font-semibold">n° {h.id}</td>
                    <td className="whitespace-nowrap">{dateFr(h.date)}</td>
                    <td>{h.meilleur_modele ? MODEL_FR[h.meilleur_modele] ?? h.meilleur_modele : '—'}</td>
                    <td className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{h.candidats.map(c => MODEL_FR[c] ?? c).join(', ') || '—'}</td>
                    <td className="vc-num">{pct(h.precision)}</td>
                    <td className="vc-num">{nf(h.fausses_alarmes_par_heure, 2)}</td>
                    <td className="vc-num">{pct(h.recall)}</td>
                    <td className="vc-num">{nf(h.f1, 3)}</td>
                    <td className="vc-num whitespace-nowrap">{duree(h.duree_s)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : <Empty>Aucun entraînement terminé en base : l’historique apparaîtra après le premier entraînement.</Empty>}
        {e.dernier_lancement && e.dernier_lancement.statut !== 'termine' && (
          <div className="mt-4 text-[13px] flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: STATUT[e.dernier_lancement.statut]?.color }} />
            Dernier lancement n° {e.dernier_lancement.id} ({dateFr(e.dernier_lancement.debut)}) : {STATUT[e.dernier_lancement.statut]?.label ?? e.dernier_lancement.statut}
            {e.dernier_lancement.erreur ? `. ${e.dernier_lancement.erreur}` : ''}
          </div>
        )}
      </Section>

      {/* ── Plateforme : capteurs, données, comptes ─────────────────────── */}
      <Section title="Capteurs et plateforme" source="devices, telemetry, ml_models, model_metrics, users, audit_logs" flush>
        <Readouts className="!border-0 !border-b !rounded-none" cols={4}>
          <Stat label="Entraînements enregistrés" value={nf(e.total)}
            sub={e.total ? <>{Object.entries(e.par_statut).map(([s, n]) => `${n} ${(STATUT[s]?.label ?? s).toLowerCase()}${n > 1 && s !== 'en_cours' ? 's' : ''}`).join(', ')} ; dernier le {dateFr(e.dernier)}</> : 'Aucun entraînement en base'} />
          <Stat label="Mesures du jeu de données" value={run ? nf(run.donnees.lignes) : '—'}
            sub={run ? <>{nf(run.donnees.features)} variables, {pluriel(run.donnees.episodes, 'épisode')}, {pluriel(run.donnees.scenarios, 'scénario')}</> : 'Aucun entraînement terminé'} />
          <Stat label="Capteurs déclarés" value={nf(data.capteurs.total)}
            sub={data.capteurs.total ? `${nf(data.capteurs.en_ligne)} en ligne` : 'Table devices vide'} />
          <Stat label="Comptes utilisateurs" value={nf(data.comptes.total)}
            sub={data.comptes.total ? <>{pluriel(data.comptes.actifs, 'actif')} : {Object.entries(data.comptes.par_role).map(([r, n]) => `${n} ${ROLE_FR[r] ?? r}${n > 1 ? 's' : ''}`).join(', ')}</> : 'Aucun compte'} />
        </Readouts>
        <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="p-4 sm:p-5">
            {data.capteurs.liste.length ? (
              <ul>
                {data.capteurs.liste.map(d => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{d.nom}</div>
                      <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>{DEVICE_FR[d.type] ?? d.type}, identifiant {d.id}, vu le {dateFr(d.vu_le)}</div>
                    </div>
                    {d.statut === 'online' ? <State kind="ok">en ligne</State> : <State kind="manque">hors ligne</State>}
                  </li>
                ))}
              </ul>
            ) : <Empty>Aucun capteur déclaré dans la table <code>devices</code>.</Empty>}
          </div>
          <dl className="p-4 sm:p-5 space-y-3 text-sm lg:border-l" style={{ borderColor: 'var(--border)' }}>
            <div><dt className="vc-kicker">Mesures temps réel en base</dt><dd className="mt-0.5 tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {nf(data.telemetrie.mesures)}{data.telemetrie.mesures ? <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>, du {dateFr(data.telemetrie.debut)} au {dateFr(data.telemetrie.fin)}</span> : null}</dd></div>
            <div><dt className="vc-kicker">Modèles de la phase 2 (archives)</dt><dd className="mt-0.5 tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {nf(data.modeles_phase2.modeles)}<span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>, {nf(data.modeles_phase2.metriques_par_attaque)} métriques par attaque</span></dd></div>
            <div><dt className="vc-kicker">Actions tracées dans le journal d’audit</dt><dd className="mt-0.5 tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {nf(data.audit.actions)}{data.audit.derniere ? <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>, dernière le {dateFr(data.audit.derniere)}</span> : null}</dd></div>
            <div><dt className="vc-kicker">Alertes et rapports</dt><dd className="mt-0.5 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
              Non stockés : le rapport opérateur est recalculé à la demande depuis le dernier entraînement.</dd></div>
          </dl>
        </div>
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
          jamais vues. Chaque chiffre est relu dans PostgreSQL à l’ouverture.
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
