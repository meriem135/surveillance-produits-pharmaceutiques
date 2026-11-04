/** Temps réel — les mesures du jeu de données (table transmission_dataset) passent une à une dans le
 *  modèle sauvegardé ; le seuil et la règle de persistance décident de l'alerte (WS /api/v1/etude/live). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Pause, Play, Square } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { BandLegend, Empty, MODEL_FR, Note, PageHeader, Paper, Readouts, ROLE_FR, SCENARIO_FR, Section, Stat, State, heure, nf, tooltipStyle, useApi, usePalette } from '../../components/etude/kit';

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
  // Les messages du flux sont regroupés et appliqués une fois par image (requestAnimationFrame) :
  // à vitesse élevée, plusieurs messages arrivent entre deux images et chacun redessinait les courbes.
  const pending = useRef<{ points: Pt[]; events: (Ev & { recu: string })[]; stats: Stats | null; progress: number | null; fini: boolean }>(
    { points: [], events: [], stats: null, progress: null, fini: false });
  const frame = useRef<number | null>(null);
  const flush = useCallback(() => {
    frame.current = null;
    const p = pending.current;
    pending.current = { points: [], events: [], stats: null, progress: null, fini: false };
    if (p.points.length) setPoints(prev => [...prev, ...p.points].slice(-WINDOW));
    if (p.events.length) setEvents(prev => [...p.events, ...prev].slice(0, 60));
    if (p.stats) setStats(p.stats);
    if (p.progress != null) setProgress(p.progress);
    if (p.fini) setState('fini');
  }, []);
  const vitesse = speed ?? info?.vitesse_defaut ?? 24;

  useEffect(() => () => { ws.current?.close(); if (frame.current != null) cancelAnimationFrame(frame.current); }, []);

  const send = (m: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(m));

  const start = useCallback(() => {
    ws.current?.close();
    if (frame.current != null) { cancelAnimationFrame(frame.current); frame.current = null; }
    pending.current = { points: [], events: [], stats: null, progress: null, fini: false };
    setPoints([]); setEvents([]); setStats(null); setProgress(0); setWsError(null); setState('connexion');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/api/v1/etude/live?token=${encodeURIComponent(getToken() ?? '')}`);
    ws.current = sock;
    sock.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'info') { sock.send(JSON.stringify({ action: 'start', role, vitesse })); setState('lecture'); }
      else if (msg.type === 'mesures') {
        const p = pending.current;
        p.points.push(...msg.points);
        if (msg.evenements.length) p.events.unshift(...msg.evenements.map((x: Ev) => ({ ...x, recu: new Date().toLocaleTimeString('fr-FR') })).reverse());
        p.stats = msg.stats; p.progress = msg.progression; p.fini ||= !!msg.fini;
        if (frame.current == null) frame.current = requestAnimationFrame(flush);
      } else if (msg.type === 'erreur') { setWsError(msg.message); setState('arret'); }
    };
    sock.onerror = () => setWsError('Connexion temps réel impossible');
    sock.onclose = () => setState(s => (s === 'fini' ? s : 'arret'));
  }, [role, vitesse, flush]);

  const header = <PageHeader title="Temps réel"
    subtitle="Les mesures enregistrées repassent une à une dans le modèle sauvegardé, comme un flux de capteurs : valeur transmise, score, alerte et réalité côte à côte." />;
  if (!info) return <div className="space-y-5">{header}{error ? <Empty>{error}</Empty> : <div className="vc-panel h-40 animate-pulse" />}</div>;

  const last = points[points.length - 1];
  const chart = points.map(p => ({ ...p, reel: p.label ? [18.7, 19.9] : null, alerte: p.alarme ? [17.1, 18.3] : null }));
  const etat = {
    arret: { t: 'Arrêté', c: 'var(--text-muted)' }, connexion: { t: 'Connexion…', c: 'var(--text-secondary)' },
    lecture: { t: 'Lecture en cours', c: 'var(--accent-primary)' }, pause: { t: 'En pause', c: 'var(--accent-warning)' },
    fini: { t: 'Lecture terminée', c: 'var(--text-secondary)' },
  }[state];
  return (
    <div className="space-y-6">
      {header}
      <div className="vc-fiche p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <label className="text-[13px] font-semibold flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>Données rejouées
            <select value={role} onChange={e => setRole(e.target.value)} disabled={state === 'lecture'} className="vc-select font-normal">
              {(['test', 'val', 'train'] as const).map(r => <option key={r} value={r}>{ROLE_FR[r]} ({nf(info.roles[r]?.lignes)} mesures évaluées)</option>)}
            </select>
          </label>
          <label className="text-[13px] font-semibold flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>Vitesse de lecture
            <span className="flex items-center gap-2 h-[34px] font-normal">
              <input type="range" min={6} max={180} step={6} value={vitesse} aria-label="Vitesse de lecture"
                onChange={e => { const v = Number(e.target.value); setSpeed(v); send({ action: 'vitesse', vitesse: v }); }}
                style={{ accentColor: 'var(--accent-primary)' }} />
              <span className="tabular-nums text-[13px] w-36" style={{ color: 'var(--text-primary)' }}>{vitesse} mesures/s (×{nf(vitesse * 5)})</span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {(state === 'arret' || state === 'fini') && <button onClick={start} className="vc-btn vc-btn-primary"><Play className="w-4 h-4" />Démarrer</button>}
            {state === 'lecture' && <button onClick={() => { send({ action: 'pause' }); setState('pause'); }} className="vc-btn"><Pause className="w-4 h-4" />Pause</button>}
            {state === 'pause' && <button onClick={() => { send({ action: 'reprendre' }); setState('lecture'); }} className="vc-btn"><Play className="w-4 h-4" />Reprendre</button>}
            {(state === 'lecture' || state === 'pause') && <button onClick={() => { send({ action: 'stop' }); ws.current?.close(); setState('arret'); }} className="vc-btn vc-btn-danger"><Square className="w-4 h-4" />Arrêter</button>}
          </div>
        </div>
        <div className="mt-4 pt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]" style={{ borderTop: '1px dashed var(--border)', color: 'var(--text-secondary)' }}>
          <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: etat.c }} aria-live="polite">
            <span className={`w-2.5 h-2.5 rounded-full ${state === 'lecture' ? 'animate-pulse-dot' : ''}`} style={{ background: etat.c }} />{etat.t}
          </span>
          <span>Modèle <strong style={{ color: 'var(--text-primary)' }}>{MODEL_FR[info.modele] ?? info.nom}</strong></span>
          <span>Alerte si au moins <strong style={{ color: 'var(--text-primary)' }}>{info.k} mesures sur {info.n}</strong> ont un score ≥ <strong style={{ color: 'var(--text-primary)' }}>{nf(info.seuil, 3)}</strong></span>
          <span className="flex items-center gap-2 min-w-[180px] flex-1 sm:flex-none sm:w-56">
            <span className="flex-1 vc-meter"><span style={{ width: `${progress * 100}%`, background: 'var(--accent-primary)' }} /></span>
            <span className="tabular-nums">{nf(progress * 100, 0)}&#8239;%</span>
          </span>
          {wsError && <State kind="manque">{wsError}</State>}
        </div>
      </div>

      <Readouts cols={5}>
        <Stat label="Mesures analysées" value={nf(stats?.mesures ?? 0)} sub={last ? new Date(last.ts).toLocaleString('fr-FR') : 'en attente du flux'} />
        <Stat label="Score actuel" value={last ? nf(last.score, 3) : '—'} alarm={!!last?.alarme}
          sub={last ? (last.alarme ? 'Alerte en cours' : last.signal ? 'Au-dessus du seuil, pas encore persistant' : 'Sous le seuil') : '—'} />
        <Stat label="Alertes levées" value={nf(stats?.alertes ?? 0)} tone="var(--alarm-amber-fill)" />
        <Stat label="Alertes justes (terminées)" value={nf(stats?.vraies ?? 0)} tone="var(--accent-primary)" />
        <Stat label="Fausses alertes" value={nf(stats?.fausses ?? 0)} tone="var(--accent-danger)" />
      </Readouts>

      <div className="grid xl:grid-cols-3 gap-6">
        <Section title="Flux des capteurs" subtitle="Dernière heure rejouée : température transmise par le frigo et score du modèle." className="xl:col-span-2" source={info.sources.mesures}>
          {points.length ? (
            <>
              <BandLegend items={[
                { label: 'Frigo, valeur transmise', color: pal.series[0], kind: 'line' },
                { label: 'Attaque réelle (piste du haut)', color: pal.attackLine },
                { label: 'Alerte du modèle (piste du dessous)', color: pal.alert },
              ]} />
              <Paper height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                    <XAxis dataKey="ts" tickFormatter={heure} minTickGap={48} tick={{ fill: pal.axis, fontSize: 12 }} />
                    <YAxis domain={[0, 20]} ticks={[0, 4, 8, 12, 16, 17.7, 19.3]} interval={0} width={64} tickFormatter={(v: number) => (v > 19 ? 'attaque' : v > 17 ? 'alerte' : `${v} °C`)} tick={{ fill: pal.axis, fontSize: 12 }} />
                    <Tooltip {...tooltipStyle} labelFormatter={v => new Date(String(v)).toLocaleString('fr-FR')} formatter={(v, n) => (n === 'Attaque réelle' || n === 'Alerte' ? ['oui', n] : [`${nf(Number(v), 2)} °C`, n])} />
                    <Area dataKey="reel" name="Attaque réelle" fill={pal.attackLine} fillOpacity={1} stroke="none" isAnimationActive={false} />
                    <Area dataKey="alerte" name="Alerte" fill={pal.alert} fillOpacity={1} stroke="none" isAnimationActive={false} />
                    <Line dataKey="fridge" name="Frigo" stroke={pal.series[0]} dot={false} strokeWidth={1.4} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Paper>
              <div className="mt-3 mb-1"><BandLegend items={[
                { label: 'Score du modèle', color: pal.ink, kind: 'line' },
                { label: `Seuil ${nf(info.seuil, 2)}`, color: pal.alert, kind: 'dash' },
              ]} /></div>
              <Paper height={150}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                    <XAxis dataKey="ts" tickFormatter={heure} minTickGap={48} tick={{ fill: pal.axis, fontSize: 12 }} />
                    <YAxis domain={[0, 1]} width={64} tick={{ fill: pal.axis, fontSize: 12 }} />
                    <Tooltip {...tooltipStyle} labelFormatter={v => new Date(String(v)).toLocaleString('fr-FR')} formatter={v => [nf(Number(v), 3), 'score']} />
                    <Line dataKey="score" name="Score du modèle" stroke={pal.ink} dot={false} strokeWidth={1.2} isAnimationActive={false} />
                    <ReferenceLine y={info.seuil} stroke={pal.alert} strokeWidth={1.5} strokeDasharray="5 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </Paper>
            </>
          ) : <Empty>Choisissez les données puis cliquez sur « Démarrer » : le modèle analyse les mesures au fil de l’eau.</Empty>}
        </Section>
        <Section title="Journal des alertes" subtitle="Début et fin de chaque alerte, comparée à la réalité.">
          {events.length ? (
            <ol className="max-h-[440px] overflow-y-auto -my-1">
              {events.map((e, i) => (
                <li key={i} className="text-[13px] py-2 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  {e.type === 'debut' ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <State kind="alerte">Alerte levée</State>
                        <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{e.ts && new Date(e.ts).toLocaleTimeString('fr-FR')}</span>
                      </div>
                      <div className="mt-0.5" style={{ color: 'var(--text-muted)' }}>Réalité : {SCENARIO_FR[e.attaque_reelle ?? 'normal'] ?? e.attaque_reelle} ; score {nf(e.score, 3)}</div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      {e.vraie ? <State kind="ok">Fin, alerte juste</State> : <State kind="manque">Fin, fausse alerte</State>}
                      <span style={{ color: 'var(--text-muted)' }}>durée {nf(e.duree_min, 1)}&#160;min</span>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : <Empty>Aucune alerte pour l’instant.</Empty>}
        </Section>
      </div>
      <Note>Les variables (moyennes, écarts-types, quantiles sur 1 à 15 min) ne regardent que le passé ; le score de chaque mesure est calculé
        en direct par le modèle sauvegardé. « Réalité » désigne l’étiquette du jeu de données, que le modèle ne voit pas.</Note>
    </div>
  );
}
