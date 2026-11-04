/** Jeu de données — KPI lus dans transmission_dataset et transmission_episodes (GET /api/v1/etude/dataset). */
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  BandLegend, Empty, Loading, Note, PageHeader, Paper, Readouts, ROLE_FR, SCENARIO_FR, Section, Stat, Table, heure, nf, pct, tooltipStyle, useApi, usePalette,
} from '../../components/etude/kit';

interface RoleRow { lignes: number; evaluees: number; attaques: number; attaques_evaluees: number; part_attaques: number | null; heures: number }
interface Sensor { min: number; max: number; moyenne: number; ecart_type: number | null }
interface Scen { scenario: string; capteur: string | null; duree_moy_min: number | null; lignes: Record<string, number>; episodes: Record<string, number> }
interface DatasetResp {
  run: { id: number; source: string; date: string; repetitions: number; zone_de_garde_min: number | null; features: number };
  total: { lignes: number; debut: string; fin: string; heures: number; attaques: number; evaluees: number; exclues_zone_de_garde: number;
    episodes_rep0: number; episodes_toutes_repetitions: number; repetitions: number; pas_s: number };
  par_role: Record<string, RoleRow>;
  capteurs: Record<string, Sensor>;
  par_scenario: Scen[];
  serie: { ts: string; frigo: number; frigo_reel: number; thermostat: number; meteo: number; attaque: number; role: string }[];
  sources: Record<string, string>;
}

const SENSOR_FR: Record<string, string> = {
  frigo: 'Frigo (mesure réelle)', frigo_transmis: 'Frigo (valeur transmise)', thermostat: 'Thermostat (réel)',
  thermostat_transmis: 'Thermostat (transmis)', meteo: 'Météo',
};

export default function DatasetPage() {
  const { data, error, loading, reload } = useApi<DatasetResp>('/api/v1/etude/dataset');
  const pal = usePalette();
  const header = <PageHeader title="Jeu de données" loading={loading} onRefresh={reload}
    subtitle="Traces réelles TON_IoT (frigo, thermostat, météo) fusionnées à 5 s, avec les attaques de transmission injectées (répétition 0 de l'étude)." />;
  if (!data) return <div className="space-y-5">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  const t = data.total;
  const serie = data.serie.map(p => ({ ...p, zone: p.attaque ? 16 : null }));
  return (
    <div className="space-y-6">
      {header}
      <Readouts cols={5}>
        <Stat label="Mesures au pas de 5 s" value={nf(t.lignes)} sub={`Du ${dateFr2(t.debut)} au ${dateFr2(t.fin)}`} />
        <Stat label="Durée couverte" value={nf(t.heures, 1)} unit="h" sub="3 capteurs alignés sur une grille commune" />
        <Stat label="Mesures falsifiées" value={nf(t.attaques)} tone="var(--accent-danger)" sub={`${pct(t.attaques / t.lignes)} des mesures`} />
        <Stat label="Épisodes d’attaque" value={nf(t.episodes_rep0)} sub={`${nf(t.episodes_toutes_repetitions)} sur les ${t.repetitions} répétitions`} />
        <Stat label="Zone de garde (exclue)" value={nf(t.exclues_zone_de_garde)}
          sub={`${nf(data.run.zone_de_garde_min ?? 0)} min après chaque épisode et en début de bloc qui change de rôle`} />
      </Readouts>

      <Section title="Frigo : valeur transmise et mesure réelle" subtitle="Moyenne par tranche de 2 minutes. Pendant une attaque, la valeur transmise s’écarte de la mesure réelle." source={data.sources.serie}>
        <BandLegend items={[
          { label: 'Valeur transmise', color: pal.series[0], kind: 'line' },
          { label: 'Mesure réelle', color: pal.series[2], kind: 'line' },
          { label: 'Attaque en cours', color: pal.attack },
        ]} />
        <Paper height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serie} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <XAxis dataKey="ts" tickFormatter={heure} minTickGap={48} tick={{ fill: pal.axis, fontSize: 12 }} />
              <YAxis domain={[0, 16]} tick={{ fill: pal.axis, fontSize: 12 }} unit="°" />
              <Tooltip {...tooltipStyle} labelFormatter={v => new Date(String(v)).toLocaleString('fr-FR')}
                formatter={(v, n) => (n === 'Attaque' ? ['oui', n] : [`${nf(Number(v), 2)} °C`, n])} />
              <Area dataKey="zone" name="Attaque" fill={pal.attack} stroke="none" isAnimationActive={false} connectNulls={false} />
              <Line dataKey="frigo_reel" name="Mesure réelle" stroke={pal.series[2]} dot={false} strokeWidth={1.2} isAnimationActive={false} />
              <Line dataKey="frigo" name="Valeur transmise" stroke={pal.series[0]} dot={false} strokeWidth={1.3} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Paper>
      </Section>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Découpage train / validation / test" subtitle="Blocs d'une heure entrelacés (70 / 15 / 15), jamais mélangés ligne à ligne." source={data.sources.par_role}>
          <Table>
            <thead><tr><th>Rôle</th><th className="vc-num">Mesures</th><th className="vc-num">Évaluées</th><th className="vc-num">Falsifiées</th><th className="vc-num">Part d'attaques</th></tr></thead>
            <tbody>
              {(['train', 'val', 'test'] as const).filter(r => data.par_role[r]).map(r => {
                const v = data.par_role[r];
                return (
                  <tr key={r}><td>{ROLE_FR[r]}</td><td className="vc-num">{nf(v.lignes)}</td><td className="vc-num">{nf(v.evaluees)}</td>
                    <td className="vc-num">{nf(v.attaques_evaluees)}</td><td className="vc-num">{pct(v.part_attaques)}</td></tr>
                );
              })}
            </tbody>
          </Table>
          <Note>L'entraînement contient un épisode dans chaque bloc (les modèles supervisés ont besoin d'exemples) ; la validation
            et le test gardent une proportion d'attaques réaliste, qui fixe la précision mesurée.</Note>
        </Section>
        <Section title="Capteurs" subtitle="Statistiques sur toutes les mesures." source={data.sources.capteurs}>
          <Table>
            <thead><tr><th>Série</th><th className="vc-num">Min</th><th className="vc-num">Moyenne</th><th className="vc-num">Max</th><th className="vc-num">Écart-type</th></tr></thead>
            <tbody>
              {Object.entries(data.capteurs).map(([k, v]) => (
                <tr key={k}><td>{SENSOR_FR[k] ?? k}</td><td className="vc-num">{nf(v.min, 2)}</td><td className="vc-num">{nf(v.moyenne, 2)}</td>
                  <td className="vc-num">{nf(v.max, 2)}</td><td className="vc-num">{nf(v.ecart_type, 2)}</td></tr>
              ))}
            </tbody>
          </Table>
        </Section>
      </div>

      <Section title="Scénarios d'attaque injectés" subtitle="Mesures falsifiées et épisodes par rôle (répétition 0)." source={data.sources.par_scenario}>
        <Table>
          <thead><tr><th>Scénario</th><th>Capteur</th><th className="vc-num">Durée moy.</th><th className="vc-num">Épisodes train / val / test</th><th className="vc-num">Mesures falsifiées</th></tr></thead>
          <tbody>
            {data.par_scenario.map(s => (
              <tr key={s.scenario}>
                <td>{SCENARIO_FR[s.scenario] ?? s.scenario}</td><td>{s.capteur === 'fridge' ? 'frigo' : s.capteur ?? '—'}</td>
                <td className="vc-num">{s.duree_moy_min == null ? '—' : `${nf(s.duree_moy_min, 1)}\u00a0min`}</td>
                <td className="vc-num">{['train', 'val', 'test'].map(r => s.episodes[r] ?? 0).join(' / ')}</td>
                <td className="vc-num">{nf(Object.values(s.lignes).reduce((a, b) => a + b, 0))}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </div>
  );
}

function dateFr2(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
