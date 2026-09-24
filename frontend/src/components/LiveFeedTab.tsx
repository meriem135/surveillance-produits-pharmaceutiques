import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radio, Play, Square, Activity, AlertTriangle, Cpu, Zap, Clock,
  Thermometer, Snowflake, CloudSun, ShieldCheck, Bug, Wifi, WifiOff,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { useLiveStream } from '../hooks/useLiveStream';
import { authHeaders } from '../lib/auth';

const API = '/api';

function riskStyle(score: number) {
  if (score >= 75) return { label: 'CRITIQUE', color: '#EF4444' };
  if (score >= 50) return { label: 'ÉLEVÉ', color: '#F97316' };
  if (score >= 25) return { label: 'MOYEN', color: '#F59E0B' };
  return { label: 'FAIBLE', color: '#22C55E' };
}

function formatTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour12: false });
}

function SectionTitle({ children, color = 'var(--accent-primary)' }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-4 rounded-full" style={{ background: color }} />
      <h2 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>{children}</h2>
    </div>
  );
}

function KpiChip({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4 relative overflow-hidden group" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `linear-gradient(135deg, ${color}08 0%, transparent 50%)` }} />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15`, color }}>
            {icon}
          </div>
        </div>
        <div className="font-display text-xl font-black tracking-tight" style={{ color }}>{value}</div>
        <div className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      </div>
    </div>
  );
}

interface LiveItem {
  id: string;
  time: string;
  season: string;
  score: number;
  label: string;
  color: string;
  attack?: string;
}

export default function LiveFeedTab() {
  const { connected, paused, point, alerts, stats, history, counters } = useLiveStream();
  const [simActive, setSimActive] = useState<boolean>(true);

  useEffect(() => {
    fetch(`${API}/simulation/status`)
      .then(r => r.json())
      .then(j => setSimActive(!!j.simulation_active))
      .catch(() => {});
  }, []);

  const toggleSimulation = async () => {
    try {
      const r = await fetch(`${API}/simulation/toggle`, { method: 'POST', headers: authHeaders() });
      const j = await r.json();
      setSimActive(!!j.simulation_active);
    } catch { /* module requis seulement */ }
  };

  const feed: LiveItem[] = useMemo(() =>
    history.map((p, i) => ({
      id: p.timestamp ?? `idx-${i}`,
      time: formatTime(p.timestamp),
      season: p.season || '—',
      score: p.risk_score || 0,
      label: p.risk_label || riskStyle(p.risk_score || 0).label,
      color: riskStyle(p.risk_score || 0).color,
      attack: p.attack_info?.type,
    })).slice(-22),
  [history]);

  const chartData = useMemo(() =>
    history.map((p, i) => ({ i, score: p.risk_score || 0, normal: p.normality_score || null })),
  [history]);

  const latencyMs = stats?.avg_latency_us != null ? (stats.avg_latency_us / 1000).toFixed(2) : '—';
  const throughput = stats?.messages_per_second != null ? stats.messages_per_second.toFixed(1) : '—';

  const currentAttack = point && (point.is_anomaly || point.attack_active);
  const currentRisk = currentAttack ? riskStyle(point.risk_score || 0) : null;

  return (
    <div className="space-y-5">
      {/* Status + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-mono"
          style={{
            border: `1px solid ${connected ? (paused ? 'rgba(245,158,11,0.35)' : 'rgba(34,197,94,0.35)') : 'rgba(239,68,68,0.35)'}`,
            color: connected ? (paused ? '#F59E0B' : '#22C55E') : '#EF4444',
            background: 'var(--bg-card)',
          }}>
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          {connected ? (paused ? 'Simulation en pause' : 'Flux connecté') : 'Hors ligne'}
        </div>
        <button onClick={toggleSimulation}
          className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-2 rounded-xl cursor-pointer transition-all"
          style={{
            background: simActive ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
            border: `1px solid ${simActive ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)'}`,
            color: simActive ? '#EF4444' : '#22C55E',
          }}>
          {simActive ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {simActive ? 'Arrêter la simulation' : 'Démarrer la simulation'}
        </button>
      </div>

      {/* Live KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiChip label="Messages reçus" value={counters.total.toLocaleString()} color="#00E5FF" icon={<Radio className="w-4 h-4" />} />
        <KpiChip label="Attaques détectées" value={counters.attacks.toLocaleString()} color="#EF4444" icon={<Bug className="w-4 h-4" />} />
        <KpiChip label="Alertes DPI" value={alerts.length.toLocaleString()} color="#F59E0B" icon={<AlertTriangle className="w-4 h-4" />} />
        <KpiChip label="Débit" value={throughput} color="#22C55E" icon={<Zap className="w-4 h-4" />} />
        <KpiChip label="Latence" value={`${latencyMs}ms`} color="#A855F7" icon={<Clock className="w-4 h-4" />} />
        <KpiChip label="Dernier point" value={point?.season || '—'} color="#818cf8" icon={<Activity className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live console */}
        <div className="lg:col-span-2 rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <SectionTitle color="#00E5FF">Flux temps réel — console capteurs</SectionTitle>
          <div className="h-[380px] overflow-hidden rounded-xl p-2 font-mono"
            style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)' }}>
            <div className="h-full overflow-y-auto pr-1 space-y-1">
              {feed.length === 0 && (
                <div className="flex items-center justify-center h-full text-xs gap-2" style={{ color: 'var(--text-secondary)' }}>
                  <Wifi className="w-4 h-4" />
                  En attente du flux...
                </div>
              )}
              <AnimatePresence initial={false}>
                {feed.map((item, idx) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: item.score >= 50 ? -12 : 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[11px]"
                    style={{
                      background: item.score >= 50 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.03)',
                      border: `1px solid ${item.score >= 50 ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.04)'}`,
                    }}
                  >
                    <span style={{ color: 'var(--text-muted, var(--text-secondary))' }}>{item.time}</span>
                    <span className="px-1 py-0.5 rounded text-[9px] font-bold" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
                      {item.season}
                    </span>
                    <span style={{ color: 'var(--accent-primary)' }}>multi-sensor</span>
                    <span style={{ color: item.color }}>
                      {item.attack ? `⚠ ${item.attack}` : '●'}
                    </span>
                    <div className="flex-1" />
                    <span className="font-bold" style={{ color: item.color }}>{item.score}%</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: `${item.color}15`, color: item.color, border: `1px solid ${item.color}30` }}>
                      {item.label}
                    </span>
                    {idx === feed.length - 1 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" style={{ color: item.color }} />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* DPI alerts */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <SectionTitle color="#EF4444">Alertes DPI en direct</SectionTitle>
          <div className="space-y-2 h-[380px] overflow-y-auto pr-1">
            {alerts.length === 0 && (
              <div className="flex items-center gap-2 py-8 justify-center" style={{ color: 'var(--text-secondary)' }}>
                <ShieldCheck className="w-4 h-4" />
                <span className="text-xs">Aucune alerte — flux normal</span>
              </div>
            )}
            {alerts.slice(0, 12).map((a, i) => (
              <motion.div
                key={`${a.timestamp}-${i}`}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="px-3 py-2.5 rounded-lg"
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold font-mono" style={{ color: '#EF4444' }}>{a.rule_id}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                    LVL {a.severity}
                  </span>
                </div>
                <div className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>{a.rule_name}</div>
                {a.attack_explanation && (
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{a.attack_explanation}</div>
                )}
                <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                  <span>risque {a.risk_score}%</span>
                  <span>·</span>
                  <span>{formatTime(a.timestamp)}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live risk chart */}
        <div className="lg:col-span-2 rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <SectionTitle color="#F59E0B">Évolution du risque en direct</SectionTitle>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="i" tick={false} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]?.payload as { score?: number } | undefined;
                    const rs = p?.score ?? 0;
                    const c = rs >= 50 ? '#EF4444' : rs >= 25 ? '#F97316' : '#22C55E';
                    return (
                      <div className="rounded-xl p-2 shadow-2xl text-[11px] font-mono"
                        style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                        Risque : <span style={{ color: c }}>{rs}%</span>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={50} stroke="rgba(239,68,68,0.35)" strokeDasharray="4 4" />
                <Area type="stepAfter" dataKey="score" name="Risque" stroke="#F59E0B" strokeWidth={2} fill="url(#riskGrad)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Current point detail */}
        <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-[0.07]"
            style={{ background: currentAttack ? '#EF4444' : '#22C55E' }} />
          <SectionTitle color={currentAttack ? '#EF4444' : '#22C55E'}>
            {currentAttack ? 'Attaque en cours' : 'État courant'}
          </SectionTitle>
          {point ? (
            <div className="space-y-3 relative z-10">
              {currentRisk && (
                <div className="px-3 py-2 rounded-xl text-center"
                  style={{ background: `${currentRisk.color}15`, border: `1px solid ${currentRisk.color}30` }}>
                  <div className="text-2xl font-black font-display" style={{ color: currentRisk.color }}>
                    {point.risk_score}
                    <span className="text-xs font-mono ml-1">/ 100</span>
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: currentRisk.color }}>
                    {currentRisk.label}
                  </div>
                </div>
              )}
              {point.attack_info?.explanation && (
                <div className="text-[11px] px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--text-primary)' }}>
                  {point.attack_info.explanation}
                </div>
              )}
              <div className="text-[10px] font-mono text-right" style={{ color: 'var(--text-secondary)' }}>
                {formatTime(point.timestamp)} · {point.season}
              </div>
              {[
                { label: 'Weather', icon: CloudSun, color: '#38BDF8', value: point.weather_temperature },
                { label: 'Fridge', icon: Snowflake, color: '#00E676', value: point.fridge_temperature },
                { label: 'Thermostat', icon: Thermometer, color: '#FF9100', value: point.thermostat_temperature },
              ].map(s => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                    style={{ background: `${s.color}0a`, border: `1px solid ${s.color}22` }}>
                    <Icon className="w-4 h-4" style={{ color: s.color }} />
                    <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{s.label}</span>
                    <span className="font-mono font-bold" style={{ color: s.color }}>
                      {s.value != null ? `${s.value.toFixed(1)}°C` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-10 justify-center" style={{ color: 'var(--text-secondary)' }}>
              {connected ? <WifiOff className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
              <span className="text-xs">Aucun point reçu</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}