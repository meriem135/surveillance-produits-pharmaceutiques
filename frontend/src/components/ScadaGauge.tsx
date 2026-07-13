import { motion } from 'framer-motion';

interface ScadaGaugeProps {
  value: number;
  min: number;
  max: number;
  label: string;
  unit?: string;
  thresholds?: { warn: number; danger: number };
  size?: number;
  inverted?: boolean;
}

const SOC_COLORS = {
  safe: '#00E676',
  low: '#38BDF8',
  medium: '#FFD600',
  high: '#FF9100',
  critical: '#FF1744',
};

function getColor(pct: number, inverted = false): string {
  const v = inverted ? 100 - pct : pct;
  if (v >= 85) return SOC_COLORS.critical;
  if (v >= 65) return SOC_COLORS.high;
  if (v >= 40) return SOC_COLORS.medium;
  if (v >= 20) return SOC_COLORS.low;
  return SOC_COLORS.safe;
}

function getRiskLabel(pct: number, inverted = false): string {
  const v = inverted ? 100 - pct : pct;
  if (v >= 85) return 'CRITIQUE';
  if (v >= 65) return 'ÉLEVÉ';
  if (v >= 40) return 'MOYEN';
  if (v >= 20) return 'FAIBLE';
  return 'SÛR';
}

export default function ScadaGauge({
  value, min, max, label, unit = '', thresholds, size = 120, inverted = false,
}: ScadaGaugeProps) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const angle = -120 + (pct / 100) * 240;
  const color = thresholds
    ? (pct >= thresholds.danger ? SOC_COLORS.critical : pct >= thresholds.warn ? SOC_COLORS.high : SOC_COLORS.safe)
    : getColor(pct, inverted);
  const riskLabel = getRiskLabel(pct, inverted);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const needleLen = r * 0.75;

  const polar = (deg: number, radius: number) => ({
    x: cx + radius * Math.cos((deg * Math.PI) / 180),
    y: cy + radius * Math.sin((deg * Math.PI) / 180),
  });

  const start = polar(-120, r);
  const tip = polar(angle, needleLen);

  const bgArc = (() => {
    const end2 = polar(120, r);
    return `M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end2.x} ${end2.y}`;
  })();

  const valArc = (() => {
    const valAngle = -120 + (pct / 100) * 240;
    const valEnd = polar(valAngle, r);
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${valAngle - (-120) > 180 ? 1 : 0} 1 ${valEnd.x} ${valEnd.y}`;
  })();

  const gradId = `gauge-${label.replace(/\s+/g, '')}`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{ textAlign: 'center', width: size, margin: '0 auto' }}
    >
      <svg width={size} height={size * 0.88} viewBox={`0 0 ${size} ${size * 0.88}`}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00E676" />
            <stop offset="35%" stopColor="#38BDF8" />
            <stop offset="55%" stopColor="#FFD600" />
            <stop offset="75%" stopColor="#FF9100" />
            <stop offset="100%" stopColor="#FF1744" />
          </linearGradient>
          <filter id={`glow-${gradId}`}>
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={color} floodOpacity="0.5" />
          </filter>
        </defs>
        <path d={bgArc} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={10} strokeLinecap="round" />
        <motion.path
          d={valArc} fill="none" stroke={`url(#${gradId})`} strokeWidth={10}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: pct / 100 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
        {[-120, -80, -40, 0, 40, 80, 120].map((deg) => {
          const t = polar(deg, r - 7);
          const len = deg % 40 === 0 ? 8 : 4;
          const te = polar(deg, r - 7 - len);
          const tickColor = deg <= -40 ? '#00E676' : deg <= 0 ? '#FFD600' : '#FF1744';
          return (
            <line key={deg} x1={t.x} y1={t.y} x2={te.x} y2={te.y}
              stroke={deg % 40 === 0 ? tickColor : 'rgba(255,255,255,0.15)'}
              strokeWidth={deg % 40 === 0 ? 2.5 : 1} opacity={deg % 40 === 0 ? 0.8 : 0.4} />
          );
        })}
        <motion.line x1={cx} y1={cy} x2={tip.x} y2={tip.y}
          stroke={color} strokeWidth={2.5} strokeLinecap="round"
          filter={`url(#glow-${gradId})`}
          initial={{ rotate: -120 }}
          animate={{ rotate: angle + 120 }}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
          transition={{ duration: 1, ease: 'easeOut' }} />
        <circle cx={cx} cy={cy} r={4.5} fill={color} filter={`url(#glow-${gradId})`} />
      </svg>
      <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace", marginTop: -2 }}>
        {value.toFixed(1)}{unit}
      </div>
      <div style={{
        fontSize: 9, fontWeight: 600, letterSpacing: '1px',
        color, opacity: 0.7, marginTop: 1,
      }}>
        {riskLabel}
      </div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
    </motion.div>
  );
}
