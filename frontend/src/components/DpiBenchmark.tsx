import { motion } from 'framer-motion';

interface DpiStats {
  total_messages: number;
  total_alerts: number;
  messages_per_second: number;
  alerts_per_minute: number;
  avg_latency_us: number;
  rule_match_counts: Record<string, number>;
  uptime_seconds: number;
}

interface Props {
  stats: DpiStats | null;
}

export default function DpiBenchmark({ stats }: Props) {
  if (!stats) {
    return (
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: 12 }}>
        En attente des métriques DPI...
      </div>
    );
  }

  const metrics = [
    { label: 'Msg/s', value: stats.messages_per_second.toFixed(1), unit: '', color: '#38BDF8' },
    { label: 'Latence', value: stats.avg_latency_us.toFixed(0), unit: 'µs', color: '#00E676' },
    { label: 'Alertes/min', value: stats.alerts_per_minute.toFixed(1), unit: '', color: '#FF1744' },
    { label: 'Total msg', value: (stats.total_messages / 1000).toFixed(0), unit: 'k', color: '#818CF8' },
    { label: 'Total alertes', value: stats.total_alerts.toString(), unit: '', color: '#FF9100' },
    { label: 'Uptime', value: Math.floor(stats.uptime_seconds / 60).toString(), unit: 'min', color: '#A3BE8C' },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {metrics.map((m) => (
          <motion.div
            key={m.label}
            whileHover={{ scale: 1.05 }}
            style={{
              padding: '6px 8px', borderRadius: 6, textAlign: 'center',
              background: `${m.color}08`, border: `1px solid ${m.color}15`,
            }}
          >
            <div style={{
              fontSize: 16, fontWeight: 700, color: m.color,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {m.value}<span style={{ fontSize: 9, opacity: 0.6 }}>{m.unit}</span>
            </div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{m.label}</div>
          </motion.div>
        ))}
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>
          Règles déclenchées
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(stats.rule_match_counts).map(([ruleId, count]) => (
            <span key={ruleId} style={{
              fontSize: 8, padding: '2px 8px', borderRadius: 4,
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)',
              fontFamily: "'JetBrains Mono', monospace", border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {ruleId}: {count}
            </span>
          ))}
          {Object.keys(stats.rule_match_counts).length === 0 && (
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)' }}>Aucune règle déclenchée</span>
          )}
        </div>
      </div>
    </div>
  );
}
