/** Jeu de données de l'année simulée 2019 (archive phase 2), onglet de « Jeu annuel simulé ».
 *  GET /api/v1/phase2/dataset-overview (dataset_fusionne.csv) et /api/v1/phase2/fusion-insights (matrices par saison). */
import { Component, Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart,
  ResponsiveContainer, Scatter as RScatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { authHeaders } from '../lib/auth';
import {
  Empty, Loading, Note, Readouts, Section, Segmented, Stat, Table, nf, tooltipStyle, usePalette,
} from '../components/etude/kit';

const API = '/api/v1';
const SRC = 'dataset_fusionne.csv (fichier du jeu annuel simulé)';
const SRC_FUSION = 'dataset_fusionne.csv, calcul fusion-insights (corrélations par saison)';

class ErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

interface DatasetPayload {
  filename: string;
  global: {
    total: number; normal: number; attack: number; attack_pct: number;
    start: string; end: string; duration_days: number;
    sensors: string[];
    stats: Record<string, { min: number; max: number; mean: number; std: number; median: number }>;
  };
  seasonal: Array<{ season: string; label: string; normal: number; attack: number; total: number }>;
  monthly: Array<{ month: number; label: string; normal: number; attack: number; total: number; attack_pct: number }>;
  hourly: Array<{ hour: number; label: string; normal: number; attack: number; total: number }>;
  heatmap_dom_attack: Array<{ day: number; values: number[] }>;
  heatmap_dom_max: number;
  heatmap_hour_pct: Array<{ month: number; label: string; values: number[] }>;
  profiles: { hourly_attack_pct: number[]; seasonal_attack_pct: number[] };
  trends: {
    weather: Array<{ datetime: string; value: number; label: number }>;
    fridge: Array<{ datetime: string; value: number; label: number }>;
    thermostat: Array<{ datetime: string; value: number; label: number }>;
  };
  split_stats: Record<string, { normal: { mean: number; std: number }; attack: { mean: number; std: number } }>;
  scatter: Array<{ weather: number; fridge: number; thermostat: number; label: number }>;
  histograms: Record<string, { bin_centers: number[]; bin_edges: number[]; normal: number[]; attack: number[] }>;
  correlations: { labels: string[]; matrix: number[][] };
  rolling: Array<{ index: number; label: string; attack_rate: number; count: number }>;
  seasonal_sensors: Array<Record<string, string | number>>;
}

interface SeasonCorrSeason { season: string; label: string; matrix: number[][]; pairs: { weather_fridge: number; weather_thermostat: number; fridge_thermostat: number } }
interface SeasonCorrData { seasons: SeasonCorrSeason[]; labels: string[] }
interface ConfusionM { labels: string[]; matrix: number[][]; threshold: number; tpr: number; fpr: number }
interface FusionExtra {
  seasonal_corr: SeasonCorrData | null;
  confusion_matrix: ConfusionM | null;
}

type TabId = 'vue' | 'tendances' | 'distributions' | 'correlations' | 'profils';
const TABS: { value: TabId; label: string }[] = [
  { value: 'vue', label: 'Vue globale' },
  { value: 'distributions', label: 'Distributions' },
  { value: 'tendances', label: 'Tendances capteurs' },
  { value: 'correlations', label: 'Corrélations' },
  { value: 'profils', label: 'Profils saisonniers' },
];

const SENSORS = ['weather', 'fridge', 'thermostat'] as const;
const SENSOR_FR: Record<string, string> = { weather: 'Météo', fridge: 'Frigo', thermostat: 'Thermostat' };
const SEASON_FR: Record<string, string> = { hiver: 'Hiver', printemps: 'Printemps', ete: 'Été', été: 'Été', automne: 'Automne' };
const seasonFr = (s: string) => SEASON_FR[s.toLowerCase()] ?? s;
const dayFr = (s: string) => {
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
const kTick = (v: number) => (v >= 1000 ? `${nf(v / 1000)}k` : nf(v));

/** Cellule de matrice de corrélation : bleu froid si positive, violet si négative ; le chiffre reste lisible. */
function CorrCell({ v, diag, small = false }: { v: number; diag: boolean; small?: boolean }) {
  const pal = usePalette();
  const abs = Math.min(1, Math.abs(v));
  const hue = v >= 0 ? pal.series[0] : pal.series[3];
  const strong = !diag && abs > 0.55;
  return (
    <div className={`${small ? 'h-8 text-[12px]' : 'h-11 text-[13px]'} flex items-center justify-center font-semibold`}
      title={`r = ${nf(v, 3)}`}
      style={{
        background: diag ? 'var(--bg-subtle)' : `color-mix(in srgb, ${hue} ${Math.round(10 + abs * 70)}%, var(--bg-panel))`,
        color: strong ? 'var(--bg-panel)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
      }}>
      {nf(v, 2)}
    </div>
  );
}

function CorrLegend() {
  const pal = usePalette();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3" style={{ background: pal.series[0] }} />corrélation positive</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3" style={{ background: pal.series[3] }} />corrélation négative</span>
      <span>teinte plus forte = |r| plus grand</span>
    </div>
  );
}

// ─── Onglets ─────────────────────────────────────────────────────────────────
function VueGlobale({ data }: { data: DatasetPayload }) {
  const pal = usePalette();
  const g = data.global;
  const seasonal = data.seasonal.map(s => ({ ...s, label: seasonFr(s.label) }));
  const axis = { fill: pal.axis, fontSize: 12 };
  return (
    <div className="space-y-6">
      <Readouts cols={5}>
        <Stat label="Mesures" value={nf(g.total)} />
        <Stat label="Normales" value={nf(g.normal)} tone="var(--accent-primary)" sub={`${nf(100 - g.attack_pct, 1)}\u202f%`} />
        <Stat label="Attaques" value={nf(g.attack)} tone="var(--accent-danger)" sub={`${nf(g.attack_pct, 2)}\u202f%`} />
        <Stat label="Durée" value={nf(g.duration_days)} unit="j" sub={`${dayFr(g.start)} au ${dayFr(g.end)}`} />
        <Stat label="Capteurs" value={nf(g.sensors.length)} sub={g.sensors.map(s => SENSOR_FR[s] ?? s).join(', ')} />
      </Readouts>

      <Section title="Statistiques par capteur" subtitle="Toutes mesures, puis moyenne ± écart-type en fonctionnement normal et sous attaque (°C)." source={SRC} flush>
        <Table min={640}>
          <thead><tr><th>Capteur</th><th className="vc-num">Min</th><th className="vc-num">Max</th><th className="vc-num">Moyenne</th><th className="vc-num">σ</th>
            <th className="vc-num">Médiane</th><th className="vc-num">Normal</th><th className="vc-num">Attaque</th></tr></thead>
          <tbody>
            {Object.entries(g.stats).map(([k, s]) => {
              const sp = data.split_stats[k];
              return (
                <tr key={k}>
                  <td className="font-semibold">{SENSOR_FR[k] ?? k}</td>
                  <td className="vc-num">{nf(s.min, 2)}</td><td className="vc-num">{nf(s.max, 2)}</td><td className="vc-num">{nf(s.mean, 2)}</td>
                  <td className="vc-num">{nf(s.std, 2)}</td><td className="vc-num">{nf(s.median, 2)}</td>
                  <td className="vc-num">{sp ? `${nf(sp.normal.mean, 2)} ± ${nf(sp.normal.std, 2)}` : '—'}</td>
                  <td className="vc-num" style={{ color: 'var(--accent-danger)' }}>{sp ? `${nf(sp.attack.mean, 2)} ± ${nf(sp.attack.std, 2)}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Section>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Répartition par saison" subtitle="Mesures normales et attaquées, empilées." source={SRC}>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={seasonal} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} />
                <YAxis tick={axis} tickFormatter={kTick} />
                <Tooltip {...tooltipStyle} formatter={(v, n) => [nf(Number(v)), n]} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12.5 }} />
                <Bar dataKey="normal" stackId="a" fill={pal.series[0]} name="Normal" maxBarSize={56} isAnimationActive={false} />
                <Bar dataKey="attack" stackId="a" fill={pal.danger} name="Attaque" maxBarSize={56} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Attaques par mois" subtitle="Nombre d'attaques (barres) et part des mesures du mois (ligne)." source={SRC}>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.monthly} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} />
                <YAxis yAxisId="left" tick={axis} />
                <YAxis yAxisId="right" orientation="right" tick={axis} tickFormatter={(v: number) => `${nf(v)}\u202f%`} />
                <Tooltip {...tooltipStyle} formatter={(v, n) => [n === '% attaque' ? `${nf(Number(v), 2)}\u202f%` : nf(Number(v)), n]} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} />
                <Bar yAxisId="left" dataKey="attack" name="Attaques" fill={pal.danger} maxBarSize={28} isAnimationActive={false} />
                <Line yAxisId="right" type="monotone" dataKey="attack_pct" name="% attaque" stroke={pal.ink} strokeWidth={2}
                  dot={{ r: 3, fill: 'var(--bg-panel)' }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>
    </div>
  );
}

interface TrendRow { label: string; isAttack: boolean; [k: string]: string | number | boolean }

function Tendances({ data }: { data: DatasetPayload }) {
  const pal = usePalette();
  const trendData = useMemo<TrendRow[]>(() => {
    const w = data.trends.weather || [];
    return w.map((pt, i) => {
      const dt = pt.datetime;
      return {
        label: dt.length > 10 ? dt.substring(5, 16).replace('T', ' ') : dt,
        weather: pt.value,
        fridge: data.trends.fridge[i]?.value ?? 0,
        thermostat: data.trends.thermostat[i]?.value ?? 0,
        isAttack: pt.label === 1,
      };
    });
  }, [data]);
  const axis = { fill: pal.axis, fontSize: 12 };

  return (
    <div className="grid lg:grid-cols-2 3xl:grid-cols-3 gap-6">
      {SENSORS.map(k => (
        <Section key={k} title={SENSOR_FR[k]} subtitle={`Échantillon de ${nf(trendData.length)} mesures sur l'année (°C).`} source={SRC}>
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} minTickGap={80} />
                <YAxis tick={axis} domain={['auto', 'auto']} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as TrendRow | undefined;
                  if (!row) return null;
                  return (
                    <div className="px-3 py-2" style={tooltipStyle.contentStyle}>
                      <div style={tooltipStyle.labelStyle}>{row.label}</div>
                      <div className="font-semibold mt-0.5">{nf(Number(row[k]), 2)}&nbsp;°C</div>
                      {row.isAttack && <div className="mt-0.5 font-semibold" style={{ color: 'var(--accent-danger)' }}>Mesure attaquée</div>}
                    </div>
                  );
                }} />
                <Line type="monotone" dataKey={k} name={SENSOR_FR[k]} stroke={pal.series[0]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      ))}
    </div>
  );
}

function Distributions({ data }: { data: DatasetPayload }) {
  const pal = usePalette();
  const axis = { fill: pal.axis, fontSize: 12 };
  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-2 3xl:grid-cols-3 gap-6">
        {Object.entries(data.histograms).map(([k, h]) => {
          const chartData = h.bin_centers.map((c, i) => ({ bin: nf(c, 1), Normal: h.normal[i], Attaque: h.attack[i] }));
          return (
            <Section key={k} title={`${SENSOR_FR[k] ?? k} : distribution des températures`} subtitle="Nombre de mesures par classe de température (°C), normal et attaque." source={SRC}>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
                    <CartesianGrid stroke={pal.grid} vertical={false} />
                    <XAxis dataKey="bin" tick={{ ...axis, fontSize: 11 }} interval={3} />
                    <YAxis tick={axis} tickFormatter={kTick} />
                    <Tooltip {...tooltipStyle} labelFormatter={l => `${l}\u00a0°C`} formatter={(v, n) => [nf(Number(v)), n]} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 12.5 }} />
                    <Bar dataKey="Normal" fill={pal.series[0]} isAnimationActive={false} />
                    <Bar dataKey="Attaque" fill={pal.danger} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          );
        })}
      </div>

      <Section title="Part des mesures attaquées par heure" subtitle="Sur toute l'année, à chaque heure de la journée." source={SRC}>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.profiles.hourly_attack_pct.map((v, i) => ({ hour: `${i}h`, pct: v }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={pal.grid} vertical={false} />
              <XAxis dataKey="hour" tick={axis} interval={1} />
              <YAxis tick={axis} tickFormatter={(v: number) => `${nf(v, 1)}\u202f%`} />
              <Tooltip {...tooltipStyle} formatter={v => [`${nf(Number(v), 2)}\u202f%`, 'Mesures attaquées']} />
              <Area type="monotone" dataKey="pct" stroke={pal.danger} strokeWidth={2} fill={pal.attack}
                dot={{ r: 2.5, fill: pal.danger, strokeWidth: 0 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}

function Correlations({ data }: { data: DatasetPayload }) {
  const pal = usePalette();
  const corr = data.correlations;
  const axis = { fill: pal.axis, fontSize: 12 };

  const scatterSeries = useMemo(() => {
    const pairs = [
      { x: 'weather', y: 'fridge', corrVal: corr.matrix[0]?.[1] ?? 0 },
      { x: 'weather', y: 'thermostat', corrVal: corr.matrix[0]?.[2] ?? 0 },
      { x: 'fridge', y: 'thermostat', corrVal: corr.matrix[1]?.[2] ?? 0 },
    ] as const;
    const cap = 400;
    const sample = (arr: DatasetPayload['scatter']) => {
      if (arr.length <= cap) return arr;
      const step = Math.ceil(arr.length / cap);
      return arr.filter((_, i) => i % step === 0);
    };
    const normal = sample(data.scatter.filter(p => p.label === 0));
    const attack = sample(data.scatter.filter(p => p.label === 1));
    return pairs.map(pair => ({
      ...pair,
      normalData: normal.map(p => ({ x: p[pair.x], y: p[pair.y] })),
      attackData: attack.map(p => ({ x: p[pair.x], y: p[pair.y] })),
    }));
  }, [data, corr]);

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-2 3xl:grid-cols-3 gap-6">
        {scatterSeries.map(pair => (
          <Section key={`${pair.x}-${pair.y}`} title={`${SENSOR_FR[pair.x]} et ${SENSOR_FR[pair.y]}`}
            subtitle={<>Coefficient de corrélation r = <strong style={{ color: 'var(--text-primary)' }}>{nf(pair.corrVal, 2)}</strong> ; au plus 400 points par classe.</>}
            source={SRC}>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 8, left: -8, bottom: 4 }}>
                  <CartesianGrid stroke={pal.grid} />
                  <XAxis type="number" dataKey="x" name={SENSOR_FR[pair.x]} tick={axis} domain={['auto', 'auto']} />
                  <YAxis type="number" dataKey="y" name={SENSOR_FR[pair.y]} tick={axis} domain={['auto', 'auto']} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]?.payload as { x: number; y: number } | undefined;
                    return (
                      <div className="px-3 py-2" style={tooltipStyle.contentStyle}>
                        <div>{SENSOR_FR[pair.x]} : {nf(p?.x, 2)}&nbsp;°C</div>
                        <div>{SENSOR_FR[pair.y]} : {nf(p?.y, 2)}&nbsp;°C</div>
                      </div>
                    );
                  }} />
                  <RScatter name="Normal" data={pair.normalData} fill={pal.series[0]} fillOpacity={0.35} isAnimationActive={false} />
                  <RScatter name="Attaque" data={pair.attackData} fill={pal.danger} fillOpacity={0.75} isAnimationActive={false} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12.5 }} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </Section>
        ))}
      </div>

      <Section title="Matrice de corrélation" subtitle="Corrélation de Pearson entre les trois capteurs, sur toute l'année." source={SRC}>
        <div className="overflow-x-auto">
          <div className="grid gap-px w-max" style={{ gridTemplateColumns: `minmax(90px, auto) repeat(${corr.labels.length}, minmax(80px, 110px))`, background: 'var(--border)', border: '1px solid var(--border)' }}>
            <div style={{ background: 'var(--bg-panel)' }} />
            {corr.labels.map(l => (
              <div key={l} className="px-2 py-1.5 text-center text-[12.5px] font-semibold" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>{SENSOR_FR[l] ?? l}</div>
            ))}
            {corr.matrix.map((row, i) => (
              <Fragment key={i}>
                <div className="px-2 flex items-center text-[12.5px] font-semibold" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>{SENSOR_FR[corr.labels[i]] ?? corr.labels[i]}</div>
                {row.map((v, j) => <CorrCell key={j} v={v} diag={i === j} />)}
              </Fragment>
            ))}
          </div>
        </div>
        <div className="mt-3"><CorrLegend /></div>
      </Section>
    </div>
  );
}

function Profils({ data, fusion }: { data: DatasetPayload; fusion: FusionExtra | null }) {
  const pal = usePalette();
  const seasonCorr = fusion?.seasonal_corr ?? null;
  const axis = { fill: pal.axis, fontSize: 12 };
  const seasonal = data.seasonal.map(s => ({ ...s, label: seasonFr(s.label), pct: s.total > 0 ? +(s.attack / s.total * 100).toFixed(1) : 0 }));

  return (
    <div className="space-y-6">
      <Section title="Valeurs par capteur et par saison" subtitle="Moyenne, écart-type et médiane, en °C." source={SRC} flush>
        <Table min={760}>
          <thead>
            <tr>
              <th rowSpan={2}>Saison</th>
              {SENSORS.map(k => <th key={k} colSpan={3} className="text-center">{SENSOR_FR[k]}</th>)}
            </tr>
            <tr>
              {SENSORS.map(k => (
                <Fragment key={k}>
                  <th className="vc-num">Moyenne</th><th className="vc-num">σ</th><th className="vc-num">Médiane</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.seasonal_sensors.map((row, i) => (
              <tr key={i}>
                <td className="font-semibold">{seasonFr(String(row.season))}</td>
                {SENSORS.map(k => (
                  <Fragment key={k}>
                    <td className="vc-num">{nf(Number(row[`${k}_mean`]), 2)}</td>
                    <td className="vc-num" style={{ color: 'var(--text-secondary)' }}>{nf(Number(row[`${k}_std`]), 2)}</td>
                    <td className="vc-num" style={{ color: 'var(--text-secondary)' }}>{nf(Number(row[`${k}_median`]), 2)}</td>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Répartition saisonnière" subtitle="Mesures normales et attaquées (barres empilées), part d'attaques (ligne)." source={SRC}>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={seasonal} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} />
                <YAxis yAxisId="left" tick={axis} tickFormatter={kTick} />
                <YAxis yAxisId="right" orientation="right" tick={axis} tickFormatter={(v: number) => `${nf(v)}\u202f%`} />
                <Tooltip {...tooltipStyle} formatter={(v, n) => [n === '% attaque' ? `${nf(Number(v), 1)}\u202f%` : nf(Number(v)), n]} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} />
                <Bar yAxisId="left" dataKey="normal" stackId="a" fill={pal.series[0]} name="Normal" maxBarSize={56} isAnimationActive={false} />
                <Bar yAxisId="left" dataKey="attack" stackId="a" fill={pal.danger} name="Attaque" maxBarSize={56} isAnimationActive={false} />
                <Line yAxisId="right" type="monotone" dataKey="pct" stroke={pal.ink} strokeWidth={2} dot={{ r: 3.5, fill: 'var(--bg-panel)' }} name="% attaque" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Corrélations 3 × 3 par saison" subtitle="Ordre des lignes et colonnes : météo, frigo, thermostat." source={SRC_FUSION}>
          {!seasonCorr || !seasonCorr.seasons?.length ? (
            <Empty>Matrices non disponibles.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {seasonCorr.seasons.map(s => (
                  <div key={s.season} className="min-w-0">
                    <div className="text-[13px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{seasonFr(s.label)}</div>
                    <div className="grid gap-px" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', background: 'var(--border)', border: '1px solid var(--border)' }}>
                      {s.matrix.map((rowArr, i) => rowArr.map((v, j) => <CorrCell key={`${i}-${j}`} v={v} diag={i === j} small />))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3"><CorrLegend /></div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

// ─── Composant principal ────────────────────────────────────────────────────
export default function DatasetOverview() {
  const [data, setData] = useState<DatasetPayload | null>(null);
  const [fusion, setFusion] = useState<FusionExtra | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('vue');

  useEffect(() => {
    let cancelled = false;
    const headers = authHeaders();
    fetch(`${API}/phase2/dataset-overview`, { headers })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    fetch(`${API}/phase2/fusion-insights`, { headers })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => {
        if (cancelled) return;
        setFusion({
          seasonal_corr: d?.seasonal_corr ?? null,
          confusion_matrix: d?.comparison?.confusion_matrix ?? null,
        });
      })
      .catch(() => { if (!cancelled) setFusion(null); });

    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loading />;

  if (error || !data) {
    return (
      <Empty>
        Impossible de charger le jeu de données.
        {error && <div className="mt-1 text-[12.5px]" style={{ color: 'var(--accent-danger)' }}>{error}</div>}
      </Empty>
    );
  }

  const g = data.global;

  return (
    <ErrorBoundary fallback={<Empty>Erreur d'affichage de cet onglet.</Empty>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] max-w-[90ch]" style={{ color: 'var(--text-secondary)' }}>
            <code>{data.filename}</code> : du {dayFr(g.start)} au {dayFr(g.end)}, {nf(g.duration_days)} jours, {nf(g.total)} mesures.
          </p>
          <Segmented label="Analyse du jeu de données" value={tab} onChange={setTab} options={TABS} />
        </div>

        {tab === 'vue' && <VueGlobale data={data} />}
        {tab === 'tendances' && <Tendances data={data} />}
        {tab === 'distributions' && <Distributions data={data} />}
        {tab === 'correlations' && <Correlations data={data} />}
        {tab === 'profils' && <Profils data={data} fusion={fusion} />}
        {tab === 'tendances' && <Note>Les mesures attaquées sont signalées dans l'infobulle de chaque point.</Note>}
      </div>
    </ErrorBoundary>
  );
}
