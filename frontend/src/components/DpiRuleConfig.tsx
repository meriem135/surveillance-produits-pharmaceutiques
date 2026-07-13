import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface DpiRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: number;
  group: string;
}

interface Props {
  onReload?: () => void;
}

export default function DpiRuleConfig({ onReload }: Props) {
  const [rules, setRules] = useState<DpiRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = async () => {
    try {
      const r = await fetch('/api/dpi/rules');
      const d = await r.json();
      if (d.rules) setRules(d.rules);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchRules(); }, []);

  const toggleRule = async (ruleId: string, current: boolean) => {
    try {
      await fetch(`/api/dpi/rules/${ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !current }),
      });
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !current } : r));
      if (onReload) onReload();
    } catch {}
  };

  if (loading) {
    return <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: 12 }}>Chargement...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rules.map((rule) => (
        <motion.div
          key={rule.id}
          whileHover={{ x: 2 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 6,
            background: rule.enabled ? 'rgba(56,189,248,0.04)' : 'rgba(255,255,255,0.01)',
            border: `1px solid ${rule.enabled ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.04)'}`,
            opacity: rule.enabled ? 1 : 0.4,
            transition: 'all 0.2s',
          }}
        >
          <button
            onClick={() => toggleRule(rule.id, rule.enabled)}
            style={{
              width: 28, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', position: 'relative',
              background: rule.enabled ? '#00E676' : 'rgba(255,255,255,0.1)',
              transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <motion.div
              animate={{ x: rule.enabled ? 13 : 2 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              style={{
                width: 12, height: 12, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 2,
              }}
            />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(99,102,241,0.15)', color: '#818CF8',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {rule.id}
              </span>
              <span style={{ fontSize: 9, color: '#E2E8F0', fontWeight: 600 }}>{rule.name}</span>
              <span style={{
                fontSize: 7, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: rule.severity >= 9 ? 'rgba(255,23,68,0.15)' : rule.severity >= 6 ? 'rgba(255,145,0,0.15)' : 'rgba(56,189,248,0.15)',
                color: rule.severity >= 9 ? '#FF1744' : rule.severity >= 6 ? '#FF9100' : '#38BDF8',
                marginLeft: 'auto',
              }}>
                NIV {rule.severity}
              </span>
            </div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginTop: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {rule.description}
            </div>
          </div>
        </motion.div>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button onClick={fetchRules} style={{
          fontSize: 8, padding: '4px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)',
          background: 'transparent', color: 'rgba(255,255,255,0.3)', cursor: 'pointer',
        }}>
          Actualiser
        </button>
        <button onClick={async () => {
          await fetch('/api/dpi/rules/reload', { method: 'POST' });
          fetchRules();
          if (onReload) onReload();
        }} style={{
          fontSize: 8, padding: '4px 10px', borderRadius: 4, border: '1px solid rgba(56,189,248,0.2)',
          background: 'rgba(56,189,248,0.05)', color: '#38BDF8', cursor: 'pointer',
        }}>
          Recharger YAML
        </button>
      </div>
    </div>
  );
}
