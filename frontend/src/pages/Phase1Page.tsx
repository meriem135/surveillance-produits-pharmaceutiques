import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { CloudSun, Snowflake, Thermometer, Cpu, Repeat, Link2, Monitor, Radio, Play, Square } from 'lucide-react';
import type { LivePoint } from '../types';

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

function PacketChip({ p }: { p: { ts: string; type: string } }) {
  return (
    <div className="shrink-0 flex flex-col items-center gap-1" title={`${fmtCaptureTime(p.ts)} · ${p.type}`}>
      <span className="w-3.5 h-3.5 rounded-full" style={{ background: 'var(--accent-primary)', boxShadow: '0 0 0 3px var(--accent-glow)' }} />
      <span className="text-[9px] font-mono font-semibold" style={{ color: 'var(--text-secondary)' }}>{p.type}</span>
      <span className="text-[8px] font-mono" style={{ color: 'var(--text-muted)' }}>{fmtCaptureTime(p.ts).slice(0, 8)}</span>
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

  const sensors = [
    { label: 'Météo', id: 'weather-01', val: currentPoint?.weather_temperature, icon: CloudSun },
    { label: 'Chambre froide', id: 'fridge-01', val: currentPoint?.fridge_temperature, icon: Snowflake },
    { label: 'Thermostat', id: 'thermostat-01', val: currentPoint?.thermostat_temperature, icon: Thermometer },
  ];
  const pipeline = [
    { label: 'Capteurs IoT', icon: Cpu, sub: 'weather-01 · fridge-01 · thermostat-01', ok: true },
    { label: 'Flux saisonnier', icon: Repeat, sub: 'rejeu des 4 saisons du jeu annuel', ok: true },
    { label: 'WebSocket', icon: Link2, sub: isConnected ? '/ws/stream connecté' : '/ws/stream fermé', ok: isConnected },
    { label: 'Tableau de bord', icon: Monitor, sub: 'affichage temps réel', ok: true },
  ];

  return (
    <motion.div className="space-y-5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-3" style={{ color: 'var(--text-primary)' }}>
            Ingestion temps réel
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md inline-flex items-center gap-1.5"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', color: isConnected ? 'var(--accent-success)' : 'var(--text-muted)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: isConnected ? 'var(--accent-success)' : 'var(--text-muted)' }} />
              {isConnected ? 'Flux actif' : 'Hors ligne'}
            </span>
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Flux des trois capteurs (météo, frigo, thermostat) rejoué depuis le jeu annuel et reçu par WebSocket.
          </p>
        </div>
        <button onClick={toggleSimulation}
          className="h-9 px-4 rounded-md text-sm font-semibold inline-flex items-center gap-2 border"
          style={simulationActive
            ? { background: 'var(--bg-card)', borderColor: 'var(--accent-danger)', color: 'var(--accent-danger)' }
            : { background: 'var(--accent-primary)', borderColor: 'transparent', color: 'var(--accent-primary-fg)' }}>
          {simulationActive ? <><Square className="w-4 h-4" /> Arrêter la simulation</> : <><Play className="w-4 h-4" /> Démarrer la simulation</>}
        </button>
      </div>

      {streamError && (
        <div className="vc-card px-4 py-2.5 text-sm" style={{ color: 'var(--accent-danger)', borderColor: 'color-mix(in srgb, var(--accent-danger) 40%, transparent)' }}>{streamError}</div>
      )}

      {/* Saison + capteurs */}
      <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
        <div className="vc-card p-4">
          <div className="vc-kicker">Saison en cours</div>
          <div className="mt-2 text-2xl font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>{displaySeason || '—'}</div>
          <div className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Mois {currentPoint?.month || '—'}</div>
          <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Simulation annuelle · quatre saisons rejouées</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {sensors.map(({ label, id, val, icon: Icon }) => (
            <div key={id} className="vc-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                <Icon className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> {label}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {val == null ? '—' : <>{fmt2(val)}<span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}> °C</span></>}
              </div>
              <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--text-muted)' }}>{id}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Compteurs de la session */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { val: String(received), lbl: 'Mesures reçues', sub: 'depuis le démarrage' },
          { val: rate != null ? `${fmt2(rate)}/s` : '—', lbl: 'Débit', sub: 'mesures reçues par seconde' },
          { val: String(sensors.length), lbl: 'Capteurs', sub: 'météo · frigo · thermostat' },
          { val: currentPoint?.dataset_datetime ? currentPoint.dataset_datetime.slice(0, 16) : '—', lbl: 'Horodatage du jeu', sub: 'dernière mesure rejouée' },
        ].map((s) => (
          <div key={s.lbl} className="vc-card p-4">
            <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{s.lbl}</div>
            <div className="mt-2 text-xl font-semibold tabular-nums truncate" style={{ color: 'var(--text-primary)' }}>{s.val}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Chaîne d'acquisition */}
      <div className="vc-card p-4">
        <div className="vc-kicker mb-3">Chaîne d’acquisition</div>
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {pipeline.map(({ label, icon: Icon, sub, ok }, i) => (
            <li key={label} className="flex items-center gap-3 rounded-lg p-3" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
              <span className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: ok ? 'var(--accent-primary)' : 'var(--accent-danger)' }}>
                <Icon className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{i + 1}. {label}</div>
                <div className="text-[11px] truncate" style={{ color: ok ? 'var(--text-muted)' : 'var(--accent-danger)' }}>{sub}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Flux de paquets */}
      <div className="vc-card p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="vc-kicker">Flux de paquets · 50 derniers</div>
          {packets.length > 0 && <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{packets.length} paquets</span>}
        </div>
        {packets.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Radio className="w-5 h-5 mx-auto mb-2" />
            Aucun paquet reçu. Démarrez la simulation pour voir le flux.
          </div>
        ) : (
          <div className="relative rounded-lg overflow-x-auto" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
            <div className="flex gap-3 items-center px-4 py-4 min-h-[84px]">
              {packets.map((p) => <PacketChip key={p.id} p={p} />)}
            </div>
          </div>
        )}
      </div>

      {/* Dernières mesures */}
      <div className="vc-card overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Dernières mesures reçues</div>
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{recent.length}</span>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune mesure pour l’instant. Démarrez la simulation.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="vc-table w-full text-sm min-w-[620px]">
              <thead>
                <tr>{['Reçue à', 'Horodatage du jeu', 'Météo', 'Frigo', 'Thermostat', 'Saison'].map(h => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i}>
                    <td className="font-mono">{fmtCaptureTime(r.timestamp || '')}</td>
                    <td className="font-mono" style={{ color: 'var(--text-secondary)' }}>{(r.dataset_datetime || '—').slice(0, 16)}</td>
                    <td className="vc-num">{fmt2(r.weather_temperature)} °C</td>
                    <td className="vc-num">{fmt2(r.fridge_temperature)} °C</td>
                    <td className="vc-num">{fmt2(r.thermostat_temperature)} °C</td>
                    <td className="capitalize">{r.season || '—'}</td>
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
