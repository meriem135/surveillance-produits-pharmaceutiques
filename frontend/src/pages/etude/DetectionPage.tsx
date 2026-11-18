/** Détection vs réalité — alertes du meilleur modèle face aux épisodes d'attaque réels, dans le temps.
 *  GET /api/v1/etude/timeline : transmission_dataset ⋈ transmission_predictions, transmission_alerts,
 *  transmission_episodes, transmission_metrics. */
import { Fragment, useState } from 'react';
import {
  Empty, Loading, Meter, MODEL_FR, Note, PageHeader, SCENARIO_FR, Section, Segmented, State, Table,
  dateFr, minutes, nf, pct, useApi,
} from '../../components/etude/kit';
import RapportAlerte, { type AlerteFiche } from './RapportAlerte';
import { ESCALADE_MIN, FAMILLE_FR, FAMILLE_REELLE, estimer, rapportAlerte, type Contribution } from './recommandations';

interface Fit { tp: number; fp: number; fn: number; tn: number; recall: number; precision: number; f1: number; avg_precision: number | null;
  fausses_alertes_par_heure: number; episodes: number; episodes_detectes: number; delai_median_min: number | null }
interface TimelineResp {
  run?: { id: number; source: string; date: string; repetitions?: number };
  role: string; modele: string; seuil: number | null; pas_minutes: number;
  serie: { ts: string; score_max: number; alarme: number; attaque: number; frigo: number; thermostat: number; role: string; evaluee: boolean }[];
  episodes: { scenario: string; capteur: string; role: string; debut: string; fin: string; duree_min: number; detecte: boolean | null; delai_min: number | null }[];
  episodes_toutes?: { repetition: number; scenario: string; capteur: string; role: string; debut: string; fin: string; duree_min: number; detecte: boolean | null; delai_min: number | null }[];
  alertes: { role: string; debut: string; fin: string; duree_min: number; score_max: number; vraie: boolean; scenario: string | null; capteur?: string | null; explication?: Contribution[] }[];
  par_scenario: { scenario: string; episodes: number; detectes: number; delai_median_min: number | null }[];
  ajustement: Record<string, { alarme?: Fit; ligne?: Fit }>;
  sources: Record<string, string>;
}

const role = 'test';   // seuls les résultats du jeu de test sont affichés
type Filtre = 'attaques' | 'alertes' | 'erreurs' | 'tout';
type Niveau = 'Normal' | 'À surveiller' | 'Alerte';
const PAGE = 15;
/** Alerte = règle d'alerte du modèle déclenchée ; à surveiller = score au-dessus du seuil sans alerte ; sinon normal. */
const niveauDe = (alarme: boolean, score: number, seuil: number | null): Niveau =>
  alarme ? 'Alerte' : seuil != null && score >= seuil ? 'À surveiller' : 'Normal';
const NIVEAU_COULEUR: Record<Niveau, string> = { Normal: 'var(--border-strong)', 'À surveiller': 'var(--alarm-amber-fill)', Alerte: 'var(--accent-danger)' };

export default function DetectionPage() {
  const { data, error, loading, reload } = useApi<TimelineResp>(`/api/v1/etude/timeline?role=${role}&minutes=1`);
  const [filtre, setFiltre] = useState<Filtre>('attaques');
  const [shown, setShown] = useState(PAGE);
  const [fiche, setFiche] = useState<{ cle: string; rap: ReturnType<typeof rapportAlerte>; al: AlerteFiche } | null>(null);
  const changeFiltre = (f: Filtre) => { setFiltre(f); setShown(PAGE); };
  const header = (
    <PageHeader title="Détection vs réalité" loading={loading} onRefresh={reload}
      subtitle={`Le modèle apprend-il vraiment les attaques ? Ses alertes, minute par minute, face aux épisodes réellement injectés${data?.run
        ? ` — ${data.run.source === 'web' ? `votre entraînement n° ${data.run.id} du ${dateFr(data.run.date)}` : 'étude de référence'}. ${
          data.run.repetitions && data.run.repetitions > 1
            ? `Résultats cumulés sur ${data.run.repetitions} répétitions ; la frise minute par minute montre la répétition n° 1.`
            : 'Une seule répétition (la n° 1).'}`
        : ' (répétition n° 1).'}`}>
    </PageHeader>
  );
  if (!data) return <div className="space-y-5">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  const eps = [...data.episodes].sort((a, b) => a.debut.localeCompare(b.debut));
  const plages = eps.map(e => ({ a: new Date(e.debut).getTime() - 60_000, b: new Date(e.fin).getTime(), nom: SCENARIO_FR[e.scenario] ?? e.scenario }));
  const alertesT = data.alertes.map(a => ({ a, d: new Date(a.debut).getTime(), f: new Date(a.fin).getTime() }));
  const lignes = data.serie.filter(p => p.evaluee).map(p => {
    const t = new Date(p.ts).getTime();
    const attaque = p.attaque === 1;
    const niveau = niveauDe(p.alarme === 1, p.score_max, data.seuil);
    const resultat: 'correct' | 'manquee' | 'fausse' = attaque && niveau !== 'Alerte' ? 'manquee' : !attaque && niveau === 'Alerte' ? 'fausse' : 'correct';
    const nom = plages.find(r => t >= r.a && t <= r.b)?.nom ?? 'Attaque';
    // alerte qui recouvre cette minute (même plage horaire) : porte le SHAP, la famille probable et les consignes
    const alerte = niveau === 'Alerte' ? alertesT.find(x => t + 60_000 > x.d && t <= x.f) : undefined;
    return { ts: p.ts, frigo: p.frigo, thermostat: p.thermostat, attaque, nom, score: p.score_max, niveau, resultat, alerte: alerte?.a };
  });
  const expliquees = data.alertes.filter(a => a.vraie && a.scenario && FAMILLE_REELLE[a.scenario] && (a.explication?.length ?? 0) > 0);
  const justes = expliquees.filter(a => estimer(a.explication ?? []).famille === FAMILLE_REELLE[a.scenario as string]).length;
  const visibles = lignes.filter(l => filtre === 'tout' ? true : filtre === 'attaques' ? l.attaque : filtre === 'alertes' ? l.niveau === 'Alerte' : l.resultat !== 'correct');
  return (
    <div className="space-y-6">
      {header}
      <Section title="Score du modèle et attaques réelles"
        subtitle={`${MODEL_FR[data.modele] ?? data.modele}, score maximal par minute. Les blocs d’une heure d’un même rôle sont mis bout à bout.`}
        source={data.sources.serie}>
        <div className="rounded-[12px] p-4 mb-4 text-[13.5px]" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2.5">
            <div className="flex items-start gap-2.5"><dt className="shrink-0 w-[128px]"><State kind="manque">Alerte</State></dt><dd>La règle d’alerte du modèle est déclenchée.</dd></div>
            <div className="flex items-start gap-2.5"><dt className="shrink-0 w-[128px]"><State kind="manque">Attaque manquée</State></dt><dd>Une attaque réelle sans alerte.</dd></div>
            <div className="flex items-start gap-2.5"><dt className="shrink-0 w-[128px]"><State kind="alerte">À surveiller</State></dt><dd>Le score dépasse le seuil sans déclencher d’alerte.</dd></div>
            <div className="flex items-start gap-2.5"><dt className="shrink-0 w-[128px]"><State kind="alerte">Fausse alerte</State></dt><dd>Une alerte sans attaque.</dd></div>
          </dl>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 mb-3">
          <Segmented<Filtre> label="Filtrer les lignes" value={filtre} onChange={changeFiltre} options={[
            { value: 'attaques', label: `Attaques (${lignes.filter(l => l.attaque).length})` },
            { value: 'alertes', label: `Alertes (${lignes.filter(l => l.niveau === 'Alerte').length})` },
            { value: 'erreurs', label: `Erreurs (${lignes.filter(l => l.resultat !== 'correct').length})` },
            { value: 'tout', label: `Tout (${lignes.length})` },
          ]} />
        </div>
        {visibles.length ? (
          <Table min={820}>
            <thead><tr>
              <th>Heure</th><th className="vc-num">Frigo</th><th className="vc-num">Thermostat</th>
              <th style={{ minWidth: 160 }}>Score du modèle</th><th>Niveau</th><th>Résultat</th><th>Recommandation</th>
            </tr></thead>
            <tbody data-testid="table-score-attaques">
              {visibles.slice(0, shown).map((l, i, tab) => {
                const al = l.alerte;
                const premiere = !!al && tab[i - 1]?.alerte !== al;   // une seule recommandation par alerte
                const est = al ? estimer(al.explication ?? []) : null;
                const rap = premiere && al ? rapportAlerte(al, { date: dateFr(al.debut), duree: minutes(al.duree_min), nf, pct }) : null;
                return (
                  <Fragment key={l.ts}>
                    <tr>
                      <td className="whitespace-nowrap tabular-nums">{dateFr(l.ts)}</td>
                      <td className="vc-num">{nf(l.frigo, 1)}&nbsp;°C</td>
                      <td className="vc-num">{nf(l.thermostat, 1)}&nbsp;°C</td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-24 shrink-0"><Meter value={l.score * 100} color={NIVEAU_COULEUR[l.niveau]} /></div>
                          <span className="tabular-nums text-[13px] w-11 text-right">{nf(l.score, 2)}</span>
                        </div>
                      </td>
                      <td>{l.niveau === 'Alerte' ? <State kind="manque">Alerte</State> : l.niveau === 'À surveiller' ? <State kind="alerte">À surveiller</State> : <State kind="neutre">Normal</State>}</td>
                      <td>{l.resultat === 'correct' ? <State kind="ok">Correct</State> : l.resultat === 'manquee' ? <State kind="manque">Attaque manquée</State> : <State kind="alerte">Fausse alerte</State>}</td>
                      <td className="text-[13px]">
                        {premiere && al && est && rap ? (
                          <div className="flex items-center gap-2">
                            <span><strong>{rap.gravite}</strong> · {al.vraie ? FAMILLE_FR[est.famille] : 'Fausse alerte'}<span className="text-[12px]" style={{ color: 'var(--text-muted)' }}> · Terminée après {minutes(al.duree_min)}</span>
                              {al.duree_min >= ESCALADE_MIN && <span className="ml-1.5"><State kind="manque">Prolongée</State></span>}</span>
                            <button className="vc-btn" onClick={() => setFiche(fiche?.cle === l.ts ? null : { cle: l.ts, rap, al })}>{fiche?.cle === l.ts ? 'Masquer' : 'Rapport'}</button>
                          </div>
                        ) : al ? <span style={{ color: 'var(--text-muted)' }}>↳ même alerte (rapport sur la première ligne)</span>
                          : <span style={{ color: 'var(--text-muted)' }}>{l.resultat === 'manquee' ? 'pas d’alerte, pas d’explication' : '—'}</span>}
                      </td>
                    </tr>
                    {fiche?.cle === l.ts && (
                      <tr><td colSpan={7} className="whitespace-normal" style={{ background: 'var(--bg-subtle)' }}>
                        <RapportAlerte rap={fiche.rap} al={fiche.al} seuil={data.seuil} onClose={() => setFiche(null)} />
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        ) : <Empty>Aucune ligne pour ce filtre.</Empty>}
        <Note>Rapport : une seule recommandation par alerte (sur sa première ligne). La famille est estimée d’après le SHAP de l’alerte, pas annoncée par le modèle (qui répond seulement « attaque » ou « normal »).
          {expliquees.length > 0 && <> Sur les {expliquees.length} alertes vraies expliquées, la famille estimée correspond au scénario injecté dans {justes} cas ({pct(justes / expliquees.length, 0)}).</>}</Note>
        {visibles.length > shown && (
          <div className="mt-3 flex items-center justify-between gap-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            <span>{shown} lignes sur {visibles.length}</span>
            <button className="vc-btn" onClick={() => setShown(s => s + PAGE * 2)}>Afficher plus</button>
          </div>
        )}
      </Section>
    </div>
  );
}
