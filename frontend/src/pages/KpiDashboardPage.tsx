import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Shield, Brain, Cpu, Network, Activity,
  AlertTriangle, CheckCircle2, Thermometer, Snowflake,
  CloudSun, Zap, Clock, Target, Gauge, ShieldCheck, ShieldAlert,
  Bug, Eye, Sparkles,
  ArrowUpRight, ArrowDownRight, BarChart2, RefreshCw, Loader2,
  CircleDot, Radio, Wifi, WifiOff, FileWarning,
} from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import { authHeaders } from '../lib/auth';
import LiveFeedTab from '../components/LiveFeedTab';
import type { Device, Alert, MLModelSummary, ModelMetric } from '../types';

const API = '/api/v1';

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) return fallback;
    return await r.json();
  } catch { return fallback; }
}

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface DpiStats {
  total_messages: number;
  total_alerts: number;
  messages_per_second: number;
  alerts_per_minute: number;
  avg_latency_us: number;
  rule_match_counts: Record<string, number>;
  uptime_seconds: number;
}

interface ShapSummary {
  n_samples: number;
  n_anomalies: number;
  shap_method: string;
  global_importance: Array<{ feature: string; label: string; shap_importance: number }>;
  seasonal_breakdown: Record<string, { count: number }>;
}

// ═══════════════════════════════════════════════════════════
// TAB DEFINITION
// ═══════════════════════════════════════════════════════════

type TabId = 'overview' | 'devices' | 'security' | 'ml' | 'network' | 'live';

const TABS: { id: TabId; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'overview', label: "Vue d'ensemble", icon: <LayoutDashboard className="w-4 h-4" />, color: '#818cf8' },
  { id: 'devices', label: 'Dispositifs IoT', icon: <Cpu className="w-4 h-4" />, color: '#22C55E' },
  { id: 'security', label: 'Sécurité', icon: <Shield className="w-4 h-4" />, color: '#EF4444' },
  { id: 'ml', label: 'ML & Performance', icon: <Brain className="w-4 h-4" />, color: '#F59E0B' },
  { id: 'network', label: 'Réseau', icon: <Network className="w-4 h-4" />, color: '#00E5FF' },
  { id: 'live', label: 'Flux en direct', icon: <Radio className="w-4 h-4" />, color: '#2DD4BF' },
];

// ═══════════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ═══════════════════════════════════════════════════════════

const staggerItem = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

function SectionTitle({ children, color = 'var(--accent-primary)' }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-4 rounded-full" style={{ background: color }} />
      <h2 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>{children}</h2>
    </div>
  );
}

function Card({ children, className = '', hover = false }: { children: React.ReactNode; className?: string; hover?: boolean }) {
  return (
    <motion.div
      className={`rounded-2xl p-5 ${className}`}
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      whileHover={hover ? { y: -2, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' } : undefined}
      transition={{ duration: 0.25 }}
    >
      {children}
    </motion.div>
  );
}

interface KpiCardProps {
  label: string;
  value: string | number;
  color: string;
  icon: React.ReactNode;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  delay?: number;
}

function KpiCard({ label, value, color, icon, sub, trend, trendValue, delay = 0 }: KpiCardProps) {
  return (
    <motion.div
      variants={staggerItem}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.4, delay }}
      className="rounded-2xl p-4 relative overflow-hidden group"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `linear-gradient(135deg, ${color}08 0%, transparent 50%)` }} />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `${color}15`, color }}>
            {icon}
          </div>
          {trend && (
            <div className="flex items-center gap-0.5 text-[10px] font-mono font-bold" style={{ color: trend === 'up' ? '#22C55E' : '#EF4444' }}>
              {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {trendValue}
            </div>
          )}
        </div>
        <div className="font-display text-xl font-black tracking-tight" style={{ color }}>{value}</div>
        <div className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label}</div>
        {sub && <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--text-muted, var(--text-secondary))' }}>{sub}</div>}
      </div>
    </motion.div>
  );
}

function ProgressRing({ value, max = 100, size = 80, strokeWidth = 6, color, label }: {
  value: number; max?: number; size?: number; strokeWidth?: number; color: string; label: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / max, 1);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
          <motion.circle
            cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round" strokeDasharray={`${progress * circumference} ${circumference}`}
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${progress * circumference} ${circumference}` }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-black font-display" style={{ color }}>{Math.round(value)}%</span>
        </div>
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}

function MiniBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  );
}

interface TooltipItem { color: string; name: string; value: number }
function ChartTip({ active, payload, label, format }: { active?: boolean; payload?: TooltipItem[]; label?: string; format?: 'number' | 'percent' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
      {label && <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>
            {format === 'percent' ? `${(p.value * 100).toFixed(1)}%` : p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB: VUE D'ENSEMBLE
// ═══════════════════════════════════════════════════════════

function TabOverview({ devices, alerts, dpiStats, mlModels, shapData }: {
  devices: Device[]; alerts: Alert[]; dpiStats: DpiStats | null;
  mlModels: MLModelSummary[]; shapData: ShapSummary | null;
}) {
  const online = devices.filter(d => d.status === 'online').length;
  const avgRisk = devices.length ? Math.round(devices.reduce((s, d) => s + d.risk_score, 0) / devices.length) : 0;
  const avgCompliance = devices.length ? Math.round(devices.reduce((s, d) => s + d.compliance_score, 0) / devices.length) : 0;
  const criticalAlerts = alerts.filter(a => (a.rule?.level || 0) >= 10).length;
  const highAlerts = alerts.filter(a => { const l = a.rule?.level || 0; return l >= 5 && l < 10; }).length;
  const securityScore = Math.max(0, 100 - avgRisk - criticalAlerts * 3);

  const uptimePct = devices.length > 0 ? Math.round((online / devices.length) * 100) : 0;

  const systemMetrics = [
    { label: 'Score de sécurité', value: securityScore, color: securityScore >= 80 ? '#22C55E' : securityScore >= 50 ? '#F97316' : '#EF4444' },
    { label: 'Disponibilité', value: uptimePct, color: uptimePct >= 90 ? '#22C55E' : uptimePct >= 70 ? '#F97316' : '#EF4444' },
    { label: 'Conformité', value: avgCompliance, color: avgCompliance >= 80 ? '#22C55E' : avgCompliance >= 50 ? '#F97316' : '#EF4444' },
    { label: 'Risque moyen', value: avgRisk, color: avgRisk <= 20 ? '#22C55E' : avgRisk <= 50 ? '#F97316' : '#EF4444' },
  ];

  const deviceTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    devices.forEach(d => { counts[d.device_type] = (counts[d.device_type] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [devices]);

  const riskDistData = useMemo(() => {
    const dist = { low: 0, medium: 0, high: 0, critical: 0 };
    devices.forEach(d => {
      if (d.risk_score < 25) dist.low++;
      else if (d.risk_score < 50) dist.medium++;
      else if (d.risk_score < 75) dist.high++;
      else dist.critical++;
    });
    return [
      { name: 'Faible', value: dist.low, color: '#22C55E' },
      { name: 'Moyen', value: dist.medium, color: '#F97316' },
      { name: 'Élevé', value: dist.high, color: '#EF4444' },
      { name: 'Critique', value: dist.critical, color: '#DC2626' },
    ];
  }, [devices]);

  const avgModelF1 = mlModels.length > 0
    ? mlModels.reduce((s, m) => s + (m.meilleur_taux || 0), 0) / mlModels.length
    : 0;

  return (
    <div className="space-y-5">
      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Score sécurité" value={`${securityScore}/100`} color={securityScore >= 80 ? '#22C55E' : securityScore >= 50 ? '#F97316' : '#EF4444'}
          icon={<ShieldCheck className="w-4 h-4" />} delay={0} />
        <KpiCard label="Appareils" value={devices.length} color="#818cf8"
          icon={<Cpu className="w-4 h-4" />} sub={`${online} en ligne`} delay={0.05} />
        <KpiCard label="Alertes totales" value={alerts.length} color="#EF4444"
          icon={<AlertTriangle className="w-4 h-4" />} sub={`${criticalAlerts} critiques`} delay={0.1} />
        <KpiCard label="Modèles ML" value={mlModels.length} color="#F59E0B"
          icon={<Brain className="w-4 h-4" />} sub={`F1: ${(avgModelF1 * 100).toFixed(0)}%`} delay={0.15} />
        <KpiCard label="Capteurs analysés" value={shapData?.n_samples.toLocaleString() || '—'} color="#00E5FF"
          icon={<Activity className="w-4 h-4" />} delay={0.2} />
        <KpiCard label="Activité réseau" value={dpiStats?.total_messages.toLocaleString() || '—'} color="#A855F7"
          icon={<Shield className="w-4 h-4" />} sub={`${(dpiStats?.messages_per_second || 0)} msg/s`} delay={0.25} />
      </div>

      {/* Progress Rings */}
      <Card>
        <SectionTitle>Indicateurs de santé système</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-4">
          {systemMetrics.map(m => (
            <ProgressRing key={m.label} value={m.value} color={m.color} label={m.label} />
          ))}
        </div>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Device Type Distribution */}
        <Card>
          <SectionTitle color="#818cf8">Répartition par type</SectionTitle>
          <div className="h-[220px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={deviceTypeData} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                  paddingAngle={3} dataKey="value" nameKey="name"
                  label={({ name, percent }: PieLabelRenderProps) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}>
                  {deviceTypeData.map((_, i) => (
                    <Cell key={i} fill={['#818cf8', '#22C55E', '#F59E0B', '#EF4444', '#A855F7'][i % 5]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Risk Distribution */}
        <Card>
          <SectionTitle color="#EF4444">Distribution des risques</SectionTitle>
          <div className="h-[220px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskDistData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="value" name="Appareils" radius={[4, 4, 0, 0]}>
                  {riskDistData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Alert Severity */}
        <Card>
          <SectionTitle color="#F59E0B">Sévérité des alertes</SectionTitle>
          <div className="space-y-3 mt-4">
            {[
              { label: 'Critique (≥10)', count: criticalAlerts, color: '#EF4444', max: Math.max(alerts.length, 1) },
              { label: 'Élevée (5-9)', count: highAlerts, color: '#F97316', max: Math.max(alerts.length, 1) },
              { label: 'Moyenne (2-4)', count: alerts.filter(a => { const l = a.rule?.level || 0; return l >= 2 && l < 5; }).length, color: '#F59E0B', max: Math.max(alerts.length, 1) },
              { label: 'Faible (0-1)', count: alerts.filter(a => (a.rule?.level || 0) < 2).length, color: '#22C55E', max: Math.max(alerts.length, 1) },
            ].map(item => (
              <div key={item.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                  <span className="text-xs font-mono font-black" style={{ color: item.color }}>{item.count}</span>
                </div>
                <MiniBar value={item.count} max={item.max} color={item.color} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB: DISPOSITIFS IOT
// ═══════════════════════════════════════════════════════════

function TabDevices({ devices }: { devices: Device[] }) {
  const online = devices.filter(d => d.status === 'online').length;
  const offline = devices.filter(d => d.status === 'offline').length;
  const quarantined = devices.filter(d => d.status === 'quarantined').length;
  const avgRisk = devices.length ? Math.round(devices.reduce((s, d) => s + d.risk_score, 0) / devices.length) : 0;
  const avgCompliance = devices.length ? Math.round(devices.reduce((s, d) => s + d.compliance_score, 0) / devices.length) : 0;

  const byType = useMemo(() => {
    const map: Record<string, { total: number; online: number; avgRisk: number; avgCompliance: number }> = {};
    devices.forEach(d => {
      if (!map[d.device_type]) map[d.device_type] = { total: 0, online: 0, avgRisk: 0, avgCompliance: 0 };
      map[d.device_type].total++;
      if (d.status === 'online') map[d.device_type].online++;
      map[d.device_type].avgRisk += d.risk_score;
      map[d.device_type].avgCompliance += d.compliance_score;
    });
    return Object.entries(map).map(([type, s]) => ({
      type, total: s.total, online: s.online,
      avgRisk: Math.round(s.avgRisk / s.total),
      avgCompliance: Math.round(s.avgCompliance / s.total),
    }));
  }, [devices]);

  const typeChart = useMemo(() => byType.map(t => ({
    name: t.type, total: t.total, online: t.online, horsLigne: t.total - t.online,
    risque: t.avgRisk, conformité: t.avgCompliance,
  })), [byType]);

  const sensorIcons: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
    thermostat: Thermometer, fridge: Snowflake, weather: CloudSun,
  };
  const sensorColors: Record<string, string> = {
    thermostat: '#FF9100', fridge: '#00E676', weather: '#38BDF8',
  };

  return (
    <div className="space-y-5">
      {/* Device KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total appareils" value={devices.length} color="#818cf8" icon={<Cpu className="w-4 h-4" />} delay={0} />
        <KpiCard label="En ligne" value={online} color="#22C55E" icon={<Wifi className="w-4 h-4" />}
          sub={`${devices.length > 0 ? Math.round((online / devices.length) * 100) : 0}% uptime`} delay={0.05} />
        <KpiCard label="Hors ligne" value={offline} color="#EF4444" icon={<WifiOff className="w-4 h-4" />} delay={0.1} />
        <KpiCard label="Quarantaine" value={quarantined} color="#F97316" icon={<ShieldAlert className="w-4 h-4" />} delay={0.15} />
        <KpiCard label="Risque moyen" value={`${avgRisk}%`} color={avgRisk >= 50 ? '#EF4444' : '#22C55E'} icon={<Gauge className="w-4 h-4" />} delay={0.2} />
      </div>

      {/* Compliance + Status Rings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <SectionTitle color="#22C55E">Conformité globale</SectionTitle>
          <div className="flex items-center justify-center py-4">
            <ProgressRing value={avgCompliance} color={avgCompliance >= 80 ? '#22C55E' : '#F97316'} size={120} strokeWidth={8} label="Compliance Score" />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Performance par type de capteur</SectionTitle>
          <div className="h-[250px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeChart} margin={{ top: 5, right: 5, left: -15, bottom: 0 }} barCategoryGap="20%">
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
                <Bar dataKey="online" name="En ligne" fill="#22C55E" radius={[4, 4, 0, 0]} />
                <Bar dataKey="horsLigne" name="Hors ligne" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Device table */}
      <Card>
        <SectionTitle>Détail des appareils</SectionTitle>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Appareil</th>
                <th className="text-left py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Type</th>
                <th className="text-left py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Localisation</th>
                <th className="text-center py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
                <th className="text-center py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Risque</th>
                <th className="text-center py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Conformité</th>
              </tr>
            </thead>
            <tbody>
              {devices.slice(0, 15).map(d => {
                const riskColor = d.risk_score >= 70 ? '#EF4444' : d.risk_score >= 30 ? '#F97316' : '#22C55E';
                const statusColor = d.status === 'online' ? '#22C55E' : d.status === 'quarantined' ? '#F97316' : '#EF4444';
                const Icon = sensorIcons[d.device_type] || CircleDot;
                return (
                  <tr key={d.id} className="transition-colors" style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded flex items-center justify-center"
                          style={{ background: `${sensorColors[d.device_type] || '#818cf8'}15` }}>
                          <Icon className="w-3 h-3" style={{ color: sensorColors[d.device_type] || '#818cf8' }} />
                        </div>
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{d.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono" style={{ color: 'var(--text-secondary)' }}>{d.device_type}</td>
                    <td className="py-2.5 px-3" style={{ color: 'var(--text-secondary)' }}>{d.location || '—'}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase"
                        style={{ background: `${statusColor}15`, color: statusColor, border: `1px solid ${statusColor}30` }}>
                        {d.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="font-mono font-bold" style={{ color: riskColor }}>{d.risk_score}%</span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="font-mono font-bold" style={{ color: d.compliance_score >= 80 ? '#22C55E' : '#F97316' }}>{d.compliance_score}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB: SÉCURITÉ
// ═══════════════════════════════════════════════════════════

function TabSecurity({ alerts, devices }: { alerts: Alert[]; devices: Device[] }) {
  const criticalAlerts = alerts.filter(a => (a.rule?.level || 0) >= 10);
  const highAlerts = alerts.filter(a => { const l = a.rule?.level || 0; return l >= 5 && l < 10; });
  const quarantined = devices.filter(d => d.status === 'quarantined');
  const avgRisk = devices.length ? Math.round(devices.reduce((s, d) => s + d.risk_score, 0) / devices.length) : 0;
  const highRiskDevices = devices.filter(d => d.risk_score >= 50);

  const alertByDevice = useMemo(() => {
    const map: Record<string, number> = {};
    alerts.forEach(a => {
      const dev = a.data?.device || a.device || 'Inconnu';
      map[dev] = (map[dev] || 0) + 1;
    });
    return Object.entries(map)
      .map(([device, count]) => ({ device, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [alerts]);

  const severityData = useMemo(() => [
    { name: 'Critique', value: criticalAlerts.length, color: '#EF4444' },
    { name: 'Élevée', value: highAlerts.length, color: '#F97316' },
    { name: 'Moyenne', value: alerts.filter(a => { const l = a.rule?.level || 0; return l >= 2 && l < 5; }).length, color: '#F59E0B' },
    { name: 'Faible', value: alerts.filter(a => (a.rule?.level || 0) < 2).length, color: '#22C55E' },
  ], [alerts, criticalAlerts, highAlerts]);

  const detectionRate = alerts.length > 0
    ? ((alerts.filter(a => (a.rule?.level || 0) >= 5).length / alerts.length) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-5">
      {/* Security KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard label="Score sécurité" value={`${Math.max(0, 100 - avgRisk - criticalAlerts.length * 3)}`}
          color="#22C55E" icon={<ShieldCheck className="w-4 h-4" />} delay={0} />
        <KpiCard label="Alertes totales" value={alerts.length} color="#818cf8"
          icon={<AlertTriangle className="w-4 h-4" />} delay={0.05} />
        <KpiCard label="Critiques" value={criticalAlerts.length} color="#EF4444"
          icon={<Bug className="w-4 h-4" />} delay={0.1} />
        <KpiCard label="Quarantaine" value={quarantined.length} color="#F97316"
          icon={<ShieldAlert className="w-4 h-4" />} delay={0.15} />
        <KpiCard label="Appareils à risque" value={highRiskDevices.length} color="#DC2626"
          icon={<Eye className="w-4 h-4" />} delay={0.2} />
        <KpiCard label="Taux de détection" value={`${detectionRate}%`} color="#A855F7"
          icon={<Target className="w-4 h-4" />} delay={0.25} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Severity Pie */}
        <Card>
          <SectionTitle color="#EF4444">Répartition par sévérité</SectionTitle>
          <div className="h-[260px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={severityData} cx="50%" cy="50%" innerRadius={60} outerRadius={95}
                  paddingAngle={4} dataKey="value" nameKey="name"
                  label={({ name, value }: PieLabelRenderProps) => `${name ?? ''}: ${value}`}
                  labelLine={false}>
                  {severityData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTip />} />
                <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Alerts by Device */}
        <Card>
          <SectionTitle color="#F59E0B">Alertes par appareil</SectionTitle>
          <div className="h-[260px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={alertByDevice} layout="vertical" margin={{ top: 5, right: 5, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="device" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} width={90} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="count" name="Alertes" fill="#F59E0B" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* High Risk Devices + Recent Critical Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <SectionTitle color="#EF4444">Appareils à risque élevé</SectionTitle>
          <div className="space-y-2 mt-3">
            {highRiskDevices.slice(0, 8).map(d => (
              <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.risk_score >= 70 ? '#EF4444' : '#F97316' }} />
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{d.name}</span>
                </div>
                <span className="text-xs font-mono font-bold shrink-0" style={{ color: d.risk_score >= 70 ? '#EF4444' : '#F97316' }}>
                  {d.risk_score}%
                </span>
              </div>
            ))}
            {highRiskDevices.length === 0 && (
              <div className="flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--text-secondary)' }}>
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs">Aucun appareil à risque élevé</span>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <SectionTitle color="#DC2626">Alertes critiques récentes</SectionTitle>
          <div className="space-y-2 mt-3">
            {criticalAlerts.slice(0, 8).map((a, i) => (
              <div key={a.id || i} className="flex items-start gap-3 px-3 py-2 rounded-lg"
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: '#EF4444' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {a.rule?.description || a.description || 'Alerte critique'}
                  </div>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {a.rule?.id || 'N/A'} · {a.data?.device || a.device || 'Inconnu'}
                  </div>
                </div>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                  LVL {a.rule?.level}
                </span>
              </div>
            ))}
            {criticalAlerts.length === 0 && (
              <div className="flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--text-secondary)' }}>
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs">Aucune alerte critique</span>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB: ML & PERFORMANCE
// ═══════════════════════════════════════════════════════════

function TabML({ mlModels, shapData, modelMetrics }: {
  mlModels: MLModelSummary[]; shapData: ShapSummary | null; modelMetrics: ModelMetric[];
}) {
  const avgMetrics = useMemo(() => {
    if (modelMetrics.length === 0) return { precision: 0, recall: 0, f1: 0, rocAuc: 0 };
    return {
      precision: modelMetrics.reduce((s, m) => s + (m.precision_attaque || 0), 0) / modelMetrics.length,
      recall: modelMetrics.reduce((s, m) => s + (m.recall_attaque || 0), 0) / modelMetrics.length,
      f1: modelMetrics.reduce((s, m) => s + (m.f1_attaque || 0), 0) / modelMetrics.length,
      rocAuc: modelMetrics.reduce((s, m) => s + (m.roc_auc || 0), 0) / modelMetrics.length,
    };
  }, [modelMetrics]);

  const shapFeatures = useMemo(() => {
    if (!shapData?.global_importance) return [];
    return shapData.global_importance.slice(0, 8).map(f => ({
      name: f.label || f.feature,
      importance: f.shap_importance,
    }));
  }, [shapData]);

  const sensorPerfData = useMemo(() => {
    const map: Record<string, { count: number; avgF1: number; avgAuc: number }> = {};
    modelMetrics.forEach(m => {
      const s = m.capteur || 'unknown';
      if (!map[s]) map[s] = { count: 0, avgF1: 0, avgAuc: 0 };
      map[s].count++;
      map[s].avgF1 += m.f1_attaque || 0;
      map[s].avgAuc += m.roc_auc || 0;
    });
    return Object.entries(map).map(([sensor, s]) => ({
      sensor,
      f1: s.count > 0 ? Math.round((s.avgF1 / s.count) * 100) : 0,
      auc: s.count > 0 ? Math.round((s.avgAuc / s.count) * 100) : 0,
    }));
  }, [modelMetrics]);

  return (
    <div className="space-y-5">
      {/* ML KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard label="Modèles" value={mlModels.length} color="#F59E0B" icon={<Brain className="w-4 h-4" />} delay={0} />
        <KpiCard label="Métriques" value={modelMetrics.length} color="#818cf8" icon={<BarChart2 className="w-4 h-4" />} delay={0.05} />
        <KpiCard label="F1 Score" value={`${(avgMetrics.f1 * 100).toFixed(1)}%`} color="#22C55E" icon={<Target className="w-4 h-4" />} delay={0.1} />
        <KpiCard label="ROC AUC" value={`${(avgMetrics.rocAuc * 100).toFixed(1)}%`} color="#A855F7" icon={<Activity className="w-4 h-4" />} delay={0.15} />
        <KpiCard label="Anomalies" value={shapData?.n_anomalies.toLocaleString() || '—'} color="#EF4444" icon={<Bug className="w-4 h-4" />}
          sub={shapData ? `${((shapData.n_anomalies / shapData.n_samples) * 100).toFixed(1)}% du dataset` : ''} delay={0.2} />
        <KpiCard label="Méthode" value={shapData?.shap_method || '—'} color="#00E5FF" icon={<Sparkles className="w-4 h-4" />} delay={0.25} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Model Performance Radar */}
        <Card>
          <SectionTitle color="#F59E0B">Performance par modèle</SectionTitle>
          <div className="h-[280px] mt-2">
            {sensorPerfData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={sensorPerfData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis dataKey="sensor" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} axisLine={false} />
                  <Radar name="F1 Score" dataKey="f1" stroke="#22C55E" fill="#22C55E" fillOpacity={0.2} strokeWidth={2} />
                  <Radar name="ROC AUC" dataKey="auc" stroke="#A855F7" fill="#A855F7" fillOpacity={0.15} strokeWidth={2} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" iconSize={10} />
                  <Tooltip content={<ChartTip format="percent" />} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--text-secondary)' }}>
                Aucune métrique disponible
              </div>
            )}
          </div>
        </Card>

        {/* SHAP Feature Importance */}
        <Card>
          <SectionTitle color="#00E5FF">Importance SHAP — Top features</SectionTitle>
          <div className="h-[280px] mt-2">
            {shapFeatures.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={shapFeatures} layout="vertical" margin={{ top: 5, right: 5, left: 10, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(4)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} width={80} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="importance" name="SHAP Value" fill="#00E5FF" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--text-secondary)' }}>
                Aucune donnée SHAP disponible
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Model List */}
      <Card>
        <SectionTitle>Modèles enregistrés</SectionTitle>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Nom</th>
                <th className="text-left py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Capteur</th>
                <th className="text-left py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Type</th>
                <th className="text-center py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Meilleur taux</th>
                <th className="text-center py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Anomalie %</th>
                <th className="text-center py-2 px-3 font-bold" style={{ color: 'var(--text-secondary)' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {mlModels.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="py-2.5 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>{m.name}</td>
                  <td className="py-2.5 px-3 font-mono" style={{ color: 'var(--text-secondary)' }}>{m.sensor}</td>
                  <td className="py-2.5 px-3" style={{ color: 'var(--text-secondary)' }}>{m.model_type}</td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="font-mono font-bold" style={{ color: (m.meilleur_taux || 0) >= 0.8 ? '#22C55E' : '#F97316' }}>
                      {((m.meilleur_taux || 0) * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {((m.anomaly_rate_normal || 0) * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold"
                      style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
                      {m.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB: RÉSEAU
// ═══════════════════════════════════════════════════════════

function TabNetwork({ dpiStats, devices }: { dpiStats: DpiStats | null; devices: Device[] }) {
  const ruleMatchData = useMemo(() => {
    if (!dpiStats?.rule_match_counts) return [];
    return Object.entries(dpiStats.rule_match_counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [dpiStats]);

  const uptime = dpiStats?.uptime_seconds || 0;
  const uptimeDays = Math.floor(uptime / 86400);
  const uptimeHrs = Math.floor((uptime % 86400) / 3600);
  const uptimeStr = uptimeDays > 0
    ? `${uptimeDays}j ${uptimeHrs}h`
    : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
  const latencyMs = (dpiStats?.avg_latency_us || 0) / 1000;

  const networkKpis = [
    { label: 'Messages traités', value: (dpiStats?.total_messages || 0).toLocaleString(), color: '#00E5FF', icon: <Radio className="w-4 h-4" /> },
    { label: 'Alertes DPI', value: dpiStats?.total_alerts || 0, color: '#EF4444', icon: <FileWarning className="w-4 h-4" />, sub: 'signalées' },
    { label: 'Débit', value: `${(dpiStats?.messages_per_second || 0).toFixed(1)}`, color: '#22C55E', icon: <Zap className="w-4 h-4" />, sub: 'msg/s' },
    { label: 'Alertes / min', value: (dpiStats?.alerts_per_minute || 0).toFixed(1), color: '#F59E0B', icon: <AlertTriangle className="w-4 h-4" /> },
    { label: 'Latence moyenne', value: `${latencyMs.toFixed(2)}ms`, color: '#A855F7', icon: <Clock className="w-4 h-4" /> },
    { label: 'Uptime', value: uptimeStr, color: '#818cf8', icon: <ShieldCheck className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-5">
      {/* Network KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {networkKpis.map((k, i) => (
          <KpiCard key={k.label} label={k.label} value={k.value} color={k.color} icon={k.icon} sub={k.sub} delay={i * 0.05} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Rule match distribution */}
        <Card>
          <SectionTitle color="#00E5FF">Règles DPI les plus actives</SectionTitle>
          <div className="h-[260px] mt-2">
            {ruleMatchData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ruleMatchData.slice(0, 8)} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="value" name="Déclenchements" fill="#00E5FF" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--text-secondary)' }}>
                Aucune activité réseau enregistrée
              </div>
            )}
          </div>
        </Card>

        {/* Latency + throughput */}
        <Card>
          <SectionTitle color="#A855F7">Latence & débit</SectionTitle>
          <div className="flex items-center justify-around py-6">
            <div className="flex flex-col items-center gap-2">
              <div className="relative w-32 h-32">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="8" />
                  <motion.circle
                    cx="60" cy="60" r="52" fill="none"
                    stroke={latencyMs < 20 ? '#22C55E' : latencyMs < 50 ? '#F97316' : '#EF4444'}
                    strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${Math.min((latencyMs / 100) * 326.7, 326.7)} 326.7`}
                    initial={{ strokeDasharray: '0 326.7' }}
                    animate={{ strokeDasharray: `${Math.min((latencyMs / 100) * 326.7, 326.7)} 326.7` }}
                    transition={{ duration: 1.2, ease: 'easeOut' }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-black font-display" style={{ color: latencyMs < 20 ? '#22C55E' : latencyMs < 50 ? '#F97316' : '#EF4444' }}>
                    {latencyMs.toFixed(2)}
                  </span>
                  <span className="text-[8px] font-mono tracking-wider" style={{ color: 'var(--text-secondary)' }}>ms</span>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Latence moyenne</span>
            </div>
            <div className="flex flex-col gap-3">
              {[
                { label: 'Messages / sec', value: (dpiStats?.messages_per_second || 0).toFixed(1), color: '#22C55E' },
                { label: 'Alertes / min', value: (dpiStats?.alerts_per_minute || 0).toFixed(1), color: '#F59E0B' },
                { label: 'Uptime', value: uptimeStr, color: '#818cf8' },
              ].map(s => (
                <div key={s.label} className="px-4 py-2 rounded-xl text-center"
                  style={{ background: `${s.color}0a`, border: `1px solid ${s.color}25` }}>
                  <div className="text-lg font-black font-display" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Sensor state + top alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <SectionTitle color="#22C55E">État des capteurs réseau</SectionTitle>
          <div className="grid grid-cols-3 gap-4 mt-4">
            {[
              { type: 'Thermostat', icon: Thermometer, color: '#FF9100', count: devices.filter(d => d.device_type === 'thermostat').length },
              { type: 'Fridge', icon: Snowflake, color: '#00E676', count: devices.filter(d => d.device_type === 'fridge').length },
              { type: 'Weather', icon: CloudSun, color: '#38BDF8', count: devices.filter(d => d.device_type === 'weather').length },
            ].map(s => {
              const Icon = s.icon;
              return (
                <div key={s.type} className="text-center p-3 rounded-xl"
                  style={{ background: `${s.color}08`, border: `1px solid ${s.color}20` }}>
                  <Icon className="w-6 h-6 mx-auto mb-1" style={{ color: s.color }} />
                  <div className="text-lg font-black font-display" style={{ color: s.color }}>{s.count}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{s.type}</div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionTitle color="#EF4444">Alertes réseau enregistrées</SectionTitle>
          <div className="space-y-3 mt-4">
            {ruleMatchData.length > 0 ? ruleMatchData.slice(0, 6).map((a, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium truncate max-w-[220px]" style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                  <span className="text-xs font-mono font-bold" style={{ color: '#EF4444' }}>{a.value}</span>
                </div>
                <MiniBar value={a.value} max={ruleMatchData[0]?.value || 1} color="#EF4444" />
              </div>
            )) : (
              <div className="flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--text-secondary)' }}>
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs">Aucune alerte réseau enregistrée</span>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════

export default function KpiDashboardPage() {
  const [tab, setTab] = useState<TabId>('overview');
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dpiStats, setDpiStats] = useState<DpiStats | null>(null);
  const [mlModels, setMlModels] = useState<MLModelSummary[]>([]);
  const [shapData, setShapData] = useState<ShapSummary | null>(null);
  const [modelMetrics, setModelMetrics] = useState<ModelMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchAll = useCallback(async () => {
    const [d, a, dpi, ml, shap, metrics] = await Promise.all([
      fetchJson<Device[]>(`${API}/devices`, []),
      fetchJson<Alert[]>(`${API}/alerts?limit=50`, []),
      fetchJson<DpiStats>('/api/dpi/stats', null as any),
      fetchJson<MLModelSummary[]>('/api/v1/phase2/results', []),
      fetchJson<ShapSummary>('/api/shap/yearly?limit=500', null as any),
      fetchJson<ModelMetric[]>('/api/v1/phase2/attack-metrics', []),
    ]);
    setDevices(d);
    setAlerts(a);
    setDpiStats(dpi);
    setMlModels(ml);
    setShapData(shap);
    setModelMetrics(metrics);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Chargement des KPIs...</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <BarChart2 className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
            Tableau de bord KPIs
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Indicateurs clés de performance — vue complète de la plateforme CYBER-GUARDIAN
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchAll()}
            className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-2 rounded-xl cursor-pointer transition-all"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <RefreshCw className="w-3 h-3" /> Actualiser
          </button>
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted, var(--text-secondary))' }}>
            Mis à jour: {lastRefresh.toLocaleTimeString('fr-FR')}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold font-display whitespace-nowrap transition-all"
            style={{
              background: tab === t.id ? `${t.color}15` : 'transparent',
              color: tab === t.id ? t.color : 'var(--text-secondary)',
              border: tab === t.id ? `1px solid ${t.color}30` : '1px solid transparent',
            }}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'overview' && (
            <TabOverview devices={devices} alerts={alerts} dpiStats={dpiStats} mlModels={mlModels} shapData={shapData} />
          )}
          {tab === 'devices' && <TabDevices devices={devices} />}
          {tab === 'security' && <TabSecurity alerts={alerts} devices={devices} />}
          {tab === 'ml' && <TabML mlModels={mlModels} shapData={shapData} modelMetrics={modelMetrics} />}
          {tab === 'network' && <TabNetwork dpiStats={dpiStats} devices={devices} />}
          {tab === 'live' && <LiveFeedTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
