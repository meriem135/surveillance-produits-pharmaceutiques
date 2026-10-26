import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { PhasePipeline, type PhaseItem } from './PhasePipeline';

interface PhaseShellProps {
  phase: PhaseItem;
  children: ReactNode;
  backgroundOrbs?: boolean;
  hidePipeline?: boolean;
  trained?: boolean;
  stats?: Array<{
    icon: ReactNode;
    label: string;
    value: string | number;
    color: string;
    sub?: string;
  }>;
}

function BackgroundOrbs({ phaseColor }: { phaseColor: string }) {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <div className="absolute w-[500px] h-[500px] rounded-full -top-32 -left-32 animate-orb"
        style={{ background: `radial-gradient(circle, ${phaseColor}0A 0%, transparent 70%)` }} />
      <div className="absolute w-[400px] h-[400px] rounded-full top-1/3 -right-24 animate-orb-reverse"
        style={{ background: `radial-gradient(circle, ${phaseColor}08 0%, transparent 70%)` }} />
      <div className="absolute w-[350px] h-[350px] rounded-full bottom-20 left-1/4 animate-orb-slow"
        style={{ background: `radial-gradient(circle, ${phaseColor}06 0%, transparent 70%)` }} />
      <div className="absolute w-[600px] h-[600px] rounded-full -bottom-48 right-1/3 animate-orb"
        style={{ background: `radial-gradient(circle, ${phaseColor}04 0%, transparent 70%)` }} />
      <div className="absolute inset-0" style={{
        backgroundImage: 'radial-gradient(rgba(55,65,81,0.08) 0.5px, transparent 0.5px)',
        backgroundSize: '32px 32px',
      }} />
    </div>
  );
}

export function PhaseShell({ phase, children, backgroundOrbs = false, hidePipeline = false, trained, stats }: PhaseShellProps) {
  const phaseColors: Record<number, string> = {
    1: '#0891B2',
    2: '#0D9488',
    3: '#E11D48',
    4: '#7C3AED',
  };
  const color = phaseColors[phase.num] || phase.color;
  const glowColor = color + '08';

  return (
    <div className="relative min-h-full" data-phase={phase.num}>
      {backgroundOrbs && <BackgroundOrbs phaseColor={glowColor} />}

      <div className="relative z-10 space-y-5 pb-8">
        {/* Header */}
        <div className="vc-card overflow-hidden">
          {!hidePipeline && <PhasePipeline activePhase={phase.num} />}

          <div className="px-4 sm:px-6 py-4 sm:py-5">
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <div className="flex items-center gap-4 w-full sm:w-auto">
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)' }}>
                  <span className="text-lg">{phase.icon}</span>
                </div>
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-lg sm:text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                      Phase {phase.num} — {phase.label}
                    </h1>
                    <span
                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold inline-flex items-center gap-1.5"
                      style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-success)' }} />
                      {trained !== undefined
                        ? (trained ? 'TERMINÉE' : 'EN ATTENTE')
                        : (phase.status === 'completed' ? 'TERMINÉE' : phase.status === 'active' ? 'EN COURS' : 'PLANIFIÉE')}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {phase.subtitle}
                  </p>
                </div>
              </div>

              {stats && (
                <div className="flex flex-wrap gap-2 sm:ml-auto w-full sm:w-auto">
                  {stats.map((s, i) => (
                    <div key={i}
                      className="flex flex-col items-start px-3 py-2 rounded-lg flex-1 sm:flex-none min-w-[90px]"
                      style={{ border: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
                      <div className="font-semibold text-base tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        {s.value}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {s.icon}
                        {s.label}
                      </div>
                      {s.sub && (
                        <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {s.sub}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="mt-3 sm:mt-4 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${phase.progress}%` }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
                className="h-full rounded-full relative"
                style={{ background: 'var(--accent-primary)' }} />
            </div>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
