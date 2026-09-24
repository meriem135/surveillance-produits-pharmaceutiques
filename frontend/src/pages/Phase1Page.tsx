import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const API_BASE = '/api';

async function fetchJson(url: string) {
  try {
    const res = await fetch(`${API_BASE}${url}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const SEV_COLORS: Record<string, string> = {
  '10': '#EF4444', '9': '#EF4444', '8': '#F97316', '7': '#F59E0B',
};
const SEV_LABELS: Record<string, string> = {
  '10': 'CRITIQUE', '9': 'CRITIQUE', '8': 'ÉLEVÉE', '7': 'MOYENNE',
};

function riskLevel(score: number) {
  if (score >= 75) return { label: 'CRITIQUE', color: '#EF4444' };
  if (score >= 50) return { label: 'ÉLEVÉ', color: '#F97316' };
  if (score >= 25) return { label: 'MOYEN', color: '#F59E0B' };
  return { label: 'FAIBLE', color: '#22C55E' };
}

interface DpiAlertEvent {
  timestamp: string;
  rule_id: string;
  rule_name: string;
  severity: number;
  description: string;
  device: string;
  attack_type: string;
  attack_explanation: string;
  risk_score?: number;
  recommendation?: { consigne?: string; steps?: string[] };
  payload: { season?: string; month?: string; [k: string]: any };
}

interface DpiStats {
  total_messages?: number;
  total_alerts?: number;
  messages_per_second?: number;
  avg_latency_us?: number;
  active_rules?: number;
  routing_reference?: { routes: number; attack_routes: number };
  attack_count?: number;
}

// ----------------------------------------------------------------------------
// Primitives de style réutilisables (refonte visuelle — données inchangées)
// ----------------------------------------------------------------------------
const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(168,85,247,0.07), rgba(168,85,247,0.02))',
  border: '1px solid var(--color-border)',
  borderRadius: 14,
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: 'var(--color-text-secondary)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

function fmtCaptureTime(ts: string) {
  if (!ts) return '--:--:--.--';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--:--.--';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function PacketBall({ p }: { p: any }) {
  const anomaly = p.status === 'anomaly';
  const c = anomaly ? '#EF4444' : '#22C55E';
  return (
    <div
      style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
      title={`${fmtCaptureTime(p.ts)} · ${p.type} · ${anomaly ? 'Anomalie (attaque)' : 'Normal'}`}
    >
      <div style={{ position: 'relative', width: 18, height: 18 }}>
        {anomaly && <div className="animate-pulse-ring" style={{ position: 'absolute', inset: 0, borderRadius: 99, border: `2px solid ${c}` }} />}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 99,
          background: anomaly
            ? 'radial-gradient(circle at 35% 30%, #F87171 0%, rgba(239,68,68,0.6) 55%, rgba(239,68,68,0.2) 100%)'
            : 'radial-gradient(circle at 35% 30%, #4ADE80 0%, rgba(34,197,94,0.55) 50%, rgba(34,197,94,0.18) 100%)',
          border: `1.5px solid ${c}`,
          boxShadow: anomaly ? '0 0 10px rgba(239,68,68,0.7), 0 0 3px #EF4444' : '0 0 8px rgba(34,197,94,0.4), 0 1px 3px rgba(0,0,0,0.4)',
        }}>
          <div style={{ position: 'absolute', left: 4, top: 3, width: 4, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.8)' }} />
        </div>
      </div>
      <span style={{ fontSize: 8.5, color: anomaly ? '#F87171' : 'rgba(148,163,184,0.9)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{p.type}</span>
      <span style={{ fontSize: 7.5, color: 'rgba(148,163,184,0.55)', fontFamily: "'JetBrains Mono', monospace" }}>{fmtCaptureTime(p.ts)}</span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// FALLBACK cards quand le backend n'est pas disponible
// ----------------------------------------------------------------------------
function DpiRulesCardFallback() {
  const rules = [
    { id: 'DPI-001', name: 'Variation brusque (Δt)', desc: 'Détecte un écart > seuil entre deux valeurs consécutives.' },
    { id: 'DPI-002', name: 'Anomalie saisonnière (Δ saison)', desc: 'Écart significatif versus la moyenne de la saison.' },
    { id: 'DPI-003', name: 'Plateau / valeur constante (min) durable', desc: 'Détecte des séquences de valeurs identiques.' },
    { id: 'DPI-004', name: 'Spike / amplitude maximale', desc: 'Détecte un pic extrême dans l’amplitude du signal.' },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {rules.map((r) => (
        <div key={r.id} style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', flex: '1 1 220px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--accent-primary)', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600 }}>{r.id}</span>
            <span style={{ fontSize: 10, color: '#22C55E', background: 'rgba(34,197,94,0.12)', padding: '2px 8px', borderRadius: 999 }}>ACTIVE</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{r.name}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>{r.desc}</div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Factories internes
// ----------------------------------------------------------------------------

export default function FactoryView() {
  const [dpiRules, setDpiRules] = useState<any[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<DpiAlertEvent[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<DpiAlertEvent[]>([]);
  const [currentPoint, setCurrentPoint] = useState<any>(null);
  const [packets, setPackets] = useState<any[]>([]);
  const [attackCount, setAttackCount] = useState(0);
  const [cleanCount, setCleanCount] = useState(0);
  const [seasonCleanCount, setSeasonCleanCount] = useState(0);
  const [dpiStats, setDpiStats] = useState<DpiStats | null>(null);
  const [phase, setPhase] = useState<'idle' | 'running'>('idle');
  const [selectedAlert, setSelectedAlert] = useState<DpiAlertEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastSeason, setLastSeason] = useState<string>('');
  const [simulationActive, setSimulationActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const manuallyStoppedRef = useRef(false);
  const reconnectTimer = useRef<any>(null);

  // ----- Polling alerts + rules -----
  useEffect(() => {
    if (phase === 'idle') return;
    const t = setInterval(async () => {
      const [alertsRes, rulesRes] = await Promise.all([
        fetchJson('/dpi/recent-alerts'),
        fetchJson('/dpi/rules'),
      ]);
      const alerts = alertsRes?.alerts;
      if (Array.isArray(alerts)) setRecentAlerts(alerts as DpiAlertEvent[]);
      if (rulesRes?.rules) setDpiRules(rulesRes.rules);
    }, 3000);
    return () => clearInterval(t);
  }, [phase]);

  // ----- WebSocket stream (départ Hiver par connexion) -----
  const connect = useCallback(() => {
    setPhase('running');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws/stream`);
    } catch (e) {
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      manuallyStoppedRef.current = false;
      setIsConnected(true);
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setCurrentPoint(data);

        // Track packets (conveyor belt)
        const isAttack = !!(data.is_anomaly || data.attack_active);
        const newPacket = {
          id: Date.now() + Math.random(),
          ts: data.timestamp || '',
          type: data.device_type || 'unknown',
          status: isAttack ? 'anomaly' : 'normal',
          score: data.risk_score || 0,
        };
        setPackets(prev => [...prev.slice(-50), newPacket]);

        if (isAttack) {
          setAttackCount(c => c + 1);
        } else {
          setCleanCount(c => c + 1);
          setSeasonCleanCount(c => c + 1);
        }

        // Alert cards from DPI alerts
        if (data.dpi_alert) {
          const da: DpiAlertEvent = {
            timestamp: data.timestamp,
            rule_id: data.dpi_alert.rule?.id || 'DPI-000',
            rule_name: data.dpi_alert.rule?.name || 'Alerte DPI',
            severity: data.dpi_alert.rule?.level || 8,
            description: data.dpi_alert.rule?.description || '',
            device: data.device_type || 'multi-sensor',
            attack_type: data.attack_info?.type || data.dpi_alert.rule?.name || '',
            attack_explanation: data.attack_info?.explanation || '',
            risk_score: data.risk_score || 0,
            recommendation: data.recommendation || data.dpi_alert?.data?.recommendation || undefined,
            payload: data,
          };
          setLiveAlerts(prev => [da, ...prev].slice(0, 50));
        }

        if (data.dpi_stats) setDpiStats(data.dpi_stats);
      } catch (e) { /* ignore */ }
    };

    ws.onclose = () => {
      setIsConnected(false);
      clearTimeout(reconnectTimer.current);
      if (phase === 'running' && !manuallyStoppedRef.current) {
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    };
    ws.onerror = () => { ws.close(); };
  }, [phase]);

  useEffect(() => {
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, []);

  // ----- Toggle simulation -----
  const toggleSimulation = async () => {
    if (simulationActive) {
      // Stop: keep alerts and stats (no restart)
      manuallyStoppedRef.current = true;
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
      wsRef.current = null;
      setPhase('idle');
      setSimulationActive(false);
      return;
    }
    // Start
    setSimulationActive(true);
    connect();
  };

  // ----- Keep last season for display when stopped -----
  useEffect(() => {
    if (currentPoint?.season) {
      setLastSeason(currentPoint.season);
    }
  }, [currentPoint]);

  const currentSeason = currentPoint?.season || lastSeason;
  const displaySeason = simulationActive ? currentSeason : lastSeason;

  // ----- Stats -----
  const totalInspect = dpiStats?.total_messages ?? (cleanCount + attackCount);
  const totalAlerts = dpiStats?.total_alerts ?? liveAlerts.length;

  // ----- Merge alerts -----
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

  const seasonAlerts = useMemo(() => {
    const season = currentPoint?.season || lastSeason;
    if (!season) return [];
    return allAlerts.filter(a => (a.payload?.season || '') === season);
  }, [allAlerts, currentPoint, lastSeason]);

  function fmt2(n: any) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(2);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      {/* ======== BANNER ======== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{ display: 'flex', gap: 14, alignItems: 'center' }}
        >
          <div className="section-badge">DPI</div>
          <div>
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              Inspection Temps Réel
              <span style={{ fontSize: 9, fontWeight: 700, color: isConnected ? '#22C55E' : '#EF4444', background: isConnected ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', border: `1px solid ${isConnected ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`, padding: '2px 8px', borderRadius: 999, letterSpacing: 1 }}>
                {isConnected ? '● LIVE' : '○ OFFLINE'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              Module DPI · Analyse des paquets en direct
            </div>
          </div>
        </motion.div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: isConnected ? '#22C55E' : '#EF4444', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: isConnected ? '#22C55E' : '#EF4444', boxShadow: isConnected ? '0 0 8px #22C55E' : '0 0 8px #EF4444' }} />
            {isConnected ? 'Flux actif' : 'Flux interrompu'}
          </div>

          <button
            onClick={toggleSimulation}
            className="btn"
            style={{
              background: simulationActive ? 'rgba(239,68,68,0.12)' : 'var(--accent-primary)',
              border: `1px solid ${simulationActive ? '#EF4444' : 'transparent'}`,
              color: simulationActive ? '#EF4444' : '#fff',
              boxShadow: simulationActive ? 'none' : '0 6px 24px -8px var(--accent-glow)',
              fontWeight: 700,
            }}
          >
            {simulationActive ? '⏹ ARRÊTER la simulation' : '▶ COMMENCER la simulation'}
          </button>
        </div>
      </div>

      {/* ======== SEASON + SENSORS ======== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 20 }}>
        <div style={{ ...cardStyle, padding: 16, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: 'linear-gradient(180deg, var(--accent-primary), transparent)' }} />
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Saison en cours</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-display)' }}>{displaySeason || '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>Mois {currentPoint?.month || '—'}</div>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', opacity: 0.6, marginTop: 6 }}>
            Simulation annuelle · 4 saisons en temps réel
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { label: 'Weather', val: currentPoint?.weather_temperature ?? '—', unit: '°C', color: '#38BDF8', icon: '🌤️' },
            { label: 'Fridge', val: currentPoint?.fridge_temperature ?? '—', unit: '°C', color: '#00E676', icon: '🧊' },
            { label: 'Thermostat', val: currentPoint?.thermostat_temperature ?? '—', unit: '°C', color: '#FF9100', icon: '🔥' },
          ].map((s, i) => (
            <div key={i} style={{ ...cardStyle, padding: 14, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderTop: `2px solid ${s.color}55` }}>
              <div style={{ fontSize: 20, marginBottom: 4, filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.15))' }}>{s.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.1 }}>
                {fmt2(s.val)}{s.val !== '—' ? s.unit : ''}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ======== STATS ======== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { val: String(totalAlerts), lbl: 'Alertes DPI', sub: 'Depuis démarrage', color: '#EF4444', icon: '🚨' },
          { val: dpiStats ? `${fmt2(dpiStats.messages_per_second)}/s` : '—', lbl: 'Débit', sub: 'msg/s entrant', color: 'var(--accent-primary)', icon: '📈' },
          { val: dpiStats && typeof dpiStats.avg_latency_us === 'number' ? `${(dpiStats.avg_latency_us / 1000).toFixed(2)}ms` : '—', lbl: 'Latence DPI', sub: 'moyenne', color: '#F59E0B', icon: '⚡' },
          { val: String(totalInspect), lbl: 'Paquets inspectés', sub: 'depuis démarrage', color: '#8B5CF6', icon: '📦' },
        ].map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
            style={{ ...cardStyle, padding: 14, position: 'relative', overflow: 'hidden' }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${s.color}, transparent)` }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>{s.val}</div>
              <div style={{ fontSize: 18, opacity: 0.9 }}>{s.icon}</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{s.lbl}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 2 }}>{s.sub}</div>
          </motion.div>
        ))}
      </div>

      {/* ======== PIPELINE ======== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'Capteurs IoT', icon: '📟', color: '#38BDF8', sub: 'weather-01 · fridge-01 · thermostat-01' },
          { label: 'Broker MQTT', icon: '🔗', color: isConnected ? '#38BDF8' : '#EF4444', sub: isConnected ? 'Mosquitto connecté' : 'Mosquitto coupé' },
          { label: 'DPI Engine', icon: '🔍', color: simulationActive ? '#EF4444' : '#38BDF8', sub: 'Détection d\'intrusion' },
          { label: 'WebSocket', icon: '🖥️', color: simulationActive ? '#EF4444' : '#38BDF8', sub: 'Dashboard temps réel' },
        ].map((s, i, arr) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 * i }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}
          >
            <div style={{ ...cardStyle, padding: '12px 10px', textAlign: 'center', width: '100%', border: `1px solid ${s.color}33`, position: 'relative' }}>
              <div style={{ position: 'absolute', top: -7, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, borderRadius: 99, background: s.color, boxShadow: `0 0 10px ${s.color}` }} />
              <div style={{ fontSize: 20, marginBottom: 2 }}>{s.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: s.color, letterSpacing: 0.4 }}>{s.label}</div>
              {s.sub && <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', marginTop: 3, lineHeight: 1.3 }}>{s.sub}</div>}
            </div>
            {i < arr.length - 1 && (
              <div style={{ flexShrink: 0, color: 'var(--color-text-secondary)', opacity: 0.6 }}>→</div>
            )}
          </motion.div>
        ))}
      </div>

      {/* ======== BADGES (malveillants / bénins) ======== */}
      {(() => {
        const total = seasonAlerts.length + Math.max(0, seasonCleanCount);
        const anomalyPct = total > 0 ? Math.round((seasonAlerts.length / total) * 100) : 0;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#EF4444', lineHeight: 1, fontFamily: 'var(--font-display)' }}>{seasonAlerts.length}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 2 }}>malveillants</div>
                </div>
                <div style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#EF4444', fontFamily: "'JetBrains Mono', monospace" }}>{anomalyPct}%</div>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 99, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${anomalyPct}%`, background: 'linear-gradient(90deg, #EF4444, #f87171)', borderRadius: 99 }} />
              </div>
            </div>
            <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#22C55E', lineHeight: 1, fontFamily: 'var(--font-display)' }}>{Math.max(0, seasonCleanCount)}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 2 }}>bénins</div>
                </div>
                <div style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#22C55E', fontFamily: "'JetBrains Mono', monospace" }}>{100 - anomalyPct}%</div>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 99, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${100 - anomalyPct}%`, background: 'linear-gradient(90deg, #22C55E, #4ade80)', borderRadius: 99 }} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ======== FLUX DE PAQUETS — ROUTE RÉSEAU ======== */}
      <div style={{ background: 'linear-gradient(180deg, var(--color-bg-card) 0%, rgba(8,12,20,0.6) 100%)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 20, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="animate-pulse-dot" style={{ width: 8, height: 8, borderRadius: 99, background: '#22C55E', boxShadow: '0 0 10px rgba(34,197,94,0.8)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--color-text-primary)' }}>
              Flux de paquets · Derniers 50
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#22C55E', background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.4)', padding: '2px 8px', borderRadius: 999, letterSpacing: 1 }}>
              LIVE
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-secondary)', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 999, letterSpacing: 1 }}>
              VOIE RÉSEAU
            </span>
          </div>
          {packets.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'Normaux', val: packets.filter(p => p.status === 'normal').length, color: '#22C55E' },
                { label: 'Anomalies', val: packets.filter(p => p.status === 'anomaly').length, color: '#EF4444' },
                { label: 'Total', val: packets.length, color: 'var(--color-text-primary)' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.val}</span>
                  <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {packets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '26px 0 18px', color: 'var(--color-text-secondary)', opacity: 0.6, fontSize: 12 }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>📡</div>
            Aucun paquet reçu. Lancez la simulation pour voir le flux.
          </div>
        ) : (
          <div style={{ position: 'relative', height: 128, borderRadius: 12, overflow: 'hidden',
            background: 'linear-gradient(180deg, #0d1420 0%, #101a2c 28%, #0d1322 72%, #0a101c 100%)',
            border: '1px solid rgba(56,189,248,0.14)' }}>
            {/* bordures de chaussée */}
            <div style={{ position: 'absolute', left: 8, right: 8, top: 8, height: 3, borderRadius: 99, background: 'linear-gradient(90deg, transparent, rgba(148,163,184,0.45) 15%, rgba(148,163,184,0.45) 85%, transparent)' }} />
            <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, height: 3, borderRadius: 99, background: 'linear-gradient(90deg, transparent, rgba(148,163,184,0.45) 15%, rgba(148,163,184,0.45) 85%, transparent)' }} />

            {/* halo de mouvement (asphalte qui défile) */}
            <div style={{ position: 'absolute', left: 0, right: 0, top: 63, height: 2, opacity: 0.14, background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0 30px, transparent 30px 76px)', animation: 'conveyorflow 6s linear infinite' }} />

            {/* panneaux de sens */}
            <div style={{ position: 'absolute', left: 10, top: 3, fontSize: 8, letterSpacing: 1, color: 'rgba(56,189,248,0.8)', fontFamily: "'JetBrains Mono', monospace" }}>ENTRÉE →</div>
            <div style={{ position: 'absolute', right: 10, top: 3, fontSize: 8, letterSpacing: 1, color: 'rgba(148,163,184,0.55)', fontFamily: "'JetBrains Mono', monospace" }}>→ SORTIE</div>

            {/* voie unique — tous les paquets */}
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, display: 'flex', gap: 12, justifyContent: 'flex-start', alignItems: 'center', padding: '0 14px', paddingTop: 6 }}>
              {packets.map((p) => <PacketBall key={p.id} p={p} />)}
            </div>
          </div>
        )}
      </div>

      {/* ======== DPI RULES + SEASON TABLE ======== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20 }}>
        <div>
          <div style={{ ...sectionTitleStyle, marginBottom: 12 }}>
            <span>🛡️</span> Règles DPI actives <span style={{ opacity: 0.6, fontFamily: "'JetBrains Mono', monospace" }}>({dpiRules.length || 4})</span>
          </div>
          {dpiRules.length === 0 ? <DpiRulesCardFallback /> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {dpiRules.map((r) => (
                <div key={r.id} style={{ ...cardStyle, padding: '12px 14px', flex: '1 1 220px', position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--accent-primary)', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700 }}>{r.id}</span>
                    <span style={{ fontSize: 9, color: r.enabled ? '#22C55E' : '#EF4444', background: r.enabled ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', border: `1px solid ${r.enabled ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`, padding: '2px 8px', borderRadius: 999, fontWeight: 700, letterSpacing: 0.5 }}>
                      {r.enabled ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 7 }}>{r.name || r.rule_name}</div>
                  {r.description && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>{r.description}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ ...sectionTitleStyle, marginBottom: 12 }}>
            <span>🚨</span> Alertes DPI — {displaySeason || 'En attente'}{' '}
            <span style={{ color: '#EF4444', fontFamily: "'JetBrains Mono', monospace" }}>({seasonAlerts.length})</span>
          </div>
          {seasonAlerts.length === 0 ? (
            <div style={{ ...cardStyle, padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)', opacity: 0.6 }}>
              📡<div style={{ marginTop: 6 }}>Aucune alerte DPI pour cette saison. Lancez la simulation.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {seasonAlerts.map((a, i) => {
                const aScore = a.risk_score ?? a.payload?.risk_score ?? 0;
                const arl = riskLevel(aScore);
                return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.03 }}
                  whileHover={{ y: -2 }}
                  onClick={() => setSelectedAlert(a)}
                  style={{ ...cardStyle, padding: 12, cursor: 'pointer', borderTop: `2px solid ${aScore > 0 ? arl.color : (SEV_COLORS[String(a.severity)] || '#8B5CF6')}55` }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: SEV_COLORS[String(a.severity)] || '#EF4444', boxShadow: `0 0 8px ${SEV_COLORS[String(a.severity)] || '#EF4444'}` }} />
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--accent-primary)', fontWeight: 700 }}>{a.rule_id}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{a.rule_name}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {aScore > 0 && (
                        <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: arl.color, background: `${arl.color}18`, border: `1px solid ${arl.color}55`, padding: '2px 8px', borderRadius: 6 }}>
                          {aScore} · {arl.label}
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: SEV_COLORS[String(a.severity)] || '#EF4444', fontWeight: 700 }}>
                        {SEV_LABELS[String(a.severity)] || `NIV ${a.severity}`}
                      </span>
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 6, lineHeight: 1.5 }}>{a.description}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', opacity: 0.6, marginTop: 4 }}>
                    {a.payload?.season || ''} · Mois {a.payload?.month || '—'} · {a.device || '—'}
                  </div>
                </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ======== MODAL: Alert detail ======== */}
      <AnimatePresence>
        {selectedAlert && (
          <AlertDetailModal
            alert={selectedAlert}
            onClose={() => setSelectedAlert(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// MODAL: Détail d'une alerte (avec génération PDF)
// ----------------------------------------------------------------------------
function AlertDetailModal({ alert, onClose }: { alert: DpiAlertEvent; onClose: () => void }) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const sevColor = SEV_COLORS[String(alert.severity)] || '#EF4444';
  const sevLabel = SEV_LABELS[String(alert.severity)] || `NIV ${alert.severity}`;
  const riskScore = alert.risk_score ?? alert.payload?.risk_score ?? 0;
  const risk = riskLevel(riskScore);
  const reco = alert.recommendation || {};
  const recoSteps = Array.isArray(reco.steps) ? reco.steps : [];

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF('p', 'mm', 'a4');
      const W = doc.internal.pageSize.getWidth();
      const M = 15;
      const CW = W - 2 * M;

      // --- Bandeau d'en-tête coloré selon la sévérité ---
      doc.setFillColor(sevColor === '#EF4444' ? 239 : 249, sevColor === '#EF4444' ? 68 : 115, sevColor === '#EF4444' ? 68 : 22);
      doc.rect(0, 0, W, 26, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text('RAPPORT D\'ALERTE DPI', M, 11);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`${alert.rule_id}  ·  ${sevLabel}${riskScore > 0 ? `  ·  Risque ${riskScore}/100 (${risk.label})` : ''}`, M, 18);

      let y = 36;

      // --- Titre ---
      doc.setTextColor(30, 30, 30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      const title = doc.splitTextToSize(alert.rule_name || alert.rule_id, CW);
      doc.text(title, M, y);
      y += title.length * 6 + 4;

      // --- Métadonnées ---
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`${new Date(alert.timestamp).toLocaleString()}   ·   ${alert.payload?.season || '—'} · Mois ${alert.payload?.month || '—'}   ·   ${alert.device || '—'}`, M, y);
      y += 6;

      doc.setDrawColor(220, 220, 220);
      doc.line(M, y, W - M, y);
      y += 7;

      // --- Détails ---
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(10);
      doc.text('Détails de l\'alerte', M, y);
      y += 6;

      const rows: [string, string][] = [
        ['Type d\'attaque', alert.attack_type || '—'],
        ['Règle', alert.rule_id],
        ['Sévérité', sevLabel],
        ...(riskScore > 0 ? ([['Risque DPI', `${riskScore}/100 · ${risk.label}`]] as [string, string][]) : []),
      ];
      doc.setFontSize(9.5);
      for (const [k, v] of rows) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(90, 90, 90);
        doc.text(k, M, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 30, 30);
        const val = doc.splitTextToSize(String(v), CW - 60);
        doc.text(val, M + 55, y);
        y += 5 + (val.length - 1) * 4;
      }

      // --- Description ---
      if (alert.description) {
        y += 4;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(60, 60, 60);
        doc.setFontSize(10);
        doc.text('Description', M, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 30, 30);
        doc.setFontSize(9.5);
        const desc = doc.splitTextToSize(alert.description, CW);
        doc.text(desc, M, y);
        y += desc.length * 4.5 + 4;
      }

      // --- Explication ---
      if (alert.attack_explanation) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(60, 60, 60);
        doc.setFontSize(10);
        doc.text('Explication', M, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 30, 30);
        doc.setFontSize(9.5);
        const expl = doc.splitTextToSize(alert.attack_explanation, CW);
        doc.text(expl, M, y);
        y += expl.length * 4.5 + 6;
      }

      // --- Recommandations (consigne + étapes) ---
      if (reco.consigne || recoSteps.length) {
        doc.setFillColor(240, 249, 255);
        doc.roundedRect(M, y - 5, CW, 1, 1, 1, 'F');
        y += 2;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(2, 132, 199);
        doc.setFontSize(11);
        doc.text('Recommandations', M, y);
        y += 7;

        if (reco.consigne) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 30, 30);
          doc.setFontSize(9.5);
          const con = doc.splitTextToSize(reco.consigne, CW);
          doc.text(con, M, y);
          y += con.length * 4.5 + 3;
        }

        if (recoSteps.length) {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(50, 50, 50);
          doc.setFontSize(9.5);
          recoSteps.forEach((s, i) => {
            doc.setFillColor(2, 132, 199);
            doc.circle(M + 2, y - 1.2, 1.6, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(7.5);
            doc.text(String(i + 1), M + 2, y - 0.6, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(50, 50, 50);
            doc.setFontSize(9.5);
            const st = doc.splitTextToSize(String(s), CW - 8);
            doc.text(st, M + 8, y);
            y += st.length * 4.5 + 3;
          });
        }
      }

      const fileName = `alerte_${alert.rule_id}_${(alert.timestamp || '').replace(/[:T]/g, '-').slice(0, 19)}.pdf`;
      doc.save(fileName);
    } catch (err: any) {
      setPdfError(err?.message || 'Erreur lors de la génération du PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 10 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border)', borderRadius: 16, maxWidth: 620, width: '100%', maxHeight: '88vh', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header band */}
        <div style={{ padding: '18px 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, background: `linear-gradient(135deg, ${sevColor}22, transparent 65%)`, borderBottom: `1px solid ${sevColor}55` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: `${sevColor}22`, border: `1px solid ${sevColor}66`, color: sevColor }}>
              🚨
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text-primary)' }}>{alert.rule_name || alert.rule_id}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--accent-primary)', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)', padding: '2px 8px', borderRadius: 6 }}>{alert.rule_id}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                {new Date(alert.timestamp).toLocaleString()} · {alert.payload?.season || '—'} · Mois {alert.payload?.month || '—'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {riskScore > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: risk.color, background: `${risk.color}1c`, border: `1px solid ${risk.color}66`, padding: '4px 10px', borderRadius: 999, fontFamily: "'JetBrains Mono', monospace" }}>
                RISQUE {riskScore} · {risk.label}
              </span>
            )}
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: sevColor, background: `${sevColor}1c`, border: `1px solid ${sevColor}66`, padding: '4px 10px', borderRadius: 999 }}>{sevLabel}</span>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--color-text-secondary)', width: 30, height: 30, borderRadius: 8, fontSize: 16, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          {/* Type d'attaque */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#F59E0B', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', padding: '3px 10px', borderRadius: 7, textTransform: 'uppercase', letterSpacing: 0.4 }}>Attaque</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{alert.attack_type || alert.rule_name || '—'}</span>
          </div>

          {/* Details grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              { k: 'Périphérique', v: alert.device || '—' },
              { k: 'Saison / Mois', v: `${alert.payload?.season || '—'} · ${alert.payload?.month || '—'}` },
            ].map((d, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px' }}>
                <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{d.k}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{d.v}</div>
              </div>
            ))}
            {riskScore > 0 && (
              <div style={{ background: `${risk.color}12`, border: `1px solid ${risk.color}44`, borderRadius: 10, padding: '9px 12px', gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Niveau de risque DPI</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: risk.color, fontFamily: "'JetBrains Mono', monospace" }}>
                  {riskScore} / 100 · {risk.label}
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, riskScore)}%`, background: risk.color, borderRadius: 99 }} />
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#F87171', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Description</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5 }}>{alert.description}</div>
            {alert.attack_explanation && (
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginTop: 8, borderTop: '1px solid rgba(239,68,68,0.12)', paddingTop: 8 }}>{alert.attack_explanation}</div>
            )}
          </div>

          {/* Recommendation */}
          {(reco.consigne || recoSteps.length > 0) && (
            <div style={{ background: 'linear-gradient(180deg, rgba(2,132,199,0.08), rgba(2,132,199,0.02))', border: '1px solid rgba(2,132,199,0.3)', borderRadius: 12, padding: 14, marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 15 }}>🛠️</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: 0.6 }}>Recommandations</span>
              </div>
              {reco.consigne && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.5, marginBottom: 10 }}>{reco.consigne}</div>}
              {recoSteps.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recoSteps.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, background: 'rgba(2,132,199,0.15)', color: '#38BDF8', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono', monospace" }}>{i + 1}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--color-text-primary)', lineHeight: 1.45 }}>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
          {pdfError && <div style={{ fontSize: 12, color: '#EF4444' }}>{pdfError}</div>}
          <button
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            style={{
              background: 'linear-gradient(135deg, var(--accent-primary), #0ea5e9)',
              color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 10,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: '0 6px 18px rgba(56,189,248,0.35)', transition: 'all .15s',
            }}
          >
            {pdfLoading ? (
              <>⏳ Génération...</>
            ) : (
              <>📄 Télécharger le PDF</>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
