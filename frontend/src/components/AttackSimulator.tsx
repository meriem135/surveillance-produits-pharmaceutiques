import { clsx } from 'clsx';
import type { AttackType } from '../types';

interface AttackSimulatorProps {
  onAttack: (type: AttackType) => void;
  onReset: () => void;
  activeAttack: AttackType | null;
}

const ATTACKS: { type: AttackType; icon: string; label: string; desc: string }[] = [
  { type: 'recon', icon: '🔍', label: 'Scan de Découverte', desc: 'Le pirate cartographie l\'usine' },
  { type: 'mitm', icon: '🌊', label: 'Falsification de Données', desc: 'Piratage des valeurs réelles' },
  { type: 'ddos', icon: '💥', label: 'Inondation Réseau', desc: 'Saturation des commandes' },
  { type: 'ransom', icon: '🔒', label: 'Ransomware Valve', desc: 'Forçage des vannes & moteurs' },
];

export default function AttackSimulator({ onAttack, onReset, activeAttack }: AttackSimulatorProps) {
  return (
    <div className="bg-bg-panel border border-border-panel rounded-2xl p-4 backdrop-blur-sm h-full">
      <div className="border-b border-white/5 pb-2 mb-3">
        <h3 className="font-display font-semibold text-sm flex items-center gap-2">
          <span>🎮</span> Simulateur de Cyber-Attaques
        </h3>
      </div>
      <p className="text-[11px] text-text-secondary mb-3">
        Simulez des attaques et observez la réaction de l'IA
      </p>
      <div className="grid grid-cols-2 gap-2">
        {ATTACKS.map(({ type, icon, label, desc }) => (
          <button
            key={type}
            onClick={() => onAttack(type)}
            className={clsx(
              'flex flex-col gap-0.5 p-2.5 rounded-xl text-left text-[11px] font-semibold border cursor-pointer transition-all duration-200',
              activeAttack === type
                ? 'bg-accent-red/25 border-accent-red text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                : 'bg-accent-orange/[0.06] border-accent-orange/25 text-[#ff9d5c] hover:bg-accent-orange/[0.15] hover:border-accent-orange hover:shadow-[0_0_10px_rgba(249,115,22,0.2)] hover:scale-[1.02]'
            )}
          >
            <span>{icon} {label}</span>
            <span className="text-[9px] opacity-70">{desc}</span>
          </button>
        ))}
      </div>
      <button
        onClick={onReset}
        className="w-full mt-3 bg-accent-green/[0.06] border border-accent-green/25 text-accent-green py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-all duration-200 hover:bg-accent-green/[0.15] hover:border-accent-green hover:shadow-[0_0_10px_rgba(34,197,94,0.2)]"
      >
        Purifier le réseau
      </button>
    </div>
  );
}
