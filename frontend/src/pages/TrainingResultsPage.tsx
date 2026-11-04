/** Résultats phase 2 (archive de l'année simulée 2019) : dernier One-Class SVM multivarié enregistré.
 *  GET /api/v1/phase2/training-results : ml_models.result_json (repli : sessionStorage « phase2_train_result »). */
import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Empty, Loading, Meter, Note, PageHeader, Readouts, Section, Stat, State, Table, nf, pct, tooltipStyle, usePalette,
} from '../components/etude/kit';

interface ModelMetrics {
  precision: number; recall: number; f1: number; roc_auc: number;
  average_precision: number; fpr: number;
  tp: number; fp: number; fn: number; tn: number;
}

interface AttackMetric {
  attack_type: string; attack_id?: string;
  n_total: number; n_detected: number;
  detection_rate: number; avg_score: number;
}

interface MonthlyData {
  month: number; month_name: string; total: number;
  attacks: number; detected: number;
  precision: number; recall: number; f1: number;
}

interface SeasonalData {
  season: string; total: number; attacks: number;
  detected: number; precision: number; recall: number;
}

interface TimelinePoint {
  datetime: string; weather_temp: number; fridge_temp: number;
  thermostat_temp: number; label: number; prediction: number;
  anomaly_score: number;
}

interface TrainingResult {
  status: string;
  training_info: {
    sensors_used: string[];
    total_rows?: number;
    n_total_samples: number;
    n_normal_samples: number;
    n_attack_samples: number;
    date_range?: string[];
    duration_seconds: number;
    n_features_selected?: number;
    n_features_original?: number;
  };
  model_metrics: ModelMetrics;
  attack_metrics: AttackMetric[];
  monthly_breakdown: MonthlyData[];
  seasonal_breakdown: SeasonalData[];
  timeline: TimelinePoint[];
  feature_importance: { feature: string; importance: number }[];
}

const SOURCE = 'ml_models.result_json (dernier OCSVM_Multivarie)';

const ATTACK_META: Record<string, { label: string; severity: string }> = {
  IoT_DDoS_normal: { label: 'DDoS', severity: 'Critique' },
  IoT_DoS_normal: { label: 'DoS', severity: 'Élevé' },
  IoT_MITM_normal: { label: 'MITM', severity: 'Élevé' },
  IoT_XSS_normal: { label: 'XSS', severity: 'Moyen' },
  IoT_backdoor_normal: { label: 'Porte dérobée', severity: 'Critique' },
  IoT_Injection_normal: { label: 'Injection', severity: 'Élevé' },
  IoT_password_normal: { label: 'Mot de passe', severity: 'Moyen' },
  IoT_ransomware_normal: { label: 'Rançongiciel', severity: 'Critique' },
  IoT_scanning_normal: { label: 'Balayage de ports', severity: 'Faible' },
  MITM_fridge_freeze: { label: 'MITM, frigo figé', severity: 'Critique' },
  Injection_fridge_plausible: { label: 'Injection plausible, frigo', severity: 'Critique' },
};

const SEASON_FR: Record<string, string> = { winter: 'Hiver', spring: 'Printemps', summer: 'Été', autumn: 'Automne' };
const SENSOR_FR: Record<string, string> = { weather: 'météo', fridge: 'frigo', thermostat: 'thermostat' };

/** Matrice de confusion du test, lisible sans la couleur (libellés + chiffres). */
function Confusion({ m }: { m: ModelMetrics }) {
  const cell = (label: string, v: number, good: boolean) => (
    <div className="p-2.5 text-center" style={{ background: good ? 'color-mix(in srgb, var(--accent-primary) 9%, var(--bg-panel))' : 'color-mix(in srgb, var(--accent-danger) 8%, var(--bg-panel))' }}>
      <div className="vc-readout-value" style={{ fontSize: 24, color: good ? 'var(--text-primary)' : 'var(--accent-danger)' }}>{nf(v)}</div>
      <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
  const head = 'px-2 py-1 text-center font-semibold';
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-px text-[12px]" style={{ background: 'var(--border)', border: '1px solid var(--border)' }}>
      <div style={{ background: 'var(--bg-panel)' }} />
      <div className={head} style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>Prédit attaque</div>
      <div className={head} style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>Prédit normal</div>
      <div className="px-2 flex items-center font-semibold" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>Attaque</div>
      {cell('vrais positifs', m.tp, true)}{cell('attaques manquées', m.fn, false)}
      <div className="px-2 flex items-center font-semibold" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>Normal</div>
      {cell('fausses alertes', m.fp, false)}{cell('vrais négatifs', m.tn, true)}
    </div>
  );
}

const rateKind = (r: number) => (r >= 90 ? 'ok' : r >= 70 ? 'alerte' : 'manque') as 'ok' | 'alerte' | 'manque';
const rateColor = (r: number) => (r >= 90 ? 'var(--accent-primary)' : r >= 70 ? 'var(--accent-warning)' : 'var(--accent-danger)');

export default function TrainingResultsPage() {
  const pal = usePalette();
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attackFilter, setAttackFilter] = useState<string | null>(null);
  const [expandedAttack, setExpandedAttack] = useState<string | null>(null);

  useEffect(() => {
    // Les résultats viennent toujours de l'API (dernier modèle enregistré en base) : ils restent
    // visibles après une reconnexion ou depuis un autre poste, pas seulement dans l'onglet qui a entraîné.
    const fetchResults = async () => {
      try {
        const r = await fetch('/api/v1/phase2/training-results');
        const text = await r.text(); // lu en texte : gère les réponses 502/vides sans « Unexpected end of JSON input »
        if (!text) throw new Error('Réponse vide du serveur (backend indisponible ?).');
        const data = JSON.parse(text);
        const saved = sessionStorage.getItem('phase2_train_result');
        if (data.error && saved) setResult(JSON.parse(saved));
        else if (data.error) setError(data.error);
        else setResult(data);
      } catch (e: unknown) {
        // Repli : le résultat déjà sauvegardé par l'entraînement (sessionStorage)
        const saved = sessionStorage.getItem('phase2_train_result');
        if (saved) {
          try { setResult(JSON.parse(saved)); return; } catch { /* ignore */ }
        }
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };
    fetchResults();
  }, []);

  const allAttacks = useMemo(() => result?.attack_metrics ?? [], [result]);
  const filteredAttacks = useMemo(
    () => (attackFilter ? allAttacks.filter(a => a.attack_type === attackFilter) : allAttacks),
    [allAttacks, attackFilter],
  );
  const flagged = useMemo(() => (result?.timeline ?? []).filter(p => p.prediction === 1), [result]);
  const monthly = useMemo(() => (result?.monthly_breakdown ?? []).map(d => ({
    ...d, precision: (d.precision || 0) * 100, recall: (d.recall || 0) * 100,
  })), [result]);
  const seasonal = useMemo(() => (result?.seasonal_breakdown ?? []).map(d => ({
    season: SEASON_FR[d.season] ?? d.season,
    precision: (d.precision || 0) * 100,
    recall: (d.recall || 0) * 100,
    detection: d.attacks > 0 ? (d.detected / d.attacks) * 100 : 0,
  })), [result]);

  const header = (
    <PageHeader title="Résultats phase 2"
      subtitle="Archive de l'année simulée 2019 (phase 2) : dernier One-Class SVM multivarié entraîné, mesuré sur le test du découpage temporel 70/15/15. Ce n'est pas l'étude de référence sur traces réelles." />
  );

  if (loading) return <div className="space-y-5">{header}<Loading /></div>;

  if (error || !result) {
    return (
      <div className="space-y-5">
        {header}
        <Empty>
          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>Aucun résultat d'entraînement</div>
          <p className="mt-1">{error || "Lancez un entraînement depuis l'onglet ML et anomalies pour voir les résultats ici."}</p>
          <a href="/#/dashboard/phase2" className="vc-btn mt-3 no-underline">Aller à ML et anomalies</a>
        </Empty>
      </div>
    );
  }

  const info = result.training_info;
  const m = result.model_metrics;
  const shown = flagged.slice(0, 40);

  const toggle = (id: string) => setExpandedAttack(prev => (prev === id ? null : id));

  return (
    <div className="space-y-6">
      {header}

      <Readouts cols={5}>
        <Stat label="Durée d'entraînement" value={nf(info?.duration_seconds, 1)} unit="s" />
        <Stat label="Capteurs" value={nf(info?.sensors_used?.length)} sub={info?.sensors_used?.map(s => SENSOR_FR[s] ?? s).join(', ')} />
        <Stat label="Échantillons" value={nf(info?.n_total_samples)} sub={`dont ${nf(info?.n_normal_samples)} normaux d'entraînement`} />
        <Stat label="Attaques dans le jeu" value={nf(info?.n_attack_samples)} tone="var(--accent-danger)" />
        <Stat label="Variables retenues" value={`${nf(info?.n_features_selected)}/${nf(info?.n_features_original)}`} />
      </Readouts>

      {m && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Section title="Métriques du modèle" subtitle="Mesurées sur le jeu de test, jamais utilisé pour régler le modèle." source={SOURCE}>
            <Readouts cols={3}>
              <Stat label="F1" value={pct(m.f1)} tone="var(--accent-primary)" />
              <Stat label="Précision" value={pct(m.precision)} sub="Alertes vraiment dues à une attaque" />
              <Stat label="Rappel" value={pct(m.recall)} sub="Attaques signalées" />
              <Stat label="ROC-AUC" value={pct(m.roc_auc)} />
              <Stat label="Taux de faux positifs" value={pct(m.fpr, 2)} tone="var(--alarm-amber-fill)" />
              <Stat label="Précision moyenne (AP)" value={pct(m.average_precision)} />
            </Readouts>
          </Section>
          <Section title="Matrice de confusion" subtitle={`${nf(m.tp + m.fn)} mesures d'attaque et ${nf(m.fp + m.tn)} mesures normales dans le test.`} source={SOURCE}>
            <Confusion m={m} />
          </Section>
        </div>
      )}

      {allAttacks.length > 0 && (
        <Section title="Détection par type d'attaque" subtitle={`${filteredAttacks.length} type${filteredAttacks.length > 1 ? 's' : ''} affiché${filteredAttacks.length > 1 ? 's' : ''}. Cliquez une ligne pour la marquer.`}
          source={`${SOURCE} → attack_metrics`} flush
          action={
            <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Type
              <select className="vc-select" value={attackFilter || ''} onChange={e => setAttackFilter(e.target.value || null)}>
                <option value="">Tous</option>
                {allAttacks.map(a => (
                  <option key={a.attack_id || a.attack_type} value={a.attack_type}>{ATTACK_META[a.attack_type]?.label || a.attack_type}</option>
                ))}
              </select>
            </label>
          }>
          <Table min={720}>
            <thead><tr><th>Type</th><th>Sévérité</th><th className="vc-num">Total</th><th className="vc-num">Détectées</th><th>Taux de détection</th><th className="vc-num">Score moyen</th></tr></thead>
            <tbody>
              {filteredAttacks.map(atk => {
                const meta = ATTACK_META[atk.attack_type] || { label: atk.attack_type, severity: '—' };
                const id = atk.attack_id || atk.attack_type;
                const isOpen = expandedAttack === id;
                const rate = atk.detection_rate || 0;
                return (
                  <tr key={id} onClick={() => toggle(id)} className="cursor-pointer"
                    style={isOpen ? { background: 'color-mix(in srgb, var(--accent-primary) 10%, var(--bg-panel))' } : undefined}>
                    <td>
                      <button type="button" aria-pressed={isOpen} className="font-semibold text-left"
                        onClick={e => { e.stopPropagation(); toggle(id); }}>{meta.label}</button>
                    </td>
                    <td className="text-[13px]">{meta.severity}</td>
                    <td className="vc-num">{nf(atk.n_total)}</td>
                    <td className="vc-num">{nf(atk.n_detected)}</td>
                    <td>
                      <div className="flex items-center gap-2 min-w-[180px]">
                        <div className="w-20 shrink-0"><Meter value={rate} color={rateColor(rate)} /></div>
                        <State kind={rateKind(rate)}>{`${nf(rate, 1)}\u202f%`}</State>
                      </div>
                    </td>
                    <td className="vc-num">{nf(atk.avg_score || 0, 4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Section>
      )}

      {flagged.length > 0 && (
        <Section title="Mesures signalées comme attaques" subtitle={`Extrait de la chronologie enregistrée : ${nf(shown.length)} affichées sur ${nf(flagged.length)} signalées.`}
          source={`${SOURCE} → timeline`} flush>
          <div className="max-h-[28rem] overflow-y-auto">
            <Table min={760}>
              <thead><tr><th className="vc-num">#</th><th>Date</th><th className="vc-num">Météo (°C)</th><th className="vc-num">Frigo (°C)</th>
                <th className="vc-num">Thermostat (°C)</th><th className="vc-num">Score</th><th>Réalité</th></tr></thead>
              <tbody>
                {shown.map((p, i) => {
                  const real = p.label === 1;
                  return (
                    <tr key={i}>
                      <td className="vc-num" style={{ color: 'var(--text-secondary)' }}>{i + 1}</td>
                      <td className="whitespace-nowrap">{new Date(p.datetime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="vc-num">{nf(p.weather_temp, 1)}</td>
                      <td className="vc-num">{nf(p.fridge_temp, 1)}</td>
                      <td className="vc-num">{nf(p.thermostat_temp, 1)}</td>
                      <td className="vc-num">{nf(p.anomaly_score, 4)}</td>
                      <td>{real ? <State kind="ok">vrai positif (attaque réelle)</State> : <State kind="alerte">faux positif (mesure normale)</State>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </Section>
      )}

      {(monthly.length > 0 || seasonal.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-6">
          {monthly.length > 0 && (
            <Section title="Performance mensuelle" subtitle="Précision et rappel du modèle, mois par mois." source={`${SOURCE} → monthly_breakdown`}>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
                    <CartesianGrid stroke={pal.grid} vertical={false} />
                    <XAxis dataKey="month_name" tick={{ fill: pal.axis, fontSize: 12 }} />
                    <YAxis domain={[0, 100]} unit=" %" tick={{ fill: pal.axis, fontSize: 12 }} />
                    <Tooltip {...tooltipStyle} formatter={(v, n) => [`${nf(Number(v), 1)}\u202f%`, n]} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 12.5 }} />
                    <Bar dataKey="precision" name="Précision" fill={pal.series[0]} maxBarSize={18} isAnimationActive={false} />
                    <Bar dataKey="recall" name="Rappel" fill={pal.series[2]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}
          {seasonal.length > 0 && (
            <Section title="Analyse saisonnière" subtitle="Précision, rappel et part des attaques détectées, par saison." source={`${SOURCE} → seasonal_breakdown`}>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={seasonal} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid stroke={pal.grid} />
                    <PolarAngleAxis dataKey="season" tick={{ fill: pal.axis, fontSize: 12 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: pal.axis, fontSize: 11 }} />
                    <Tooltip {...tooltipStyle} formatter={(v, n) => [`${nf(Number(v), 1)}\u202f%`, n]} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} />
                    <Radar name="Précision" dataKey="precision" stroke={pal.series[0]} fill={pal.series[0]} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                    <Radar name="Rappel" dataKey="recall" stroke={pal.series[1]} fill="none" strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />
                    <Radar name="Détection" dataKey="detection" stroke={pal.series[3]} fill="none" strokeWidth={2} isAnimationActive={false} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <Note>Une saison sans aucune attaque détectée (précision et rappel nuls) apparaît au centre du radar.</Note>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
