import { motion } from 'framer-motion';

interface Feature {
  name: string;
  importance: number;
}

interface Factor {
  name: string;
  contribution: number;
  color: string;
}

interface PhaseFlowDiagramProps {
  mlScore: number;
  mlFeatures: Feature[];
  riskScore: number;
  factors: Factor[];
}

export function PhaseFlowDiagram({ mlScore, mlFeatures, riskScore, factors }: PhaseFlowDiagramProps) {
  const phase2Color = '#00FFA3';
  const phase3Color = '#FF2D78';

  return (
    <div className="rounded-2xl p-4 sm:p-6 glass glass-border overflow-hidden relative"
      style={{ borderColor: 'rgba(168,85,247,0.12)' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: 'linear-gradient(90deg, transparent, #00FFA3, #A855F7, #FF2D78, transparent)' }} />

      <h3 className="font-display font-bold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <span className="text-base">{'\u{1F9EC}'}</span> Flux de données ML → Risque
        <span className="ml-auto text-[8px] font-mono px-2 py-0.5 rounded-full" style={{ background: 'rgba(168,85,247,0.1)', color: '#A855F7' }}>
          Phase 2 → Phase 3
        </span>
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 items-center">
        {/* Phase 2 Box */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="rounded-xl p-4 sm:p-5 relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${phase2Color}08, ${phase2Color}02)`,
            border: `1px solid ${phase2Color}20`,
          }}>
          <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10"
            style={{ background: phase2Color }} />
          <div className="text-[9px] font-bold mb-2 tracking-wider" style={{ color: phase2Color }}>
            PHASE 2 · Isolation Forest Multivarié
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-display" style={{ color: phase2Color }}>
            {mlScore.toFixed(0)}<span className="text-sm">/100</span>
          </div>
          <div className="mt-2 space-y-1">
            {mlFeatures.slice(0, 3).map((f, i) => (
              <div key={f.name} className="flex items-center gap-2 text-[8px] sm:text-[9px]">
                <div className={`w-1.5 h-1.5 rounded-full ${i === 0 ? 'animate-pulse' : ''}`} style={{ background: phase2Color }} />
                <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{f.name}</span>
                <span className="ml-auto font-mono opacity-60" style={{ color: 'var(--text-primary)' }}>
                  {f.importance.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          {/* Anomaly score indicator */}
          <div className="mt-3 flex items-center gap-2 text-[8px]">
            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${mlScore}%` }}
                transition={{ duration: 1, delay: 0.3 }}
                className="h-full rounded-full"
                style={{ background: mlScore > 70 ? '#EF4444' : mlScore > 40 ? '#FBBF24' : phase2Color }} />
            </div>
            <span className="font-mono font-bold" style={{ color: phase2Color }}>ML</span>
          </div>
        </motion.div>

        {/* Arrow + Weight */}
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="flex flex-col items-center gap-2">
          <div className="hidden md:block text-2xl" style={{ color: 'var(--text-secondary)', opacity: 0.4 }}>
            {'\u27A1\uFE0F'}
          </div>
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[8px] sm:text-[9px] font-bold whitespace-nowrap"
            style={{
              background: 'rgba(168,85,247,0.1)',
              color: '#A855F7',
              border: '1px solid rgba(168,85,247,0.2)',
            }}>
            <span className="hidden sm:inline">poids </span>\u00D7 30%
          </div>
        </motion.div>

        {/* Phase 3 Box */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="rounded-xl p-4 sm:p-5 relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${phase3Color}08, ${phase3Color}02)`,
            border: `1px solid ${phase3Color}20`,
          }}>
          <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10"
            style={{ background: phase3Color }} />
          <div className="text-[9px] font-bold mb-2 tracking-wider" style={{ color: phase3Color }}>
            PHASE 3 · Risk Scoring
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-display" style={{ color: phase3Color }}>
            {riskScore}<span className="text-sm">/100</span>
          </div>
          <div className="mt-2 space-y-1">
            {factors.map((f, i) => (
              <div key={f.name} className="flex items-center gap-2 text-[8px] sm:text-[9px]">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: f.color }} />
                <span style={{ color: 'var(--text-secondary)' }}>{f.name}</span>
                <span className="ml-auto font-mono" style={{ color: f.contribution > 20 ? f.color : 'var(--text-secondary)' }}>
                  +{f.contribution.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
          {/* Contribution bar */}
          <div className="mt-3 flex gap-1">
            {factors.map((f, i) => (
              <motion.div
                key={f.name}
                initial={{ width: 0 }}
                animate={{ width: `${f.contribution}%` }}
                transition={{ duration: 0.8, delay: 0.5 + i * 0.1 }}
                className="h-1.5 rounded-full first:rounded-l-full last:rounded-r-full"
                style={{ background: f.color, opacity: 0.7 }} />
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
