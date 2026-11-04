/** Temps réel — les mesures du jeu de données (table transmission_dataset) passent une à une dans le
 *  modèle sauvegardé ; le seuil et la règle de persistance décident de l'alerte (WS /api/v1/etude/live). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BellRing, CheckCircle2, Pause, Play, Square, XCircle } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { Empty, MODEL_FR, Note, PageHeader, Pill, ROLE_FR, SCENARIO_FR, Section, Stat, heure, nf, tooltipStyle, useApi, usePalette } from '../../components/etude/kit';

interface Info { modele: string; nom: string; seuil: number; k: number; n: number; critere: string | null;
  roles: Record<string, { lignes: number; episodes: number }>; vitesse_defaut: number; sources: Record<string, string> }
interface Pt { idx: number; ts: string; fridge: number; thermostat: number; weather: number; score: number; signal: boolean; alarme: boolean; label: number; attack_type: string }
interface Ev { type: 'debut' | 'fin'; idx: number; ts?: string; attaque_reelle?: string; score?: number; duree_min?: number; vraie?: boolean; debut_idx?: number }
interface Stats { mesures: number; alertes: number; vraies: number; fausses: number; attaque_lignes: number }

const WINDOW = 720;   // 1 h de mesures affichées

export default function TempsReelPage() {
  const { data: info, error } = useApi<Info>('/api/v1/etude/live/info');
  const pal = usePalette();
  const [role, setRole] = useState('test');
  const [speed, setSpeed] = useState<number | null>(null);
  const [state, setState] = useState<'arret' | 'connexion' | 'lecture' | 'pause' | 'fini'>('arret');
  const [points, setPoints] = useState<Pt[]>([]);
  const [events, setEvents] = useState<(Ev & { recu: string })[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [progress, setProgress] = useState(0);
  const [wsError, setWsError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const vitesse = speed ?? info?.vitesse_defaut ?? 24;

  useEffect(() => () => ws.current?.close(), []);

  const send = (m: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(m));

  const start = useCallback(() => {
    ws.current?.close();
    setPoints([]); setEvents([]); setStats(null); setProgress(0); setWsError(null); setState('connexion');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/api/v1/etude/live?token=${encodeURIComponent(getToken() ?? '')}`);
    ws.current = sock;
    sock.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'info') { sock.send(JSON.stringify({ action: 'start', role, vitesse })); setState('lecture'); }
      else if (msg.type === 'mesures') {
        setPoints(prev => [...prev, ...msg.points].slice(-WINDOW));
        if (msg.evenements.length) setEvents(prev => [...msg.evenements.map((x: Ev) => ({ ...x, recu: new Date().toLocaleTimeString('fr-FR') })), ...prev].slice(0, 60));
        setStats(msg.stats); setProgress(msg.progression);
        if (msg.fini) setState('fini');
      } else if (msg.type === 'erreur') { setWsError(msg.message); setState('arret'); }
    };
    sock.onerror = () => setWsError('Connexion temps réel impossible');
    sock.onclose = () => setState(s => (s === 'fini' ? s : 'arret'));
  }, [role, vitesse]);

  const header = <PageHeader title="Temps réel"
    subtitle="Les mesures enregistrées passent une à une dans le modèle sauvegardé, comme un flux de capteurs : score, alerte et réalité côte à côte." />;
  if (!info) return <div className="space-y-4">{header}{error ? <Empty>{error}</Empty> : <div className="vc-card h-40 animate-pulse" />}</div>;

  const last = points[points.length - 1];
  const chart = points.map(p => ({ ...p, reel: p.label ? 16 : null, alerte: p.alarme ? 16 : null }));
  return (
    <div className="space-y-5">
      {header}
      <div className="vc-card p-4 flex flex-wrap items-center gap-3">
        <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>Données
          <select value={role} onChange={e => setRole(e.target.value)} disabled={state === 'lecture'} className="ml-2 rounded-md px-2 py-1 text-sm"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            {(['test', 'val', 'train'] as const).map(r => <option key={r} value={r}>{ROLE_FR[r]} ({nf(info.roles[r]?.lignes)} mesures)</option>)}
          </select>
        </label>
        <label className="text-sm flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>Vitesse
          <input type="range" min={6} max={180} step={6} value={vitesse} onChange={e => { const v = Number(e.target.value); setSpeed(v); send({ action: 'vitesse', vitesse: v }); }} />
          <span className="tabular-nums text-xs w-28">{vitesse} mesures/s (×{nf(vitesse * 5)})</span>
        </label>
        <div className="flex gap-2 ml-auto">
          {(state === 'arret' || state === 'fini') && <button onClick={start} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}><Play className="w-4 h-4" />Démarrer</button>}
          {state === 'lecture' && <button onClick={() => { send({ action: 'pause' }); setState('pause'); }} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}><Pause className="w-4 h-4" />Pause</button>}
          {state === 'pause' && <button onClick={() => { send({ action: 'reprendre' }); setState('lecture'); }} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}><Play className="w-4 h-4" />Reprendre</button>}
          {(state === 'lecture' || state === 'pause') && <button onClick={() => { send({ action: 'stop' }); ws.current?.close(); setState('arret'); }} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm" style={{ border: '1px solid var(--border)', color: 'var(--accent-danger)' }}><Square className="w-4 h-4" />Arrêter</button>}
        </div>
        <div className="w-full text-xs" style={{ color: 'var(--text-muted)' }}>
          Modèle : <strong>{MODEL_FR[info.modele] ?? info.nom}</strong> · alerte si au moins {info.k} mesures sur {info.n} ont un score ≥ {nf(info.seuil, 3)}
          {' '}· progression {nf(progress * 100, 0)} %{wsError && <span style={{ color: 'var(--accent-danger)' }}> · {wsError}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Mesures analysées" value={nf(stats?.mesures ?? 0)} sub={last ? new Date(last.ts).toLocaleString('fr-FR') : '—'} />
        <Stat label="Score actuel" value={last ? nf(last.score, 3) : '—'} sub={last ? (last.alarme ? 'ALERTE en cours' : last.signal ? 'au-dessus du seuil' : 'normal') : '—'} tone={last?.alarme ? 'var(--accent-danger)' : undefined} />
        <Stat icon={<BellRing className="w-4 h-4" />} label="Alertes levées" value={nf(stats?.alertes ?? 0)} tone="var(--accent-warning)" />
        <Stat icon={<CheckCircle2 className="w-4 h-4" />} label="Alertes justes (terminées)" value={nf(stats?.vraies ?? 0)} tone="var(--accent-success)" />
        <Stat icon={<XCircle className="w-4 h-4" />} label="Fausses alertes" value={nf(stats?.fausses ?? 0)} tone="var(--accent-danger)" />
      </div>

      <div className="grid xl:grid-cols-3 gap-5">
        <Section title="Flux des capteurs" subtitle="Dernière heure : valeurs transmises ; rouge = attaque réelle, orange = alerte du modèle." className="xl:col-span-2" source={info.sources.mesures}>
          {points.length ? (
            <>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="ts" tickFormatter={heure} minTickGap={48} tick={{ fill: pal.axis, fontSize: 11 }} />
                    <YAxis domain={[0, 16]} tick={{ fill: pal.axis, fontSize: 11 }} unit="°" />
                    <Tooltip {...tooltipStyle} labelFormatter={v => new Date(String(v)).toLocaleString('fr-FR')} formatter={(v, n) => (n === 'Attaque réelle' || n === 'Alerte' ? ['oui', n] : [`${nf(Number(v), 2)} °C`, n])} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area dataKey="reel" name="Attaque réelle" fill={pal.attack} stroke="none" isAnimationActive={false} />
                    <Area dataKey="alerte" name="Alerte" fill={pal.alert} fillOpacity={0.2} stroke="none" isAnimationActive={false} />
                    <Line dataKey="fridge" name="Frigo" stroke={pal.series[0]} dot={false} strokeWidth={1} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="h-[160px] mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="ts" tickFormatter={heure} minTickGap={48} tick={{ fill: pal.axis, fontSize: 11 }} />
                    <YAxis domain={[0, 1]} tick={{ fill: pal.axis, fontSize: 11 }} />
                    <Tooltip {...tooltipStyle} labelFormatter={v => new Date(String(v)).toLocaleString('fr-FR')} formatter={v => [nf(Number(v), 3), 'score']} />
                    <Line dataKey="score" name="Score du modèle" stroke={pal.series[1]} dot={false} strokeWidth={1} isAnimationActive={false} />
                    <ReferenceLine y={info.seuil} stroke={pal.axis} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : <Empty>Choisissez les données et cliquez sur « Démarrer » : le modèle analyse les mesures au fil de l'eau.</Empty>}
        </Section>
        <Section title="Journal des alertes" subtitle="Début et fin de chaque alerte, comparée à la réalité.">
          {events.length ? (
            <ul className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {events.map((e, i) => (
                <li key={i} className="text-xs rounded-md p-2" style={{ border: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
                  {e.type === 'debut' ? (
                    <><Pill tone="var(--accent-warning)">alerte</Pill> <span style={{ color: 'var(--text-primary)' }}>{e.ts && new Date(e.ts).toLocaleTimeString('fr-FR')}</span>
                      <span style={{ color: 'var(--text-muted)' }}> · réalité : {SCENARIO_FR[e.attaque_reelle ?? 'normal'] ?? e.attaque_reelle} · score {nf(e.score, 3)}</span></>
                  ) : (
                    <>{e.vraie ? <Pill tone="var(--accent-success)">fin · alerte juste</Pill> : <Pill tone="var(--accent-danger)">fin · fausse alerte</Pill>}
                      <span style={{ color: 'var(--text-muted)' }}> · durée {nf(e.duree_min, 1)} min</span></>
                  )}
                </li>
              ))}
            </ul>
          ) : <Empty>Aucune alerte pour l'instant.</Empty>}
        </Section>
      </div>
      <Note>Les features (moyennes, écarts-types, quantiles sur 1 à 15 min) ne regardent que le passé ; le score de chaque mesure est calculé
        en direct par le modèle sauvegardé. « Réalité » = étiquette du jeu de données, que le modèle ne voit pas.</Note>
    </div>
  );
}
