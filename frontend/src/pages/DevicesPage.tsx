import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, AlertTriangle, Shield, Wifi, HardDrive } from 'lucide-react';
import type { Device } from '../types';

const MOCK_DEVICES: Device[] = [
  { id: 'dev-001', name: 'PLC Principal', ip_address: '192.168.1.10', protocol: 'Modbus TCP', risk_score: 12, status: 'online', device_type: 'PLC' },
  { id: 'dev-002', name: 'Capteur Température', ip_address: '192.168.1.20', protocol: 'MQTT', risk_score: 45, status: 'online', device_type: 'Capteur' },
  { id: 'dev-003', name: 'Vanne Motorisée A', ip_address: '192.168.1.30', protocol: 'Modbus TCP', risk_score: 78, status: 'warning', device_type: 'Actionneur' },
  { id: 'dev-004', name: 'Routeur Industriel', ip_address: '192.168.1.1', protocol: 'SNMP', risk_score: 92, status: 'critical', device_type: 'Réseau' },
  { id: 'dev-005', name: 'IHM Supervision', ip_address: '192.168.1.100', protocol: 'HTTP', risk_score: 8, status: 'online', device_type: 'IHM' },
  { id: 'dev-006', name: 'Capteur Pression', ip_address: '192.168.1.21', protocol: 'MQTT', risk_score: 30, status: 'offline', device_type: 'Capteur' },
  { id: 'dev-007', name: 'Moteur Convoyeur', ip_address: '192.168.1.40', protocol: 'Modbus TCP', risk_score: 55, status: 'online', device_type: 'Moteur' },
  { id: 'dev-008', name: 'Passerelle IoT', ip_address: '192.168.1.200', protocol: 'MQTT', risk_score: 65, status: 'warning', device_type: 'Passerelle' },
];

const STATUS_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  online: { color: 'var(--accent-success)', bg: 'rgba(34,197,94,0.1)', label: 'En ligne' },
  warning: { color: 'var(--accent-warning)', bg: 'rgba(249,115,22,0.1)', label: 'Attention' },
  critical: { color: 'var(--accent-danger)', bg: 'rgba(239,68,68,0.1)', label: 'Critique' },
  offline: { color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.05)', label: 'Hors ligne' },
};

function getRiskColor(score: number) {
  if (score >= 70) return 'var(--accent-danger)';
  if (score >= 40) return 'var(--accent-warning)';
  return 'var(--accent-success)';
}

const cardVariant = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.3 } }),
};

export default function DevicesPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    let d = MOCK_DEVICES;
    if (filter !== 'all') d = d.filter((dev) => dev.status === filter);
    if (search.trim()) d = d.filter((dev) => dev.name.toLowerCase().includes(search.toLowerCase()) || dev.ip_address.includes(search));
    return d;
  }, [search, filter]);

  const stats = useMemo(() => ({
    total: MOCK_DEVICES.length,
    online: MOCK_DEVICES.filter((d) => d.status === 'online').length,
    critical: MOCK_DEVICES.filter((d) => d.status === 'critical').length,
    avgRisk: Math.round(MOCK_DEVICES.reduce((a, d) => a + d.risk_score, 0) / MOCK_DEVICES.length),
  }), []);

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Appareils', value: stats.total, icon: <HardDrive className="w-4 h-4" />, color: 'var(--accent-primary)' },
          { label: 'En Ligne', value: stats.online, icon: <Wifi className="w-4 h-4" />, color: 'var(--accent-success)' },
          { label: 'Critiques', value: stats.critical, icon: <AlertTriangle className="w-4 h-4" />, color: 'var(--accent-danger)' },
          { label: 'Risk Score Moyen', value: `${stats.avgRisk}%`, icon: <Shield className="w-4 h-4" />, color: getRiskColor(stats.avgRisk) },
        ].map((s, i) => (
          <motion.div key={s.label} custom={i} variants={cardVariant} initial="hidden" animate="visible"
            className="bg-bg-panel border border-border-panel rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 text-text-secondary text-xs font-bold uppercase tracking-wider mb-2">
              {s.icon}{s.label}
            </div>
            <div className="font-display text-3xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          <input type="text" placeholder="Rechercher par nom ou IP..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-bg-card border border-border-panel text-text-primary pl-9 pr-4 py-2.5 rounded-xl text-xs outline-none w-72 transition-all focus:border-[var(--accent-primary)] focus:shadow-[0_0_10px_var(--accent-glow)]" />
        </div>
        {['all', 'online', 'warning', 'critical', 'offline'].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200"
            style={{
              background: filter === s ? 'var(--accent-glow)' : 'var(--bg-card)',
              color: filter === s ? 'var(--accent-primary)' : 'var(--text-secondary)',
              border: filter === s ? '1px solid var(--accent-primary)' : '1px solid var(--border)',
            }}
          >
            {s === 'all' ? 'Tous' : STATUS_STYLES[s]?.label || s}
          </button>
        ))}
      </div>

      {/* Device Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((device, i) => {
          const st = STATUS_STYLES[device.status] || STATUS_STYLES.offline;
          return (
            <motion.div key={device.id} custom={i} variants={cardVariant} initial="hidden" animate="visible"
              className="bg-bg-panel border border-border-panel rounded-2xl p-5 hover:brightness-110 transition-all duration-300 cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-display font-bold text-sm">{device.name}</div>
                  <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>{device.ip_address}</div>
                </div>
                <span className="px-2.5 py-1 rounded-md text-[10px] font-bold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{device.protocol}</span>
                <div className="flex items-center gap-2">
                  <span style={{ color: 'var(--text-secondary)' }}>Risk:</span>
                  <span className="font-bold font-mono" style={{ color: getRiskColor(device.risk_score) }}>{device.risk_score}%</span>
                </div>
              </div>
              <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                <motion.div
                  initial={{ width: 0 }} animate={{ width: `${device.risk_score}%` }}
                  transition={{ duration: 1, delay: i * 0.05 }}
                  className="h-full rounded-full"
                  style={{ background: getRiskColor(device.risk_score) }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
