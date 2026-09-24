import { Database, ShieldCheck } from 'lucide-react';

export default function Header() {
  return (
    <header className="flex items-center justify-between px-8 py-5 bg-bg-panel border border-border-panel rounded-2xl backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-fade-in">
      <div>
        <h1 className="font-display text-[26px] font-bold bg-gradient-to-r from-accent-cyan via-blue-400 to-accent-green bg-clip-text text-transparent flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-accent-cyan" />
          VigiloChain
        </h1>
        <p className="text-text-secondary text-xs font-medium tracking-wide mt-1">
          Jumeau Numérique Industriel — Surveillance par Intelligence Artificielle en Temps Réel (100% Offline-First)
        </p>
      </div>
      <div className="flex items-center gap-2 bg-accent-green/10 text-accent-green px-4 py-2 rounded-full text-xs font-bold border border-accent-green/20 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
        <span className="w-[10px] h-[10px] rounded-full bg-accent-green shadow-[0_0_10px_var(--color-accent-green)] animate-pulse-glow" />
        <Database className="w-3.5 h-3.5" />
        Base de données locale connectée
      </div>
    </header>
  );
}
