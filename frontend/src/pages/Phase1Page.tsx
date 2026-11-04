import { useState, useEffect, useCallback, useRef } from 'react';
import { Cpu, Repeat, Link2, Monitor, Play, Square } from 'lucide-react';
import { Empty, PageHeader, Readouts, Section, Stat, State, Table, nf } from '../components/etude/kit';
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
    <li className="shrink-0 flex flex-col items-center gap-1" title={`${fmtCaptureTime(p.ts)} · ${p.type}`}>
      <span className="w-3 h-3" style={{ background: 'var(--accent-primary)' }} aria-hidden />
      <span className="text-[12px] font-mono" style={{ color: 'var(--text-secondary)' }}>{p.type}</span>
      <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{fmtCaptureTime(p.ts).slice(0, 8)}</span>
    </li>
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
    return nf(Number(n), 2);
  }

  const sensors = [
    { label: 'Météo', id: 'weather-01', val: currentPoint?.weather_temperature },
    { label: 'Chambre froide', id: 'fridge-01', val: currentPoint?.fridge_temperature },
    { label: 'Thermostat', id: 'thermostat-01', val: currentPoint?.thermostat_temperature },
  ];
  const pipeline = [
    { label: 'Capteurs IoT', icon: Cpu, sub: 'weather-01 · fridge-01 · thermostat-01', ok: true },
    { label: 'Flux saisonnier', icon: Repeat, sub: 'rejeu des 4 saisons du jeu annuel', ok: true },
    { label: 'WebSocket', icon: Link2, sub: isConnected ? '/ws/stream connecté' : '/ws/stream fermé', ok: isConnected },
    { label: 'Tableau de bord', icon: Monitor, sub: 'affichage temps réel', ok: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Ingestion temps réel"
        subtitle="Archive de l’année simulée 2019 (phase 2) : flux des trois capteurs (météo, frigo, thermostat) rejoué depuis le jeu annuel et reçu par WebSocket. Ce n’est pas l’étude de référence sur traces réelles.">
        <State kind={isConnected ? 'ok' : 'neutre'}>{isConnected ? 'Flux actif' : 'Hors ligne'}</State>
        <button type="button" onClick={toggleSimulation} className={simulationActive ? 'vc-btn vc-btn-danger' : 'vc-btn vc-btn-primary'}>
          {simulationActive ? <><Square className="w-4 h-4" /> Arrêter la simulation</> : <><Play className="w-4 h-4" /> Démarrer la simulation</>}
        </button>
      </PageHeader>

      {streamError && <div role="alert"><State kind="manque">{streamError}</State></div>}

      <Readouts cols={4}>
        <Stat label="Saison en cours" value={<span className="capitalize">{displaySeason || '—'}</span>} sub={`Mois ${currentPoint?.month || '—'} · quatre saisons rejouées`} />
        {sensors.map(({ label, id, val }) => (
          <Stat key={id} label={label} tone="var(--accent-primary)" value={val == null ? '—' : fmt2(val)} unit={val == null ? undefined : '°C'} sub={<code>{id}</code>} />
        ))}
      </Readouts>

      <Readouts cols={4}>
        <Stat label="Mesures reçues" value={nf(received)} sub="depuis le démarrage" />
        <Stat label="Débit" value={rate != null ? fmt2(rate) : '—'} unit={rate != null ? '/s' : undefined} sub="mesures reçues par seconde" />
        <Stat label="Capteurs" value={nf(sensors.length)} sub="météo · frigo · thermostat" />
        <Stat label="Horodatage du jeu" value={<span className="text-[22px]">{currentPoint?.dataset_datetime ? currentPoint.dataset_datetime.slice(0, 16).replace('T', ' ') : '—'}</span>} sub="dernière mesure rejouée" />
      </Readouts>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Chaîne d’acquisition" subtitle="Du capteur simulé au tableau de bord.">
          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pipeline.map(({ label, icon: Icon, sub, ok }, i) => (
              <li key={label} className="flex items-center gap-3 p-3 rounded-[3px] min-w-0" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                <Icon className="w-4 h-4 shrink-0" style={{ color: ok ? 'var(--accent-primary)' : 'var(--accent-danger)' }} aria-hidden />
                <div className="min-w-0">
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{i + 1}. {label}</div>
                  <div className="text-[12.5px] truncate" style={{ color: ok ? 'var(--text-muted)' : 'var(--accent-danger)' }}>{sub}</div>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Flux de paquets" subtitle={packets.length > 0 ? `${nf(packets.length)} derniers paquets (50 au plus)` : '50 derniers paquets'} source="WebSocket /ws/stream">
          {packets.length === 0 ? <Empty>Aucun paquet reçu. Démarrez la simulation pour voir le flux.</Empty> : (
            <ol className="flex gap-3 items-center p-3 overflow-x-auto rounded-[3px]" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }} aria-label="Paquets reçus">
              {packets.map((p) => <PacketChip key={p.id} p={p} />)}
            </ol>
          )}
        </Section>
      </div>

      <Section title="Dernières mesures reçues" subtitle={`${nf(recent.length)} mesures affichées (12 au plus)`} source="WebSocket /ws/stream" flush>
        {recent.length === 0 ? <div className="p-4 sm:p-5"><Empty>Aucune mesure pour l’instant. Démarrez la simulation.</Empty></div> : (
          <Table min={620}>
            <thead>
              <tr><th>Reçue à</th><th>Horodatage du jeu</th><th className="vc-num">Météo</th><th className="vc-num">Frigo</th><th className="vc-num">Thermostat</th><th>Saison</th></tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i}>
                  <td className="font-mono">{fmtCaptureTime(r.timestamp || '')}</td>
                  <td className="font-mono" style={{ color: 'var(--text-secondary)' }}>{(r.dataset_datetime || '—').slice(0, 16)}</td>
                  <td className="vc-num">{fmt2(r.weather_temperature)}&nbsp;°C</td>
                  <td className="vc-num">{fmt2(r.fridge_temperature)}&nbsp;°C</td>
                  <td className="vc-num">{fmt2(r.thermostat_temperature)}&nbsp;°C</td>
                  <td className="capitalize">{r.season || '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}
