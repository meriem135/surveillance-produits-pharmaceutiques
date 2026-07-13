import { motion } from 'framer-motion';

type Severity = 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'offline';

interface StatusIndicatorProps {
  status: Severity;
  label: string;
  sublabel?: string;
  pulse?: boolean;
  size?: number;
}

const SEVERITY_CONFIG: Record<Severity, { color: string; glow: string; label: string }> = {
  safe:     { color: '#00E676', glow: 'rgba(0,230,118,0.35)', label: 'SÛR' },
  low:      { color: '#38BDF8', glow: 'rgba(56,189,248,0.3)',  label: 'FAIBLE' },
  medium:   { color: '#FFD600', glow: 'rgba(255,214,0,0.35)',  label: 'MOYEN' },
  high:     { color: '#FF9100', glow: 'rgba(255,145,0,0.4)',   label: 'ÉLEVÉ' },
  critical: { color: '#FF1744', glow: 'rgba(255,23,68,0.45)',  label: 'CRITIQUE' },
  offline:  { color: '#64748B', glow: 'rgba(100,116,139,0.2)', label: 'HORS LIGNE' },
};

export default function StatusIndicator({ status, label, sublabel, pulse = true, size = 10 }: StatusIndicatorProps) {
  const cfg = SEVERITY_CONFIG[status];
  const isActive = status !== 'offline';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        {pulse && isActive && (
          <motion.div
            style={{
              position: 'absolute', inset: -3, borderRadius: '50%',
              background: cfg.glow,
            }}
            animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <div style={{
          width: size, height: size, borderRadius: '50%',
          background: cfg.color,
          boxShadow: isActive ? `0 0 ${size * 1.5}px ${cfg.glow}` : 'none',
          position: 'relative', zIndex: 1,
        }} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: cfg.color, lineHeight: 1.3, letterSpacing: '0.3px' }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 8, fontWeight: 700, color: cfg.color, opacity: 0.6, letterSpacing: '0.8px' }}>{cfg.label}</span>
          {sublabel && <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>· {sublabel}</span>}
        </div>
      </div>
    </div>
  );
}
