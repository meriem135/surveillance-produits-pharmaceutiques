/** Jeu annuel simulé (archive phase 2) : KPIs du jeu 2019 et performance du One-Class SVM.
 *  GET /api/v1/phase2/dataset-kpis (dataset_fusionne.csv + fichiers de résultats d'entraînement), actualisé toutes les 30 s.
 *  L'onglet « Jeu de données » délègue à DatasetOverview (dataset-overview + fusion-insights). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { authHeaders } from '../lib/auth';
import {
  Empty, Loading, Meter, Note, PageHeader, Readouts, Section, Segmented, Stat, Table, nf, pct, tooltipStyle, usePalette,
} from '../components/etude/kit';
import DatasetOverview from './DatasetOverview';

const API = '/api/v1';

// ─── Types : KPIs réels du jeu d'entraînement + modèle ───────────────────────
interface SensorStat { min: number; max: number; mean: number; std: number; median: number }
interface NormalVsAttack { sensor: string; normal_mean: number; attack_mean: number; delta: number }
interface PeakInfo { label: string; attack: number; attack_pct: number; share_of_dataset: number }
interface MonthlyRow { month: number; label: string; normal: number; attack: number; total: number; attack_pct: number }
interface HourlyRow { hour: number; label: string; normal: number; attack: number; total: number }
interface SeasonalRow { season: string; label: string; normal: number; attack: number; total: number }
interface AttackDetection { attack_type: string; attack_id: string; n_total: number; n_detected: number; detection_rate: number; avg_score: number }
interface ShapFeature { feature: string; shap_importance: number }

interface DatasetKpis {
  filename: string;
  total: number; normal: number; attack: number;
  attack_pct: number; normal_pct: number; imbalance_ratio: number;
  duration_days: number; start: string; end: string; interval_min: number;
  sensors: string[]; features: number;
  sensor_stats: Record<string, SensorStat>;
  normal_vs_attack: NormalVsAttack[];
  peaks: { month: PeakInfo | null; hour: PeakInfo | null; season: PeakInfo | null };
  seasonal: SeasonalRow[];
  monthly: MonthlyRow[];
  hourly: HourlyRow[];
  profiles: { hourly_attack_pct: number[]; seasonal_attack_pct: number[] };
}

interface TrainingKpis {
  available: boolean;
  best_model: string | null;
  metrics: null | {
    precision: number; recall: number; f1: number; roc_auc: number; ap: number; fpr: number;
    tp: number; fp: number; fn: number; tn: number; threshold?: number; cv_roc_auc?: number;
  };
  split: null | { n_train?: number; n_val?: number; n_test?: number; n_attack_val?: number; n_attack_test?: number };
  trained_at: string | null;
  attack_detection: AttackDetection[];
  shap_top_features: ShapFeature[];
  n_total_samples?: number | null;
  n_normal_samples?: number | null;
  n_attack_samples?: number | null;
}

interface KpiResponse {
  dataset: DatasetKpis;
  training: TrainingKpis;
  generated_at?: string;
}

const SENSOR_FR: Record<string, string> = { weather: 'Météo', fridge: 'Frigo', thermostat: 'Thermostat' };
const PERIOD_FR: Record<string, string> = { hiver: 'Hiver', printemps: 'Printemps', ete: 'Été', été: 'Été', automne: 'Automne' };
const SRC_DATA = 'dataset_fusionne.csv (fichier du jeu annuel simulé)';
const SRC_TRAIN = 'résultats d’entraînement phase 2 (fichiers JSON du modèle OCSVM)';

/** « 2019-01-01 00:00 » → « 1 janv. 2019 ». */
const dayFr = (s: string) => {
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};

// ─── Onglet KPIs ─────────────────────────────────────────────────────────────
function TabKpis({ data }: { data: KpiResponse }) {
  const pal = usePalette();
  const d = data.dataset;
  const t = data.training;
  const m = t.metrics;

  const sensorChartData = useMemo(() =>
    d.normal_vs_attack.map(n => ({ name: SENSOR_FR[n.sensor] || n.sensor, Normal: n.normal_mean, Attaque: n.attack_mean, delta: n.delta })),
  [d.normal_vs_attack]);

  const hourlyData = useMemo(() =>
    d.hourly.map(h => ({ label: h.label, pct: h.total > 0 ? +((h.attack / h.total) * 100).toFixed(2) : 0 })),
  [d.hourly]);

  const monthlyData = useMemo(() =>
    d.monthly.map(mn => ({ label: mn.label, attack: mn.attack, attack_pct: mn.attack_pct, normal: mn.normal })),
  [d.monthly]);

  const shapData = useMemo(() =>
    (t.shap_top_features || []).slice(0, 8).map(f => ({ name: f.feature.length > 22 ? f.feature.slice(0, 22) + '…' : f.feature, importance: f.shap_importance })),
  [t.shap_top_features]);

  const avgDetection = useMemo(() => {
    if (!t.attack_detection.length) return 0;
    return t.attack_detection.reduce((s, a) => s + a.detection_rate, 0) / t.attack_detection.length;
  }, [t.attack_detection]);

  const splitRows = t.split ? [
    { label: 'Entraînement (mesures normales)', value: t.split.n_train ?? 0, color: pal.series[0] },
    { label: 'Validation', value: t.split.n_val ?? 0, color: pal.series[1] },
    { label: 'Test', value: t.split.n_test ?? 0, color: pal.series[2] },
  ] : [];
  const splitMax = Math.max(...splitRows.map(r => r.value), 1);

  const peaks = [
    { title: 'Mois le plus attaqué', peak: d.peaks.month },
    { title: 'Heure la plus attaquée', peak: d.peaks.hour },
    { title: 'Saison la plus attaquée', peak: d.peaks.season },
  ];
  const peakMax = Math.max(...peaks.map(p => p.peak?.share_of_dataset ?? 0), 1);

  const axis = { fill: pal.axis, fontSize: 12 };

  return (
    <div className="space-y-6">
      <Section title={`Jeu d’entraînement : ${d.filename}`}
        subtitle={`Du ${dayFr(d.start)} au ${dayFr(d.end)}, une mesure toutes les ${nf(d.interval_min)} minutes.`} source={SRC_DATA}>
        <Readouts cols={4}>
          <Stat label="Échantillons" value={nf(d.total)} />
          <Stat label="Normaux" value={nf(d.normal)} tone="var(--accent-primary)" sub={`${nf(d.normal_pct, 1)}\u202f%`} />
          <Stat label="Attaques" value={nf(d.attack)} tone="var(--accent-danger)" sub={`${nf(d.attack_pct, 2)}\u202f%`} />
          <Stat label="Taux d'attaque" value={nf(d.attack_pct, 2)} unit="%" sub={`≈ 1 attaque pour ${nf(d.imbalance_ratio, 1)} normaux`} />
          <Stat label="Durée" value={nf(d.duration_days)} unit="j" />
          <Stat label="Intervalle" value={nf(d.interval_min)} unit="min" />
          <Stat label="Capteurs" value={nf(d.sensors.length)} sub={d.sensors.map(s => SENSOR_FR[s] ?? s).join(', ')} />
          <Stat label="Variables du modèle" value={nf(d.features)} sub="multivariées" />
        </Readouts>
      </Section>

      <Readouts cols={3}>
        {peaks.map(({ title, peak }) => (
          <Stat key={title} label={title} tone="var(--accent-danger)"
            value={peak ? (PERIOD_FR[peak.label] ?? peak.label) : '—'}
            sub={peak ? (
              <>
                {nf(peak.attack)} attaques, {nf(peak.attack_pct, 1)}{'\u202f'}% de ce créneau, {nf(peak.share_of_dataset, 1)}{'\u202f'}% du total
                <div className="mt-2"><Meter value={(peak.share_of_dataset / peakMax) * 100} color="var(--accent-danger)" /></div>
              </>
            ) : undefined} />
        ))}
      </Readouts>

      <div className="grid lg:grid-cols-2 3xl:grid-cols-3 gap-6">
        <Section title="Répartition normal / attaque" source={SRC_DATA}>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {/* Pourcentages dans la légende : des étiquettes autour de l'anneau débordaient du panneau. */}
                <Pie data={[
                  { name: `Normal ${nf(d.normal_pct, 1)}\u202f%`, value: d.normal },
                  { name: `Attaque ${nf(d.attack_pct, 1)}\u202f%`, value: d.attack },
                ]} cx="50%" cy="45%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name"
                  stroke="var(--bg-panel)" isAnimationActive={false}>
                  <Cell fill={pal.series[0]} />
                  <Cell fill={pal.danger} />
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(v, n) => [nf(Number(v)), n]} />
                <Legend verticalAlign="bottom" iconType="square" wrapperStyle={{ fontSize: 12.5 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Attaques par mois" subtitle="Nombre d'attaques (barres) et part des mesures du mois (ligne)." source={SRC_DATA} className="3xl:col-span-2">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
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

        <Section title="Profil d'attaque par heure" subtitle="Part des mesures attaquées à chaque heure de la journée." source={SRC_DATA}>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} interval={3} />
                <YAxis tick={axis} tickFormatter={(v: number) => `${nf(v)}\u202f%`} />
                <Tooltip {...tooltipStyle} formatter={v => [`${nf(Number(v), 2)}\u202f%`, 'Mesures attaquées']} />
                <Area type="monotone" dataKey="pct" name="Mesures attaquées" stroke={pal.danger} strokeWidth={2} fill={pal.attack}
                  dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Température moyenne : normal ou attaque" subtitle="Moyenne de chaque capteur, en °C." source={SRC_DATA}>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sensorChartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis dataKey="name" tick={axis} />
                <YAxis tick={axis} />
                <Tooltip {...tooltipStyle} formatter={(v, n) => [`${nf(Number(v), 2)}\u00a0°C`, n]} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12.5 }} />
                <Bar dataKey="Normal" fill={pal.series[0]} maxBarSize={36} isAnimationActive={false} />
                <Bar dataKey="Attaque" fill={pal.danger} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Statistiques par capteur" subtitle="Toutes mesures confondues, puis moyenne en fonctionnement normal et sous attaque (°C)." source={SRC_DATA} flush
          className="lg:col-span-2 3xl:col-span-1">
          <Table min={560}>
            <thead><tr><th>Capteur</th><th className="vc-num">Min</th><th className="vc-num">Max</th><th className="vc-num">Moyenne</th>
              <th className="vc-num">σ</th><th className="vc-num">Normal</th><th className="vc-num">Attaque</th><th className="vc-num">Écart</th></tr></thead>
            <tbody>
              {d.sensors.map(k => {
                const s = d.sensor_stats[k];
                const nv = d.normal_vs_attack.find(n => n.sensor === k);
                if (!s) return null;
                return (
                  <tr key={k}>
                    <td className="font-semibold">{SENSOR_FR[k] ?? k}</td>
                    <td className="vc-num">{nf(s.min, 2)}</td><td className="vc-num">{nf(s.max, 2)}</td>
                    <td className="vc-num">{nf(s.mean, 2)}</td><td className="vc-num">{nf(s.std, 2)}</td>
                    <td className="vc-num">{nf(nv?.normal_mean, 2)}</td>
                    <td className="vc-num" style={{ color: 'var(--accent-danger)' }}>{nf(nv?.attack_mean, 2)}</td>
                    <td className="vc-num font-semibold">{nv ? `${nv.delta > 0 ? '+' : ''}${nf(nv.delta, 2)}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Section>
      </div>

      <Section title="Performance du modèle entraîné"
        subtitle={t.available && t.trained_at ? `Entraîné le ${new Date(t.trained_at).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}, mesuré sur le test.` : undefined}
        source={SRC_TRAIN}>
        {t.available && m ? (
          <Readouts cols={4}>
            <Stat label="Modèle" value={<span className="text-[22px]">{t.best_model === 'OCSVM_Multivarie' ? 'One-Class SVM multivarié' : (t.best_model || '—')}</span>} />
            <Stat label="F1" value={pct(m.f1)} tone="var(--accent-primary)" />
            <Stat label="ROC-AUC" value={pct(m.roc_auc)} />
            <Stat label="Précision" value={pct(m.precision)} />
            <Stat label="Rappel" value={pct(m.recall)} />
            <Stat label="Taux de faux positifs" value={pct(m.fpr, 2)} tone="var(--alarm-amber-fill)" />
            <Stat label="Détection moyenne par type d'attaque" value={nf(avgDetection, 1)} unit="%" sub={`moyenne sur ${t.attack_detection.length} types`} />
            <Stat label="Attaques dans le test" value={nf(m.tp + m.fn)} tone="var(--accent-danger)" sub={`${nf(m.tp)} détectées, ${nf(m.fn)} manquées`} />
          </Readouts>
        ) : (
          <Empty>Aucun modèle entraîné enregistré : lancez l'entraînement depuis l'onglet ML.</Empty>
        )}
      </Section>

      {t.available && (
        <div className="grid lg:grid-cols-2 3xl:grid-cols-3 gap-6">
          <Section title="Découpage entraînement / validation / test" subtitle="Découpage temporel ; l'entraînement ne voit que des mesures normales." source={SRC_TRAIN}>
            <div className="space-y-3">
              {splitRows.map(r => (
                <div key={r.label}>
                  <div className="flex items-center justify-between gap-3 mb-1 text-[13.5px]">
                    <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
                    <span className="vc-num font-semibold" style={{ color: 'var(--text-primary)' }}>{nf(r.value)}</span>
                  </div>
                  <Meter value={(r.value / splitMax) * 100} color={r.color} />
                </div>
              ))}
              {t.split?.n_attack_test !== undefined && (
                <Note>{nf(t.split.n_attack_test)} attaques dans le test ({nf(t.split.n_attack_val)} en validation).</Note>
              )}
            </div>
          </Section>

          <Section title="Variables les plus influentes (SHAP)" subtitle="Importance moyenne absolue, 8 premières variables." source={SRC_TRAIN} className="3xl:col-span-2">
            {shapData.length > 0 ? (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={shapData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid stroke={pal.grid} horizontal={false} />
                    <XAxis type="number" tick={axis} tickFormatter={(v: number) => nf(v, 2)} />
                    <YAxis type="category" dataKey="name" tick={{ ...axis, fontSize: 11.5 }} width={150} />
                    <Tooltip {...tooltipStyle} formatter={v => [nf(Number(v), 4), 'Importance SHAP']} />
                    <Bar dataKey="importance" name="Importance SHAP" fill={pal.series[0]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <Empty>Aucune donnée SHAP.</Empty>}
          </Section>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
type TabId = 'kpis' | 'dataset';

export default function TableauDeBordPage() {
  const [tab, setTab] = useState<TabId>('kpis');
  const [data, setData] = useState<KpiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const loadKpis = useCallback(async () => {
    try {
      const r = await fetch(`${API}/phase2/dataset-kpis`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling des KPIs (mise à jour dans des callbacks async)
    loadKpis();
    const interval = setInterval(loadKpis, 30000);
    return () => clearInterval(interval);
  }, [loadKpis]);

  return (
    <div className="space-y-6">
      <PageHeader title="Jeu annuel simulé" onRefresh={loadKpis}
        subtitle="Archive de l'année simulée 2019 (phase 2) : jeu dataset_fusionne.csv construit à partir des traces TON_IoT, et performance du One-Class SVM. Ce n'est pas l'étude de référence sur traces réelles.">
        <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Mis à jour à {lastRefresh.toLocaleTimeString('fr-FR')}</span>
      </PageHeader>

      <Segmented label="Vue affichée" value={tab} onChange={setTab}
        options={[{ value: 'kpis', label: 'Indicateurs' }, { value: 'dataset', label: 'Jeu de données' }]} />

      {tab === 'kpis' && (
        loading ? <Loading /> : error || !data ? (
          <Empty>
            Impossible de charger les indicateurs du jeu de données.
            {error && <div className="mt-1 text-[12.5px]" style={{ color: 'var(--accent-danger)' }}>{error}</div>}
          </Empty>
        ) : <TabKpis data={data} />
      )}
      {tab === 'dataset' && <DatasetOverview />}
    </div>
  );
}
