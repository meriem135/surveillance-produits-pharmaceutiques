import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SEV_COLORS: Record<string, string> = {
  '10': '#EF4444', '9': '#EF4444', '8': '#F97316', '7': '#F59E0B',
};
const SEV_LABELS: Record<string, string> = {
  '10': 'CRITIQUE', '9': 'CRITIQUE', '8': 'ÉLEVÉE', '7': 'MOYENNE',
};

const API_BASE = '/api';
const BACKEND_AVAILABLE = { current: false };

async function fetchJson(url: string) {
  try {
    const res = await fetch(`${API_BASE}${url}`);
    if (!res.ok) return null;
    BACKEND_AVAILABLE.current = true;
    return await res.json();
  } catch { return null; }
}

const MOCK_RULES = [
  { id: 'DPI-001', name: 'Variation brusque (Δt)', enabled: true, severity: 9, group: 'behavioral' },
  { id: 'DPI-004', name: 'Anomalie saisonnière (3σ adaptatif)', enabled: true, severity: 10, group: 'sensor' },
  { id: 'DPI-005', name: 'Spike température (> 42°C)', enabled: true, severity: 5, group: 'sensor' },
];

export default function Phase1Page() {
  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <FactoryView />
    </div>
  );
}



// ─── Interface pour les alertes DPI temps réel ──────────────────────
interface DpiAlertEvent {
  timestamp: string;
  rule_id: string;
  rule_name: string;
  severity: number;
  description: string;
  device: string;
  attack_type: string;
  attack_explanation: string;
  payload: any;
}

// ─── Vue Usine DPI / Factory ────────────────────────────────────────
function FactoryView() {
  const [dpiStats, setDpiStats] = useState<any>(null);
  const [dpiRules, setDpiRules] = useState<any[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<DpiAlertEvent[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<DpiAlertEvent[]>([]);
  const [cleanCount, setCleanCount] = useState(0);
  const [attackCount, setAttackCount] = useState(0);
  const [packets, setPackets] = useState<{id:number; isAttack:boolean; y:number; device?:string}[]>([]);
  const [currentPoint, setCurrentPoint] = useState<any>(null);
  const [selectedAlert, setSelectedAlert] = useState<DpiAlertEvent | null>(null);
  const [chatAlert, setChatAlert] = useState<DpiAlertEvent | null>(null);
  const [seasonAttackCount, setSeasonAttackCount] = useState(0);
  const [seasonCleanCount, setSeasonCleanCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const packetIdRef = useRef(0);
  const prevSeasonRef = useRef<string | null>(null);

  // Poll REST endpoints
  const fetchData = useCallback(async () => {
    const [stats, rules, alerts] = await Promise.all([
      fetchJson('/dpi/stats'),
      fetchJson('/dpi/rules'),
      fetchJson('/dpi/recent-alerts?limit=20'),
    ]);
    if (stats) setDpiStats(stats);
    if (rules?.rules) setDpiRules(rules.rules);
    if (alerts?.alerts) setRecentAlerts(alerts.alerts);
  }, []);

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 3000); return () => clearInterval(iv); }, [fetchData]);

  // WebSocket connection for real-time streaming
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/stream`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[FactoryView] WebSocket connecté');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'reset') return;

          // Track season change — reset per-season counters
          if (data.season && data.season !== prevSeasonRef.current) {
            prevSeasonRef.current = data.season;
            setSeasonAttackCount(0);
            setSeasonCleanCount(0);
          }

          setCurrentPoint(data);

          // Spawn packet on conveyor belt — only real attacks (label=1)
          const isAttack = data.attack_active === true;
          packetIdRef.current++;
          const newPacket = {
            id: packetIdRef.current,
            isAttack,
            y: 15 + Math.random() * 50,
            device: data.device_type || 'unknown',
          };
          setPackets(prev => [...prev.slice(-50), newPacket]);

          if (isAttack) {
            setAttackCount(c => c + 1);
            setSeasonAttackCount(c => c + 1);
          } else {
            setCleanCount(c => c + 1);
            setSeasonCleanCount(c => c + 1);
          }

          // Create alert card only for real attacks (label=1), not DPI false positives
          if (data.attack_active) {
            const payload = data.dpi_alert?.data?.payload || data;
            const attackInfo = data.attack_info || {};
            const liveAlert: DpiAlertEvent = {
              timestamp: data.timestamp || new Date().toISOString(),
              rule_id: data.dpi_alert?.rule?.id || 'ATTAQUE',
              rule_name: data.dpi_alert?.rule?.name || 'Donnée attaquée',
              severity: data.dpi_alert?.rule?.level || 8,
              description: data.dpi_alert?.rule?.description || 'Point de données marqué comme attaque dans le dataset.',
              device: data.dpi_alert?.data?.device || payload.device_type || data.device_type || '',
              attack_type: attackInfo.type || (data.dpi_alert?.rule?.name || 'Point anormal (dataset)'),
              attack_explanation: attackInfo.explanation || '',
              payload: payload,
            };
            setLiveAlerts(prev => [liveAlert, ...prev].slice(0, 50));
          }

          // Update DPI stats from stream
          if (data.dpi_stats) {
            setDpiStats(data.dpi_stats);
          }
        } catch (e) {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        console.log('[FactoryView] WebSocket déconnecté, reconnexion dans 3s');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, []);

  // Compute stats from REST + WebSocket
  const totalInspect = dpiStats?.total_messages ?? (cleanCount + attackCount);
  const totalAlerts = dpiStats?.total_alerts ?? liveAlerts.length;

  // Merge live + recent alerts, dedup by timestamp+rule_id
  const allAlerts = useMemo(() => {
    const seen = new Set<string>();
    const merged: DpiAlertEvent[] = [];
    for (const a of [...liveAlerts, ...recentAlerts]) {
      const key = a.timestamp + a.rule_id;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(a);
      }
    }
    return merged.slice(0, 30);
  }, [liveAlerts, recentAlerts]);

  // Show only current season's alerts
  const currentSeason = currentPoint?.season || '';
  const seasonAlerts = useMemo(() => {
    return allAlerts.filter(a => (a.payload?.season || '') === currentSeason);
  }, [allAlerts, currentSeason]);

  // MQTT Topics with green/red dots (comme dashboard-pfe-demo)
  const mqttTopics = useMemo(() => {
    const p = currentPoint || {};
    const baseTopics = [
      { topic: 'factory/sensors/temperature', msg: JSON.stringify({val: p.weather_temperature ?? '—', unit:'C'}), rate: '142 msg/min', status: 'clean' as const },
      { topic: 'factory/sensors/pressure', msg: JSON.stringify({val: (p.weather_temperature ?? 20) * 0.7, unit:'PSI'}), rate: '98 msg/min', status: 'clean' as const },
      { topic: 'factory/sensors/humidity', msg: JSON.stringify({val: 45 + Math.random() * 10, unit:'%'}), rate: '85 msg/min', status: 'clean' as const },
      { topic: 'factory/plc/FC1/write', msg: `WR 0x01 0x0A 0xFF`, rate: '23 msg/min', status: 'clean' as const },
      { topic: 'factory/fridge/coldchain', msg: JSON.stringify({val: p.fridge_temperature ?? '—', unit:'C'}), rate: '67 msg/min', status: 'clean' as const },
      { topic: 'factory/thermostat/control', msg: JSON.stringify({val: p.thermostat_temperature ?? '—', unit:'C'}), rate: '12 msg/min', status: 'clean' as const },
    ];
    const attackTopics = [
      { topic: 'factory/unknown/device', msg: '\\x00\\x01\\xFF\\xFE anomaly', rate: '18 msg/min', status: 'attack' as const },
      { topic: 'factory/temp/backdoor', msg: JSON.stringify({cmd:'exec',val:'rm -rf /'}), rate: '3 msg/min', status: 'attack' as const },
      { topic: 'factory/malicious/inject', msg: '\\x90\\x90\\xEB\\xFF', rate: '7 msg/min', status: 'attack' as const },
      { topic: 'factory/sensors/spoofed', msg: JSON.stringify({val: 999.9, unit:'C'}), rate: '15 msg/min', status: 'attack' as const },
    ];
    if (p.attack_active) {
      return [...baseTopics, ...attackTopics];
    }
    return baseTopics;
  }, [currentPoint]);

  return (
    <>
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      {/* Season + Sensors + Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 20 }}>
        <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Saison en cours</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-primary)' }}>{currentPoint?.season || '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>Mois {currentPoint?.month || '—'}</div>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', opacity: 0.6, marginTop: 2 }}>
            Simulation annuelle · 4 saisons en temps réel
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            { label: 'Weather', val: currentPoint?.weather_temperature ?? '—' , unit: '°C', color: '#38BDF8', icon: '🌤️' },
            { label: 'Fridge', val: currentPoint?.fridge_temperature ?? '—' , unit: '°C', color: '#00E676', icon: '🧊' },
            { label: 'Thermostat', val: currentPoint?.thermostat_temperature ?? '—', unit: '°C', color: '#FF9100', icon: '🔥' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 18, marginBottom: 2 }}>{s.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>
                {s.val}{s.val !== '—' ? s.unit : ''}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { val: String(dpiRules.length || 6), lbl: 'Règles DPI', sub: `${dpiRules.filter((r:any) => r.enabled).length} actives`, color: '#22C55E' },
          { val: String(totalAlerts), lbl: 'Alertes DPI', sub: 'Depuis démarrage', color: '#EF4444' },
          { val: String(dpiStats?.messages_per_second ?? '—'), lbl: 'Msg/s', sub: 'Débit entrant', color: 'var(--accent-primary)' },
          { val: dpiStats ? `${(dpiStats.avg_latency_us / 1000).toFixed(1)}ms` : '—', lbl: 'Latence DPI', sub: 'Moyenne', color: '#F59E0B' },
          { val: String(totalInspect), lbl: 'Paquets inspectés', sub: 'Temps réel', color: '#A855F7' },
          { val: liveAlerts.length > 0 ? String(liveAlerts.length) : '—', lbl: 'Attaques en direct', sub: 'Non filtrées', color: '#F97316' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{s.lbl}</div>
            <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', opacity: 0.6 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Factory Pipeline */}
      <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, fontSize: 10, color: 'var(--color-text-secondary)', textAlign: 'center' }}>
          {[
            { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>, lbl: 'Broker MQTT', sub: 'mosquitto:1883' },
            { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>, lbl: 'Moteur DPI', sub: 'Inspection paquets' },
            { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>, lbl: 'Filtre règles', sub: 'MQTT Topics' },
            { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>, lbl: 'Sortie', sub: 'Trafic filtré' },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: 'center', zIndex: 2 }}>
              <div style={{ marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-text-primary)' }}>{s.lbl}</div>
              <div style={{ fontSize: 8, color: 'var(--color-text-secondary)', opacity: 0.6 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Conveyor belt — dots vert/rouge comme le dashboard-pfe-demo */}
        <div style={{ position: 'relative', height: 80, background: 'linear-gradient(180deg, transparent 0%, rgba(42,58,92,0.2) 40%, rgba(42,58,92,0.4) 50%, rgba(42,58,92,0.2) 60%, transparent 100%)', borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 2, background: 'repeating-linear-gradient(90deg, var(--accent-primary) 0, var(--accent-primary) 20px, transparent 20px, transparent 40px)', opacity: 0.5 }} />
          <AnimatePresence>
            {packets.map(pkt => (
              <motion.div
                key={pkt.id}
                initial={{ x: -50 }}
                animate={{ x: 'calc(100vw)' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 4 + Math.random() * 2, ease: 'linear' }}
                style={{
                  position: 'absolute', top: pkt.y,
                  width: 12, height: 12, borderRadius: '50%',
                  background: pkt.isAttack ? '#EF4444' : '#22C55E',
                  boxShadow: pkt.isAttack
                    ? '0 0 12px rgba(239,68,68,0.8), 0 0 24px rgba(239,68,68,0.3)'
                    : '0 0 8px rgba(34,197,94,0.5)',
                  zIndex: 2,
                }} />
            ))}
          </AnimatePresence>
          {/* DPI Scanner */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 70, height: 70, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,245,255,0.15) 0%, transparent 70%)',
            border: '2px solid var(--accent-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, zIndex: 3,
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
        </div>

        {/* Badge counters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { dot: '#22C55E', lbl: `${seasonCleanCount} sains (${currentSeason})` },
            { dot: '#EF4444', lbl: `${seasonAttackCount} malveillants (${currentSeason})` },
            { dot: 'var(--accent-primary)', lbl: `${seasonCleanCount + seasonAttackCount} inspectés` },
          ].map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, fontSize: 10, background: 'rgba(0,245,255,0.06)', border: '1px solid rgba(0,245,255,0.15)', color: 'var(--accent-primary)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: b.dot, display: 'inline-block' }} />
              {b.lbl}
            </span>
          ))}
        </div>
      </div>

      {/* Trafic Topics MQTT — puces vert/rouge comme dashboard-pfe-demo */}
      <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 18, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Trafic Topics MQTT
          <span style={{ fontSize: 10, padding: '2px 10px', borderRadius: 20, background: 'var(--accent-glow)', color: 'var(--accent-primary)' }}>{mqttTopics.length} sujets</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
          {mqttTopics.map((t, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 8,
              background: t.status === 'attack' ? 'rgba(239,68,68,0.06)' : 'var(--color-bg-surface, rgba(0,0,0,0.1))',
              border: `1px solid ${t.status === 'attack' ? 'rgba(239,68,68,0.15)' : 'var(--border)'}`,
              transition: '0.2s',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: t.status === 'attack' ? '#EF4444' : '#22C55E',
                boxShadow: t.status === 'attack' ? '0 0 8px rgba(239,68,68,0.6)' : 'none',
              }} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--color-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.topic}
              </span>
              <span style={{ fontSize: 9, color: 'var(--color-text-muted)', padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.15)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.msg}
              </span>
              <span style={{ fontSize: 8, color: 'var(--color-text-muted)', minWidth: 40, textAlign: 'right' }}>
                {t.rate}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* DPI Rules (full width) */}
      <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 18, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          📖 Moteur de règles DPI
          <span style={{ fontSize: 10, padding: '2px 10px', borderRadius: 20, background: 'var(--accent-glow)', color: 'var(--accent-primary)' }}>Snort-compatible</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Règle', 'Description', 'Sévérité', 'Groupe', 'Statut'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--border)', fontSize: 9, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(dpiRules.length > 0 ? dpiRules : MOCK_RULES).map((r: any) => (
                <tr key={r.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid rgba(42,58,92,0.2)', fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>{r.id}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid rgba(42,58,92,0.2)', fontSize: 10 }}>{r.name || r.desc}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid rgba(42,58,92,0.2)' }}>
                    <span style={{ padding: '1px 7px', borderRadius: 10, fontSize: 9, fontWeight: 600, background: `${SEV_COLORS[String(r.severity)] || '#94A3B8'}18`, color: SEV_COLORS[String(r.severity)] || '#94A3B8' }}>{r.severity}</span>
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid rgba(42,58,92,0.2)', fontSize: 10, color: 'var(--color-text-secondary)' }}>{r.group || '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid rgba(42,58,92,0.2)' }}>
                    <span style={{ padding: '1px 7px', borderRadius: 10, fontSize: 9, fontWeight: 600, background: r.enabled !== false ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)', color: r.enabled !== false ? '#22C55E' : '#6B7280' }}>{r.enabled !== false ? 'ACTIF' : 'INACTIF'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alertes DPI — scroll horizontal */}
      <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          {/* Season header bar */}
          {(() => {
            const seasonColors: Record<string, {bg:string, accent:string, label:string}> = {
              'Hiver':     {bg: 'linear-gradient(135deg, #1E3A5F, #0F1F3A)', accent: '#60A5FA', label: '❄️ Hiver'},
              'Printemps': {bg: 'linear-gradient(135deg, #1A3A1A, #0F2A0F)', accent: '#4ADE80', label: '🌱 Printemps'},
              'Été':       {bg: 'linear-gradient(135deg, #3A1A0A, #2A1005)', accent: '#FB923C', label: '☀️ Été'},
              'Automne':   {bg: 'linear-gradient(135deg, #3A2A0A, #2A1F05)', accent: '#FBBF24', label: '🍂 Automne'},
            };
            const sc = seasonColors[currentSeason] || seasonColors['Hiver'];
            return (
              <div style={{ background: sc.bg, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 24, lineHeight: 1 }}>
                    {currentSeason === 'Hiver' ? '❄️' : currentSeason === 'Printemps' ? '🌱' : currentSeason === 'Été' ? '☀️' : '🍂'}
                  </span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                      Alertes DPI — {currentSeason || 'En attente'}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {seasonAlerts.length} alerte{seasonAlerts.length > 1 ? 's' : ''} · saison courante : {currentSeason || '—'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: 'rgba(255,255,255,0.4)', background: 'rgba(0,0,0,0.25)', padding: '3px 8px', borderRadius: 6 }}>
                    <span>💀9-10</span>
                    <span style={{ opacity: 0.3 }}>|</span>
                    <span>⚠️5</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Severity explanation */}
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', padding: '8px 14px', background: 'rgba(0,0,0,0.08)', borderBottom: '1px solid var(--border)', lineHeight: 1.6 }}>
            💡 <strong>Calcul :</strong> DPI-004 (3σ saisonnier) = 10 💀 · DPI-001 (Δt weather 14°C / frigo 5°C / thermostat 16°C) = 9 💀 · DPI-005 (spike &gt;42°C) = 5 ⚠️
          </div>

          {/* Alerts list — only current season */}
          {seasonAlerts.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'center', padding: 40, opacity: 0.4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%' }}>
              <span style={{ fontSize: 32, opacity: 0.3 }}>
                {currentSeason === 'Hiver' ? '❄️' : currentSeason === 'Printemps' ? '🌱' : currentSeason === 'Été' ? '☀️' : '🍂'}
              </span>
              <span>{currentPoint?.attack_active ? '🚨 Cycle attaque en cours...' : 'Aucune alerte pour cette saison.'}<br />Le moteur DPI analyse le flux en temps réel.</span>
            </div>
          ) : (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', overflowY: 'hidden', padding: '8px 14px 14px', scrollSnapType: 'x mandatory' }}>
                  {seasonAlerts.map((a, i) => {
                const sevColor = SEV_COLORS[String(a.severity)] || (a.severity >= 9 ? '#EF4444' : a.severity >= 7 ? '#F97316' : '#F59E0B');
                const sevIcon = a.severity >= 9 ? '💀' : a.severity >= 7 ? '🔥' : '⚠️';
                const sevLabel = a.severity >= 9 ? 'CRITIQUE' : a.severity >= 7 ? 'ÉLEVÉE' : 'MOYENNE';
                const deviceLabel = a.device || a.payload?.device_type || 'multi-sensor';
                const attackType = a.payload?.attack_info?.type || a.attack_type || a.rule_name;
                const attackExplanation = a.payload?.attack_info?.explanation || a.attack_explanation;
                return (
                  <motion.div key={a.timestamp + a.rule_id + i}
                    initial={{ opacity: 0, x: 20, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                    onClick={() => setSelectedAlert(a)}
                    style={{ cursor: 'pointer',
                      minWidth: 340, maxWidth: 380, scrollSnapAlign: 'start',
                      padding: 0, borderRadius: 12, overflow: 'hidden',
                      background: `linear-gradient(135deg, ${sevColor}12, transparent)`,
                      border: `1px solid ${sevColor}25`,
                      boxShadow: `0 0 20px ${sevColor}08`,
                    }}>
                    <div style={{ height: 3, background: `linear-gradient(90deg, ${sevColor}, ${sevColor}88, transparent)` }} />
                    <div style={{ padding: '10px 14px 12px', display: 'flex', gap: 12 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `linear-gradient(135deg, ${sevColor}30, ${sevColor}10)`,
                        border: `1px solid ${sevColor}30`,
                        fontSize: 20,
                      }}>
                        {sevIcon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                              {attackType}
                            </span>
                            {attackExplanation && (
                              <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'rgba(239,68,68,0.25)', color: '#EF4444', letterSpacing: '0.5px' }}>
                                ATTAQUE
                              </span>
                            )}
                            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 8px', borderRadius: 4, background: `${sevColor}18`, color: sevColor, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.3px' }}>
                              {a.rule_id}
                            </span>
                            <span style={{ fontSize: 9, padding: '1px 8px', borderRadius: 4, background: '#1E293B', color: '#94A3B8', fontFamily: "'JetBrains Mono', monospace" }}>
                              {deviceLabel}
                            </span>
                          </div>
                          <span style={{
                            padding: '2px 10px', borderRadius: 8, fontSize: 9, fontWeight: 700,
                            background: `linear-gradient(135deg, ${sevColor}25, ${sevColor}10)`,
                            color: sevColor, whiteSpace: 'nowrap', border: `1px solid ${sevColor}20`,
                          }}>
                            {sevLabel}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-primary)', lineHeight: 1.5, marginBottom: 4 }}>
                          {a.description?.split('|')[0]?.trim() || a.description}
                        </div>
                        {attackExplanation && (
                          <div style={{
                            fontSize: 10, color: '#FCA5A5', lineHeight: 1.6,
                            padding: '8px 10px', borderRadius: 8,
                            background: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))',
                            border: '1px solid rgba(239,68,68,0.15)',
                            marginBottom: 4,
                          }}>
                            <span style={{ fontWeight: 700 }}>🧠 Attaque :</span> {attackExplanation}
                          </div>
                        )}
                        <div style={{ fontSize: 9, color: 'var(--color-text-muted)', fontFamily: "'JetBrains Mono', monospace", textAlign: 'right', opacity: 0.6 }}>
                          {new Date(a.timestamp).toLocaleDateString('fr-FR')} {new Date(a.timestamp).toLocaleTimeString('fr-FR')} — cliquer pour détails
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
        </div>
    </motion.div>

    {/*********** Alert Detail Modal ***********/}
    <AnimatePresence>
      {selectedAlert && <AlertDetailModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} onAskAi={setChatAlert} />}
    </AnimatePresence>

    {/*********** AI Chat Modal (isolé) ***********/}
    <AnimatePresence>
      {chatAlert && <AIChatModal alert={chatAlert} onClose={() => setChatAlert(null)} />}
    </AnimatePresence>
    </>
  );
}

function renderMd(md: string): string {
  return md
    .replace(/^### (.*$)/gm, '<strong style="color:#A855F7;font-size:13px;display:block;margin-top:8px">$1</strong>')
    .replace(/^## (.*$)/gm, '<strong style="color:#F59E0B;font-size:14px;display:block;margin-top:10px">$1</strong>')
    .replace(/^# (.*$)/gm, '<strong style="color:#EF4444;font-size:15px;display:block;margin-top:12px">$1</strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#E2E8F0">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;font-size:11px">$1</code>')
    .replace(/- (.*$)/gm, '<span style="display:block;margin-left:12px;color:#94A3B8">• $1</span>')
    .replace(/\n/g, '<br>');
}

// ─── Modal détails alerte avec rapport IA intégré ──────────────────
function AlertDetailModal({ alert, onClose, onAskAi }: { alert: DpiAlertEvent; onClose: () => void; onAskAi: (a: DpiAlertEvent) => void }) {
  const sevColor = SEV_COLORS[String(alert.severity)] || (alert.severity >= 9 ? '#EF4444' : '#F59E0B');
  const sevIcon = alert.severity >= 9 ? '💀' : alert.severity >= 7 ? '🔥' : '⚠️';
  const sevLabel = SEV_LABELS[String(alert.severity)] || 'MOYENNE';
  const p = alert.payload || {};
  const attackType = p.attack_info?.type || alert.attack_type || alert.rule_name;
  const attackExplanation = p.attack_info?.explanation || alert.attack_explanation;
  const hasCorrelation = alert.description?.includes('Corrélation');
  const deviceId = alert.device || p.device_type || 'multi-sensor';
  const sensorType = deviceId.includes('fridge') ? 'fridge' : deviceId.includes('weather') ? 'weather' : 'thermostat';

  const [aiReport, setAiReport] = useState<string | null>(null);
  const [reportEngine, setReportEngine] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  const riskScore = Math.round(100 - (p.normality_score ?? 50));
  const severity = riskScore >= 80 ? 'CRITICAL' : riskScore >= 60 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : 'LOW';

  const reportPayload = {
    device_id: deviceId,
    rule_id: alert.rule_id,
    rule_name: alert.rule_name,
    rule_description: alert.description || attackType,
    attack_type: attackType,
    risk_score: riskScore,
    severity,
    sensor: sensorType,
    weather_temperature: p.weather_temperature,
    fridge_temperature: p.fridge_temperature,
    thermostat_temperature: p.thermostat_temperature,
    season: p.season,
    month: p.month,
    label: p.label,
    is_anomaly: p.is_anomaly,
    normality_score: p.normality_score,
    force_template: true,
  };

  useEffect(() => {
    let cancelled = false;
    setReportLoading(true);
    setReportError('');
    fetch('/api/v1/analyst/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportPayload),
    })
      .then(r => { if (!r.ok) throw new Error(`Erreur ${r.status}`); return r.json(); })
      .then(data => { if (!cancelled) { setAiReport(data.report || '(rapport vide)'); setReportEngine(data.engine || 'template'); } })
      .catch(err => { if (!cancelled) setReportError(err.message); })
      .finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [alert.timestamp + alert.rule_id]);

  async function downloadPdf() {
    setPdfLoading(true);
    setPdfError('');
    try {
      const resp = await fetch('/api/v1/analyst/report-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportPayload),
      });
      if (!resp.ok) throw new Error(`Erreur ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport_${alert.rule_id}_${deviceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        padding: 20,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'linear-gradient(145deg, #0B1628, #111D35)',
          border: `1px solid ${sevColor}30`,
          borderRadius: 20, maxWidth: 680, width: '100%', maxHeight: '90vh',
          boxShadow: `0 25px 60px rgba(0,0,0,0.6), 0 0 40px ${sevColor}15`,
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Top accent bar */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${sevColor}, ${sevColor}66, transparent)` }} />

        {/* Scrollable body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `linear-gradient(135deg, ${sevColor}30, ${sevColor}08)`,
                border: `1px solid ${sevColor}35`,
                fontSize: 24,
              }}>
                {sevIcon}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{attackType}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 6, background: `${sevColor}20`, color: sevColor, fontFamily: "'JetBrains Mono', monospace" }}>{alert.rule_id}</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {new Date(alert.timestamp).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} à {new Date(alert.timestamp).toLocaleTimeString('fr-FR')}
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.04)', color: '#94A3B8', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>✕</button>
          </div>

          {/* Description */}
          <div style={{
            fontSize: 12, color: '#CBD5E1', lineHeight: 1.7, marginBottom: 16,
            padding: '12px 14px', borderRadius: 10,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.04)',
          }}>
            {alert.description}
          </div>

          {/* Attack explanation */}
          {attackExplanation && (
            <div style={{
              fontSize: 12, color: '#E2E8F0', lineHeight: 1.7, marginBottom: 16,
              padding: '12px 14px', borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.03))',
              border: `1px solid rgba(239,68,68,0.15)`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#EF4444', textTransform: 'uppercase', marginBottom: 4 }}>🧠 Scénario d'attaque injecté</div>
              {attackExplanation}
            </div>
          )}

          {/* Key-Value details grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              ['Appareil', alert.device || p.device_type || '—'],
              ['Sévérité', `${sevIcon} ${sevLabel} (${alert.severity}/10)`],
              ['Saison', p.season || '—'],
              ['Attack actif', p.attack_active ? '✅ Oui' : '❌ Non'],
              ['Label', String(p.label ?? '—')],
              ['Anomalie', p.is_anomaly ? '⚠️ Oui' : '✅ Non'],
              ['Score normalité', p.normality_score != null ? `${Math.round(p.normality_score)}%` : '—'],
              ['Corrélation', hasCorrelation ? '🔗 Oui' : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{
                padding: '8px 10px', borderRadius: 8,
                background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)',
              }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 12, color: '#E2E8F0', fontFamily: "'JetBrains Mono', monospace" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Sensor readings */}
          <div style={{
            padding: '12px 14px', borderRadius: 10,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.04)',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>📡 Valeurs capteurs</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                ['🌤️ Météo', p.weather_temperature != null ? `${p.weather_temperature.toFixed(1)}°C` : '—'],
                ['🧊 Frigo', p.fridge_temperature != null ? `${p.fridge_temperature.toFixed(1)}°C` : '—'],
                ['🌡️ Thermostat', p.thermostat_temperature != null ? `${p.thermostat_temperature.toFixed(1)}°C` : '—'],
              ].map(([label, val]) => (
                <div key={label} style={{
                  padding: '8px 10px', borderRadius: 8, textAlign: 'center',
                  background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <div style={{ fontSize: 10, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#F1F5F9' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Analysis Report */}
          <div style={{
            padding: '14px 16px', borderRadius: 10,
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(168,85,247,0.15)',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#A855F7', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>🤖</span> Rapport d'analyse IA
              {reportEngine && (
                <span style={{
                  fontSize: 9, padding: '1px 8px', borderRadius: 4,
                  background: reportEngine === 'ollama' ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)',
                  color: reportEngine === 'ollama' ? '#22C55E' : '#FBBF24',
                  fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                }}>
                  {reportEngine === 'ollama' ? '🧠 Ollama' : '⚙️ Template'}
                </span>
              )}
              {reportLoading && <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 400 }}>⏳ Génération en cours...</span>}
            </div>
            {reportLoading && (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
                Analyse de l'alerte en cours...
              </div>
            )}
            {reportError && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5', fontSize: 11 }}>
                ❌ {reportError}
              </div>
            )}
            {aiReport && !reportLoading && (
              <div style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 1.8 }}
                dangerouslySetInnerHTML={{ __html: renderMd(aiReport) }}
              />
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            {!pdfLoading && !pdfError && (
              <button onClick={downloadPdf} style={{
                flex: 1, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                background: 'linear-gradient(135deg, rgba(0,245,255,0.12), rgba(0,245,255,0.04))',
                border: '1px solid rgba(0,245,255,0.2)', color: 'var(--accent-primary)',
                fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <span>📄</span> Télécharger le PDF
              </button>
            )}
            {pdfLoading && (
              <div style={{ flex: 1, textAlign: 'center', padding: 10, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                ⏳ Génération du PDF...
              </div>
            )}
            {pdfError && (
              <div style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5', fontSize: 11 }}>
                ❌ {pdfError}
              </div>
            )}
            <button onClick={() => onAskAi(alert)} style={{
              flex: 1, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
              background: 'linear-gradient(135deg, rgba(168,85,247,0.12), rgba(168,85,247,0.04))',
              border: '1px solid rgba(168,85,247,0.2)', color: '#A855F7',
              fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <span>🤖</span> Poser une question à l'IA
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Modal IA Chat (isolé, style ChatGPT) ──────────────────────────
function AIChatModal({ alert, onClose }: { alert: DpiAlertEvent; onClose: () => void }) {
  const p = alert.payload || {};
  const attackType = p.attack_info?.type || alert.attack_type || alert.rule_name;
  const deviceId = alert.device || p.device_type || 'multi-sensor';
  const sensorType = deviceId.includes('fridge') ? 'fridge' : deviceId.includes('weather') ? 'weather' : 'thermostat';

  const [messages, setMessages] = useState<{role:string; content:string}[]>([
    { role: 'ai', content: `Bonjour ! Je suis l'assistant IA Peaksoft. L'alerte en cours est de type **${attackType}** sur le capteur **${sensorType}** (règle ${alert.rule_id}). Posez-moi vos questions sur cette attaque : causes, impacts, recommandations, standards de sécurité, etc.` },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const q = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setLoading(true);
    try {
      const resp = await fetch('/api/v1/analyst/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          device_type: sensorType,
        }),
      });
      if (!resp.ok) throw new Error(`Erreur ${resp.status}`);
      const data = await resp.json();
      setMessages(prev => [...prev, { role: 'ai', content: data.report || '(réponse vide)' }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', content: `❌ Erreur : ${err instanceof Error ? err.message : 'connexion'}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        padding: 20,
      }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, height: 520,
          background: '#1E293B', borderRadius: 16,
          border: '1px solid rgba(168,85,247,0.2)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', background: 'rgba(168,85,247,0.08)',
          borderBottom: '1px solid rgba(168,85,247,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#E2E8F0' }}>Assistant IA Peaksoft</span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer',
            fontSize: 18, lineHeight: 1, padding: '4px 8px', borderRadius: 6,
          }}>✕</button>
        </div>

        {/* Messages */}
        <div ref={listRef} style={{
          flex: 1, overflowY: 'auto', padding: '14px 18px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '85%', padding: '10px 14px', borderRadius: 12, fontSize: 12, lineHeight: 1.7,
                background: msg.role === 'user' ? 'rgba(168,85,247,0.15)' : 'rgba(30,41,59,0.8)',
                border: msg.role === 'user' ? '1px solid rgba(168,85,247,0.2)' : '1px solid rgba(255,255,255,0.06)',
                color: msg.role === 'user' ? '#D8B4FE' : '#CBD5E1',
              }}>
                {msg.role === 'user' ? (
                  msg.content
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }} />
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                padding: '10px 14px', borderRadius: 12, fontSize: 12,
                background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.06)',
                color: '#94A3B8', fontStyle: 'italic',
              }}>
                ⏳ Réflexion en cours...
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{
          display: 'flex', gap: 8, padding: '12px 18px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.15)',
        }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder="Posez votre question..."
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 8, fontSize: 12,
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(168,85,247,0.2)',
              color: '#E2E8F0', outline: 'none',
            }}
          />
          <button onClick={send} disabled={loading || !input.trim()} style={{
            padding: '10px 18px', borderRadius: 8, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            background: loading ? 'rgba(168,85,247,0.2)' : 'rgba(168,85,247,0.3)',
            border: '1px solid rgba(168,85,247,0.3)', color: loading ? '#94A3B8' : '#D8B4FE',
            fontSize: 12, fontWeight: 600,
          }}>
            {loading ? '...' : 'Envoyer'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}


