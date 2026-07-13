import { motion } from 'framer-motion';

interface PhaseBridgeProps {
  fromPhase: number;
  toPhase: number;
  fromLabel: string;
  toLabel: string;
  value: string | number;
  weight: number;
  contribution?: number;
  isFromDetail?: boolean;
}

const PHASE_COLORS: Record<number, string> = {
  1: '#00F5FF',
  2: '#00FFA3',
  3: '#FF2D78',
  4: '#A855F7',
};

export function PhaseBridge({
  fromPhase,
  toPhase,
  fromLabel,
  toLabel,
  value,
  weight,
  contribution,
  isFromDetail = false,
}: PhaseBridgeProps) {
  const fromColor = PHASE_COLORS[fromPhase] || '#00FFA3';
  const toColor = PHASE_COLORS[toPhase] || '#FF2D78';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-3 sm:p-4 glass overflow-hidden relative cursor-default group"
      style={{
        border: '1px solid rgba(168,85,247,0.12)',
        background: 'linear-gradient(135deg, rgba(0,255,163,0.03), rgba(255,45,120,0.03))',
      }}>
      {/* Connector line */}
      <div className="absolute top-1/2 left-0 right-0 h-[1px] opacity-20"
        style={{
          background: `linear-gradient(90deg, ${fromColor}, ${toColor})`,
        }} />

      <div className="relative flex items-center justify-between gap-3 flex-wrap">
        {/* Source */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${fromColor}12` }}>
            <span className="text-xs sm:text-sm">{'\u{1F9E0}'}</span>
          </div>
          <div className="text-[9px] sm:text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            <div className="font-bold" style={{ color: fromColor }}>
              Phase {fromPhase}
            </div>
            {fromLabel}
          </div>
        </div>

        {/* Flow indicator */}
        <div className="flex flex-col items-center flex-1 sm:flex-none">
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="text-[8px] sm:text-[9px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
              style={{
                background: 'rgba(168,85,247,0.1)',
                color: '#A855F7',
                border: '1px solid rgba(168,85,247,0.15)',
              }}>
              {isFromDetail ? 'ML Score' : 'Contribution'} \u00D7 {weight}%
            </div>
            <motion.div
              animate={{ x: [0, 3, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-xs sm:text-sm" style={{ color: toColor }}>
              {'\u27A1\uFE0F'}
            </motion.div>
          </div>
        </div>

        {/* Target */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="text-[9px] sm:text-[10px] text-right" style={{ color: 'var(--text-secondary)' }}>
            <div className="font-bold" style={{ color: toColor }}>
              Phase {toPhase}
            </div>
            {toLabel}
          </div>
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${toColor}12` }}>
            <span className="text-xs sm:text-sm">{'\u{1F6E1}\uFE0F'}</span>
          </div>
        </div>
      </div>

      {/* Value bar */}
      <div className="mt-2 sm:mt-3 flex items-center gap-2 sm:gap-3 relative">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${isFromDetail ? weight : (contribution || 0)}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="h-full rounded-full relative"
            style={{
              background: `linear-gradient(90deg, ${fromColor}, ${toColor})`,
              boxShadow: `0 0 8px ${toColor}30`,
            }} />
        </div>
        <div className="text-[9px] font-mono font-bold shrink-0" style={{ color: toColor }}>
          {value}
        </div>
      </div>

      {isFromDetail && contribution != null && (
        <div className="mt-1 text-[8px] text-center" style={{ color: 'var(--text-secondary)' }}>
          Contribution au risque total : <strong style={{ color: toColor }}>{contribution.toFixed(1)} pts</strong>
        </div>
      )}
    </motion.div>
  );
}
