import { useTelemetry } from '../hooks/useTelemetry';
import { useState, useCallback, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { clsx } from 'clsx';
import {
  Activity, Shield, AlertTriangle, Brain, Cpu, Radio, Crosshair,
  Thermometer, Lock, TrendingUp, TrendingDown,
  RefreshCw, Zap, Server, Map, Eye, Bell, CheckCircle2, ChevronRight,
  Layers,
} from 'lucide-react';
import type { AttackType, Telemetry } from '../types';
import RiskPanel from '../components/RiskPanel';
import { useRiskData } from '../hooks/useRiskData';
import LlmAnalysisPanel from '../components/LlmAnalysisPanel';


const ATTACK_PROFILES: Record<AttackType, { label: string; desc: string; color: string; taux_detection: number; normality_target: number; pattern: string }> = {
  recon:  { label: 'Scanning', desc: 'Reconnaissance réseau', color: 'oklch(0.75 0.18 60)', taux_detection: 74.2, normality_target: 38, pattern: 'noise' },
  mitm:   { label: 'MITM', desc: 'Falsification capteurs', color: 'oklch(0.78 0.17 75)', taux_detection: 100.0, normality_target: 15, pattern: 'offset' },
  ddos:   { label: 'DDoS', desc: 'Saturation réseau', color: 'oklch(0.66 0.22 20)', taux_detection: 100.0, normality_target: 8, pattern: 'burst' },
  ransom: { label: 'Ransomware', desc: 'Sabotage automates', color: 'oklch(0.58 0.24 15)', taux_detection: 97.5, normality_target: 2, pattern: 'spike' },
};

function simulateAttack(data: Telemetry[], type: AttackType): Telemetry[] {
  const profile = ATTACK_PROFILES[type];
  const count = data.length;
  const attackWindow = 60;
  const startIdx = Math.max(0, count - attackWindow);
  const modelDetects = Math.random() * 100 < profile.taux_detection;
  return data.map((item, idx) => {
    if (idx < startIdx) return item;
    const progress = (idx - startIdx) / attackWindow;
    const severity = Math.min(1, progress * 1.8);
    const sensorValues = { ...item.metric_value.sensors };
    const baseScore = 98 - (98 - profile.normality_target) * severity;
    const noise = (Math.random() - 0.5) * 8 * severity;
    const normality = parseFloat(Math.max(0.5, Math.min(100, baseScore + noise)).toFixed(1));
    const isAnomaly = modelDetects ? normality < 50 : normality >= 50;
    if (profile.pattern === 'noise') {
      sensorValues.weather_temperature = parseFloat((sensorValues.weather_temperature + (Math.random() - 0.5) * 6 * severity).toFixed(1));
      sensorValues.fridge_temperature = parseFloat((sensorValues.fridge_temperature + (Math.random() - 0.5) * 3 * severity).toFixed(1));
    } else if (profile.pattern === 'offset') {
      sensorValues.weather_temperature = parseFloat((sensorValues.weather_temperature + 8 * severity).toFixed(1));
      sensorValues.fridge_temperature = parseFloat((sensorValues.fridge_temperature * (1 + 1.2 * severity)).toFixed(1));
      sensorValues.thermostat_temperature = parseFloat((sensorValues.thermostat_temperature * (1 + severity)).toFixed(1));
    } else if (profile.pattern === 'burst') {
      const burst = Math.random() < 0.3 ? (Math.random() - 0.5) * 14 * severity : 0;
      sensorValues.weather_temperature = parseFloat((sensorValues.weather_temperature + burst).toFixed(1));
      sensorValues.thermostat_temperature = parseFloat((sensorValues.thermostat_temperature + burst * 0.7).toFixed(1));
      sensorValues.fridge_temperature = parseFloat((sensorValues.fridge_temperature + (Math.random() - 0.5) * 4 * severity).toFixed(1));
    } else if (profile.pattern === 'spike') {
      const spike = idx > startIdx + attackWindow - 15 ? 25 * severity : 0;
      sensorValues.fridge_temperature = parseFloat((sensorValues.fridge_temperature + spike + (Math.random() - 0.5) * 3).toFixed(1));
      sensorValues.weather_temperature = parseFloat((sensorValues.weather_temperature + spike * 0.3).toFixed(1));
    }
    return { ...item, metric_value: { ...item.metric_value, normality_score: normality, is_anomaly: isAnomaly, sensors: sensorValues } };
  });
}

const attacks: { type: AttackType; icon: React.ReactNode; label: string; desc: string; color: string; detection: number }[] = [
  { type: 'recon', icon: <Eye className="h-3.5 w-3.5" />, label: 'Scanning', desc: 'Reconnaissance', color: 'oklch(0.75 0.18 60)', detection: 74.2 },
  { type: 'mitm', icon: <Radio className="h-3.5 w-3.5" />, label: 'MITM', desc: 'Falsification', color: 'oklch(0.78 0.17 75)', detection: 100 },
  { type: 'ddos', icon: <Zap className="h-3.5 w-3.5" />, label: 'DDoS', desc: 'Saturation', color: 'oklch(0.66 0.22 20)', detection: 100 },
  { type: 'ransom', icon: <Lock className="h-3.5 w-3.5" />, label: 'Ransomware', desc: 'Sabotage', color: 'oklch(0.58 0.24 15)', detection: 97.5 },
];

const devices = [
  { id: 'dev-01', name: 'PLC-A12 Weather', ip: '192.168.1.10', protocol: 'MQTT', risk: 92, status: 'critical', type: 'PLC' },
  { id: 'dev-02', name: 'Fridge-07 Cold-chain', ip: '192.168.1.20', protocol: 'MQTT', risk: 78, status: 'warning', type: 'Capteur' },
  { id: 'dev-03', name: 'Gateway-RPi-03', ip: '192.168.1.3', protocol: 'MQTT', risk: 88, status: 'critical', type: 'Passerelle' },
  { id: 'dev-04', name: 'HMI-Panel-04', ip: '192.168.1.100', protocol: 'Modbus', risk: 45, status: 'online', type: 'IHM' },
  { id: 'dev-05', name: 'Camera-12 Perimeter', ip: '192.168.1.50', protocol: 'RTSP', risk: 34, status: 'online', type: 'Camera' },
  { id: 'dev-06', name: 'PLC-A09 Motor', ip: '192.168.1.11', protocol: 'Modbus', risk: 55, status: 'warning', type: 'PLC' },
];

const severityPie = [
  { name: 'Critical', value: 12, color: 'oklch(0.66 0.22 20)' },
  { name: 'Élevé', value: 31, color: 'oklch(0.75 0.18 60)' },
  { name: 'Moyen', value: 58, color: 'oklch(0.78 0.17 75)' },
  { name: 'Faible', value: 94, color: 'oklch(0.78 0.13 165)' },
];

function getStatusColor(status: string) {
  switch (status) {
    case 'critical': return 'oklch(0.66 0.22 20)';
    case 'warning': return 'oklch(0.78 0.17 75)';
    case 'online': return 'oklch(0.78 0.13 165)';
    default: return 'oklch(0.65 0.02 230)';
  }
}

function getRiskColor(score: number) {
  if (score >= 70) return 'oklch(0.66 0.22 20)';
  if (score >= 40) return 'oklch(0.78 0.17 75)';
  return 'oklch(0.78 0.13 165)';
}

const sectionAnim = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

export default function DashboardPage() {
  const { data: rawData, loading } = useTelemetry();
  const [activeAttack, setActiveAttack] = useState<AttackType | null>(null);
  const originalRef = useRef<Telemetry[] | null>(null);

  if (!originalRef.current && rawData.length > 0) originalRef.current = rawData;
  const displayData = (activeAttack && originalRef.current) ? simulateAttack(originalRef.current, activeAttack) : rawData;
  const latest = displayData.length > 0 ? displayData[displayData.length - 1] : null;
  const normality = latest?.metric_value.normality_score ?? 97.6;
  const isAnomaly = normality < 50;

  const handleAttack = useCallback((type: AttackType) => {
    if (activeAttack === type) { setActiveAttack(null); return; }
    if (!originalRef.current && rawData.length > 0) originalRef.current = rawData;
    setActiveAttack(type);
  }, [activeAttack, rawData]);

  const timelineData = useMemo(() => displayData.map((d) => ({
    time: d.timestamp.split(' ')[1]?.slice(0, 5) ?? d.timestamp,
    score: d.metric_value.normality_score,
    anomaly: d.metric_value.is_anomaly ? d.metric_value.normality_score : null,
  })), [displayData]);

  const anomalyCount = displayData.filter((d) => d.metric_value.is_anomaly).length;
  const riskData = useRiskData();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="text-center space-y-4">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            className="w-12 h-12 rounded-full border-2 mx-auto"
            style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--accent-primary)' }}
          />
          <div className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Initialisation du tableau de bord</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Connexion au flux de télémétrie...</div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* ===== GLOBAL STATS BAR ===== */}
      <motion.div custom={0} variants={sectionAnim} className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { icon: <Shield className="h-4 w-4" />, label: 'État système', value: activeAttack ? 'ALERTE' : 'SÉCURISÉ', color: activeAttack ? 'var(--accent-danger)' : 'var(--accent-success)', pulse: activeAttack },
          { icon: <Brain className="h-4 w-4" />, label: 'Score normalité', value: `${normality.toFixed(1)}%`, color: isAnomaly ? 'var(--accent-danger)' : 'var(--accent-primary)', delta: activeAttack ? -4.2 : 0.3 },
          { icon: <Activity className="h-4 w-4" />, label: 'Msg / s', value: '4 812', color: 'var(--accent-primary)', delta: 312 },
          { icon: <AlertTriangle className="h-4 w-4" />, label: 'Anomalies', value: anomalyCount.toString(), color: anomalyCount > 0 ? 'var(--accent-danger)' : 'var(--accent-success)', delta: anomalyCount },
          { icon: <Server className="h-4 w-4" />, label: 'Appareils suivis', value: '412', color: 'var(--accent-primary)', delta: 6 },
          { icon: <Crosshair className="h-4 w-4" />, label: 'Menaces actives', value: activeAttack ? '1' : '0', color: activeAttack ? 'var(--accent-danger)' : 'var(--accent-success)' },
        ].map((stat) => (
          <div key={stat.label}
            className="relative overflow-hidden rounded-xl border p-4 transition-all duration-300 hover:scale-[1.02]"
            style={{
              background: stat.pulse ? 'color-mix(in srgb, var(--accent-danger) 8%, var(--bg-panel))' : 'var(--bg-panel)',
              borderColor: stat.pulse ? 'color-mix(in srgb, var(--accent-danger) 30%, transparent)' : 'var(--border)',
            }}
          >
            {stat.pulse && (
              <motion.div className="absolute -inset-2 rounded-full" style={{ background: 'radial-gradient(circle, oklch(0.66 0.22 20 / 0.12), transparent 70%)' }}
                animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 2 }} />
            )}
            <div className="relative flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{stat.label}</span>
              <span style={{ color: stat.color }}>{stat.icon}</span>
            </div>
            <div className="relative flex items-baseline gap-2">
              <span className="font-display text-xl font-bold" style={{ color: stat.color }}>
                {stat.value}
              </span>
              {stat.delta !== undefined && (
                <span className={clsx(
                  'text-[10px] font-semibold flex items-center gap-0.5',
                  stat.delta > 0 ? '[color:var(--accent-success)]' : '[color:var(--accent-danger)]'
                )}>
                  {stat.delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(stat.delta)}
                </span>
              )}
            </div>
          </div>
        ))}
      </motion.div>

      {/* ===== SYSTEM TIMELINE + SEVERITY PIE ===== */}
      <motion.div custom={1} variants={sectionAnim} className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' }}>
                <Activity className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <div>
                <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Stabilité usine · temps réel</h3>
                <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Score de normalité comportementale</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: 'var(--accent-success)' }}>
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" /> live
              </span>
              <LlmAnalysisPanel
                activeAttack={activeAttack}
                normalityScore={normality}
                anomalyCount={anomalyCount}
              />
              <motion.button
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold border cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="h-3 w-3" /> Rafraîchir
              </motion.button>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="normGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.78 0.13 165)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="oklch(0.78 0.13 165)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="critGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.66 0.22 20)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="oklch(0.66 0.22 20)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="oklch(0.30 0.03 250 / 0.3)" strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={60} />
                <YAxis domain={[0, 100]} stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="score" stroke="oklch(0.78 0.13 165)" strokeWidth={2.5} fill="url(#normGrad)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="anomaly" stroke="oklch(0.66 0.22 20)" strokeWidth={2.5} fill="url(#critGrad)" dot={false} activeDot={{ r: 4, fill: 'oklch(0.66 0.22 20)' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Sévérité</h3>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>24h</span>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={severityPie} dataKey="value" innerRadius={42} outerRadius={68} paddingAngle={3} stroke="none">
                  {severityPie.map((s) => <Cell key={s.name} fill={s.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            {severityPie.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-[10px]">
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span style={{ color: 'var(--text-secondary)' }}>{s.name}</span>
                <span className="ml-auto font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ===== INTELLIGENCE GRID: TWIN | ATTACK | XAI ===== */}
      <motion.div custom={2} variants={sectionAnim} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Twin Status */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' }}>
              <Cpu className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Jumeau Numérique</h3>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Isolation Forest · Behavioral Twin</div>
            </div>
          </div>
          <div className="flex items-center justify-around py-6">
            <div className="text-center">
              <motion.div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl mx-auto mb-2"
                style={{
                  background: 'var(--bg-card)',
                  border: '2px solid var(--accent-primary)',
                  boxShadow: '0 0 24px -8px var(--accent-primary)',
                }}
                animate={{ boxShadow: activeAttack
                  ? ['0 0 24px -8px oklch(0.66 0.22 20)', '0 0 40px -4px oklch(0.66 0.22 20)', '0 0 24px -8px oklch(0.66 0.22 20)']
                  : ['0 0 24px -8px var(--accent-primary)', '0 0 40px -4px var(--accent-primary)', '0 0 24px -8px var(--accent-primary)']
                }}
                transition={{ repeat: Infinity, duration: 2.5 }}
              >
                🏭
              </motion.div>
              <div className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Automate</div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <motion.div className="h-1 w-16 rounded-full" style={{ background: activeAttack
                ? 'linear-gradient(90deg, oklch(0.66 0.22 20), oklch(0.66 0.22 20))'
                : 'linear-gradient(90deg, var(--accent-primary), var(--accent-success))'
              }} />
              <motion.div className="h-1 w-12 rounded-full" style={{ background: activeAttack
                ? 'oklch(0.66 0.22 20 / 0.5)' : 'var(--accent-success)' }} />
              <span className="text-[8px] font-mono" style={{ color: 'var(--text-secondary)' }}>{activeAttack ? '⚠ ANOMALIE' : '✓ SYNC'}</span>
            </div>
            <div className="text-center">
              <motion.div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl mx-auto mb-2"
                style={{
                  background: activeAttack
                    ? 'color-mix(in srgb, oklch(0.66 0.22 20) 15%, var(--bg-card))'
                    : 'var(--bg-card)',
                  border: `2px solid ${activeAttack ? 'oklch(0.66 0.22 20)' : 'var(--accent-success)'}`,
                }}
              >
                {activeAttack ? '🔴' : '🤖'}
              </motion.div>
              <div className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>IA Guardian</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            {[
              { label: 'Modèles ML', value: '14', color: 'var(--accent-primary)' },
              { label: 'Twins actifs', value: '412', color: 'var(--accent-primary)' },
              { label: 'Dérives (24h)', value: '9', color: 'var(--accent-warning)' },
              { label: 'Score moyen', value: `${normality.toFixed(1)}%`, color: isAnomaly ? 'var(--accent-danger)' : 'var(--accent-success)' },
            ].map((s) => (
              <div key={s.label} className="text-center p-2 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                <div className="font-display text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[9px]" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Attack Simulator */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, oklch(0.66 0.22 20) 15%, transparent)' }}>
              <Zap className="h-4 w-4" style={{ color: 'oklch(0.66 0.22 20)' }} />
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Simulateur Cyber</h3>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Teste la réaction de l'IA</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {attacks.map((a) => (
              <motion.button
                key={a.type}
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => handleAttack(a.type)}
                className="flex flex-col gap-1 p-3 rounded-xl text-left text-xs border cursor-pointer transition-colors"
                style={{
                  background: activeAttack === a.type
                    ? 'color-mix(in srgb, oklch(0.66 0.22 20) 18%, transparent)'
                    : 'var(--bg-card)',
                  borderColor: activeAttack === a.type ? a.color : 'var(--border)',
                  boxShadow: activeAttack === a.type ? `0 0 20px -8px ${a.color}` : 'none',
                }}
              >
                <span className="flex items-center gap-1.5 font-semibold" style={{ color: activeAttack === a.type ? a.color : 'var(--text-primary)' }}>
                  {a.icon} {a.label}
                </span>
                <span className="flex items-center justify-between w-full">
                  <span style={{ color: 'var(--text-secondary)' }}>{a.desc}</span>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded" style={{
                    background: a.detection >= 100 ? 'color-mix(in srgb, #22C55E 15%, transparent)' : a.detection >= 90 ? 'color-mix(in srgb, #FBBF24 15%, transparent)' : 'color-mix(in srgb, #F97316 15%, transparent)',
                    color: a.detection >= 100 ? '#22C55E' : a.detection >= 90 ? '#FBBF24' : '#F97316',
                  }}>IF {a.detection}%</span>
                </span>
              </motion.button>
            ))}
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => setActiveAttack(null)}
            className="w-full py-2.5 rounded-xl text-xs font-bold border cursor-pointer transition-all"
            style={{
              background: activeAttack
                ? 'color-mix(in srgb, var(--accent-success) 10%, transparent)'
                : 'var(--bg-card)',
              borderColor: activeAttack ? 'var(--accent-success)' : 'var(--border)',
              color: activeAttack ? 'var(--accent-success)' : 'var(--text-secondary)',
            }}
          >
            {activeAttack ? '🛡️ Purifier le réseau' : '🛡️ Réseau sain'}
          </motion.button>
          {activeAttack && (() => {
            const profile = ATTACK_PROFILES[activeAttack];
            const detected = Math.random() * 100 < profile.taux_detection;
            return (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              className="mt-3 p-3 rounded-xl text-[11px] leading-relaxed border" style={{
                background: detected ? 'color-mix(in srgb, oklch(0.66 0.22 20) 8%, transparent)' : 'color-mix(in srgb, #F97316 8%, transparent)',
                borderColor: detected ? 'oklch(0.66 0.22 20 / 0.3)' : '#F9731640',
                color: detected ? 'oklch(0.75 0.18 60)' : '#F97316',
              }}
            >
              <strong className="block mb-1 text-xs">{detected ? '🚨 Attaque détectée' : '⚠️ Attaque non détectée'}</strong>
              {detected
                ? `Isolation Forest Multi-varié (F1=99.5%) a détecté l'attaque ${profile.label} (taux réel: ${profile.taux_detection}%). Contre-mesure : ${activeAttack === 'recon' ? 'Blocage IP' : activeAttack === 'mitm' ? 'Chiffrement TLS' : activeAttack === 'ddos' ? 'Rate limiting' : 'Isolement automate'}.`
                : `L'attaque ${profile.label} (taux réel: ${profile.taux_detection}%) n'a pas été détectée par le modèle. Cause possible : motif trop proche du comportement normal.`}
            </motion.div>
            );
          })()}
        </div>

        {/* XAI Panel */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent-purple) 15%, transparent)' }}>
              <Brain className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} />
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Analyse SHAP · XAI</h3>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Explicabilité IA en temps réel</div>
            </div>
          </div>
          <div className="flex items-center justify-center py-4">
            <div className="relative">
              <svg width="160" height="90" viewBox="0 0 160 90">
                <defs>
                  <linearGradient id="gaugeBg" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="oklch(0.66 0.22 20 / 0.3)" />
                    <stop offset="50%" stopColor="oklch(0.78 0.17 75 / 0.3)" />
                    <stop offset="100%" stopColor="oklch(0.78 0.13 165 / 0.3)" />
                  </linearGradient>
                </defs>
                <path d="M 15 80 A 65 65 0 0 1 145 80" fill="none" stroke="url(#gaugeBg)" strokeWidth="12" strokeLinecap="round" />
                <motion.path
                  d="M 15 80 A 65 65 0 0 1 145 80"
                  fill="none"
                  stroke={isAnomaly ? 'oklch(0.66 0.22 20)' : 'oklch(0.78 0.13 165)'}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${(normality / 100) * 204} 204`}
                  initial={{ strokeDasharray: '0 204' }}
                  animate={{ strokeDasharray: `${(normality / 100) * 204} 204` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
                <text x="80" y="60" textAnchor="middle" fill={isAnomaly ? 'oklch(0.66 0.22 20)' : 'var(--text-primary)'} fontSize="22" fontWeight="bold" fontFamily="monospace">
                  {normality.toFixed(1)}%
                </text>
                <text x="80" y="76" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" opacity="0.7">
                  {isAnomaly ? '⚠ ANOMALIE' : '✓ FONCTIONNEMENT NOMINAL'}
                </text>
              </svg>
            </div>
          </div>
          <div className="space-y-2 mt-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            {(() => {
              const shapValues = !activeAttack
                ? [{ feature: 'Weather température', impact: 0.18 }, { feature: 'Fridge température', impact: 0.12 }, { feature: 'Thermostat température', impact: 0.09 }]
                : activeAttack === 'recon'
                ? [{ feature: 'Weather température', impact: -0.21 }, { feature: 'Fridge température', impact: -0.08 }, { feature: 'Thermostat température', impact: -0.05 }]
                : activeAttack === 'mitm'
                ? [{ feature: 'Fridge température', impact: -0.54 }, { feature: 'Thermostat température', impact: -0.38 }, { feature: 'Weather température', impact: -0.12 }]
                : activeAttack === 'ddos'
                ? [{ feature: 'Weather température', impact: -0.47 }, { feature: 'Thermostat température', impact: -0.35 }, { feature: 'Fridge température', impact: -0.18 }]
                : [{ feature: 'Fridge température', impact: -0.72 }, { feature: 'Weather température', impact: -0.31 }, { feature: 'Thermostat température', impact: -0.09 }];
              const isAttackActive = activeAttack !== null;
              return shapValues.map((f, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg text-xs" style={{ background: 'var(--bg-card)' }}>
                  <div className="flex items-center gap-2">
                    <span className={clsx('w-1.5 h-1.5 rounded-full', (isAttackActive || f.impact < 0) ? 'bg-[oklch(0.66_0.22_20)]' : 'bg-[oklch(0.78_0.13_165)]')} />
                    <span style={{ color: 'var(--text-primary)' }}>{f.feature}</span>
                  </div>
                  <span className="font-mono font-semibold" style={{ color: (isAttackActive || f.impact < 0) ? 'oklch(0.66 0.22 20)' : 'oklch(0.78 0.13 165)' }}>
                    {f.impact > 0 ? '+' : ''}{f.impact.toFixed(3)}
                  </span>
                </div>
              ));
            })()}
          </div>
          <div className="mt-3 p-3 rounded-xl text-[11px] border" style={{
            background: isAnomaly ? 'color-mix(in srgb, oklch(0.66 0.22 20) 6%, transparent)' : 'color-mix(in srgb, var(--accent-success) 5%, transparent)',
            borderColor: isAnomaly ? 'oklch(0.66 0.22 20 / 0.2)' : 'color-mix(in srgb, var(--accent-success) 20%, transparent)',
            color: isAnomaly ? 'oklch(0.75 0.18 60)' : 'var(--accent-success)',
          }}>
            <span className="font-semibold">
              {isAnomaly
                ? '🧠 Anomalie comportementale détectée par Isolation Forest'
                : '🧠 Comportement nominal — aucun écart significatif détecté'
              }
            </span>
          </div>
        </div>
      </motion.div>

      {/* ===== ML PHASE 2 LIVE ===== */}
      <motion.div custom={2.5} variants={sectionAnim}>
        <div className="rounded-xl border p-4" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, #96CEB4 15%, transparent)' }}>
              <Layers className="h-4 w-4" style={{ color: '#96CEB4' }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Phase 2 · Isolation Forest Multi-varié</h3>
                <span className="flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full" style={{
                  background: 'color-mix(in srgb, #22C55E 12%, transparent)',
                  color: '#22C55E',
                  border: '1px solid color-mix(in srgb, #22C55E 25%, transparent)',
                }}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" /> F1: 99.5%
                </span>
              </div>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Meilleur modèle · Détection temps réel</div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <motion.a href="#/dashboard/phase2"
                className="text-[10px] font-semibold flex items-center gap-1 cursor-pointer hover:underline"
                style={{ color: 'var(--accent-primary)' }}
              >
                Détails Phase 2 <ChevronRight className="h-3 w-3" />
              </motion.a>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {[
              { label: 'F1 Score', value: '0.995', colour: '#96CEB4', sub: 'Best model' },
              { label: 'Rappel', value: '100%', colour: '#22C55E', sub: '8/9 attaques' },
              { label: 'Précision', value: '99.1%', colour: '#00F5FF', sub: 'Multi-varié' },
              { label: 'ROC-AUC', value: '84.0%', colour: '#A78BFA', sub: 'Comparatif' },
              { label: 'Taux FP', value: '33.4%', colour: activeAttack ? '#F97316' : '#96CEB4', sub: 'Rapporté au normal' },
              { label: 'Détection', value: activeAttack ? '⚠️ Attaque' : '✓ Sain', colour: activeAttack ? 'var(--accent-danger)' : 'var(--accent-success)', sub: activeAttack ? `${ATTACK_PROFILES[activeAttack]?.label || ''} actif` : 'Aucune menace' },
            ].map((s) => (
              <div key={s.label} className="p-3 rounded-lg text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="font-display font-bold text-lg" style={{ color: s.colour }}>{s.value}</div>
                <div className="text-[9px] font-semibold mt-0.5" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
                <div className="text-[8px]" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ===== DEVICES AT RISK + ALERT BAND ===== */}
      <motion.div custom={3} variants={sectionAnim} className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, oklch(0.66 0.22 20) 12%, transparent)' }}>
                <Server className="h-4 w-4" style={{ color: 'oklch(0.66 0.22 20)' }} />
              </div>
              <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Appareils à risque</h3>
            </div>
            <motion.a href="#/devices"
              className="flex items-center gap-1 text-[10px] font-semibold cursor-pointer hover:underline"
              style={{ color: 'var(--accent-primary)' }}
            >
              Voir tout <ChevronRight className="h-3 w-3" />
            </motion.a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {devices.map((d, i) => {
              const statusColor = getStatusColor(d.status);
              return (
                <motion.div key={d.id}
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between p-3 rounded-xl border text-xs transition-all hover:brightness-110 cursor-pointer"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: statusColor }} />
                    <div className="min-w-0">
                      <div className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{d.name}</div>
                      <div className="text-[9px] font-mono" style={{ color: 'var(--text-secondary)' }}>{d.ip} · {d.protocol}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono font-bold" style={{ color: getRiskColor(d.risk) }}>{d.risk}%</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ background: `color-mix(in srgb, ${statusColor} 15%, transparent)`, color: statusColor }}>
                      {d.status}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Bell className="h-4 w-4" style={{ color: 'var(--accent-warning)' }} />
            <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Alertes récentes</h3>
            <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--accent-warning)' }}>{anomalyCount} anomalies</span>
          </div>
          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
            {displayData.slice(-8).reverse().map((row, i) => {
              const val = row.metric_value;
              const isBad = val.is_anomaly;
              return (
                <motion.div key={i}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                  className="flex items-center justify-between p-2.5 rounded-lg text-[11px] transition-all"
                  style={{
                    background: isBad ? 'color-mix(in srgb, oklch(0.66 0.22 20) 8%, transparent)' : 'var(--bg-card)',
                    borderLeft: `3px solid ${isBad ? 'oklch(0.66 0.22 20)' : 'oklch(0.78 0.13 165)'}`,
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={clsx('h-1.5 w-1.5 rounded-full shrink-0', isBad && 'animate-pulse')}
                      style={{ background: isBad ? 'oklch(0.66 0.22 20)' : 'oklch(0.78 0.13 165)' }}
                    />
                    <span className="truncate font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {row.timestamp.split(' ')[1]?.slice(0, 5)}
                    </span>
                    <span className="truncate" style={{ color: 'var(--text-primary)' }}>
                      {isBad ? 'Anomalie' : 'Conforme'}
                    </span>
                  </div>
                  <span className={clsx('font-mono font-semibold shrink-0 ml-2', isBad ? 'text-[oklch(0.66_0.22_20)]' : 'text-[oklch(0.78_0.13_165)]')}>
                    {val.normality_score.toFixed(1)}%
                  </span>
                </motion.div>
              );
            })}
          </div>
          <motion.a href="#/alerts"
            className="flex items-center justify-center gap-1.5 mt-3 pt-3 text-xs font-semibold border-t cursor-pointer hover:underline"
            style={{ color: 'var(--accent-primary)', borderColor: 'var(--border)' }}
          >
            Voir toutes les alertes <ChevronRight className="h-3 w-3" />
          </motion.a>
        </div>
      </motion.div>

      {/* ===== SENSORS TEMPERATURES + THREAT BAR ===== */}
      <motion.div custom={4} variants={sectionAnim} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' }}>
              <Thermometer className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Températures capteurs · Temps réel</h3>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Weather · Fridge · Thermostat</div>
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={displayData.map((d) => ({
                time: d.timestamp.split(' ')[1]?.slice(0, 5) ?? '',
                Weather: d.metric_value.sensors.weather_temperature,
                Fridge: d.metric_value.sensors.fridge_temperature,
                Thermostat: d.metric_value.sensors.thermostat_temperature,
              }))} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="oklch(0.30 0.03 250 / 0.3)" strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="Weather" stroke="#38BDF8" strokeWidth={2} dot={false} name="Weather" />
                <Line type="monotone" dataKey="Fridge" stroke="#00E676" strokeWidth={2} dot={false} name="Fridge" />
                <Line type="monotone" dataKey="Thermostat" stroke="#FF9100" strokeWidth={2} dot={false} name="Thermostat" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, oklch(0.66 0.22 20) 12%, transparent)' }}>
              <Map className="h-4 w-4" style={{ color: 'oklch(0.66 0.22 20)' }} />
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Menaces par vecteur</h3>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Dernières 24h</div>
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { name: 'MQTT DPI', value: 142, color: 'var(--accent-primary)' },
                { name: 'CVE Exploit', value: 89, color: 'oklch(0.66 0.22 20)' },
                { name: 'Comportemental', value: 67, color: 'oklch(0.78 0.17 75)' },
                { name: 'Réseau', value: 45, color: 'var(--accent-purple)' },
                { name: 'Firmware', value: 31, color: 'oklch(0.78 0.13 165)' },
              ]} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="oklch(0.30 0.03 250 / 0.3)" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.65 0.02 230)" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {[
                    { name: 'MQTT DPI', value: 142, color: 'var(--accent-primary)' },
                    { name: 'CVE Exploit', value: 89, color: 'oklch(0.66 0.22 20)' },
                    { name: 'Comportemental', value: 67, color: 'oklch(0.78 0.17 75)' },
                    { name: 'Réseau', value: 45, color: 'var(--accent-purple)' },
                    { name: 'Firmware', value: 31, color: 'oklch(0.78 0.13 165)' },
                  ].map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </motion.div>

      {/* ===== RISK PANEL (Phase 3) ===== */}
      <motion.div custom={5} variants={sectionAnim}>
        <RiskPanel
          riskScore={riskData.riskScore}
          factors={riskData.factors}
          history={riskData.history}
          whatIfActions={riskData.whatIfActions}
          cveList={riskData.cveList}
          loading={riskData.loading}
          error={riskData.error}
          devices={riskData.devices}
          selectedDevice={riskData.selectedDevice}
          onSelectDevice={riskData.selectDevice}
        />
      </motion.div>

      {/* ===== FOOTER ===== */}
      <motion.div custom={6} variants={sectionAnim}
        className="flex items-center justify-between rounded-xl border p-4 text-[10px]"
        style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
      >
        <div className="flex items-center gap-4">
          <span className="font-semibold uppercase tracking-wider">PEAKSOFT Cyber-Guardian</span>
          <span className="opacity-50">|</span>
          <span>Jumeau Numérique IA · Isolation Forest · TON_IoT</span>
          <span className="opacity-50">|</span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" style={{ color: 'var(--accent-success)' }} />
            {displayData.length} points de télémétrie
          </span>
        </div>
        <div className="flex items-center gap-3">
          <motion.a href="#/bi" style={{ color: 'var(--accent-primary)' }}
            className="hover:underline cursor-pointer"
          >
            Power BI →
          </motion.a>
          <span className="flex items-center gap-1" style={{ color: displayData.filter(d => d.metric_value.is_anomaly).length > 0 ? 'oklch(0.66 0.22 20)' : 'var(--accent-success)' }}>
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            {displayData.filter(d => d.metric_value.is_anomaly).length > 0 ? 'Anomalies détectées' : 'Système sain'}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
