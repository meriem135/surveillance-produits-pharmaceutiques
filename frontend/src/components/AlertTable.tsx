import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { clsx } from 'clsx';
import type { Telemetry } from '../types';

interface AlertTableProps {
  data: Telemetry[];
}

export default function AlertTable({ data }: AlertTableProps) {
  const [search, setSearch] = useState('');

  const reversed = useMemo(() => [...data].reverse(), [data]);

  const filtered = useMemo(() => {
    if (!search.trim()) return reversed;
    return reversed.filter((row) =>
      row.timestamp.toLowerCase().includes(search.toLowerCase())
    );
  }, [reversed, search]);

  return (
    <div className="bg-bg-panel border border-border-panel rounded-2xl p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-0">
        <h3 className="font-display font-semibold text-lg flex items-center gap-2">
          <span>📋</span> Historique des Activités et Décisions IA
        </h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <input
            type="text"
            placeholder="Rechercher par date ou heure..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-bg-card border border-border-panel text-text-primary pl-9 pr-4 py-2 rounded-lg text-xs font-body w-[280px] outline-none transition-all duration-200 focus:border-accent-cyan focus:shadow-[0_0_10px_rgba(0,245,255,0.25)]"
          />
        </div>
      </div>

      <div className="overflow-x-auto max-h-[400px] overflow-y-auto rounded-xl border border-border-panel mt-4">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-gray-800/80 sticky top-0 z-10">
              {['Horodatage', 'Stabilité', 'Weather °C', 'Fridge °C', 'Thermostat °C', 'Décision'].map((h) => (
                <th key={h} className="text-text-secondary font-semibold px-4 py-3.5 border-b border-border-panel whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, idx) => {
              const val = row.metric_value;
              const isAnomaly = val.is_anomaly;
              return (
                <tr
                  key={idx}
                  className="transition-colors duration-150 hover:bg-white/[0.02]"
                >
                  <td className="font-mono text-[11px] px-4 py-3 border-b border-border-panel bg-bg-base/40">{row.timestamp}</td>
                  <td
                    className="font-bold px-4 py-3 border-b border-border-panel"
                    style={{ color: val.normality_score < 40 ? 'var(--color-accent-red)' : '#22C55E' }}
                  >
                    {val.normality_score}%
                  </td>
                  <td className="font-mono text-[11px] px-4 py-3 border-b border-border-panel bg-bg-base/40">
                    {val.sensors.weather_temperature.toFixed(1)}°C
                  </td>
                  <td className="font-mono text-[11px] px-4 py-3 border-b border-border-panel bg-bg-base/40">
                    {val.sensors.fridge_temperature.toFixed(1)}°C
                  </td>
                  <td className="font-mono text-[11px] px-4 py-3 border-b border-border-panel bg-bg-base/40">
                    {val.sensors.thermostat_temperature.toFixed(1)}°C
                  </td>
                  <td className="px-4 py-3 border-b border-border-panel">
                    <span
                      className={clsx(
                        'inline-block px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide border',
                        isAnomaly
                          ? 'bg-accent-red/10 text-red-400 border-accent-red/20'
                          : 'bg-accent-green/10 text-accent-green border-accent-green/20'
                      )}
                    >
                      {isAnomaly ? '🚨 ALERTE INTRUSION' : '✔ Conforme'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
