import { clsx } from 'clsx';

interface TwinStatusProps {
  danger: boolean;
}

export default function TwinStatus({ danger }: TwinStatusProps) {
  return (
    <div className="bg-bg-panel border border-border-panel rounded-2xl p-4 backdrop-blur-sm h-full">
      <div className="border-b border-white/5 pb-2 mb-3">
        <h3 className="font-display font-semibold text-sm flex items-center gap-2">
          <span>🔌</span> Synchronisation Temps Réel
        </h3>
      </div>
      <div className="flex justify-around items-center py-3 bg-white/[0.01] rounded-xl border border-white/[0.03] relative">
        <div className="text-center z-[2]">
          <div className="w-[56px] h-[56px] rounded-xl bg-bg-card border-2 border-blue-400 flex items-center justify-center mx-auto mb-1.5 text-xl shadow-[0_0_20px_rgba(59,130,246,0.15)]">
            🏭
          </div>
          <span className="text-[11px] font-semibold text-text-secondary">Automate Réel</span>
        </div>

        <div className="absolute h-[2px] w-[40%] top-1/2 left-[30%] -translate-y-1/2 z-[1] transition-all duration-300"
          style={{
            background: danger
              ? 'linear-gradient(90deg, var(--color-accent-red), var(--color-accent-red))'
              : 'linear-gradient(90deg, var(--color-accent-green), var(--color-accent-cyan))',
          }}
        />

        <div className={clsx('text-center z-[2]', danger && 'animate-warning-flash')}>
          <div className={clsx(
            'w-[56px] h-[56px] rounded-xl bg-bg-card flex items-center justify-center mx-auto mb-1.5 text-xl transition-all duration-300',
            danger
              ? 'border-2 border-accent-red shadow-[0_0_25px_rgba(239,68,68,0.4)]'
              : 'border-2 border-accent-green shadow-[0_0_20px_rgba(34,197,94,0.15)]'
          )}>
            {danger ? '🔥' : '🤖'}
          </div>
          <span className="text-[11px] font-semibold text-text-secondary">Ange Gardien IA</span>
        </div>
      </div>
    </div>
  );
}
