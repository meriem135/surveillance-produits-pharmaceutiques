import { type ReactNode } from 'react';
import { PageHeader, Readouts, Stat, State } from './etude/kit';
import { PhasePipeline, type PhaseItem } from './PhasePipeline';

interface PhaseShellProps {
  phase: PhaseItem;
  children: ReactNode;
  /** Conservé pour compatibilité : les orbes décoratifs ont été retirés. */
  backgroundOrbs?: boolean;
  hidePipeline?: boolean;
  trained?: boolean;
  /** Sous-titre de l'en-tête ; par défaut celui de la phase. */
  subtitle?: ReactNode;
  /** Actions affichées à droite de l'en-tête. */
  actions?: ReactNode;
  stats?: Array<{
    icon: ReactNode;
    label: string;
    value: string | number;
    /** Ignoré : les lectures utilisent les jetons du thème. */
    color: string;
    sub?: string;
  }>;
}

/** Cadre commun des pages de phase (archives de l'année simulée), au langage des pages etude. */
export function PhaseShell({ phase, children, hidePipeline = false, trained, subtitle, actions, stats }: PhaseShellProps) {
  const done = trained !== undefined ? trained : phase.status === 'completed';
  return (
    <div className="space-y-6 pb-8" data-phase={phase.num}>
      <PageHeader title={`Phase ${phase.num} : ${phase.label}`} subtitle={subtitle ?? phase.subtitle}>
        <State kind={done ? 'ok' : 'neutre'}>{done ? 'Phase terminée' : phase.status === 'active' ? 'En cours' : 'En attente'}</State>
        {actions}
      </PageHeader>
      {!hidePipeline && <div className="vc-panel overflow-hidden"><PhasePipeline activePhase={phase.num} /></div>}
      {stats && stats.length > 0 && (
        <Readouts cols={stats.length >= 5 ? 5 : stats.length === 3 ? 3 : 4}>
          {stats.map((s, i) => <Stat key={i} label={s.label} value={s.value} sub={s.sub} />)}
        </Readouts>
      )}
      {children}
    </div>
  );
}
