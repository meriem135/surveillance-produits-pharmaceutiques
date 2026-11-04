import { Brain, Download, Search, ShieldCheck } from 'lucide-react';
export interface PhaseItem {
  num: number;
  label: string;
  subtitle: string;
  icon: import('react').ReactNode;
  color: string;
  status: 'completed' | 'active' | 'pending';
  progress: number;
}

export const PHASE_CONFIG: PhaseItem[] = [
  {
    num: 1, label: 'Ingestion IoT', subtitle: 'MQTT · flux temps réel des trois capteurs',
    icon: <Download className="w-5 h-5" />, color: '#0891B2', status: 'completed', progress: 100,
  },
  {
    num: 2, label: 'Détection d’anomalies', subtitle: 'One-Class SVM · jeu annuel simulé à partir des traces TON_IoT',
    icon: <Brain className="w-5 h-5" />, color: '#0D9488', status: 'completed', progress: 100,
  },
  {
    num: 3, label: 'Risk Scoring Prédictif', subtitle: 'CVE + 5 facteurs · Score 0-100',
    icon: <ShieldCheck className="w-5 h-5" />, color: '#E11D48', status: 'active', progress: 65,
  },
  {
    num: 4, label: 'Threat Intelligence', subtitle: 'CTI Dashboard · LLM Analyst',
    icon: <Search className="w-5 h-5" />, color: '#7C3AED', status: 'pending', progress: 15,
  },
];

export function PhasePipeline({ activePhase }: { activePhase: number }) {
  return (
    <div className="flex items-center px-4 sm:px-6 py-2.5 gap-0 overflow-x-auto"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 5%, transparent)' }}>
      {PHASE_CONFIG.map((p, i) => (
        <div key={p.num} className="flex items-center flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 flex-1">
            <div
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-sm shrink-0 transition-all duration-500 ${
                p.num === activePhase ? 'ring-2' : ''
              } ${p.status === 'completed' ? 'opacity-80' : p.status === 'pending' ? 'opacity-30' : ''}`}
              style={{
                background: p.num === activePhase ? `${p.color}18` : 'color-mix(in srgb, var(--text-primary) 4%, transparent)',
                borderColor: p.num === activePhase ? p.color : 'transparent',
                borderWidth: '2px',
                boxShadow: p.num === activePhase ? `0 0 20px ${p.color}30` : 'none',
              }}>
              <span className="text-xs sm:text-sm">{p.num === activePhase ? '\u25C9' : p.status === 'completed' ? '\u2713' : p.icon}</span>
            </div>
            <div className="min-w-0 hidden sm:block">
              <div className="text-[9px] font-bold truncate" style={{ color: p.num === activePhase ? p.color : 'var(--text-secondary)' }}>
                Phase {p.num}
              </div>
              <div className="text-[7px] truncate" style={{ color: p.num === activePhase ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {p.label}
              </div>
            </div>
            <div className={`text-[8px] font-mono font-bold shrink-0 px-1.5 py-0.5 rounded ${
              p.status === 'completed' ? 'opacity-60' : p.status === 'pending' ? 'opacity-30' : ''}`}
              style={{
                background: `${p.color}12`,
                color: p.color,
                display: p.num === activePhase ? 'block' : 'none',
              }}>
              {p.progress}%
            </div>
          </div>
          {i < PHASE_CONFIG.length - 1 && (
            <div className="flex items-center mx-1 sm:mx-2 shrink-0" style={{ color: 'var(--text-secondary)', opacity: 0.25 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 12h14M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
