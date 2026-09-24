import { useState, useEffect, useCallback } from 'react';
import type { Telemetry } from '../types';

const API_BASE = '/api';

export function useTelemetry() {
  const [data, setData] = useState<Telemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/telemetry`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: Telemetry[] = await res.json();
      if (json.length > 0) {
        setData(json);
        setError(null);
      } else {
        setError('Aucune donnée de télémétrie disponible');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
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
