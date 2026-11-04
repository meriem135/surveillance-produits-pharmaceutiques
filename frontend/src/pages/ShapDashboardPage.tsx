/**
 * Analyse SHAP de l'année simulée 2019 (archive phase 2, modèle OneClassSVM).
 * GET /api/shap/yearly (importance globale, par mois, par saison), GET /api/shap/hourly (profil horaire),
 * GET /api/v1/phase2/attack-dataset (lignes du jeu de données), puis pour un point :
 * GET /api/shap/point + POST /api/v1/pharma/point-report (voir ShapPointReport).
 */
import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Filter, Loader2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/components/ui/use-toast';
import {
  BandLegend, Empty, Loading, Note, PageHeader, Readouts, Section, Segmented, Stat, State, Table, nf, pct, tooltipStyle, usePalette,
} from '../components/etude/kit';
import ShapPointReport, {
  GROUP_LABELS, MONTHS, SEASON_LABELS, loadPointReport, reportHref, type PharmaReportResponse, type ShapPointResponse,
} from '../components/ShapPointReport';

// ─── Types de l'API ──────────────────────────────────────────────────────────
interface ShapGlobalItem { feature: string; label: string; group: string; shap_importance: number }
interface ShapRow { month?: number; month_name?: string; hour?: number; hour_label?: string; count: number; [key: string]: number | string | undefined }
interface ShapSeasonal { [season: string]: { count: number; importance: { feature: string; label: string; shap_importance: number }[] } }
interface ShapYearlyResponse {
  available: boolean; error?: string; n_samples: number; n_anomalies: number; shap_method?: string; model_kind?: string;
  n_attacks_sample?: number; n_normals_sample?: number; n_anomalies_pool?: number; stratified?: boolean; sampling_note?: string;
  n_real_attacks?: number; n_real_days?: number;
  detection_metrics?: { tp: number; fp: number; fn: number; recall: number; precision: number; f1: number; scored_n: number; scored_on: string };
  attack_importance?: ShapGlobalItem[]; normal_importance?: ShapGlobalItem[]; low_sample_warning?: string | null;
  global_importance: ShapGlobalItem[]; group_importance: Record<string, number>; monthly_shap: ShapRow[];
  seasonal_breakdown: ShapSeasonal; feature_names: string[];
}
interface ShapHourlyResponse { available: boolean; n_samples: number; shap_method?: string; low_sample_warning?: string | null; hours: ShapRow[]; feature_names: string[] }
interface AttackDatasetRow {
  datetime: string; weather_temp: number; fridge_temp: number; thermostat_temp: number;
  weather_fridge_diff: number; weather_thermostat_diff: number; fridge_thermostat_diff: number;
  label: number; prediction: number; anomaly_score: number;
}
interface AttackDatasetResponse {
  available: boolean; rows: AttackDatasetRow[]; total: number; page: number; page_size: number; total_pages: number; error?: string;
  summary?: { total: number; normal: number; attack: number; detected: number; recall: number };
}

type Filters = { day: number | ''; month: number | ''; season: string; hour: number | '' };
const NO_FILTERS: Filters = { day: '', month: '', season: '', hour: '' };
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const SEASON_API: Record<string, string> = { winter: 'hiver', spring: 'printemps', summer: 'ete', autumn: 'automne' };
/** Ordre des groupes de variables dans la palette (bleu froid = thermostat, encre = frigo…). */
const GROUP_ORDER = ['thermostat', 'fridge', 'weather', 'cross', 'time', 'other'];
/** Libellé français d'une variable du modèle (ex. fridge_roll_std_10 → « Frigo σ₁₀ »). */
const FEATURE_FIXED: Record<string, string> = {
  hour_sin: 'Heure (sin)', hour_cos: 'Heure (cos)', season_sin: 'Saison (sin)', season_cos: 'Saison (cos)',
  fridge_cond_enc: 'État du frigo', thermo_status: 'État du thermostat',
  weather_fridge_diff: 'Écart météo-frigo', weather_thermostat_diff: 'Écart météo-thermostat', fridge_thermostat_diff: 'Écart frigo-thermostat',
};
const SENSOR_FR: Record<string, string> = { weather: 'Météo', fridge: 'Frigo', thermostat: 'Thermostat', thermo: 'Thermostat' };
const SUFFIX_FR: Record<string, string> = { temp: 'T°', diff_1: 'Δ₁', roll_mean_10: 'μ₁₀', roll_std_10: 'σ₁₀' };
const featureFr = (f: string) => {
  if (FEATURE_FIXED[f]) return FEATURE_FIXED[f];
  const [head, ...rest] = f.split('_');
  const suf = SUFFIX_FR[rest.join('_')];
  return SENSOR_FR[head] && suf ? `${SENSOR_FR[head]} ${suf}` : f;
};
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const hh = (h: number) => `${String(h).padStart(2, '0')} h`;

// ─── Carte de chaleur : variables en lignes, périodes en colonnes ───────────
function Heatmap({ rows, cols, value, color, colLabel }: {
  rows: { key: string; label: string }[]; cols: ShapRow[]; value: (c: ShapRow, f: string) => number; color: string; colLabel: (c: ShapRow) => string;
}) {
  const max = Math.max(0.0001, ...cols.flatMap(c => rows.map(r => value(c, r.key))));
  const fill = (v: number) => `color-mix(in srgb, ${color} ${Math.round(6 + (v / max) * 88)}%, var(--bg-panel))`;
  return (
    <div>
      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
        <table className="w-full text-[12px]" style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="text-left font-normal pr-2" style={{ color: 'var(--text-muted)' }} scope="col">Variable</th>
              {cols.map(c => <th key={colLabel(c)} scope="col" className="font-normal px-0.5 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{colLabel(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <th scope="row" className="text-left font-normal pr-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.label}</th>
                {cols.map(c => {
                  const v = value(c, r.key);
                  return <td key={colLabel(c)} title={`${r.label}, ${colLabel(c)} : ${nf(v, 4)} (n = ${c.count})`}
                    style={{ minWidth: 26, height: 20, background: fill(v), borderRadius: 2 }} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-3 text-[12.5px]" style={{ color: 'var(--text-secondary)' }} aria-hidden>
        Faible
        {[0.05, 0.3, 0.55, 0.8, 1].map(s => <span key={s} className="w-5 h-3" style={{ background: fill(s * max) }} />)}
        Fort (max {nf(max, 3)})
      </div>
    </div>
  );
}

export default function ShapDashboardPage() {
  const pal = usePalette();
  const [yearlyData, setYearlyData] = useState<ShapYearlyResponse | null>(null);
  const [hourlyData, setHourlyData] = useState<ShapHourlyResponse | null>(null);
  const [pointModal, setPointModal] = useState<{ point: ShapPointResponse; pharma: PharmaReportResponse } | null>(null);
  const [openingPoint, setOpeningPoint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'global' | 'monthly' | 'seasonal' | 'hourly'>('global');
  const [division, setDivision] = useState<'analysis' | 'dataset'>('analysis');
  const [impView, setImpView] = useState<'all' | 'attacks' | 'normals'>('attacks');
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [attackData, setAttackData] = useState<AttackDatasetResponse | null>(null);
  const [attackError, setAttackError] = useState<string | null>(null);
  const [attackLoading, setAttackLoading] = useState(false);
  const [attackPage, setAttackPage] = useState(1);
  const [showAllRows, setShowAllRows] = useState(false);

  // ── Jeu de données (lignes) ──
  const fetchAttackData = useCallback(async () => {
    const params = new URLSearchParams();
    params.set('only_attacks', String(!showAllRows));
    params.set('page', String(attackPage));
    params.set('page_size', '25');
    if (applied.month !== '') params.set('month', String(applied.month));
    if (applied.season) params.set('season', SEASON_API[applied.season] || applied.season);
    if (applied.day !== '') params.set('doy', String(applied.day));
    if (applied.hour !== '') params.set('hour', String(applied.hour));
    setAttackLoading(true);
    setAttackError(null);
    try {
      const r = await fetch(`/api/v1/phase2/attack-dataset?${params}`);
      if (r.ok) setAttackData(await r.json());
      else {
        setAttackError(r.status === 404 ? 'Point d’accès du jeu de données indisponible.' : `HTTP ${r.status}`);
        setAttackData(null);
      }
    } catch {
      setAttackError('Serveur injoignable.');
      setAttackData(null);
    }
    setAttackLoading(false);
  }, [attackPage, applied, showAllRows]);
  useEffect(() => { fetchAttackData(); }, [fetchAttackData]);

  // ── Analyse annuelle ──
  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (applied.day !== '') params.set('day', String(applied.day));
    if (applied.month !== '') params.set('month', String(applied.month));
    if (applied.season) params.set('season', applied.season);
    if (applied.hour !== '') params.set('hour', String(applied.hour));
    const qs = params.toString();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/shap/yearly${qs ? `?${qs}` : ''}`);
      if (r.ok) {
        const yearly = await r.json();
        if (!yearly?.available) throw new Error(yearly?.error || `HTTP ${r.status}`);
        setYearlyData(yearly);
      } else throw new Error(r.status === 500 ? 'Erreur serveur.' : `HTTP ${r.status}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m.includes('fetch') ? 'Serveur injoignable.' : m);
    }
    setLoading(false);
  }, [applied.day, applied.month, applied.season, applied.hour]);
  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Profil horaire (chargé à l'ouverture de l'onglet) ──
  const fetchHourly = useCallback(async () => {
    const params = new URLSearchParams();
    if (applied.month !== '') params.set('month', String(applied.month));
    if (applied.season) params.set('season', applied.season);
    const qs = params.toString();
    setHourlyLoading(true);
    try {
      const r = await fetch(`/api/shap/hourly${qs ? `?${qs}` : ''}`);
      if (r.ok) {
        const data = await r.json();
        if (data?.available) setHourlyData(data);
      }
    } catch {
      setHourlyData(null);
    }
    setHourlyLoading(false);
  }, [applied.month, applied.season]);
  useEffect(() => { if (activeTab === 'hourly') fetchHourly(); }, [activeTab, fetchHourly]);

  // ── Filtres ──
  const pending = (Object.keys(draft) as (keyof Filters)[]).some(k => draft[k] !== applied[k]);
  const anySet = draft.day !== '' || draft.month !== '' || !!draft.season || draft.hour !== '';
  const applyFilters = () => { setAttackPage(1); setApplied(draft); };
  const resetFilters = () => { setAttackPage(1); setDraft(NO_FILTERS); setApplied(NO_FILTERS); };
  const appliedSummary = [
    applied.month !== '' ? MONTHS[applied.month - 1] : null,
    applied.season ? SEASON_LABELS[applied.season] : null,
    applied.day !== '' ? `jour ${applied.day}` : null,
    applied.hour !== '' ? hh(applied.hour) : null,
  ].filter(Boolean).join(', ');

  // ── Rapport d'un point ──
  const openPointModal = async (row: AttackDatasetRow) => {
    if (openingPoint) return;
    setOpeningPoint(row.datetime);
    try {
      setPointModal(await loadPointReport(row.datetime));
    } catch {
      toast({ title: 'Point indisponible', description: "Impossible d'ouvrir l'analyse SHAP et le rapport pour ce point.", variant: 'destructive' });
    } finally {
      setOpeningPoint(null);
    }
  };
  useEffect(() => {
    if (!pointModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPointModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pointModal]);

  // ── Export PDF de l'analyse ──
  const exportPdf = async () => {
    try {
      if (!yearlyData) return;
      const { jsPDF } = await import('jspdf');
      await import('jspdf-autotable');
      const doc = new jsPDF('p', 'mm', 'a4');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = doc as any;
      let y = 20;
      doc.setFontSize(16);
      doc.setTextColor(26, 32, 38);
      doc.text('Analyse SHAP : interprétabilité du modèle', 20, y);
      y += 7;
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} · OneClassSVM · archive de l’année simulée 2019 (phase 2)`, 20, y);
      y += 12;
      d.autoTable({
        startY: y, head: [['Indicateur', 'Valeur']], theme: 'grid', headStyles: { fillColor: [26, 32, 38] }, margin: { left: 20, right: 20 },
        body: [
          ['Échantillons analysés', String(yearlyData.n_samples)],
          ['Anomalies détectées', `${yearlyData.n_anomalies} (${((yearlyData.n_anomalies / yearlyData.n_samples) * 100).toFixed(1)} %)`],
          ['Variable principale', `${yearlyData.global_importance[0]?.label || 'N/A'} (${yearlyData.global_importance[0]?.shap_importance.toFixed(5) || ''})`],
          ['Méthode SHAP', yearlyData.shap_method || 'KernelExplainer'],
        ],
      });
      y = d.lastAutoTable.finalY + 10;
      d.autoTable({
        startY: y, head: [['Variable', 'Groupe', 'Importance SHAP']], theme: 'grid', headStyles: { fillColor: [31, 95, 166] }, margin: { left: 20, right: 20 },
        body: yearlyData.global_importance.map(f => [f.label, GROUP_LABELS[f.group] || f.group, f.shap_importance.toFixed(6)]),
      });
      doc.save(`shap-analyse-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({ title: 'PDF exporté', description: 'Rapport SHAP téléchargé' });
    } catch (err) {
      toast({ title: 'Erreur PDF', description: `Échec : ${err instanceof Error ? err.message : ''}`, variant: 'destructive' });
    }
  };

  // ── Dérivés ──
  const groupColor = (g: string) => pal.series[Math.max(0, GROUP_ORDER.indexOf(g))] ?? pal.series[5];
  const labelOf = featureFr;

  const header = (
    <PageHeader title="Analyse SHAP de l’année simulée"
      subtitle="Archive de l’année simulée 2019 (phase 2, OneClassSVM), pas l’étude de référence sur traces réelles : quelles variables font réagir le modèle, et pourquoi chaque point est signalé."
      loading={loading} onRefresh={() => { fetchData(); fetchAttackData(); }}>
      <Segmented label="Vue" value={division} onChange={setDivision}
        options={[{ value: 'analysis', label: 'Analyse SHAP' }, { value: 'dataset', label: 'Jeu de données' }]} />
      <button type="button" onClick={exportPdf} disabled={!yearlyData} className="vc-btn"><Download className="w-3.5 h-3.5" aria-hidden /> PDF</button>
    </PageHeader>
  );

  const filtersSection = (
    <Section title="Filtres" subtitle="S’appliquent à l’analyse et au jeu de données. Mois et saison s’excluent ; le profil horaire ne tient compte que du mois et de la saison.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[13px] flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>Mois
          <select className="vc-select" value={draft.month}
            onChange={e => setDraft(f => ({ ...f, month: e.target.value ? Number(e.target.value) : '', season: e.target.value ? '' : f.season }))}>
            <option value="">Tous les mois</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="text-[13px] flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>Saison
          <select className="vc-select" value={draft.season}
            onChange={e => setDraft(f => ({ ...f, season: e.target.value, month: e.target.value ? '' : f.month }))}>
            <option value="">Toutes les saisons</option>
            {SEASONS.map(s => <option key={s} value={s}>{SEASON_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="text-[13px] flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>Jour de l’année
          <input type="number" min={1} max={365} placeholder="1 à 365" className="vc-input w-28" value={draft.day}
            onChange={e => setDraft(f => ({ ...f, day: e.target.value ? Number(e.target.value) : '' }))} />
        </label>
        <label className="text-[13px] flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>Heure
          <select className="vc-select" value={draft.hour}
            onChange={e => setDraft(f => ({ ...f, hour: e.target.value !== '' ? Number(e.target.value) : '' }))}>
            <option value="">Toutes les heures</option>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
          </select>
        </label>
        <button type="button" onClick={applyFilters} disabled={!pending} className="vc-btn vc-btn-primary"><Filter className="w-3.5 h-3.5" aria-hidden /> Filtrer</button>
        {(anySet || appliedSummary) && <button type="button" onClick={resetFilters} className="vc-btn"><X className="w-3.5 h-3.5" aria-hidden /> Réinitialiser</button>}
      </div>
      <p className="text-[13px] mt-3" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
        {pending ? <State kind="alerte">Filtres non appliqués : cliquez sur « Filtrer »</State>
          : appliedSummary ? <>Filtres actifs : <strong style={{ color: 'var(--text-primary)' }}>{appliedSummary}</strong></> : 'Aucun filtre : toute l’année.'}
      </p>
    </Section>
  );

  // ─── Vue « Jeu de données » ────────────────────────────────────────────────
  const datasetView = (
    <Section title="Contenu du jeu de données"
      subtitle="« Attaques détectées » : attaques réelles (label = 1) que le modèle a signalées. Cliquez sur une ligne pour ouvrir le rapport du point : explication SHAP, impact, CVE et recommandations."
      source="merged_3_sensors.csv + prédictions OneClassSVM (GET /api/v1/phase2/attack-dataset)"
      action={<Segmented label="Lignes affichées" value={showAllRows ? 'toutes' : 'attaques'}
        onChange={v => { setShowAllRows(v === 'toutes'); setAttackPage(1); }}
        options={[{ value: 'attaques', label: 'Attaques détectées' }, { value: 'toutes', label: 'Toutes les lignes' }]} />}>
      {attackLoading && !attackData ? <Loading />
        : attackData?.error ? <Empty>{attackData.error}</Empty>
        : attackError ? <Empty>{attackError}</Empty>
        : !attackData || attackData.rows.length === 0 ? <Empty>Aucune donnée pour ces filtres : élargissez les filtres.</Empty>
        : (
          <div className="space-y-4" aria-busy={attackLoading}>
            {attackData.summary && (
              <Readouts cols={4}>
                <Stat label="Lignes" value={nf(attackData.summary.total)} />
                <Stat label="Attaques réelles" value={nf(attackData.summary.attack)} tone="var(--accent-danger)" />
                <Stat label="Attaques détectées" value={nf(attackData.summary.detected)} tone="var(--accent-primary)" />
                <Stat label="Rappel" value={pct(attackData.summary.recall || 0, 0)} />
              </Readouts>
            )}
            <Table min={900}>
              <thead>
                <tr>
                  <th>Date et heure</th><th className="vc-num">Météo (°C)</th><th className="vc-num">Frigo (°C)</th><th className="vc-num">Thermostat (°C)</th>
                  <th className="vc-num" title="Écart météo − frigo">Écart M−F</th><th className="vc-num" title="Écart météo − thermostat">Écart M−T</th><th className="vc-num" title="Écart frigo − thermostat">Écart F−T</th>
                  <th>Label</th><th>Modèle</th><th className="vc-num">Score</th><th className="relative"><span className="sr-only">Rapport</span></th>
                </tr>
              </thead>
              <tbody>
                {attackData.rows.map(row => (
                  <tr key={row.datetime} onClick={() => openPointModal(row)} className="cursor-pointer">
                    <td className="whitespace-nowrap tabular-nums">{row.datetime.replace('T', ' ').slice(0, 16)}</td>
                    <td className="vc-num">{nf(row.weather_temp, 2)}</td>
                    <td className="vc-num">{nf(row.fridge_temp, 2)}</td>
                    <td className="vc-num">{nf(row.thermostat_temp, 2)}</td>
                    <td className="vc-num">{nf(row.weather_fridge_diff, 2)}</td>
                    <td className="vc-num">{nf(row.weather_thermostat_diff, 2)}</td>
                    <td className="vc-num">{nf(row.fridge_thermostat_diff, 2)}</td>
                    <td>{row.label === 1 ? <State kind="manque">attaque</State> : <State kind="neutre">normal</State>}</td>
                    <td>{row.prediction === 1 ? <State kind="ok">signalé</State> : <State kind="neutre">non signalé</State>}</td>
                    <td className="vc-num">{nf(row.anomaly_score, 3)}</td>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex gap-1.5">
                        <button type="button" className="vc-btn" style={{ height: 28 }} disabled={!!openingPoint}
                          onClick={e => { e.stopPropagation(); openPointModal(row); }}
                          aria-label={`Ouvrir le rapport du point du ${row.datetime.replace('T', ' ')}`}>
                          {openingPoint === row.datetime ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : null} Rapport
                        </button>
                        <Link to={reportHref(row.datetime)} onClick={e => e.stopPropagation()} className="vc-btn" style={{ height: 28 }}
                          aria-label={`Rapport du point du ${row.datetime.replace('T', ' ')} en pleine page`} title="Pleine page">
                          <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                        </Link>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              <span className="tabular-nums">Page {nf(attackData.page)} sur {nf(attackData.total_pages)} · {nf(attackData.total)} points · écarts en °C (M : météo, F : frigo, T : thermostat)</span>
              <div className="flex gap-2">
                <button type="button" className="vc-btn" onClick={() => setAttackPage(p => Math.max(1, p - 1))} disabled={attackData.page <= 1 || attackLoading}>
                  <ChevronLeft className="w-4 h-4" aria-hidden /> Précédente
                </button>
                <button type="button" className="vc-btn" onClick={() => setAttackPage(p => Math.min(attackData.total_pages, p + 1))} disabled={attackData.page >= attackData.total_pages || attackLoading}>
                  Suivante <ChevronRight className="w-4 h-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        )}
    </Section>
  );

  // ─── Vue « Analyse » ───────────────────────────────────────────────────────
  const analysisView = (() => {
    if (!yearlyData) return error ? <Empty>{error}</Empty> : <Loading />;
    const y = yearlyData;
    const top = y.global_importance[0];
    const groups = Object.entries(y.group_importance).sort((a, b) => b[1] - a[1]);
    const seasons = Object.entries(y.seasonal_breakdown || {}).sort((a, b) => b[1].count - a[1].count);
    const impData = (impView === 'attacks' ? (y.attack_importance?.length ? y.attack_importance : y.global_importance)
      : impView === 'normals' ? (y.normal_importance?.length ? y.normal_importance : y.global_importance) : y.global_importance)
      .map(d => ({ ...d, label: featureFr(d.feature) }));
    const featRows = y.feature_names.map(f => ({ key: f, label: labelOf(f) }));
    const abs = (c: ShapRow, f: string) => Math.abs(Number(c[f]) || 0);
    const presentGroups = GROUP_ORDER.filter(g => impData.some(d => d.group === g));
    const featList = [...new Set(SEASONS.flatMap(s => (y.seasonal_breakdown?.[s]?.importance ?? []).map(f => f.feature)))].slice(0, 7);
    const seasonal = featList.map(feat => {
      const row: Record<string, string | number> = { feature: labelOf(feat) };
      for (const s of SEASONS) row[s] = y.seasonal_breakdown?.[s]?.importance.find(f => f.feature === feat)?.shap_importance ?? 0;
      return row;
    });
    const m = y.detection_metrics;
    return (
      <>
        <Readouts cols={5}>
          <Stat label="Échantillons analysés" value={nf(y.n_samples)} sub={y.sampling_note} />
          <Stat label="Anomalies détectées" value={nf(y.n_anomalies_pool ?? y.n_anomalies)} tone="var(--accent-warning)"
            sub={y.stratified ? 'dans le pool analysé' : pct(y.n_anomalies / y.n_samples)} />
          <Stat label="Variable la plus influente" value={<span className="text-[26px]">{top?.label ?? '—'}</span>} sub={top ? `SHAP moyen ${nf(top.shap_importance, 4)}` : undefined} />
          <Stat label="Capteur clé" value={<span className="text-[26px]">{GROUP_LABELS[groups[0]?.[0] ?? ''] ?? groups[0]?.[0] ?? '—'}</span>} sub={groups[0] ? `Score ${nf(groups[0][1], 3)}` : undefined} />
          <Stat label="Saison la plus représentée" value={<span className="text-[26px]">{SEASON_LABELS[seasons[0]?.[0] ?? ''] ?? '—'}</span>} sub={seasons[0] ? `${nf(seasons[0][1].count)} échantillons` : undefined} />
        </Readouts>
        {m && (
          <Readouts cols={4}>
            <Stat label={`Rappel (${nf(m.scored_n)} points du ${m.scored_on})`} value={pct(m.recall)} tone="var(--accent-primary)" sub={`${nf(m.tp)} vrais positifs, ${nf(m.fn)} attaques manquées`} />
            <Stat label="Précision" value={pct(m.precision)} sub={`${nf(m.fp)} fausses alertes`} />
            <Stat label="F1" value={nf(m.f1, 3)} />
            <Stat label="Attaques réelles dans l’année" value={nf(y.n_real_attacks)} tone="var(--accent-danger)" sub={y.n_real_days != null ? `sur ${nf(y.n_real_days)} jours` : undefined} />
          </Readouts>
        )}
        {y.low_sample_warning && <p className="text-[13.5px]"><State kind="alerte">{y.low_sample_warning}</State></p>}

        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Angle d’analyse" value={activeTab} onChange={setActiveTab} options={[
            { value: 'global', label: 'Importance globale' }, { value: 'monthly', label: 'Par mois' },
            { value: 'seasonal', label: 'Par saison' }, { value: 'hourly', label: 'Par heure' },
          ]} />
          <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Modèle {y.model_kind ?? 'ocsvm'} · {y.shap_method ?? 'KernelExplainer'}</span>
        </div>

        {activeTab === 'global' && (
          <Section title="Importance des variables"
            subtitle={impView === 'attacks' ? `Impact SHAP moyen sur les ${nf(y.n_attacks_sample ?? 0)} anomalies détectées seulement : ce qui déclenche réellement le modèle.`
              : impView === 'normals' ? `Impact SHAP moyen sur ${nf(y.n_normals_sample ?? 0)} points normaux : la référence du comportement sain.`
              : `Impact moyen absolu sur ${nf(y.n_samples)} points (échantillon stratifié). Préférez la vue « Attaques » pour comprendre les attaques.`}
            source="shap_analysis_live.json (GET /api/shap/yearly)"
            action={<Segmented label="Points pris en compte" value={impView} onChange={setImpView}
              options={[{ value: 'attacks', label: 'Attaques' }, { value: 'normals', label: 'Normaux' }, { value: 'all', label: 'Tout' }]} />}>
            <BandLegend items={presentGroups.map(g => ({ label: GROUP_LABELS[g] ?? g, color: groupColor(g) }))} />
            <div style={{ height: Math.max(160, impData.length * 26 + 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={impData} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={pal.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fill: pal.axis, fontSize: 12 }} tickFormatter={v => nf(Number(v), 2)} />
                  <YAxis type="category" dataKey="label" width={140} interval={0} tick={{ fill: pal.axis, fontSize: 12 }} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--bg-subtle)' }}
                    formatter={(v, _n, item) => [nf(Number(v), 4), `Importance SHAP (${GROUP_LABELS[(item?.payload as ShapGlobalItem)?.group] ?? ''})`]} />
                  <Bar dataKey="shap_importance" name="Importance SHAP" isAnimationActive={false}>
                    {impData.map(d => <Cell key={d.feature} fill={groupColor(d.group)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Note>Barres les plus longues : variables qui pèsent le plus dans la décision d’anomalie.</Note>
          </Section>
        )}

        {activeTab === 'monthly' && (
          <Section title="Importance SHAP mois par mois"
            subtitle="Plus la case est foncée, plus la variable a pesé dans la détection ce mois-là : utile pour repérer des tendances saisonnières."
            source="shap_analysis_live.json (GET /api/shap/yearly, monthly_shap)">
            <Heatmap rows={featRows} cols={y.monthly_shap} value={abs} color={pal.series[0]} colLabel={c => (c.month ? MONTHS_SHORT[c.month - 1] : String(c.month_name))} />
          </Section>
        )}

        {activeTab === 'seasonal' && y.seasonal_breakdown && (
          <Section title="Importance SHAP par saison" subtitle="Les sept variables les plus importantes selon les saisons, empilées." source="shap_analysis_live.json (GET /api/shap/yearly, seasonal_breakdown)">
            <BandLegend items={SEASONS.map((s, i) => ({ label: `${SEASON_LABELS[s]} (${nf(y.seasonal_breakdown[s]?.count ?? 0)} éch.)`, color: pal.series[i] }))} />
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={seasonal} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke={pal.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fill: pal.axis, fontSize: 12 }} tickFormatter={v => nf(Number(v), 2)} />
                  <YAxis type="category" dataKey="feature" width={140} interval={0} tick={{ fill: pal.axis, fontSize: 12 }} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--bg-subtle)' }} formatter={(v, n) => [nf(Number(v), 4), n]} />
                  {SEASONS.map((s, i) => <Bar key={s} dataKey={s} name={SEASON_LABELS[s]} stackId="a" fill={pal.series[i]} isAnimationActive={false} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        )}

        {activeTab === 'hourly' && (
          <Section title="Importance SHAP heure par heure"
            subtitle={`Importance moyenne de chaque variable selon l’heure de la journée${hourlyData ? ` (${nf(hourlyData.n_samples)} échantillons)` : ''}.`}
            source="shap_analysis_live.json (GET /api/shap/hourly)">
            {hourlyLoading ? <Loading />
              : hourlyData && hourlyData.hours.length > 0 ? (
                <>
                  {hourlyData.low_sample_warning && <p className="mb-3 text-[13.5px]"><State kind="alerte">{hourlyData.low_sample_warning}</State></p>}
                  <Heatmap rows={hourlyData.feature_names.map(f => ({ key: f, label: labelOf(f) }))} cols={hourlyData.hours} value={abs}
                    color={pal.series[0]} colLabel={c => String(c.hour_label ?? c.hour).replace('h', '')} />
                  <Note>Colonnes : heures de 00 à 23. Repérez les heures où un capteur devient dominant.</Note>
                </>
              ) : <Empty>Aucune donnée pour ce filtre.</Empty>}
          </Section>
        )}
      </>
    );
  })();

  return (
    <div className="space-y-6">
      {header}
      {error && yearlyData && (
        <p className="text-[13.5px]"><State kind="manque">Analyse non mise à jour : {error}</State></p>
      )}
      {filtersSection}
      {division === 'analysis' ? analysisView : datasetView}

      {pointModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-6"
          style={{ background: 'color-mix(in srgb, var(--bg-base) 82%, transparent)' }} onClick={() => setPointModal(null)}>
          <div role="dialog" aria-modal="true" aria-label="Rapport du point" className="w-full max-w-[1100px] max-h-[94vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <ShapPointReport point={pointModal.point} pharma={pointModal.pharma} onClose={() => setPointModal(null)} showFullPageLink />
          </div>
        </div>
      )}
    </div>
  );
}
