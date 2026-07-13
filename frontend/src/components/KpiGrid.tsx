import { ShieldCheck, Brain, Activity, AlertTriangle } from 'lucide-react';
import StatCard from './StatCard';
import type { Telemetry } from '../types';

interface KpiGridProps {
  data: Telemetry[];
  attackActive: boolean;
}

export default function KpiGrid({ data, attackActive }: KpiGridProps) {
  const latest = data.length > 0 ? data[data.length - 1] : null;
  const normality = latest?.metric_value.normality_score ?? 97.6;
  const totalCount = data.length;

  return (
    <div className="grid grid-cols-2 gap-3 h-full">
      <StatCard
        title="État du système"
        value={attackActive ? 'ALERTE' : 'Sécurisé'}
        description={attackActive ? 'Comportement anormal detecte' : 'Fonctionnement nominal'}
        accentColor={attackActive ? 'var(--color-accent-danger)' : 'var(--color-accent-success)'}
        icon={<ShieldCheck className="w-3.5 h-3.5" />}
      />
      <StatCard
        title="Confiance IA"
        value={`${normality.toFixed(1)}%`}
        description="Score de normalite"
        accentColor={attackActive ? 'var(--color-accent-danger)' : 'var(--color-accent-primary)'}
        icon={<Brain className="w-3.5 h-3.5" />}
      />
      <StatCard
        title="Activite réseau"
        value={totalCount.toLocaleString()}
        description="Points de telemetrie analyses"
        accentColor="var(--color-accent-primary)"
        icon={<Activity className="w-3.5 h-3.5" />}
      />
      <StatCard
        title="Niveau de menace"
        value={attackActive ? 'CRITIQUE' : 'Aucune'}
        description={attackActive ? 'Signal anormal bloque' : 'Aucune intrusion'}
        accentColor={attackActive ? 'var(--color-accent-danger)' : 'var(--color-accent-success)'}
        icon={<AlertTriangle className="w-3.5 h-3.5" />}
      />
    </div>
  );
}
