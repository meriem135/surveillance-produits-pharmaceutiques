import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { authHeaders } from '../lib/auth';
import ShapPointReport from '../components/ShapPointReport';

interface ShapCause {
  feature: string;
  label?: string;
  shap_value: number;
  feature_value: number;
  interpretation?: string;
  group?: string;
}
interface ShapPointResponse {
  available: boolean;
  error?: string;
  timestamp: string;
  requested_timestamp?: string;
  index: number;
  is_anomaly: boolean;
  anomaly_score: number;
  prediction: number;
  label: number;
  month: number;
  season: string;
  risk_score_per_100: number;
  sensor_values: Record<string, number>;
  group_shap: Record<string, number>;
  dominant_group: string;
  dominant_sensor: string;
  top_causes: ShapCause[];
  top_normal: ShapCause[];
  model_kind: string;
  shap_method: string;
}
interface PharmaReportResponse {
  report: string;
  guardian: string;
  sensor: string;
  sensor_label: string;
  domain: 'production' | 'stock' | 'logistics';
  domain_label: string;
  sensor_role: string;
  product_impact: string;
  attack_id: string | null;
  attack_name: string | null;
  attack_category: string | null;
  severity: string;
  risk_score_per_100: number;
  label: number;
  is_anomaly: boolean;
  season: string | null;
  device: string | null;
  sensor_values: Record<string, number>;
  why: string;
  shap_causes_summary: string[];
  impact: { production_impact: number; stock_impact: number; effect: string };
  actions: string[];
  disposition: { label: string; description: string };
  regulatory: string[];
  mitigation: string[];
  ai_context_enabled: boolean;
  error?: string;
}

export default function ShapPointReportPage() {
  const [searchParams] = useSearchParams();
  const timestamp = searchParams.get('timestamp') || '';
  const [point, setPoint] = useState<ShapPointResponse | null>(null);
  const [pharma, setPharma] = useState<PharmaReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!timestamp) {
        setError('Point non spécifié (timestamp manquant dans l’URL).');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const p = await fetch(
          `/api/shap/point?timestamp=${encodeURIComponent(timestamp)}`,
        );
        if (!p.ok) {
          const d = await p.json().catch(() => null);
          throw new Error(d?.error || `HTTP ${p.status}`);
        }
        const pointRes: ShapPointResponse = await p.json();
        if (!pointRes.available)
          throw new Error(pointRes.error || 'SHAP indisponible');
        const sov = pointRes.sensor_values || {};
        const r = await fetch('/api/v1/pharma/point-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            sensor: pointRes.dominant_sensor || 'thermostat',
            attack_id: null,
            risk_score: pointRes.risk_score_per_100,
            is_anomaly: pointRes.is_anomaly,
            label: pointRes.label,
            season: pointRes.season,
            sensor_values: {
              weather: sov.weather,
              fridge: sov.fridge,
              thermostat: sov.thermostat,
            },
            top_causes: pointRes.top_causes.slice(0, 5),
          }),
        });
        const pharmaRes: PharmaReportResponse = await r.json();
        if (pharmaRes.report !== 'ok')
          throw new Error(pharmaRes.error || 'Rapport indisponible');
        if (cancelled) return;
        setPoint(pointRes);
        setPharma(pharmaRes);
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : 'Erreur lors du chargement du rapport',
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [timestamp]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00FFA3' }} />
        <div
          className="text-[11px]"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Chargement du rapport complet…
        </div>
      </div>
    );
  }
  if (error || !point || !pharma) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <ShieldAlert className="w-8 h-8" style={{ color: '#FF2D78' }} />
        <div
          className="text-sm font-bold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Rapport indisponible
        </div>
        <div
          className="text-[11px] max-w-md"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {error || 'Impossible de charger ce point (backend 8000).'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <ShapPointReport point={point} pharma={pharma} />
    </div>
  );
}