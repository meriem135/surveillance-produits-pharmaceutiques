import { motion } from 'framer-motion';

interface MachinePanelProps {
  name: string;
  icon: string;
  temperature: number;
  status: 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'offline';
  attackRate: number;
  detectionRate: number;
  riskScore: number;
  color: string;
  details?: { label: string; value: string }[];
}

const SEVERITY = {
  safe:     { color: '#00E676', bg: 'rgba(0,230,118,0.08)', border: 'rgba(0,230,118,0.2)',  label: 'SÛR' },
  low:      { color: '#38BDF8', bg: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.2)',  label: 'FAIBLE' },
  medium:   { color: '#FFD600', bg: 'rgba(255,214,0,0.08)',  border: 'rgba(255,214,0,0.25)',  label: 'MOYEN' },
  high:     { color: '#FF9100', bg: 'rgba(255,145,0,0.1)',   border: 'rgba(255,145,0,0.3)',   label: 'ÉLEVÉ' },
  critical: { color: '#FF1744', bg: 'rgba(255,23,68,0.12)',  border: 'rgba(255,23,68,0.35)',  label: 'CRITIQUE' },
  offline:  { color: '#64748B', bg: 'rgba(100,116,139,0.05)', border: 'rgba(100,116,139,0.15)', label: 'HORS LIGNE' },
};

function RiskMeter({ score }: { score: number }) {
  const barColor = score >= 75 ? '#FF1744' : score >= 50 ? '#FF9100' : score >= 25 ? '#FFD600' : '#00E676';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{ height: '100%', background: barColor, borderRadius: 3, boxShadow: `0 0 6px ${barColor}` }}
        />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: barColor, fontFamily: "'JetBrains Mono', monospace", minWidth: 32, textAlign: 'right' }}>{score}/100</span>
    </div>
  );
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(pct, 1)}%` }}
        transition={{ duration: 1, ease: 'easeOut' }}
        style={{ height: '100%', background: color, borderRadius: 3, boxShadow: `0 0 4px ${color}` }}
      />
    </div>
  );
}

export default function MachinePanel({
  name, icon, temperature, status, attackRate, detectionRate, riskScore, color, details,
}: MachinePanelProps) {
  const sev = SEVERITY[status];
  const isAttacked = status === 'high' || status === 'critical';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01, y: -2 }}
      style={{
        background: `linear-gradient(135deg, rgba(15,23,42,0.8), rgba(15,23,42,0.4))`,
        border: `1px solid ${sev.border}`,
        borderRadius: 14,
        padding: 18,
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.3s',
      }}
    >
      {isAttacked && (
        <motion.div
          animate={{ opacity: [0.03, 0.08, 0.03] }}
          transition={{ duration: 3, repeat: Infinity }}
          style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #FF1744, transparent)', pointerEvents: 'none' }}
        />
      )}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${sev.color}, transparent)`, opacity: 0.7 }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: `linear-gradient(135deg, ${color}25, ${color}08)`,
            border: `1px solid ${color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
          }}>
            {icon}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0', lineHeight: 1.2 }}>{name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: sev.color, boxShadow: `0 0 8px ${sev.color}`, flexShrink: 0 }} />
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', color: sev.color }}>{sev.label}</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <motion.div
            key={temperature}
            initial={{ scale: 1.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ fontSize: 24, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}
          >
            {temperature.toFixed(1)}°
          </motion.div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginTop: 2, letterSpacing: '0.5px' }}>Température</div>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px',
        padding: '10px 0', marginBottom: 10,
        borderTop: '1px solid rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Risque</div>
          <RiskMeter score={riskScore} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Détection</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MiniBar pct={detectionRate} color="#38BDF8" />
            <span style={{ fontSize: 10, fontWeight: 600, color: '#38BDF8', fontFamily: "'JetBrains Mono', monospace", minWidth: 36, textAlign: 'right' }}>{detectionRate.toFixed(0)}%</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 9, color: '#FF1744', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Attaques</span>
            <span style={{ fontSize: 10, color: '#FF1744', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{attackRate.toFixed(0)}%</span>
          </div>
          <MiniBar pct={attackRate} color="#FF1744" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 9, color: '#00E676', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Normal</span>
            <span style={{ fontSize: 10, color: '#00E676', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{(100 - attackRate).toFixed(0)}%</span>
          </div>
          <MiniBar pct={100 - attackRate} color="#00E676" />
        </div>
      </div>

      {details && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px', marginTop: 10,
          paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.04)',
        }}>
          {details.map((d) => (
            <div key={d.label} style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
              <span style={{ color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{d.label}: </span>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
