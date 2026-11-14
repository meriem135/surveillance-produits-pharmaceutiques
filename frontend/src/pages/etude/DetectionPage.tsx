/** Détection vs réalité — alertes du meilleur modèle face aux épisodes d'attaque réels, dans le temps.
 *  GET /api/v1/etude/timeline : transmission_dataset ⋈ transmission_predictions, transmission_alerts,
 *  transmission_episodes, transmission_metrics. */
import { Fragment, useState } from 'react';
import {
  Empty, Loading, Meter, MODEL_FR, Note, PageHeader, ROLE_FR, SCENARIO_FR, Section, Segmented, State, Table,
  dateFr, minutes, nf, pct, useApi,
} from '../../components/etude/kit';
import { FAMILLE_FR, FAMILLE_REELLE, estimer, rapportAlerte, type Contribution } from './recommandations';

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

const ROLES = ['test', 'val', 'train'] as const;
type Filtre = 'attaques' | 'alertes' | 'erreurs' | 'tout';
type Niveau = 'Normal' | 'À surveiller' | 'Alerte';
const PAGE = 15;
/** Alerte = règle d'alerte du modèle déclenchée ; à surveiller = score au-dessus du seuil sans alerte ; sinon normal. */
const niveauDe = (alarme: boolean, score: number, seuil: number | null): Niveau =>
  alarme ? 'Alerte' : seuil != null && score >= seuil ? 'À surveiller' : 'Normal';
const NIVEAU_COULEUR: Record<Niveau, string> = { Normal: 'var(--border-strong)', 'À surveiller': 'var(--alarm-amber-fill)', Alerte: 'var(--accent-danger)' };

export default function DetectionPage() {
  const [role, setRole] = useState<string>('test');
  const { data, error, loading, reload } = useApi<TimelineResp>(`/api/v1/etude/timeline?role=${role}&minutes=1`);
  const [filtre, setFiltre] = useState<Filtre>('attaques');
  const [shown, setShown] = useState(PAGE);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const changeFiltre = (f: Filtre) => { setFiltre(f); setShown(PAGE); };
  const changeRole = (r: string) => { setRole(r); setShown(PAGE); };
  const header = (
    <PageHeader title="Détection vs réalité" loading={loading} onRefresh={reload}
      subtitle={`Le modèle apprend-il vraiment les attaques ? Ses alertes, minute par minute, face aux épisodes réellement injectés${data?.run
        ? ` — ${data.run.source === 'web' ? `votre entraînement n° ${data.run.id} du ${dateFr(data.run.date)}` : 'étude de référence'}. ${
          data.run.repetitions && data.run.repetitions > 1
            ? `Résultats cumulés sur ${data.run.repetitions} répétitions ; la frise minute par minute montre la répétition 0.`
            : 'Une seule répétition (la 0).'}`
        : ' (répétition 0).'}`}>
      <Segmented label="Données affichées" value={role as typeof ROLES[number]} onChange={changeRole}
        options={ROLES.map(r => ({ value: r, label: ROLE_FR[r] }))} />
    </PageHeader>
  );
  if (!data) return <div className="space-y-5">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  const eps = [...data.episodes].sort((a, b) => a.debut.localeCompare(b.debut));
  const toutes = data.episodes_toutes && data.episodes_toutes.length ? data.episodes_toutes : data.episodes.map(e => ({ ...e, repetition: 0 }));
  const det = eps.filter(e => e.detecte).length;
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
      <Section title={`${ROLE_FR[data.role]} : score du modèle et attaques réelles`}
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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="text-[13.5px]" style={{ color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{det}</strong> épisodes détectés sur <strong style={{ color: 'var(--text-primary)' }}>{eps.length}</strong>
            {data.seuil != null && <> · seuil de risque <strong style={{ color: 'var(--text-primary)' }}>{pct(data.seuil, 0)}</strong></>}
          </div>
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
              <th>Heure</th><th className="vc-num">Frigo</th><th className="vc-num">Thermostat</th><th>Attaque réelle</th>
              <th style={{ minWidth: 160 }}>Score du modèle</th><th>Niveau</th><th>Résultat</th><th>Recommandation</th>
            </tr></thead>
            <tbody data-testid="table-score-attaques">
              {visibles.slice(0, shown).map((l, i, tab) => {
                const al = l.alerte;
                const premiere = !!al && tab[i - 1]?.alerte !== al;   // une seule recommandation par alerte
                const nb = al ? lignes.filter(x => x.alerte === al).length : 0;
                const est = al ? estimer(al.explication ?? []) : null;
                const rap = premiere && al ? rapportAlerte(al, { date: dateFr(al.debut), duree: minutes(al.duree_min), nf, pct }) : null;
                const expl = al?.explication ?? [];
                return (
                  <Fragment key={l.ts}>
                    <tr>
                      <td className="whitespace-nowrap tabular-nums">{dateFr(l.ts)}</td>
                      <td className="vc-num">{nf(l.frigo, 1)}&nbsp;°C</td>
                      <td className="vc-num">{nf(l.thermostat, 1)}&nbsp;°C</td>
                      <td>{l.attaque ? <span className="font-semibold" style={{ color: 'var(--accent-danger)' }}>{l.nom}</span> : <span style={{ color: 'var(--text-muted)' }}>Aucune</span>}</td>
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
                            <span><strong>{rap.gravite}</strong> · {al.vraie ? FAMILLE_FR[est.famille] : 'Fausse alerte'}<span className="text-[12px]" style={{ color: 'var(--text-muted)' }}> ({nb} min d’alerte)</span></span>
                            <button className="vc-btn" onClick={() => setOuverte(ouverte === l.ts ? null : l.ts)}>{ouverte === l.ts ? 'Masquer' : 'Rapport'}</button>
                          </div>
                        ) : al ? <span style={{ color: 'var(--text-muted)' }}>↳ même alerte (rapport sur la première ligne)</span>
                          : <span style={{ color: 'var(--text-muted)' }}>{l.resultat === 'manquee' ? 'pas d’alerte, pas d’explication' : '—'}</span>}
                      </td>
                    </tr>
                    {rap && ouverte === l.ts && (
                      <tr><td colSpan={8} className="text-[13px] whitespace-normal" style={{ background: 'var(--bg-subtle)' }}>
                        <div className="sticky left-0 max-w-[600px] py-1">
                          <p className="mb-2">{rap.synthese}</p>
                          <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>{rap.hypothese}</p>
                          {expl.length > 0 && (
                            <details className="mb-2">
                              <summary className="cursor-pointer">Features déterminantes (SHAP de l’alerte)</summary>
                              <ul className="mt-1 space-y-0.5">
                                {expl.map(c => <li key={c.feature}>{c.libelle} : <span className="tabular-nums">{nf(c.valeur, 2)}</span> contre <span className="tabular-nums">{nf(c.valeur_normale, 2)}</span> en fonctionnement normal (effet SHAP {nf(c.shap, 3)})</li>)}
                              </ul>
                            </details>
                          )}
                          <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Actions suggérées, à confirmer par un opérateur</div>
                          {rap.etapes.map(e => (
                            <div key={e.niveau} className="mb-1"><strong>{e.niveau}</strong>
                              <ul className="list-disc pl-5">{e.items.map(it => <li key={it}>{it}</li>)}</ul></div>
                          ))}
                        </div>
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


      <div>
        <Section title="Épisodes réels et détection" subtitle={toutes.length > data.episodes.length
          ? `${toutes.length} épisodes en ${ROLE_FR[data.role].toLowerCase()}, toutes répétitions confondues (${new Set(toutes.map(e => e.repetition)).size} répétitions).`
          : `${data.episodes.length} épisodes en ${ROLE_FR[data.role].toLowerCase()} (répétition 0).`} source={data.sources.episodes} flush>
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
      </div>
    </div>
  );
}
