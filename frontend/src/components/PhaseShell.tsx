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

export function PhaseShell({ phase, children, backgroundOrbs = true, hidePipeline = false, trained, stats }: PhaseShellProps) {
  const phaseColors: Record<number, string> = {
    1: '#00F5FF',
    2: '#00FFA3',
    3: '#FF2D78',
    4: '#A855F7',
  };
  const color = phaseColors[phase.num] || phase.color;
  const glowColor = color + '08';

  return (
    <div className="relative min-h-full" data-phase={phase.num}>
      {backgroundOrbs && <BackgroundOrbs phaseColor={glowColor} />}

      <div className="relative z-10 space-y-4 pb-8 px-1">
        {/* Header */}
        <div className="rounded-2xl overflow-hidden glass glass-border"
          style={{
            borderColor: `${color}18`,
            boxShadow: `0 0 40px ${glowColor}`,
          }}>
          {!hidePipeline && <PhasePipeline activePhase={phase.num} />}

          <div className="px-4 sm:px-6 py-4 sm:py-5">
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <div className="flex items-center gap-4 w-full sm:w-auto">
                <div
                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${color}20, ${color}08)`,
                    color: color,
                    boxShadow: `0 0 30px ${color}25`,
                  }}>
                  <span className="text-xl sm:text-2xl">{phase.icon}</span>
                </div>
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="font-display text-lg sm:text-xl font-bold"
                      style={{
                        background: `linear-gradient(135deg, ${color}, ${color}CC)`,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                      }}>
                      Phase {phase.num} — {phase.label}
                    </h1>
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold inline-flex items-center gap-1.5"
                      style={{
                        background: `${color}12`,
                        color: color,
                        border: `1px solid ${color}25`,
                      }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                      {trained !== undefined
                        ? (trained ? 'TERMINÉE' : 'EN ATTENTE')
                        : (phase.status === 'completed' ? 'TERMINÉE' : phase.status === 'active' ? 'EN COURS' : 'PLANIFIÉE')}
                    </span>
                  </div>
                  <p className="text-[10px] sm:text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {phase.subtitle}
                  </p>
                </div>
              </div>

              {stats && (
                <div className="flex flex-wrap gap-2 sm:ml-auto w-full sm:w-auto">
                  {stats.map((s, i) => (
                    <div key={i}
                      className="flex flex-col items-center px-2.5 sm:px-3 py-2 rounded-xl glass flex-1 sm:flex-none min-w-[70px] sm:min-w-[80px]"
                      style={{ border: `1px solid ${s.color}20` }}>
                      <div className="font-display font-bold text-sm sm:text-base" style={{ color: s.color }}>
                        {s.value}
                      </div>
                      <div className="flex items-center gap-1 text-[7px] sm:text-[8px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {s.icon}
                        {s.label}
                      </div>
                      {s.sub && (
                        <div className="text-[6px] sm:text-[7px] font-mono mt-0.5 opacity-60" style={{ color: 'var(--text-secondary)' }}>
                          {s.sub}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="mt-3 sm:mt-4 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${phase.progress}%` }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
                className="h-full rounded-full relative"
                style={{
                  background: `linear-gradient(90deg, ${color}, ${color}CC)`,
                  boxShadow: `0 0 10px ${color}30`,
                }} />
            </div>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
