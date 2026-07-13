import { motion } from 'framer-motion';

export interface DpiAlert {
  rule: {
    id: string;
    name: string;
    level: number;
    description: string;
    groups: string[];
    correlation?: {
      matched_rules: string[];
      count: number;
      boost: number;
    };
  };
  data: {
    device: string;
    payload: Record<string, any>;
  };
  timestamp: string;
}

interface Props {
  alerts: DpiAlert[];
  onSelect?: (alert: DpiAlert) => void;
}

const LEVEL_META: Record<number, { label: string; color: string }> = {
  12: { label: 'CRITIQUE', color: '#FF1744' },
  9: { label: 'ÉLEVÉ', color: '#FF9100' },
  7: { label: 'MOYEN', color: '#FFD600' },
  6: { label: 'MOYEN', color: '#FFD600' },
  5: { label: 'FAIBLE', color: '#38BDF8' },
  3: { label: 'INFO', color: '#00E676' },
};

const ID_COLORS: Record<string, string> = {
  'DPI-001': '#FF1744', 'DPI-002': '#FFD600', 'DPI-003': '#38BDF8',
  'DPI-004': '#FF9100', 'DPI-005': '#818CF8', 'DPI-006': '#A3BE8C',
};

function AlertIcon({ level }: { level: number }) {
  const icon = level >= 9 ? '\u{26a0}\u{fe0f}' : level >= 6 ? '\u{26a1}' : '\u{2139}\u{fe0f}';
  return <span style={{ fontSize: 12 }}>{icon}</span>;
}

function RuleBadge({ id }: { id: string }) {
  const c = ID_COLORS[id] || '#818CF8';
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, padding: '1px 7px', borderRadius: 3,
      background: `${c}18`, color: c, fontFamily: "'JetBrains Mono', monospace",
    }}>
      {id}
    </span>
  );
}

function PayloadChip({ k, v }: { k: string; v: any }) {
  const display = typeof v === 'number' ? v.toFixed(1) : String(v).slice(0, 10);
  return (
    <span style={{
      fontSize: 7, padding: '1px 4px', borderRadius: 2,
      background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.35)',
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {k}={display}
    </span>
  );
}

export default function DpiAlertPanel({ alerts, onSelect }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {alerts.length === 0 && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: 16 }}>
          Aucune alerte DPI
        </div>
      )}
      {alerts.map((alert) => {
        const meta = LEVEL_META[alert.rule.level] || { label: 'INFO', color: '#94A3B8' };
        const { correlation } = alert.rule;
        return (
          <motion.div key={alert.timestamp + alert.rule.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onSelect?.(alert)}
            style={{
              padding: '5px 8px', borderRadius: 5,
              borderLeft: `2px solid ${meta.color}`,
              background: `${meta.color}06`,
              cursor: onSelect ? 'pointer' : 'default',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
              <AlertIcon level={alert.rule.level} />
              <RuleBadge id={alert.rule.id} />
              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace" }}>
                {new Date(alert.timestamp).toLocaleTimeString('fr-FR')}
              </span>
            </div>
            <div style={{ fontSize: 9, color: '#E2E8F0', lineHeight: 1.2 }}>
              {alert.rule.name}
            </div>
            {correlation && correlation.count > 1 && (
              <div style={{ fontSize: 7, color: '#FFD600', marginBottom: 1 }}>
                {correlation.count} règles [{correlation.matched_rules.join(', ')}] +{correlation.boost}
              </div>
            )}
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 1 }}>
              {Object.entries(alert.data.payload).slice(0, 3).map(([k, v]) => (
                <PayloadChip key={k} k={k} v={v} />
              ))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
