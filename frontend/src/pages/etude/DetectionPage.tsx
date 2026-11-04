/** Détection vs réalité — alertes du meilleur modèle face aux épisodes d'attaque réels, dans le temps.
 *  GET /api/v1/etude/timeline : transmission_dataset ⋈ transmission_predictions, transmission_alerts,
 *  transmission_episodes, transmission_metrics. */
import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  Empty, Loading, MODEL_FR, Note, PageHeader, Pill, ROLE_FR, SCENARIO_FR, Section, Table, heure, minutes, nf, pct,
  tooltipStyle, useApi, usePalette,
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

function Confusion({ f }: { f: Fit }) {
  const cell = (label: string, v: number, good: boolean) => (
    <div className="rounded-md p-2 text-center" style={{ background: good ? 'color-mix(in srgb, var(--accent-success) 10%, transparent)' : 'color-mix(in srgb, var(--accent-danger) 9%, transparent)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-base font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{nf(v)}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {cell('attaque signalée', f.tp, true)}{cell('attaque ratée', f.fn, false)}
      {cell('normal signalé', f.fp, false)}{cell('normal non signalé', f.tn, true)}
    </div>
  );
}

export default function DetectionPage() {
  const [role, setRole] = useState<string>('test');
  const { data, error, loading, reload } = useApi<TimelineResp>(`/api/v1/etude/timeline?role=${role}&minutes=1`);
  const pal = usePalette();
  const serie = useMemo(() => (data?.serie ?? []).map(p => ({ ...p, reel: p.attaque ? 1.04 : null, detecte: p.alarme ? 1.0 : null })), [data]);
  const header = (
    <PageHeader title="Détection vs réalité" loading={loading} onRefresh={reload}
      subtitle="Le modèle apprend-il vraiment les attaques ? Ses alertes, minute par minute, face aux épisodes réellement injectés (répétition 0).">
      <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {ROLES.map(r => (
          <button key={r} onClick={() => setRole(r)} className="px-3 py-1.5 text-sm"
            style={r === role ? { background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' } : { background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
            {ROLE_FR[r]}
          </button>
        ))}
      </div>
    </PageHeader>
  );
  if (!data) return <div className="space-y-4">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  const fit = data.ajustement;
  const fa = data.alertes.filter(a => !a.vraie);
  return (
    <div className="space-y-5">
      {header}
      <Section title={`${ROLE_FR[data.role]} : score du modèle et attaques réelles`}
        subtitle={`${MODEL_FR[data.modele] ?? data.modele} — score maximal par minute ; bande rouge = attaque réelle, bande orange = alerte levée (après persistance).`}
        source={data.sources.serie}>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serie} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" />
              <XAxis dataKey="ts" tickFormatter={heure} minTickGap={48} tick={{ fill: pal.axis, fontSize: 11 }} />
              <YAxis domain={[0, 1.08]} tick={{ fill: pal.axis, fontSize: 11 }} />
              <Tooltip {...tooltipStyle} labelFormatter={v => new Date(String(v)).toLocaleString('fr-FR')}
                formatter={(v, n) => (n === 'Score max' ? [nf(Number(v), 3), n] : ['oui', n])} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="reel" name="Attaque réelle" fill={pal.attack} stroke="none" isAnimationActive={false} />
              <Area dataKey="detecte" name="Alerte levée" fill={pal.alert} fillOpacity={0.25} stroke="none" isAnimationActive={false} />
              <Line dataKey="score_max" name="Score max" stroke={pal.series[0]} dot={false} strokeWidth={1.2} isAnimationActive={false} />
              {data.seuil != null && <ReferenceLine y={data.seuil} stroke={pal.axis} strokeDasharray="4 4" label={{ value: `seuil ${nf(data.seuil, 2)}`, fill: pal.axis, fontSize: 11, position: 'insideTopRight' }} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Note>Les blocs d'une heure d'un même rôle sont mis bout à bout ; les lignes en zone de garde ne sont pas évaluées.</Note>
      </Section>

      <div className="grid lg:grid-cols-3 gap-5">
        {ROLES.map(r => {
          const f = fit[r]?.alarme;
          return (
            <Section key={r} title={`Ajustement — ${ROLE_FR[r]}`} subtitle="Mesures (après persistance), cumul des répétitions." source={data.sources.ajustement}>
              {f ? (
                <>
                  <Confusion f={f} />
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>Rappel</span><span className="text-right tabular-nums">{pct(f.recall)}</span>
                    <span>Précision</span><span className="text-right tabular-nums">{pct(f.precision)}</span>
                    <span>F1</span><span className="text-right tabular-nums">{nf(f.f1, 3)}</span>
                    <span>AP (sans seuil)</span><span className="text-right tabular-nums">{nf(f.avg_precision, 3)}</span>
                    <span>Fausses alertes / h</span><span className="text-right tabular-nums">{nf(f.fausses_alertes_par_heure, 2)}</span>
                    <span>Épisodes détectés</span><span className="text-right tabular-nums">{f.episodes_detectes}/{f.episodes}</span>
                  </div>
                </>
              ) : <Empty>—</Empty>}
            </Section>
          );
        })}
      </div>
      <Note>Un modèle presque parfait sur l'entraînement mais nettement moins bon en validation et en test sur-apprend ; un modèle médiocre
        partout sous-apprend. Voir aussi la courbe d'apprentissage dans « Résultats ».</Note>

      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Épisodes réels et détection" subtitle={`${data.episodes.length} épisodes en ${ROLE_FR[data.role].toLowerCase()} (répétition 0).`} source={data.sources.episodes}>
          <Table>
            <thead><tr><th>Début</th><th>Scénario</th><th className="vc-num">Durée</th><th>Détecté</th><th className="vc-num">Délai</th></tr></thead>
            <tbody>
              {data.episodes.map(e => (
                <tr key={e.debut}><td className="whitespace-nowrap">{new Date(e.debut).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{SCENARIO_FR[e.scenario] ?? e.scenario}</td><td className="vc-num">{minutes(e.duree_min)}</td>
                  <td>{e.detecte ? <Pill tone="var(--accent-success)"><CheckCircle2 className="w-3 h-3" />oui</Pill> : <Pill tone="var(--accent-danger)"><XCircle className="w-3 h-3" />non</Pill>}</td>
                  <td className="vc-num">{minutes(e.delai_min)}</td></tr>
              ))}
            </tbody>
          </Table>
        </Section>
        <Section title="Par scénario" subtitle="Répétition 0, rôle choisi." source={data.sources.episodes}>
          <Table>
            <thead><tr><th>Scénario</th><th className="vc-num">Épisodes détectés</th><th className="vc-num">Délai médian</th></tr></thead>
            <tbody>
              {data.par_scenario.map(s => (
                <tr key={s.scenario}><td>{SCENARIO_FR[s.scenario] ?? s.scenario}</td><td className="vc-num">{s.detectes}/{s.episodes}</td><td className="vc-num">{minutes(s.delai_median_min)}</td></tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Alertes levées : <strong>{data.alertes.length}</strong>, dont <strong>{fa.length}</strong> fausse(s) (aucune mesure falsifiée).
          </div>
          {fa.length > 0 && (
            <ul className="mt-2 text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
              {fa.slice(0, 8).map(a => <li key={a.debut}>{new Date(a.debut).toLocaleString('fr-FR')} — {minutes(a.duree_min)}, score max {nf(a.score_max, 3)}</li>)}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
