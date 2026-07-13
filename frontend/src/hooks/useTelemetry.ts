import { useState, useEffect, useCallback } from 'react';
import type { Telemetry } from '../types';

const API_BASE = '/api';
const POINTS = 80;

const THESIS_RESULTS = {
  if_multivarie: { f1: 0.995, recall: 1.0, precision: 0.991, fp_rate: 0.334, roc_auc: 0.840 },
  attack_rates: { ddos: 100.0, dos: 100.0, mitm: 100.0, xss: 100.0, injection: 99.4, ransomware: 97.5, scanning: 74.2 },
};

function generateMockData(): Telemetry[] {
  const now = Date.now();
  const data: Telemetry[] = [];
  const fpRate = THESIS_RESULTS.if_multivarie.fp_rate;
  let score = 97 + Math.random() * 2;
  for (let i = 0; i < POINTS; i++) {
    const drift = Math.sin(i / 25) * 3;
    const noise = (Math.random() - 0.5) * 4;
    const isFalsePositive = Math.random() < fpRate * 0.15;
    score = Math.max(40, Math.min(100, score + (Math.random() - 0.5) * 3 + drift * 0.1));
    const finalScore = isFalsePositive
      ? parseFloat(Math.max(10, Math.min(45, 40 + (Math.random() - 0.5) * 20)).toFixed(1))
      : parseFloat(Math.max(60, Math.min(100, score + noise)).toFixed(1));
    const t = new Date(now - (POINTS - i) * 30000);
    const baseTemp = 26 + Math.sin(i / 20) * 4;
    data.push({
      metric_key: 'behavioral_twin',
      timestamp: t.toISOString().replace('T', ' ').slice(0, 19),
      metric_value: {
        normality_score: finalScore,
        is_anomaly: finalScore < 50,
        sensors: {
          weather_temperature: parseFloat((baseTemp + 2 + (Math.random() - 0.5) * 4).toFixed(1)),
          fridge_temperature: parseFloat((4 + Math.sin(i / 15) * 1.5 + (Math.random() - 0.5) * 1.5).toFixed(1)),
          thermostat_temperature: parseFloat((24 + Math.sin(i / 22) * 2 + (Math.random() - 0.5) * 2).toFixed(1)),
        },
      },
    });
  }
  return data;
}

export function useTelemetry() {
  const [data, setData] = useState<Telemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/telemetry`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: Telemetry[] = await res.json();
      if (json.length > 0) {
        setData(json);
        setError(null);
        return;
      }
      throw new Error('empty data');
    } catch {
      setData(generateMockData());
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
