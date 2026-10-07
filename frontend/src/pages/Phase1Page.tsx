import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import type { LivePoint } from '../types';

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

function PacketBall({ p }: { p: { ts: string; type: string } }) {
  const c = '#38BDF8';
  return (
    <div
      style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
      title={`${fmtCaptureTime(p.ts)} · ${p.type}`}
    >
      <div style={{ position: 'relative', width: 18, height: 18 }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 99,
          background: 'radial-gradient(circle at 35% 30%, #7DD3FC 0%, rgba(56,189,248,0.55) 50%, rgba(56,189,248,0.18) 100%)',
          border: `1.5px solid ${c}`,
          boxShadow: '0 0 8px rgba(56,189,248,0.4), 0 1px 3px rgba(0,0,0,0.4)',
        }}>
          <div style={{ position: 'absolute', left: 4, top: 3, width: 4, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.8)' }} />
        </div>
      </div>
      <span style={{ fontSize: 8.5, color: 'rgba(148,163,184,0.9)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{p.type}</span>
      <span style={{ fontSize: 7.5, color: 'rgba(148,163,184,0.55)', fontFamily: "'JetBrains Mono', monospace" }}>{fmtCaptureTime(p.ts)}</span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Ingestion temps réel : flux des 3 capteurs reçu par WebSocket (/ws/stream)
// ----------------------------------------------------------------------------

interface Packet { id: number; ts: string; type: string }

export default function FactoryView() {
  const [currentPoint, setCurrentPoint] = useState<LivePoint | null>(null);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [recent, setRecent] = useState<LivePoint[]>([]);
  const [received, setReceived] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'running'>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const [simulationActive, setSimulationActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const manuallyStoppedRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  // ----- WebSocket stream (départ Hiver par connexion) -----
  const connect = useCallback(() => {
    setPhase('running');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws/stream`);
    } catch {
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      manuallyStoppedRef.current = false;
      setIsConnected(true);
      setStreamError(null);
      setStartedAt(t => t ?? Date.now());
    };

    ws.onmessage = (ev) => {
      try {
        const data: LivePoint = JSON.parse(ev.data);
        // Messages de contrôle du flux (pause, nouveau cycle, jeu de données absent)
        if (data.type === 'error') { setStreamError(data.message || 'Flux indisponible'); return; }
        if (data.type) return;
        setCurrentPoint(data);
        setReceived(c => c + 1);
        setLastAt(Date.now());
        setPackets(prev => [...prev.slice(-50), { id: ++seq.current, ts: data.timestamp || '', type: data.device_type || 'unknown' }]);
        setRecent(prev => [data, ...prev].slice(0, 12));
      } catch { /* ignore */ }
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
      // Stop: on garde les dernières mesures affichées (pas de redémarrage)
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

  // La dernière mesure reste affichée après l'arrêt (saison comprise)
  const displaySeason = currentPoint?.season || '';

  // ----- Stats -----
  const elapsed = startedAt && lastAt ? (lastAt - startedAt) / 1000 : 0;
  const rate = elapsed > 1 ? received / elapsed : null;

  function fmt2(n: unknown) {
    if (n === null || n === undefined || isNaN(Number(n))) return '—';
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
          <div className="section-badge">IoT</div>
          <div>
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              Ingestion Temps Réel
              <span style={{ fontSize: 9, fontWeight: 700, color: isConnected ? '#22C55E' : '#EF4444', background: isConnected ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', border: `1px solid ${isConnected ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`, padding: '2px 8px', borderRadius: 999, letterSpacing: 1 }}>
                {isConnected ? '● LIVE' : '○ OFFLINE'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              Flux des 3 capteurs · météo, frigo, thermostat
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

      {streamError && (
        <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: 16, color: '#EF4444', borderColor: 'rgba(239,68,68,0.4)', fontSize: 12 }}>
          {streamError}
        </div>
      )}

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
          { val: String(received), lbl: 'Mesures reçues', sub: 'depuis démarrage', color: '#8B5CF6', icon: '📦' },
          { val: rate != null ? `${fmt2(rate)}/s` : '—', lbl: 'Débit', sub: 'mesures/s reçues', color: 'var(--accent-primary)', icon: '📈' },
          { val: '3', lbl: 'Capteurs', sub: 'météo · frigo · thermostat', color: '#00E676', icon: '📟' },
          { val: currentPoint?.dataset_datetime ? currentPoint.dataset_datetime.slice(0, 16) : '—', lbl: 'Horodatage du jeu', sub: 'dernière mesure rejouée', color: '#F59E0B', icon: '🕒' },
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
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>{s.val}</div>
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
          { label: 'Flux saisonnier', icon: '🔁', color: '#38BDF8', sub: 'rejeu des 4 saisons du jeu annuel' },
          { label: 'WebSocket', icon: '🔗', color: isConnected ? '#38BDF8' : '#EF4444', sub: isConnected ? '/ws/stream connecté' : '/ws/stream fermé' },
          { label: 'Dashboard', icon: '🖥️', color: '#38BDF8', sub: 'affichage temps réel' },
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

      {/* ======== FLUX DE PAQUETS ======== */}
      <div style={{ background: 'linear-gradient(180deg, var(--color-bg-card) 0%, rgba(8,12,20,0.6) 100%)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="animate-pulse-dot" style={{ width: 8, height: 8, borderRadius: 99, background: '#22C55E', boxShadow: '0 0 10px rgba(34,197,94,0.8)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--color-text-primary)' }}>
              Flux de paquets · Derniers 50
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#22C55E', background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.4)', padding: '2px 8px', borderRadius: 999, letterSpacing: 1 }}>
              LIVE
            </span>
          </div>
          {packets.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{packets.length}</span>
              <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Total</span>
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
            <div style={{ position: 'absolute', left: 8, right: 8, top: 8, height: 3, borderRadius: 99, background: 'linear-gradient(90deg, transparent, rgba(148,163,184,0.45) 15%, rgba(148,163,184,0.45) 85%, transparent)' }} />
            <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, height: 3, borderRadius: 99, background: 'linear-gradient(90deg, transparent, rgba(148,163,184,0.45) 15%, rgba(148,163,184,0.45) 85%, transparent)' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: 63, height: 2, opacity: 0.14, background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0 30px, transparent 30px 76px)', animation: 'conveyorflow 6s linear infinite' }} />
            <div style={{ position: 'absolute', left: 10, top: 3, fontSize: 8, letterSpacing: 1, color: 'rgba(56,189,248,0.8)', fontFamily: "'JetBrains Mono', monospace" }}>ENTRÉE →</div>
            <div style={{ position: 'absolute', right: 10, top: 3, fontSize: 8, letterSpacing: 1, color: 'rgba(148,163,184,0.55)', fontFamily: "'JetBrains Mono', monospace" }}>→ SORTIE</div>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, display: 'flex', gap: 12, justifyContent: 'flex-start', alignItems: 'center', padding: '0 14px', paddingTop: 6 }}>
              {packets.map((p) => <PacketBall key={p.id} p={p} />)}
            </div>
          </div>
        )}
      </div>

      {/* ======== DERNIÈRES MESURES ======== */}
      <div>
        <div style={{ ...sectionTitleStyle, marginBottom: 12 }}>
          <span>📋</span> Dernières mesures reçues <span style={{ opacity: 0.6, fontFamily: "'JetBrains Mono', monospace" }}>({recent.length})</span>
        </div>
        {recent.length === 0 ? (
          <div style={{ ...cardStyle, padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)', opacity: 0.6 }}>
            📡<div style={{ marginTop: 6 }}>Aucune mesure pour l'instant. Lancez la simulation.</div>
          </div>
        ) : (
          <div style={{ ...cardStyle, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--color-text-secondary)', textAlign: 'left' }}>
                  {['Reçue à', 'Horodatage du jeu', 'Météo', 'Frigo', 'Thermostat', 'Saison'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 14px', fontFamily: "'JetBrains Mono', monospace" }}>{fmtCaptureTime(r.timestamp || '')}</td>
                    <td style={{ padding: '8px 14px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--color-text-secondary)' }}>{(r.dataset_datetime || '—').slice(0, 16)}</td>
                    <td style={{ padding: '8px 14px', color: '#38BDF8', fontFamily: "'JetBrains Mono', monospace" }}>{fmt2(r.weather_temperature)} °C</td>
                    <td style={{ padding: '8px 14px', color: '#00E676', fontFamily: "'JetBrains Mono', monospace" }}>{fmt2(r.fridge_temperature)} °C</td>
                    <td style={{ padding: '8px 14px', color: '#FF9100', fontFamily: "'JetBrains Mono', monospace" }}>{fmt2(r.thermostat_temperature)} °C</td>
                    <td style={{ padding: '8px 14px' }}>{r.season || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
