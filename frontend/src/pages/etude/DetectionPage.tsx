/** Détection vs réalité — alertes du meilleur modèle face aux épisodes d'attaque réels, dans le temps.
 *  GET /api/v1/etude/timeline : transmission_dataset ⋈ transmission_predictions, transmission_alerts,
 *  transmission_episodes, transmission_metrics. */
import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  BandLegend, Empty, Loading, MODEL_FR, Note, PageHeader, Paper, ROLE_FR, SCENARIO_FR, Section, Segmented, State, Table, Tally, TallyLegend,
  heure, minutes, nf, pct, tooltipStyle, useApi, usePalette,
} from '../../components/etude/kit';

interface Fit { tp: number; fp: number; fn: number; tn: number; recall: number; precision: number; f1: number; avg_precision: number | null;
  fausses_alertes_par_heure: number; episodes: number; episodes_detectes: number; delai_median_min: number | null }
interface TimelineResp {
  role: string; modele: string; seuil: number | null; pas_minutes: number;
  serie: { ts: string; score_max: number; alarme: number; attaque: number; frigo: number; thermostat: number; role: string; evaluee: boolean }[];
  episodes: { scenario: string; capteur: string; role: string; debut: string; fin: string; duree_min: number; detecte: boolean | null; delai_min: number | null }[];
  alertes: { role: string; debut: string; fin: string; duree_min: number; score_max: number; vraie: boolean; scenario: string | null }[];
  par_scenario: { scenario: string; episodes: number; detectes: number; delai_median_min: number | null }[];
  ajustement: Record<string, { alarme?: Fit; ligne?: Fit }>;
  sources: Record<string, string>;
}

const ROLES = ['test', 'val', 'train'] as const;
/** Deux pistes d'événements au-dessus de la courbe, comme les plumes d'un enregistreur. */
const laneTick = (v: number) => (v > 1.2 ? 'attaque' : v > 1.1 ? 'alerte' : String(v).replace('.', ','));

function Confusion({ f }: { f: Fit }) {
  const cell = (label: string, v: number, good: boolean) => (
    <div className="p-2.5 text-center" style={{ background: good ? 'color-mix(in srgb, var(--accent-primary) 9%, var(--bg-panel))' : 'color-mix(in srgb, var(--accent-danger) 8%, var(--bg-panel))' }}>
      <div className="vc-readout-value" style={{ fontSize: 24, color: good ? 'var(--text-primary)' : 'var(--accent-danger)' }}>{nf(v)}</div>
      <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-px text-[12px]" style={{ background: 'var(--border)', border: '1px solid var(--border)' }}>
        <div style={{ background: 'var(--bg-panel)' }} />
        <div className="px-2 py-1 text-center font-semibold" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>Signalé</div>
        <div className="px-2 py-1 text-center font-semibold" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>Non signalé</div>
        <div className="px-2 flex items-center font-semibold" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>Attaque</div>
        {cell('attaques signalées', f.tp, true)}{cell('attaques ratées', f.fn, false)}
        <div className="px-2 flex items-center font-semibold" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>Normal</div>
        {cell('fausses alertes', f.fp, false)}{cell('normal non signalé', f.tn, true)}
      </div>
    </div>
  );
}

export default function DetectionPage() {
  const [role, setRole] = useState<string>('test');
  const { data, error, loading, reload } = useApi<TimelineResp>(`/api/v1/etude/timeline?role=${role}&minutes=1`);
  const pal = usePalette();
  const serie = useMemo(() => (data?.serie ?? []).map(p => ({ ...p, reel: p.attaque ? [1.2, 1.29] : null, detecte: p.alarme ? [1.08, 1.17] : null })), [data]);
  const header = (
    <PageHeader title="Détection vs réalité" loading={loading} onRefresh={reload}
      subtitle="Le modèle apprend-il vraiment les attaques ? Ses alertes, minute par minute, face aux épisodes réellement injectés (répétition 0).">
      <Segmented label="Données affichées" value={role as typeof ROLES[number]} onChange={setRole}
        options={ROLES.map(r => ({ value: r, label: ROLE_FR[r] }))} />
    </PageHeader>
  );
  if (!data) return <div className="space-y-5">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  const fit = data.ajustement;
  const fa = data.alertes.filter(a => !a.vraie);
  const eps = [...data.episodes].sort((a, b) => a.debut.localeCompare(b.debut));
  const det = eps.filter(e => e.detecte).length;
  return (
    <div className="space-y-6">
      {header}
      <Section title={`${ROLE_FR[data.role]} : score du modèle et attaques réelles`}
        subtitle={`${MODEL_FR[data.modele] ?? data.modele}, score maximal par minute. Les blocs d’une heure d’un même rôle sont mis bout à bout.`}
        source={data.sources.serie}>
        <BandLegend items={[
          { label: 'Score maximal', color: pal.ink, kind: 'line' },
          { label: 'Attaque réelle (piste du haut)', color: pal.attackLine },
          { label: 'Alerte levée après persistance (piste du dessous)', color: pal.alert },
          ...(data.seuil != null ? [{ label: `Seuil ${nf(data.seuil, 2)}`, color: pal.alert, kind: 'dash' as const }] : []),
        ]} />
        <Paper height={300}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serie} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <XAxis dataKey="ts" tickFormatter={heure} minTickGap={48} tick={{ fill: pal.axis, fontSize: 12 }} />
              <YAxis domain={[0, 1.3]} ticks={[0, 0.25, 0.5, 0.75, 1, 1.125, 1.245]} interval={0} width={64} tickFormatter={laneTick} tick={{ fill: pal.axis, fontSize: 12 }} />
              <Tooltip {...tooltipStyle} labelFormatter={v => new Date(String(v)).toLocaleString('fr-FR')}
                formatter={(v, n) => (n === 'Score max' ? [nf(Number(v), 3), n] : ['oui', n])} />
              <Area dataKey="reel" name="Attaque réelle" fill={pal.attackLine} fillOpacity={1} stroke="none" isAnimationActive={false} />
              <Area dataKey="detecte" name="Alerte levée" fill={pal.alert} fillOpacity={1} stroke="none" isAnimationActive={false} />
              <Line dataKey="score_max" name="Score max" stroke={pal.ink} dot={false} strokeWidth={1.1} isAnimationActive={false} />
              {data.seuil != null && <ReferenceLine y={data.seuil} stroke={pal.alert} strokeWidth={1.5} strokeDasharray="5 4" />}
            </ComposedChart>
          </ResponsiveContainer>
        </Paper>
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Épisodes dans l’ordre chronologique : {det} détectés sur {eps.length}
            </div>
            <TallyLegend />
          </div>
          <div className="vc-tally" role="list" aria-label="Épisodes d’attaque dans l’ordre chronologique">
            {eps.map(e => (
              <i key={e.debut} role="listitem" data-miss={e.detecte ? undefined : ''}
                title={`${new Date(e.debut).toLocaleString('fr-FR')} : ${SCENARIO_FR[e.scenario] ?? e.scenario}, ${e.detecte ? `détecté en ${minutes(e.delai_min)}` : 'manqué'}`}
                aria-label={`${SCENARIO_FR[e.scenario] ?? e.scenario}, ${e.detecte ? 'détecté' : 'manqué'}`} />
            ))}
          </div>
        </div>
      </Section>

      <div>
        <h2 className="text-[22px]" style={{ color: 'var(--text-primary)' }}>Entraînement, validation, test : le même modèle sur les trois</h2>
        <p className="text-[13.5px] mt-1 max-w-[80ch]" style={{ color: 'var(--text-secondary)' }}>
          Mesures après persistance, cumul des répétitions. Presque parfait à l’entraînement mais nettement moins bon en validation
          et en test : sur-apprentissage. Médiocre partout : sous-apprentissage.
        </p>
      </div>
      <div className="grid lg:grid-cols-3 gap-6 -mt-2">
        {ROLES.map(r => {
          const f = fit[r]?.alarme;
          return (
            <Section key={r} title={ROLE_FR[r]} source={data.sources.ajustement}
              action={r === data.role ? <span className="text-[12.5px] font-semibold" style={{ color: 'var(--accent-primary)' }}>affiché ci-dessus</span> : undefined}>
              {f ? (
                <>
                  <Confusion f={f} />
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-4 text-[13.5px]" style={{ color: 'var(--text-secondary)' }}>
                    <dt>Précision</dt><dd className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{pct(f.precision)}</dd>
                    <dt>Fausses alertes par heure</dt><dd className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{nf(f.fausses_alertes_par_heure, 2)}</dd>
                    <dt>Rappel</dt><dd className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{pct(f.recall)}</dd>
                    <dt>F1</dt><dd className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{nf(f.f1, 3)}</dd>
                    <dt>AP (sans seuil)</dt><dd className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{nf(f.avg_precision, 3)}</dd>
                    <dt>Épisodes détectés</dt><dd className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{f.episodes_detectes}/{f.episodes}</dd>
                  </dl>
                </>
              ) : <Empty>Pas de mesure enregistrée pour ce rôle.</Empty>}
            </Section>
          );
        })}
      </div>
      <Note>Voir aussi la courbe d’apprentissage dans « Résultats ».</Note>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Épisodes réels et détection" subtitle={`${data.episodes.length} épisodes en ${ROLE_FR[data.role].toLowerCase()} (répétition 0).`} source={data.sources.episodes} flush>
          <Table>
            <thead><tr><th className="sm:pl-5">Début</th><th>Scénario</th><th className="vc-num">Durée</th><th>Détection</th><th className="vc-num sm:pr-5">Délai</th></tr></thead>
            <tbody>
              {data.episodes.map(e => (
                <tr key={e.debut}><td className="whitespace-nowrap tabular-nums sm:pl-5">{new Date(e.debut).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{SCENARIO_FR[e.scenario] ?? e.scenario}</td><td className="vc-num">{minutes(e.duree_min)}</td>
                  <td>{e.detecte ? <State kind="ok">détecté</State> : <State kind="manque">manqué</State>}</td>
                  <td className="vc-num sm:pr-5">{minutes(e.delai_min)}</td></tr>
              ))}
            </tbody>
          </Table>
        </Section>
        <Section title="Par scénario" subtitle="Répétition 0, rôle choisi." source={data.sources.episodes} flush>
          <Table min={420}>
            <thead><tr><th className="sm:pl-5">Scénario</th><th>Épisodes détectés</th><th className="vc-num sm:pr-5">Délai médian</th></tr></thead>
            <tbody>
              {data.par_scenario.map(s => (
                <tr key={s.scenario}><td className="sm:pl-5">{SCENARIO_FR[s.scenario] ?? s.scenario}</td>
                  <td><span className="inline-flex items-center gap-2"><Tally detected={s.detectes} total={s.episodes} /><span className="tabular-nums text-[13px]">{s.detectes}/{s.episodes}</span></span></td>
                  <td className="vc-num sm:pr-5">{minutes(s.delai_median_min)}</td></tr>
              ))}
            </tbody>
          </Table>
          <div className="px-4 sm:px-5 py-4 text-sm" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{data.alertes.length}</strong> alertes levées, dont{' '}
            <strong style={{ color: fa.length ? 'var(--accent-danger)' : 'var(--text-primary)' }}>{fa.length}</strong> fausse{fa.length > 1 ? 's' : ''} (aucune mesure falsifiée pendant l’alerte).
            {fa.length > 0 && (
              <ul className="mt-2 text-[13px] space-y-1" style={{ color: 'var(--text-muted)' }}>
                {fa.slice(0, 8).map(a => <li key={a.debut} className="flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-warning)' }} aria-hidden />{new Date(a.debut).toLocaleString('fr-FR')} : {minutes(a.duree_min)}, score max {nf(a.score_max, 3)}</li>)}
              </ul>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
