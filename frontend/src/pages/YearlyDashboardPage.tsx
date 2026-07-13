import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, LineChart, Line, Scatter, ComposedChart,
} from 'recharts';
import { motion } from 'framer-motion';

/* ─── Types ─── */
interface KpiData {
  total_points: number; normal_points: number; attack_points: number;
  attack_rate: number; avg_temp_weather: number; avg_temp_fridge: number;
  avg_temp_thermostat: number; min_temp_weather: number; max_temp_weather: number;
}
interface TimelinePoint { doy: number; mean: number; min: number; max: number; attack_value: number | null }
interface MonthlyPoint { month: number; month_name: string; mean: number; min: number; max: number; std: number }
interface SeasonalPoint { season: string; hour: number; mean: number; std: number; color: string }
interface DistPoint { x: number; y: number }
interface FridgeCondition { overall: Record<string,{count:number;pct:number;color:string}>; monthly: Array<{month:number;month_name:string;high:number;medium:number;low:number}> }
interface ThermostatStatus { by_hour: Array<{hour:number;active_pct:number}>; by_month: Array<{month:number;month_name:string;active_pct:number}> }
interface CorrelationMatrix { labels: string[]; matrix: Array<{label:string;values:number[]}> }
interface MlPerformance { roc_auc: number; confusion_matrix: {tn:number;fp:number;fn:number;tp:number}; classification_report: Record<string,any>; feature_importance: Array<{feature:string;importance:number}>; score_distribution: {normal:number[];attack:number[]} }

/* ─── Helpers ─── */
const MONTHS = ['Jan','Fev','Mar','Avr','Mai','Jun','Jul','Aou','Sep','Oct','Nov','Dec'];
const COLORS = { weather: '#5E81AC', fridge: '#A3BE8C', thermostat: '#BF616A', attack: '#E74C3C', normal: '#4CAF50' };

function fmtKpi(val: any, unit = '') {
  if (typeof val === 'number') return val.toLocaleString('fr-FR') + unit;
  return String(val) + unit;
}

/* ─── Custom Tooltip ─── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#262B3A', border: '1px solid #2E3440', borderRadius: 8, padding: '8px 14px', fontSize: 12 }}>
      <div style={{ color: '#81A1C1', marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || '#D8DEE9' }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  );
}

/* ─── Section wrapper ─── */
function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: '#D8DEE9' }}>{title}</h2>
      {desc && <p style={{ color: '#81A1C1', fontSize: 13, marginBottom: 20 }}>{desc}</p>}
      {children}
    </motion.div>
  );
}

function Card({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#1A1D27', border: '1px solid #2E3440', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #2E3440', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h3>
        {tag && <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 8, background: '#262B3A', color: '#88C0D0' }}>{tag}</span>}
      </div>
      <div style={{ padding: '16px 20px 20px' }}>{children}</div>
    </div>
  );
}

/* ─── KpiCard ─── */
function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <motion.div whileHover={{ scale: 1.03 }} style={{ background: '#262B3A', border: '1px solid #2E3440', borderRadius: 10, padding: '18px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#81A1C1', marginTop: 4 }}>{label}</div>
    </motion.div>
  );
}

/* ─── Page principale ─── */
export default function YearlyDashboardPage() {
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [sensor, setSensor] = useState('weather');
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [, setMonthly] = useState<MonthlyPoint[]>([]);
  const [seasonal, setSeasonal] = useState<SeasonalPoint[]>([]);
  const [distrib, setDistrib] = useState<{normal:DistPoint[];attack:DistPoint[]}>({normal:[],attack:[]});
  const [fridge, setFridge] = useState<FridgeCondition | null>(null);
  const [thermo, setThermo] = useState<ThermostatStatus | null>(null);
  const [corr, setCorr] = useState<CorrelationMatrix | null>(null);
  const [mlPerf, setMlPerf] = useState<MlPerformance | null>(null);
  const [attackTL, setAttackTL] = useState<{attacks:any[];normal:any[];injection_dates:string[]} | null>(null);
  const [monthlyComp, setMonthlyComp] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJson = useCallback(async (url: string) => {
    try { const r = await fetch(url); return await r.json(); } catch { return null; }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [k, tl, m, s, d, f, t, cr, ml, at, mc] = await Promise.all([
        fetchJson('/api/yearly/kpi'),
        fetchJson(`/api/yearly/timeline?sensor=${sensor}&start_doy=1&end_doy=365`),
        fetchJson(`/api/yearly/monthly?sensor=${sensor}`),
        fetchJson(`/api/yearly/seasonal?sensor=${sensor}`),
        fetchJson(`/api/yearly/distribution?sensor=${sensor}`),
        fetchJson('/api/yearly/fridge-condition'),
        fetchJson('/api/yearly/thermostat-status'),
        fetchJson('/api/yearly/correlation'),
        fetchJson('/api/yearly/ml-performance'),
        fetchJson('/api/yearly/attack-timeline'),
        fetchJson('/api/yearly/monthly-comparison'),
      ]);
      if (k) setKpi(k);
      if (tl) setTimeline(tl.data);
      if (m) setMonthly(m.data);
      if (s) setSeasonal(s.data);
      if (d) setDistrib({ normal: d.normal, attack: d.attack });
      if (f) setFridge(f);
      if (t) setThermo(t);
      if (cr) setCorr(cr);
      if (ml) setMlPerf(ml);
      if (at) setAttackTL(at);
      if (mc) setMonthlyComp(mc.data);
      setLoading(false);
    }
    load();
  }, [sensor, fetchJson]);

  useEffect(() => {
    async function updateSensor() {
      const [tl, m, s, d] = await Promise.all([
        fetchJson(`/api/yearly/timeline?sensor=${sensor}&start_doy=1&end_doy=365`),
        fetchJson(`/api/yearly/monthly?sensor=${sensor}`),
        fetchJson(`/api/yearly/seasonal?sensor=${sensor}`),
        fetchJson(`/api/yearly/distribution?sensor=${sensor}`),
      ]);
      if (tl) setTimeline(tl.data);
      if (m) setMonthly(m.data);
      if (s) setSeasonal(s.data);
      if (d) setDistrib({ normal: d.normal, attack: d.attack });
    }
    updateSensor();
  }, [sensor, fetchJson]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#81A1C1' }}>
        Chargement du dashboard annuel...
      </div>
    );
  }

  const sensorColors = ['#5E81AC', '#A3BE8C', '#BF616A'];
  const sensorNames = ['Weather', 'Fridge', 'Thermostat'];
  const sensors = ['weather', 'fridge', 'thermostat'];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* ─── HEADER ─── */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, background: 'linear-gradient(90deg, #5E81AC, #88C0D0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Dashboard Annuel IoT 2019
        </h1>
        <p style={{ color: '#81A1C1', fontSize: 13, marginTop: 4 }}>
          105 120 points &bull; 3 capteurs &bull; 365 jours &bull; 9 types d'attaque &bull; Isolation Forest
        </p>
      </div>

      {/* ─── KPI ROW ─── */}
      <Section title="Indicateurs clés" desc="Vue d'ensemble des données annuelles générées">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
          {kpi && <>
            <KpiCard label="Points mesurés" value={fmtKpi(kpi.total_points)} color="#5E81AC" />
            <KpiCard label="Données normales" value={fmtKpi(kpi.normal_points)} color="#4CAF50" />
            <KpiCard label="Points d'attaque" value={fmtKpi(kpi.attack_points)} color="#E74C3C" />
            <KpiCard label="Taux d'attaque" value={fmtKpi(kpi.attack_rate, '%')} color="#EBCB8B" />
            <KpiCard label="Ø Weather" value={fmtKpi(kpi.avg_temp_weather, '°C')} color="#5E81AC" />
            <KpiCard label="Ø Fridge" value={fmtKpi(kpi.avg_temp_fridge, '°C')} color="#A3BE8C" />
            <KpiCard label="Ø Thermostat" value={fmtKpi(kpi.avg_temp_thermostat, '°C')} color="#BF616A" />
            <KpiCard label="Étendue Weather" value={`${fmtKpi(kpi.min_temp_weather)}~${fmtKpi(kpi.max_temp_weather)}°C`} color="#D08770" />
          </>}
        </div>
      </Section>

      {/* ─── TIMELINE ─── */}
      <Section title="Timeline annuelle" desc="Sélectionnez un capteur pour voir son évolution sur 365 jours avec les attaques">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {sensors.map(s => (
            <button key={s} onClick={() => setSensor(s)}
              style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${s === sensor ? COLORS[s as keyof typeof COLORS] : '#2E3440'}`, background: s === sensor ? '#262B3A' : 'transparent', color: s === sensor ? COLORS[s as keyof typeof COLORS] : '#81A1C1', cursor: 'pointer', fontWeight: s === sensor ? 600 : 400, fontSize: 13 }}>
              {sensorNames[sensors.indexOf(s)]}
            </button>
          ))}
        </div>
        <Card title={`${sensorNames[sensors.indexOf(sensor)]} — Température quotidienne`} tag="moyenne ± min/max">
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={timeline} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2E3440" />
              <XAxis dataKey="doy" tick={{ fill: '#81A1C1', fontSize: 11 }} tickFormatter={(v: number) => MONTHS[Math.floor(v / 30.4)]} />
              <YAxis tick={{ fill: '#81A1C1', fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="max" fill="none" stroke="transparent" />
              <Area type="monotone" dataKey="min" fill="none" stroke="transparent" />
              <Area type="monotone" dataKey="mean" stroke={COLORS[sensor as keyof typeof COLORS]} fill={COLORS[sensor as keyof typeof COLORS]} fillOpacity={0.15} strokeWidth={2} name="Moyenne" dot={false} />
              <Scatter dataKey="attack_value" fill="#E74C3C" name="Attaque" r={3} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </Section>

      {/* ─── MONTHLY COMPARISON ─── */}
      <Section title="Comparaison mensuelle des 3 capteurs" desc="Moyennes mensuelles superposées">
        <Card title="Moyenne mensuelle par capteur" tag="3 capteurs">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2E3440" />
              <XAxis dataKey="month_name" tick={{ fill: '#81A1C1', fontSize: 11 }} />
              <YAxis tick={{ fill: '#81A1C1', fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#D8DEE9' }} />
              {sensors.map((s, i) => (
                <Line key={s} data={monthlyComp.filter(d => d.sensor === s)} type="monotone" dataKey="value" stroke={sensorColors[i]} strokeWidth={2} name={sensorNames[i]} dot={{ r: 3 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </Section>

      {/* ─── SEASONAL ─── */}
      <Section title="Profils saisonniers" desc="Cycle journalier moyen par saison (24h)">
        <Card title={`${sensorNames[sensors.indexOf(sensor)]} — Profil 24h`} tag="4 saisons">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={seasonal.filter((_, i) => i < 24)} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2E3440" />
              <XAxis dataKey="hour" tick={{ fill: '#81A1C1', fontSize: 11 }} domain={[0, 23]} />
              <YAxis tick={{ fill: '#81A1C1', fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#D8DEE9' }} />
              {['winter','spring','summer','autumn'].map(season => {
                const seasonData = seasonal.filter(s => s.season === season);
                const colorMap: Record<string,string> = { winter: '#5E81AC', spring: '#A3BE8C', summer: '#EBCB8B', autumn: '#D08770' };
                return <Line key={season} data={seasonData} type="monotone" dataKey="mean" stroke={colorMap[season]} strokeWidth={2} name={{winter:'Hiver',spring:'Printemps',summer:'Été',autumn:'Automne'}[season]} dot={false} />;
              })}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </Section>

      {/* ─── ATTACK TIMELINE ─── */}
      {attackTL && (
        <Section title="Distribution des attaques" desc="3 vagues d'injection : 15 février, 15 juin, 15 octobre">
          <Card title="Points normaux vs attaque par jour" tag="87.7% d'attaque">
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={attackTL.normal.map((n: any, i: number) => ({ doy: n.doy, normal: n.count, attack: attackTL.attacks[i]?.count || 0 }))} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2E3440" />
                <XAxis dataKey="doy" tick={{ fill: '#81A1C1', fontSize: 11 }} tickFormatter={(v: number) => MONTHS[Math.floor(v / 30.4)]} />
                <YAxis tick={{ fill: '#81A1C1', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#D8DEE9' }} />
                <Area type="monotone" dataKey="normal" stackId="1" stroke="#4CAF50" fill="#4CAF50" fillOpacity={0.3} name="Normal" />
                <Area type="monotone" dataKey="attack" stackId="1" stroke="#E74C3C" fill="#E74C3C" fillOpacity={0.7} name="Attaque" />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              {attackTL.injection_dates.map(d => (
                <span key={d} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: '#262B3A', color: '#FFD700', border: '1px solid #FFD700' }}>Injection: {d}</span>
              ))}
            </div>
          </Card>
        </Section>
      )}

      {/* ─── DISTRIBUTIONS ─── */}
      <Section title="Distributions Normal vs Attaque" desc="Comparaison des densités de température">
        <Card title={`${sensorNames[sensors.indexOf(sensor)]}`} tag="KDE">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={distrib.normal.map((n, i) => ({ x: n.x, normal: n.y, attack: distrib.attack[i]?.y || 0 }))} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2E3440" />
              <XAxis dataKey="x" tick={{ fill: '#81A1C1', fontSize: 11 }} />
              <YAxis tick={{ fill: '#81A1C1', fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#D8DEE9' }} />
              <Area type="monotone" dataKey="normal" fill="#4CAF50" stroke="#4CAF50" fillOpacity={0.3} name="Normal" />
              <Area type="monotone" dataKey="attack" fill="#E74C3C" stroke="#E74C3C" fillOpacity={0.3} name="Attaque" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </Section>

      {/* ─── MONTHLY BOXPLOT STYLE ─── */}
      <Section title="Boxplots mensuels" desc="Min, moyenne, max par mois pour les 3 capteurs">
        <Card title="Étendue mensuelle" tag="3 capteurs">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2E3440" />
              <XAxis dataKey="month_name" tick={{ fill: '#81A1C1', fontSize: 11 }} />
              <YAxis tick={{ fill: '#81A1C1', fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#D8DEE9' }} />
              {sensors.map((s, i) => {
                const sensorMonthly = monthlyComp.filter(d => d.sensor === s);
                return <Line key={s} data={sensorMonthly} type="monotone" dataKey="value" stroke={sensorColors[i]} strokeWidth={2} name={sensorNames[i]} dot={{ r: 4 }} />;
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </Section>

      {/* ─── FRIDGE CONDITION ─── */}
      {fridge && (
        <Section title="Analyse Fridge — Température condition" desc="Répartition high/medium/low sur l'année">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
            <Card title="Répartition globale" tag="pie">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 0' }}>
                {Object.entries(fridge.overall).map(([cond, data]) => (
                  <div key={cond} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#262B3A', borderRadius: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: data.color }} />
                      <span style={{ fontSize: 13, textTransform: 'capitalize' }}>{cond}</span>
                    </div>
                    <span style={{ fontWeight: 600, color: data.color }}>{data.pct}%</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Évolution mensuelle" tag="stacked">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={fridge.monthly} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2E3440" />
                  <XAxis dataKey="month_name" tick={{ fill: '#81A1C1', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#81A1C1', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="high" fill="#BF616A" name="High" stackId="a" />
                  <Bar dataKey="medium" fill="#EBCB8B" name="Medium" stackId="a" />
                  <Bar dataKey="low" fill="#A3BE8C" name="Low" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </Section>
      )}

      {/* ─── THERMOSTAT STATUS ─── */}
      {thermo && (
        <Section title="Analyse Thermostat — Activation du chauffage" desc="Pattern horaire et mensuel">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card title="Par heure" tag="cycle 24h">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={thermo.by_hour} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2E3440" />
                  <XAxis dataKey="hour" tick={{ fill: '#81A1C1', fontSize: 11 }} domain={[0, 23]} />
                  <YAxis tick={{ fill: '#81A1C1', fontSize: 11 }} unit="%" />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="active_pct" fill="#BF616A" stroke="#BF616A" fillOpacity={0.2} strokeWidth={2} name="Chauffage" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Par mois" tag="saisonnier">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={thermo.by_month} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2E3440" />
                  <XAxis dataKey="month_name" tick={{ fill: '#81A1C1', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#81A1C1', fontSize: 11 }} unit="%" />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="active_pct" fill="#BF616A" radius={[4, 4, 0, 0]} name="Chauffage" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </Section>
      )}

      {/* ─── CORRELATION ─── */}
      {corr && (
        <Section title="Matrice de corrélation" desc="Relations linéaires entre les 7 features">
          <Card title="Pearson Correlation" tag="heatmap">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, margin: '0 auto' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 10px' }}></th>
                    {corr.labels.map((l: string) => <th key={l} style={{ padding: '6px 10px', color: '#81A1C1', fontWeight: 600, fontSize: 10 }}>{l}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {corr.matrix.map((row: any) => (
                    <tr key={row.label}>
                      <td style={{ padding: '6px 10px', color: '#81A1C1', fontWeight: 600, fontSize: 10 }}>{row.label}</td>
                      {row.values.map((v: number, j: number) => {
                        const abs = Math.abs(v);
                        const fg = abs > 0.5 ? '#fff' : '#D8DEE9';
                        return (
                          <td key={j} style={{
                            padding: '6px 10px', textAlign: 'center',
                            background: `rgba(${v > 0 ? '46, 52, 64' : '191, 97, 106'}, ${abs * 0.6 + 0.1})`,
                            color: fg, fontWeight: abs > 0.5 ? 700 : 400,
                            borderRadius: 4,
                          }}>
                            {v.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>
      )}

      {/* ─── ML PERFORMANCE ─── */}
      {mlPerf && (
        <Section title="Machine Learning — Isolation Forest" desc="Détection d'anomalies sur les données annuelles">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
            <KpiCard label="ROC AUC" value={mlPerf.roc_auc.toFixed(3)} color="#5E81AC" />
            <KpiCard label="Précision Attaque" value={(mlPerf.classification_report?.Attaque?.precision || 0).toFixed(3)} color="#A3BE8C" />
            <KpiCard label="Rappel Attaque" value={(mlPerf.classification_report?.Attaque?.recall || 0).toFixed(3)} color="#EBCB8B" />
            <KpiCard label="F1 Attaque" value={(mlPerf.classification_report?.Attaque?.['f1-score'] || 0).toFixed(3)} color="#BF616A" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card title="Matrice de confusion" tag={`AUC = ${mlPerf.roc_auc}`}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 280, margin: '0 auto' }}>
                {[
                  { label: 'VN (Normal→Normal)', value: mlPerf.confusion_matrix.tn, color: '#4CAF50' },
                  { label: 'FP (Normal→Attaque)', value: mlPerf.confusion_matrix.fp, color: '#EBCB8B' },
                  { label: 'FN (Attaque→Normal)', value: mlPerf.confusion_matrix.fn, color: '#D08770' },
                  { label: 'VP (Attaque→Attaque)', value: mlPerf.confusion_matrix.tp, color: '#E74C3C' },
                ].map(cell => (
                  <div key={cell.label} style={{ background: '#262B3A', borderRadius: 8, padding: '14px 10px', textAlign: 'center', border: `1px solid ${cell.color}40` }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: cell.color }}>{cell.value}</div>
                    <div style={{ fontSize: 9, color: '#81A1C1', marginTop: 4 }}>{cell.label}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Importance des features" tag="top facteurs">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {mlPerf.feature_importance.slice(0, 7).map((f, i) => {
                  const colors = ['#5E81AC','#A3BE8C','#BF616A','#EBCB8B','#D08770','#B48EAD','#88C0D0'];
                  return (
                    <div key={f.feature} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, color: '#81A1C1', minWidth: 100 }}>{f.feature}</span>
                      <div style={{ flex: 1, height: 18, background: '#262B3A', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${f.importance * 100}%`, height: '100%', background: colors[i % colors.length], borderRadius: 4, transition: 'width 0.5s' }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: colors[i % colors.length], minWidth: 40, textAlign: 'right' }}>
                        {(f.importance * 100).toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
          <div style={{ marginTop: 16 }}>
            <Card title="Rapport de classification" tag="détaillé">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #2E3440', color: '#81A1C1', fontSize: 11, textTransform: 'uppercase' }}>Classe</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '2px solid #2E3440', color: '#81A1C1', fontSize: 11, textTransform: 'uppercase' }}>Precision</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '2px solid #2E3440', color: '#81A1C1', fontSize: 11, textTransform: 'uppercase' }}>Recall</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '2px solid #2E3440', color: '#81A1C1', fontSize: 11, textTransform: 'uppercase' }}>F1</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '2px solid #2E3440', color: '#81A1C1', fontSize: 11, textTransform: 'uppercase' }}>Support</th>
                  </tr>
                </thead>
                <tbody>
                  {['Normal', 'Attaque'].map(cls => {
                    const r = mlPerf.classification_report[cls];
                    if (!r) return null;
                    return (
                      <tr key={cls}>
                        <td style={{ padding: '8px 12px', borderBottom: '1px solid #262B3A', color: cls === 'Normal' ? '#4CAF50' : '#E74C3C', fontWeight: 600 }}>{cls}</td>
                        <td style={{ padding: '8px 12px', borderBottom: '1px solid #262B3A', textAlign: 'right' }}>{(r.precision || 0).toFixed(3)}</td>
                        <td style={{ padding: '8px 12px', borderBottom: '1px solid #262B3A', textAlign: 'right' }}>{(r.recall || 0).toFixed(3)}</td>
                        <td style={{ padding: '8px 12px', borderBottom: '1px solid #262B3A', textAlign: 'right', fontWeight: 600 }}>{(r['f1-score'] || 0).toFixed(3)}</td>
                        <td style={{ padding: '8px 12px', borderBottom: '1px solid #262B3A', textAlign: 'right' }}>{r.support || 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        </Section>
      )}
    </div>
  );
}
