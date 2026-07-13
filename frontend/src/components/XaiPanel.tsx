import { clsx } from 'clsx';
import { useState, useEffect } from 'react';
import type { AttackType } from '../types';

interface XaiPanelProps {
  attackActive: boolean;
  attackType: AttackType | null;
}

interface ShapCause {
  feature: string;
  valeur: number;
  impact: number;
  interpretation: string;
}

interface ShapResponse {
  timestamp: string;
  is_anomaly: boolean;
  anomaly_score: number;
  top_causes: ShapCause[];
  sensors: Record<string, number>;
}

const RECOMMENDATIONS: Record<string, { title: string; text: string; danger: boolean }> = {
  recon: { title: 'Scan capteurs suspect', text: 'Blocage IP sur le pare-feu industriel.', danger: true },
  mitm: { title: 'Detournement MitM', text: 'Chiffrement TLS active, routage securise.', danger: true },
  ddos: { title: 'Saturation reseau', text: 'Limitation a 10 com/s par appareil slave.', danger: true },
  ransom: { title: 'Sabotage capteurs', text: 'Isolement de l\'automate du reseau de production.', danger: true },
  normal: { title: 'Protection active', text: 'Aucune anomalie detectee. Flux 100% sain.', danger: false },
};

function generateDemoShap(attackActive: boolean, attackType: AttackType | null): ShapResponse {
  if (!attackActive || !attackType) {
    return {
      timestamp: new Date().toISOString(), is_anomaly: false, anomaly_score: 0.12,
      sensors: { weather_temperature: 26.3, fridge_temperature: 4.1, thermostat_temperature: 23.7 },
      top_causes: [
        { feature: 'weather_temperature', valeur: 26.3, impact: 0.18, interpretation: 'Température weather dans la norme saisonnière' },
        { feature: 'fridge_temperature', valeur: 4.1, impact: 0.12, interpretation: 'Chaîne du froid stable' },
        { feature: 'thermostat_temperature', valeur: 23.7, impact: 0.09, interpretation: 'Régulation thermique nominale' },
      ],
    };
  }
  const attackProfiles: Record<string, { score: number; sensors: Record<string, number>; causes: ShapCause[] }> = {
    recon: {
      score: 0.52, sensors: { weather_temperature: 27.8, fridge_temperature: 4.5, thermostat_temperature: 24.1 },
      causes: [
        { feature: 'zscore_weather_temperature', valeur: 1.82, impact: -0.31, interpretation: 'Écart anormal de la température weather (Z-score=1.82)' },
        { feature: 'rolling_std_30', valeur: 2.14, impact: -0.24, interpretation: 'Volatilité accrue sur les 30 dernières secondes' },
        { feature: 'weather_temperature', valeur: 27.8, impact: -0.18, interpretation: 'Variation subtile due au scan réseau' },
      ],
    },
    mitm: {
      score: 0.78, sensors: { weather_temperature: 25.1, fridge_temperature: 18.4, thermostat_temperature: 28.2 },
      causes: [
        { feature: 'fridge_temperature', valeur: 18.4, impact: -0.52, interpretation: 'Température frigo anormalement haute (4→18°C) — falsification MITM' },
        { feature: 'thermostat_temperature', valeur: 28.2, impact: -0.41, interpretation: 'Thermostat décalé de +5°C — injection de fausses données' },
        { feature: 'weather_temperature_lag_1', valeur: 25.1, impact: -0.09, interpretation: 'Incohérence temporelle entre relevés consécutifs' },
      ],
    },
    ddos: {
      score: 0.91, sensors: { weather_temperature: 31.5, fridge_temperature: 6.2, thermostat_temperature: 26.8 },
      causes: [
        { feature: 'rolling_mean_5', valeur: 31.5, impact: -0.48, interpretation: 'Moyenne 5s anormale — saturation de messages MQTT' },
        { feature: 'diff_1', valeur: 4.2, impact: -0.37, interpretation: 'Variation instantanée extrême due au flood réseau' },
        { feature: 'weather_temperature', valeur: 31.5, impact: -0.28, interpretation: 'Bruit élevé sur la liaison capteur' },
      ],
    },
    ransom: {
      score: 0.98, sensors: { weather_temperature: 28.1, fridge_temperature: 47.2, thermostat_temperature: 24.5 },
      causes: [
        { feature: 'fridge_temperature', valeur: 47.2, impact: -0.71, interpretation: 'PIC CRITIQUE — frigo à 47°C (normal=2-6°C) — ransomware actif' },
        { feature: 'zscore_fridge_temperature', valeur: 8.45, impact: -0.22, interpretation: 'Z-score frigo = 8.45 — valeur hors norme' },
        { feature: 'fridge_temperature_lag_5', valeur: 44.1, impact: -0.18, interpretation: 'Dégradation rapide confirmée sur les 5 dernières secondes' },
      ],
    },
  };
  const p = attackProfiles[attackType] || attackProfiles.ddos;
  return {
    timestamp: new Date().toISOString(), is_anomaly: true, anomaly_score: p.score,
    sensors: p.sensors, top_causes: p.causes,
  };
}

const FEATURE_LABELS: Record<string, string> = {
  weather_temperature: 'Weather °C',
  fridge_temperature: 'Fridge °C',
  thermostat_temperature: 'Thermostat °C',
  rolling_mean_5: 'Moyenne 5s',
  rolling_mean_30: 'Moyenne 30s',
  rolling_mean_60: 'Moyenne 60s',
  rolling_std_5: 'Volatilite 5s',
  rolling_std_30: 'Volatilite 30s',
  diff_1: 'Variation inst.',
  diff_5: 'Variation 5s',
  weather_temperature_lag_1: 'Weather t-1',
  fridge_temperature_lag_1: 'Fridge t-1',
  thermostat_temperature_lag_1: 'Thermostat t-1',
  weather_temperature_lag_5: 'Weather t-5',
  fridge_temperature_lag_5: 'Fridge t-5',
  thermostat_temperature_lag_5: 'Thermostat t-5',
  weather_temperature_lag_10: 'Weather t-10',
  fridge_temperature_lag_10: 'Fridge t-10',
  thermostat_temperature_lag_10: 'Thermostat t-10',
  zscore_weather_temperature: 'Z-Weather',
  zscore_fridge_temperature: 'Z-Fridge',
  zscore_thermostat_temperature: 'Z-Thermostat',
};

function ScoreGauge({ score, isAnomaly }: { score: number; isAnomaly: boolean }) {
  const normalized = Math.max(-1, Math.min(1, score / 0.7));
  const angle = (normalized + 1) * 180;
  const color = isAnomaly ? '#EF4444' : '#22C55E';

  return (
    <div className="flex flex-col items-center py-3">
      <svg width="140" height="80" viewBox="0 0 140 80" className="overflow-visible">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#EF4444" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#EAB308" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#22C55E" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <path d="M 10 75 A 60 60 0 0 1 130 75" fill="none" stroke="url(#gaugeGrad)" strokeWidth="10" strokeLinecap="round" />
        <path d="M 10 75 A 60 60 0 0 1 130 75" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${angle / 180 * 188.5} 188.5`} style={{ transition: 'all 0.8s ease-out' }} />
        <circle cx={10 + 120 * Math.cos(Math.PI - angle * Math.PI / 180)} cy={75 - 60 * Math.sin(Math.PI - angle * Math.PI / 180)}
          r="6" fill={color} stroke="var(--color-bg-panel)" strokeWidth="2" style={{ transition: 'all 0.8s ease-out' }} />
        <text x="70" y="55" textAnchor="middle" fill={color} fontSize="18" fontWeight="bold" fontFamily="monospace">
          {score.toFixed(3)}
        </text>
        <text x="70" y="70" textAnchor="middle" fill="var(--color-text-secondary)" fontSize="9" opacity="0.7">
          {isAnomaly ? '⚠ ANOMALIE' : '✓ SAIN'}
        </text>
      </svg>
    </div>
  );
}

function ImpactBar({ impact }: { impact: number }) {
  const pct = Math.min(Math.abs(impact) * 55, 100);
  const isNegative = impact < 0;

  return (
    <div className="relative mt-1.5">
      <div className="flex justify-between text-[10px] mb-0.5 px-0.5" style={{ color: 'var(--color-text-secondary)' }}>
        <span className="opacity-60">← Anomalie</span>
        <span className="opacity-60">Normal →</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden relative" style={{ background: 'var(--color-bg-card)' }}>
        <div className="absolute inset-0 flex">
          <div className="h-full w-1/2" style={{ background: 'color-mix(in srgb, var(--color-accent-danger) 8%, transparent)' }} />
          <div className="h-full w-1/2" style={{ background: 'color-mix(in srgb, var(--color-accent-success) 8%, transparent)' }} />
        </div>
        <div className="h-full rounded-full transition-all duration-700 ease-out relative" style={{
          width: `${pct}%`,
          marginLeft: isNegative ? `${50 - pct}%` : '50%',
          background: isNegative
            ? 'linear-gradient(90deg, #EF4444, #dc2626)'
            : 'linear-gradient(90deg, #22C55E, #16a34a)',
        }} />
      </div>
    </div>
  );
}

export default function XaiPanel({ attackActive, attackType }: XaiPanelProps) {
  const [shapData, setShapData] = useState<ShapResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchShap = () => {
      fetch('/api/shap/latest')
        .then(r => r.json())
        .then(d => { if (mounted && !d.error) setShapData(d); })
        .catch(() => { if (mounted) setShapData(generateDemoShap(attackActive, attackType)); })
        .finally(() => { if (mounted) setLoading(false); });
    };
    fetchShap();
    const interval = setInterval(fetchShap, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, [attackActive, attackType]);

  const recom = attackActive && attackType ? RECOMMENDATIONS[attackType] : RECOMMENDATIONS.normal;
  const causes = shapData?.top_causes?.slice(0, 3) || [];

  return (
    <div className="rounded-2xl p-5" style={{
      background: 'var(--color-bg-panel)',
      border: '1px solid var(--color-border)',
    }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs" style={{
          background: shapData?.is_anomaly
            ? 'color-mix(in srgb, var(--color-accent-danger) 20%, transparent)'
            : 'color-mix(in srgb, var(--color-accent-primary) 15%, transparent)',
          color: shapData?.is_anomaly ? 'var(--color-accent-danger)' : 'var(--color-accent-primary)',
        }}>
          {shapData?.is_anomaly ? '!' : 'AI'}
        </div>
        <div>
          <div className="font-display font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
            Analyse SHAP
          </div>
          <div className="text-[10px] opacity-50 font-mono" style={{ color: 'var(--color-text-secondary)' }}>
            Explication IA en temps reel
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center">
          <div className="inline-block w-5 h-5 rounded-full border-2 animate-spin" style={{
            borderColor: 'var(--color-border)',
            borderTopColor: 'var(--color-accent-primary)',
          }} />
          <div className="text-xs mt-2 opacity-50" style={{ color: 'var(--color-text-secondary)' }}>Analyse...</div>
        </div>
      ) : shapData ? (
        <>
          <ScoreGauge score={shapData.anomaly_score} isAnomaly={shapData.is_anomaly} />

          {shapData.sensors && (
            <div className="flex gap-2 justify-center mb-3">
              {Object.entries(shapData.sensors).map(([key, val]) => (
                <div key={key} className="text-center px-2 py-1.5 rounded-lg" style={{
                  background: 'var(--color-bg-card)',
                  minWidth: 60,
                }}>
                  <div className="text-[10px] opacity-60 font-mono" style={{ color: 'var(--color-text-secondary)' }}>{key.split('_')[0]}</div>
                  <div className="text-xs font-mono font-semibold tabular-nums" style={{
                    color: val < -0.5 ? 'var(--color-accent-danger)' : val > 0.5 ? 'var(--color-accent-success)' : 'var(--color-text-primary)',
                  }}>
                    {val.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between px-1 mb-3 pb-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {shapData.is_anomaly ? 'Causes de l\'anomalie' : 'Facteurs de confiance'}
            </span>
            <span className={clsx('text-[10px] font-mono', shapData.is_anomaly ? 'text-red-400' : 'text-accent-green')}>
              Top {causes.length}
            </span>
          </div>

          <div className="space-y-3">
            {causes.length > 0 ? causes.map((cause, idx) => (
              <div key={idx} className="rounded-xl p-3" style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
              }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{
                      background: shapData.is_anomaly
                        ? 'color-mix(in srgb, var(--color-accent-danger) 15%, transparent)'
                        : 'color-mix(in srgb, var(--color-accent-success) 15%, transparent)',
                      color: shapData.is_anomaly ? 'var(--color-accent-danger)' : 'var(--color-accent-success)',
                    }}>
                      #{idx + 1}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {FEATURE_LABELS[cause.feature] || cause.feature}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono opacity-60" style={{ color: 'var(--color-text-secondary)' }}>
                      val: {cause.valeur.toFixed(3)}
                    </span>
                    <span className="font-mono font-semibold text-xs tabular-nums" style={{
                      color: cause.impact < 0 ? 'var(--color-accent-danger)' : 'var(--color-accent-success)',
                    }}>
                      {cause.impact > 0 ? '+' : ''}{cause.impact.toFixed(3)}
                    </span>
                  </div>
                </div>

                <ImpactBar impact={cause.impact} />

                <div className="mt-1.5 text-[11px] leading-tight px-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {cause.interpretation}
                </div>
              </div>
            )) : (
              <div className="text-xs py-4 text-center opacity-50" style={{ color: 'var(--color-text-secondary)' }}>
                Aucune cause SHAP disponible
              </div>
            )}
          </div>

          <div className={clsx('mt-4 rounded-xl p-3.5 border', recom.danger ? 'border-red-500/20' : 'border-green-500/20')} style={{
            background: recom.danger
              ? 'color-mix(in srgb, var(--color-accent-danger) 6%, transparent)'
              : 'color-mix(in srgb, var(--color-accent-success) 5%, transparent)',
          }}>
            <div className={clsx('text-[11px] font-bold uppercase tracking-wider mb-1', recom.danger ? 'text-red-400' : 'text-accent-green')}>
              {recom.title}
            </div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{recom.text}</div>
          </div>
        </>
      ) : (
        <div className="py-8 text-center text-xs opacity-50" style={{ color: 'var(--color-text-secondary)' }}>
          En attente de donnees...
        </div>
      )}
    </div>
  );
}
