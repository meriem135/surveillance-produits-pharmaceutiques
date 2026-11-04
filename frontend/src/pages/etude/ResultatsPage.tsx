/** Résultats et métriques — transmission_metrics, transmission_model_results, transmission_learning_curve
 *  (GET /api/v1/etude/metrics). Le modèle est choisi sur la validation ; le test ne fait que confirmer. */
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Empty, Loading, MODEL_FR, Note, PageHeader, Readouts, State, ROLE_FR, SCENARIO_FR, Section, Stat, Table, Tally, minutes, nf, pct,
  tooltipStyle, useApi, usePalette,
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
    meilleur_modele: string | null };
  modeles: Record<string, ModelBlock>; classement_validation: string[];
  courbe_apprentissage: { modele: string | null; points: { part_train: number; lignes_train: number; ap_train: number; ap_val: number; f1_train: number | null; f1_val: number | null }[] };
  validation_croisee: null | { lignes: number; blocs: number; folds: number;
    methodes: Record<string, { description: string; blocs_partages: number; modeles: Record<string, Record<string, CvStat>> }> };
  sources: Record<string, string>;
}

export default function ResultatsPage() {
  const { data, error, loading, reload } = useApi<MetricsResp>('/api/v1/etude/metrics');
  const pal = usePalette();
  const header = <PageHeader title="Résultats et métriques" loading={loading} onRefresh={reload}
    subtitle="Un seul réglage d'alerte par modèle, choisi sur la validation ; les chiffres du test confirment le choix sans y avoir servi." />;
  if (!data) return <div className="space-y-5">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  const ranking = data.classement_validation.filter(k => data.modeles[k]);
  const bestKey = ranking[0];
  const best = data.modeles[bestKey];
  const bt = best?.alarme.test;
  const op = best?.point_fonctionnement;
  const v1 = data.modeles.RF_v1;
  const reps = data.run.repetitions;
  const lc = data.courbe_apprentissage.points.map(p => ({ ...p, pct: Math.round(p.part_train * 100) }));

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

      <Section title="Comparaison des modèles" subtitle="Classement sur la validation : contrainte tenue (précision, fausses alertes/h), puis rappel, puis fausses alertes, puis délai." source={data.sources.modeles}>
        <Table min={860}>
          <thead><tr><th>#</th><th>Modèle</th><th>Réglage</th><th>Rôle</th><th className="vc-num">Épisodes</th><th className="vc-num">FA/h</th>
            <th className="vc-num">Précision</th><th className="vc-num">Rappel</th><th className="vc-num">F1</th><th className="vc-num">Délai</th><th className="vc-num">AP</th></tr></thead>
          <tbody>
            {[...ranking, ...(v1 ? ['RF_v1'] : [])].flatMap((k, i) => {
              const m = data.modeles[k];
              const o = m.point_fonctionnement;
              return (['val', 'test'] as const).map((r, j) => {
                const v = m.alarme[r];
                if (!v) return null;
                return (
                  <tr key={`${k}-${r}`} style={k === 'RF_v1' ? { color: 'var(--text-secondary)' } : k === bestKey ? { background: 'var(--accent-glow)' } : undefined}>
                    {j === 0 && <td rowSpan={2}>{k === 'RF_v1' ? 'réf.' : i + 1}</td>}
                    {j === 0 && <td rowSpan={2}><div className="font-semibold">{MODEL_FR[k] ?? k}</div>
                      {o && (o.contrainte_tenue ? <State kind="ok">contrainte tenue</State> : <State kind="manque">contrainte non tenue</State>)}</td>}
                    {j === 0 && <td rowSpan={2} className="text-[13px] whitespace-nowrap">{o ? `≥ ${nf(o.seuil, 3)}, ${o.k} sur ${o.n}` : '—'}</td>}
                    <td className="text-[13px]">{ROLE_FR[r]}</td>
                    <td className="vc-num">{v.episodes_detectes}/{v.episodes}</td><td className="vc-num">{nf(v.fausses_alertes_par_heure, 2)}</td>
                    <td className="vc-num">{pct(v.precision)}</td><td className="vc-num">{pct(v.recall)}</td><td className="vc-num">{nf(v.f1, 3)}</td>
                    <td className="vc-num">{minutes(v.delai_median_min)}</td><td className="vc-num">{nf(v.avg_precision, 3)}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </Table>
        <Note>FA/h : alertes sans aucune mesure falsifiée, par heure de fonctionnement normal. AP : précision moyenne (aire sous la
          courbe précision-rappel, indépendante du seuil). « réf. » : Random Forest avec les anciennes features, même protocole corrigé (avant / après).</Note>
      </Section>

      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Entraînement, validation, test : sur- ou sous-apprentissage ?" subtitle="Le même modèle mesuré sur ses données d'entraînement et sur des heures jamais vues." source={data.sources.modeles}>
          <Table>
            <thead><tr><th>Modèle</th><th className="vc-num">AP train</th><th className="vc-num">AP val</th><th className="vc-num">AP test</th><th className="vc-num">F1 train</th><th className="vc-num">F1 test</th></tr></thead>
            <tbody>
              {ranking.map(k => {
                const m = data.modeles[k];
                return (
                  <tr key={k}><td>{MODEL_FR[k] ?? k}</td>
                    <td className="vc-num">{nf(m.alarme.train?.avg_precision, 3)}</td><td className="vc-num">{nf(m.alarme.val?.avg_precision, 3)}</td>
                    <td className="vc-num">{nf(m.alarme.test?.avg_precision, 3)}</td><td className="vc-num">{nf(m.alarme.train?.f1, 3)}</td>
                    <td className="vc-num">{nf(m.alarme.test?.f1, 3)}</td></tr>
                );
              })}
            </tbody>
          </Table>
          {best?.diagnostic && <Note><strong>{MODEL_FR[bestKey]}</strong> : {best.diagnostic.verdict} (écart d'AP train − validation {nf(best.diagnostic.ecart_ap_train_val, 3)}).</Note>}
        </Section>
        <Section title={`Courbe d’apprentissage, ${MODEL_FR[data.courbe_apprentissage.modele ?? ''] ?? '—'}`}
          subtitle="AP selon la part des blocs d'entraînement utilisée (moyenne de 3 rotations)." source={data.sources.courbe_apprentissage}>
          {lc.length ? (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lc} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke={pal.grid} vertical={false} />
                  <XAxis dataKey="pct" unit=" %" tick={{ fill: pal.axis, fontSize: 12 }} />
                  <YAxis domain={[0.4, 1]} tick={{ fill: pal.axis, fontSize: 12 }} />
                  <Tooltip {...tooltipStyle} labelFormatter={v => `${v} % du train`} formatter={(v, n) => [nf(Number(v), 3), n]} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} />
                  <Line dataKey="ap_train" name="AP entraînement" stroke={pal.series[1]} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: 'var(--bg-panel)' }} isAnimationActive={false} />
                  <Line dataKey="ap_val" name="AP validation" stroke={pal.series[0]} strokeWidth={2} dot={{ r: 3, fill: 'var(--bg-panel)' }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>Courbe d'apprentissage non calculée pour cette étude.</Empty>}
          <Note>Un écart qui reste grand quand le train grandit, avec une validation qui monte encore, indique un modèle limité par la
            quantité de données (variance) plutôt qu'un modèle trop simple.</Note>
        </Section>
      </div>

      {best && bt && (
        <div className="grid lg:grid-cols-2 gap-5">
          <Section title={`Par scénario, ${MODEL_FR[bestKey]} sur le test`} subtitle="Épisodes détectés, délai médian et part des mesures falsifiées signalées." source={data.sources.modeles}>
            <Table>
              <thead><tr><th>Scénario</th><th className="vc-num">Épisodes</th><th className="vc-num">Délai</th><th className="vc-num">Mesures signalées</th></tr></thead>
              <tbody>
                {Object.entries(bt.per_episode).map(([s, e]) => (
                  <tr key={s}><td>{SCENARIO_FR[s] ?? s}</td><td className="vc-num"><span className="inline-flex items-center gap-2 justify-end"><Tally detected={e.detected} total={e.n} />{e.detected}/{e.n}</span></td>
                    <td className="vc-num">{minutes(e.delai_median_min)}</td><td className="vc-num">{nf(bt.per_attack[s]?.rate, 1)}&#8239;%</td></tr>
                ))}
              </tbody>
            </Table>
          </Section>
          <Section title="Effet de la règle de persistance" subtitle={`${MODEL_FR[bestKey]} au même seuil, sans persistance (chaque mesure) et avec (${op?.k} sur ${op?.n}).`} source={data.sources.modeles}>
            <Table>
              <thead><tr><th>Rôle</th><th>Niveau</th><th className="vc-num">FA/h</th><th className="vc-num">Précision</th><th className="vc-num">Rappel</th><th className="vc-num">Épisodes</th></tr></thead>
              <tbody>
                {(['val', 'test'] as const).flatMap(r => ([['ligne', 'mesure par mesure'], ['alarme', 'avec persistance']] as const).map(([lvl, lab]) => {
                  const v = best[lvl][r];
                  return v ? (
                    <tr key={r + lvl}><td>{ROLE_FR[r]}</td><td className="text-[13px]">{lab}</td><td className="vc-num">{nf(v.fausses_alertes_par_heure, 2)}</td>
                      <td className="vc-num">{pct(v.precision)}</td><td className="vc-num">{pct(v.recall)}</td><td className="vc-num">{v.episodes_detectes}/{v.episodes}</td></tr>
                  ) : null;
                }))}
              </tbody>
            </Table>
          </Section>
        </div>
      )}

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
