import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Line,
} from 'recharts';
import { BandLegend, Empty, Readouts, Section, Segmented, Stat, nf, pct, tooltipStyle, usePalette } from './etude/kit';

interface ErrorPoint {
  datetime: string;
  actual_label: number;
  prediction: number;
  anomaly_score: number;
  _sensor?: string;
  temperature?: number;
}

interface Props {
  points: ErrorPoint[];
  attackMetrics?: Array<{ attack_type: string; n_total: number; n_detected?: number; detection_rate?: number; n_anomalies?: number; taux_detection?: number }>;
}

type ErrType = 'all' | 'fp' | 'fn';
type SensorF = 'all' | 'weather' | 'fridge' | 'thermostat';
const SENSOR_FR: Record<string, string> = { weather: 'Météo', fridge: 'Chambre froide', thermostat: 'Thermostat', unknown: 'Inconnu' };
const pctTick = (v: number) => `${nf(v, 0)} %`;

/** Analyse des erreurs du modèle non supervisé sur l'année simulée (calcul côté client). */
export default function ErrorAnalysisPanel({ points: allPoints, attackMetrics }: Props) {
  const [errorType, setErrorType] = useState<ErrType>('all');
  const [sensorFilter, setSensorFilter] = useState<SensorF>('all');
  const pal = usePalette();
  const points = useMemo(() => sensorFilter === 'all' ? allPoints : allPoints.filter(p => p._sensor === sensorFilter), [allPoints, sensorFilter]);
  const showFp = errorType !== 'fn';
  const showFn = errorType !== 'fp';

  const d = useMemo(() => {
    let fp = 0, fn = 0, tp = 0, tn = 0;
    const byHour = Array.from({ length: 24 }, () => ({ fp: 0, fn: 0, total: 0 }));
    const bySensor: Record<string, { fp: number; fn: number; total: number }> = {};
    const byDay: Record<string, { fp: number; fn: number }> = {};
    for (const p of points) {
      const dt = new Date(p.datetime);
      const isFp = p.actual_label === 0 && p.prediction === 1;
      const isFn = p.actual_label === 1 && p.prediction === 0;
      if (isFp) fp++; else if (isFn) fn++; else if (p.actual_label === 1) tp++; else tn++;
      const h = byHour[dt.getHours()]; h.total++; if (isFp) h.fp++; if (isFn) h.fn++;
      const s = p._sensor || 'unknown';
      const b = (bySensor[s] ??= { fp: 0, fn: 0, total: 0 }); b.total++; if (isFp) b.fp++; if (isFn) b.fn++;
      const k = dt.toLocaleDateString('fr-FR');
      const dd = (byDay[k] ??= { fp: 0, fn: 0 }); if (isFp) dd.fp++; if (isFn) dd.fn++;
    }
    const totalNormal = fp + tn || 1;
    const totalAttack = fn + tp || 1;
    return {
      fp, fn, tp, tn,
      fpRate: fp / totalNormal, fnRate: fn / totalAttack,
      hourly: byHour.map((h, i) => ({ hour: `${i}h`, fpRate: h.total ? (h.fp / h.total) * 100 : 0, fnRate: h.total ? (h.fn / h.total) * 100 : 0, total: h.total })),
      bySensor: Object.entries(bySensor).map(([s, v]) => ({ sensor: SENSOR_FR[s] ?? s, fpRate: v.total ? (v.fp / v.total) * 100 : 0, fnRate: v.total ? (v.fn / v.total) * 100 : 0 })),
      timeline: Object.entries(byDay).slice(-30).map(([date, v]) => ({ date, ...v })),
    };
  }, [points]);

  if (allPoints.length === 0) return null;

  const axis = { fill: pal.axis, fontSize: 11 };
  const attackData = (attackMetrics ?? []).map(a => ({
    name: a.attack_type.replace('IoT_', '').replace('_normal', ''),
    rate: a.detection_rate ?? a.taux_detection ?? 0, total: a.n_total,
  }));
  const legend = [
    ...(showFp ? [{ label: 'Fausses alertes (FP)', color: pal.alert }] : []),
    ...(showFn ? [{ label: 'Attaques manquées (FN)', color: pal.danger }] : []),
  ];

  return (
    <Section title="Analyse des erreurs"
      subtitle="Fausses alertes et attaques manquées du modèle sur la chronologie de l’année simulée (archive, phase 2)."
      source="/api/v1/phase2/timeline, /api/v1/phase2/attack-metrics"
      action={
        <div className="flex flex-wrap gap-2">
          <Segmented<ErrType> label="Type d’erreur" value={errorType} onChange={setErrorType}
            options={[{ value: 'all', label: 'Toutes' }, { value: 'fp', label: 'FP' }, { value: 'fn', label: 'FN' }]} />
          <Segmented<SensorF> label="Capteur" value={sensorFilter} onChange={setSensorFilter}
            options={[{ value: 'all', label: 'Tous' }, { value: 'weather', label: 'Météo' }, { value: 'fridge', label: 'Frigo' }, { value: 'thermostat', label: 'Thermostat' }]} />
        </div>
      }>
      <Readouts cols={4} className="mb-5">
        <Stat label="Faux positifs" tone="var(--accent-warning)" value={nf(d.fp)} sub={`${pct(d.fpRate, 2)} des points normaux`} />
        <Stat label="Faux négatifs" tone="var(--accent-danger)" value={nf(d.fn)} sub={`${pct(d.fnRate, 2)} des points d’attaque`} alarm={d.fn > 0} />
        <Stat label="Vrais positifs" tone="var(--accent-primary)" value={nf(d.tp)} sub="attaques détectées" />
        <Stat label="Vrais négatifs" value={nf(d.tn)} sub="points normaux non signalés" />
      </Readouts>

      {points.length === 0 ? <Empty>Aucun point pour ce capteur.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-2 3xl:grid-cols-4">
          <figure className="min-w-0">
            <figcaption className="vc-kicker mb-2">Taux d’erreur par heure</figcaption>
            <BandLegend items={[...legend, { label: 'Points par heure', color: pal.series[1], kind: 'line' }]} />
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={d.hourly}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis dataKey="hour" tick={axis} interval={2} />
                <YAxis yAxisId="r" tick={axis} tickFormatter={pctTick} width={44} />
                <YAxis yAxisId="n" orientation="right" hide />
                <Tooltip {...tooltipStyle} formatter={(v: unknown, n: unknown) => [n === 'Points' ? nf(Number(v)) : `${nf(Number(v), 2)} %`, String(n)]} />
                {showFp && <Bar yAxisId="r" dataKey="fpRate" name="FP" fill={pal.alert} maxBarSize={12} />}
                {showFn && <Bar yAxisId="r" dataKey="fnRate" name="FN" fill={pal.danger} maxBarSize={12} />}
                <Line yAxisId="n" type="monotone" dataKey="total" name="Points" stroke={pal.series[1]} strokeWidth={1} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </figure>

          <figure className="min-w-0">
            <figcaption className="vc-kicker mb-2">Évolution des erreurs (30 derniers jours)</figcaption>
            <BandLegend items={legend.map(l => ({ ...l, kind: 'line' as const }))} />
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={d.timeline}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis dataKey="date" tick={axis} interval="preserveStartEnd" />
                <YAxis tick={axis} width={40} />
                <Tooltip {...tooltipStyle} />
                {showFp && <Line type="monotone" dataKey="fp" name="FP" stroke={pal.alert} strokeWidth={2} dot={false} />}
                {showFn && <Line type="monotone" dataKey="fn" name="FN" stroke={pal.danger} strokeWidth={2} dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </figure>

          <figure className="min-w-0">
            <figcaption className="vc-kicker mb-2">Taux d’erreur par capteur</figcaption>
            <BandLegend items={legend} />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.bySensor} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid stroke={pal.grid} horizontal={false} />
                <XAxis type="number" tick={axis} tickFormatter={pctTick} />
                <YAxis dataKey="sensor" type="category" tick={axis} width={110} />
                <Tooltip {...tooltipStyle} formatter={(v: unknown, n: unknown) => [`${nf(Number(v), 2)} %`, String(n)]} />
                {showFp && <Bar dataKey="fpRate" name="FP" fill={pal.alert} maxBarSize={16} />}
                {showFn && <Bar dataKey="fnRate" name="FN" fill={pal.danger} maxBarSize={16} />}
              </BarChart>
            </ResponsiveContainer>
          </figure>

          {attackData.length > 0 && (
            <figure className="min-w-0">
              <figcaption className="vc-kicker mb-2">Taux de détection par type d’attaque</figcaption>
              <BandLegend items={[{ label: 'Points d’attaque signalés', color: pal.ok }]} />
              <ResponsiveContainer width="100%" height={Math.max(200, attackData.length * 28)}>
                <BarChart data={attackData} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke={pal.grid} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={axis} tickFormatter={pctTick} />
                  <YAxis dataKey="name" type="category" tick={axis} width={150} />
                  <Tooltip {...tooltipStyle} formatter={(v: unknown) => [`${nf(Number(v), 1)} %`, 'Détection']} />
                  <Bar dataKey="rate" name="Détection" fill={pal.ok} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </figure>
          )}
        </div>
      )}
    </Section>
  );
}
