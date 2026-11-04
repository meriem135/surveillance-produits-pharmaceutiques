/** Explicabilité SHAP du meilleur modèle — transmission_shap (GET /api/v1/etude/shap). */
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Empty, Loading, MODEL_FR, Note, PageHeader, SCENARIO_FR, Section, Segmented, nf, tooltipStyle, useApi, usePalette } from '../../components/etude/kit';

interface Feat { rang: number; feature: string; libelle: string; importance: number }
interface ShapResp {
  modele: string | null; n_lignes: number | null; repetitions: number | null;
  global: Feat[]; par_scenario: Record<string, Feat[]>; sources: Record<string, string>;
}

function Bars({ rows, color, height }: { rows: Feat[]; color: string; height: number }) {
  const pal = usePalette();
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const data = rows.map(r => ({ ...r, nom: r.libelle || r.feature }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={pal.grid} horizontal={false} />
          <XAxis type="number" tick={{ fill: pal.axis, fontSize: 12 }} />
          <YAxis type="category" dataKey="nom" width={narrow ? 120 : 220} tick={{ fill: pal.ink, fontSize: narrow ? 11 : 12.5 }} interval={0} />
          <Tooltip {...tooltipStyle} formatter={v => [nf(Number(v), 4), 'importance |SHAP| moyenne']}
            labelFormatter={(_, p) => (p?.[0]?.payload?.feature ? `${p[0].payload.nom} (${p[0].payload.feature})` : '')} />
          <Bar dataKey="importance" fill={color} barSize={14} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ShapPage() {
  const { data, error, loading, reload } = useApi<ShapResp>('/api/v1/etude/shap');
  const pal = usePalette();
  const [sc, setSc] = useState<string | null>(null);
  const header = <PageHeader title="Explicabilité SHAP" loading={loading} onRefresh={reload}
    subtitle="Ce que regarde le meilleur modèle pour signaler une attaque : importance moyenne |SHAP| de chaque feature sur les mesures falsifiées du test." />;
  if (!data) return <div className="space-y-5">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  if (!data.global.length) return <div className="space-y-5">{header}<Empty>Aucune valeur SHAP en base pour cette étude.</Empty></div>;
  const scenarios = Object.keys(data.par_scenario);
  const current = sc ?? scenarios[0];
  return (
    <div className="space-y-6">
      {header}
      <Section title={`Importance globale, ${MODEL_FR[data.modele ?? ''] ?? data.modele}`}
        subtitle={`${nf(data.n_lignes)} mesures falsifiées du test${data.repetitions ? `, ${data.repetitions} rotations` : ''} ; TreeExplainer.`}
        source={data.sources.shap}>
        <Bars rows={data.global} color={pal.series[0]} height={Math.max(260, data.global.length * 26)} />
        <Note>Une valeur SHAP mesure de combien une feature pousse le score vers « attaque » pour une mesure donnée ; la moyenne de sa
          valeur absolue classe les features par influence. Ce n'est pas une causalité : deux features corrélées se partagent l'effet.</Note>
      </Section>
      <Section title="Par scénario" subtitle="Les features les plus influentes changent avec le mécanisme de l'attaque." source={data.sources.shap}>
        <div className="mb-4">
          <Segmented label="Scénario d’attaque" value={current} onChange={setSc}
            options={scenarios.map(s => ({ value: s, label: SCENARIO_FR[s] ?? s }))} />
        </div>
        {current && <Bars rows={data.par_scenario[current]} color={pal.series[1]} height={Math.max(200, data.par_scenario[current].length * 30)} />}
      </Section>
    </div>
  );
}
