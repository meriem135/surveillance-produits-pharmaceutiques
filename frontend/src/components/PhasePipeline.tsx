import { Brain, Download, Search, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

export interface PhaseItem {
  num: number;
  label: string;
  subtitle: string;
  icon: ReactNode;
  /** Jeton CSS de la phase (plus de couleur en dur). */
  color: string;
  status: 'completed' | 'active' | 'pending';
  progress: number;
}

export const PHASE_CONFIG: PhaseItem[] = [
  {
    num: 1, label: 'Ingestion IoT', subtitle: 'MQTT, flux temps réel des trois capteurs',
    icon: <Download className="w-5 h-5" />, color: 'var(--accent-primary)', status: 'completed', progress: 100,
  },
  {
    num: 2, label: 'Détection d’anomalies', subtitle: 'One-Class SVM, jeu annuel simulé à partir des traces TON_IoT',
    icon: <Brain className="w-5 h-5" />, color: 'var(--accent-primary)', status: 'completed', progress: 100,
  },
  {
    num: 3, label: 'Score de risque prédictif', subtitle: 'CVE et 5 facteurs, score de 0 à 100',
    icon: <ShieldCheck className="w-5 h-5" />, color: 'var(--accent-primary)', status: 'active', progress: 65,
  },
  {
    num: 4, label: 'Renseignement sur les menaces', subtitle: 'Tableau CTI, analyste LLM',
    icon: <Search className="w-5 h-5" />, color: 'var(--accent-primary)', status: 'pending', progress: 15,
  },
];

const STATUS_FR: Record<PhaseItem['status'], string> = { completed: 'terminée', active: 'en cours', pending: 'planifiée' };

/** Frise sobre des quatre phases ; la phase active est soulignée. */
export function PhasePipeline({ activePhase }: { activePhase: number }) {
  return (
    <ol className="vc-panel-head grid grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: 'var(--border)' }}>
      {PHASE_CONFIG.map(p => {
        const active = p.num === activePhase;
        return (
          <li key={p.num} aria-current={active ? 'step' : undefined} className="px-4 py-2.5 min-w-0"
            style={{ background: 'var(--bg-panel)', boxShadow: active ? 'inset 0 -2px 0 var(--accent-primary)' : undefined }}>
            <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Phase {p.num} · {STATUS_FR[p.status]}</div>
            <div className="text-[13.5px] truncate" style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: active ? 600 : 400 }}>{p.label}</div>
          </li>
        );
      })}
    </ol>
  );
}
