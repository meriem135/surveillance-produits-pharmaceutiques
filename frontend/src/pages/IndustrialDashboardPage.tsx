import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, ComposedChart,
} from 'recharts';
import ScadaGauge from '../components/ScadaGauge';
import StatusIndicator from '../components/StatusIndicator';
import MachinePanel from '../components/MachinePanel';
import AlarmBanner from '../components/AlarmBanner';
import XaiPanel from '../components/XaiPanel';
import DpiAlertPanel from '../components/DpiAlertPanel';
import DpiBenchmark from '../components/DpiBenchmark';
import DpiRuleConfig from '../components/DpiRuleConfig';

interface KpiData {
  total_points: number; normal_points: number; attack_points: number;
  attack_rate: number; avg_temp_weather: number; avg_temp_fridge: number;
  avg_temp_thermostat: number; min_temp_weather: number; max_temp_weather: number;
}
interface TimelinePoint { doy: number; mean: number; min: number; max: number; attack_value: number | null }
interface MonthlyPoint { month: number; month_name: string; mean: number; min: number; max: number; std: number }
interface MlPerformance { roc_auc: number; confusion_matrix: {tn:number;fp:number;fn:number;tp:number}; classification_report: Record<string,any>; feature_importance: Array<{feature:string;importance:number}> }
interface AttackTimeline { doy: number; count: number }
interface DeviceInfo { id: string; name: string; ip_address: string; risk_score: number; status: string; device_type: string; }
type Period = 'year' | 'month' | 'week' | 'day';
type AttackType = 'recon' | 'mitm' | 'ddos' | 'ransom';

const MONTHS = ['Jan','Fev','Mar','Avr','Mai','Jun','Jul','Aou','Sep','Oct','Nov','Dec'];
const SENSORS = ['weather','fridge','thermostat'];
const SENSOR_NAMES = ['Station Meteo','Chambre Froide','Thermostat'];
const SENSOR_COLORS = ['#38BDF8','#00E676','#FF9100'];
const SENSOR_ICONS = ['\u{1f324}','\u{1f9ca}','\u{1f525}'];

const PERIODS: {key: Period; label: string; days: number; desc: string}[] = [
  { key: 'year', label: 'Année', days: 365, desc: '1 Jan - 31 Dec 2019' },
  { key: 'month', label: '30 jours', days: 30, desc: '15 Jun - 15 Jul 2019' },
  { key: 'week', label: '7 jours', days: 7, desc: '15 Jun - 21 Jun 2019' },
  { key: 'day', label: 'Aujourd\'hui', days: 1, desc: '15 Jun 2019' },
];

const ATTACK_INFO: Record<string, { title: string; desc: string; color: string }> = {
  recon: { title: 'Reconnaissance', desc: 'Scan réseau détecté sur le segment 192.168.1.0/24. Ports MQTT (1883) et Modbus (502) sondés.', color: '#F59E0B' },
  mitm: { title: 'Man-in-the-Middle', desc: 'Falsification de trames Modbus détectée. Registres FC2 et FC3 modifiés.', color: '#EAB308' },
  ddos: { title: 'DDoS', desc: 'Saturation du réseau MQTT : 50 000 req/s. Latence critique sur les automates.', color: '#EF4444' },
  ransom: { title: 'Ransomware', desc: 'Chiffrement des PLC-A12 et PLC-A09. Vannes forcées et capteurs désactivés.', color: '#991B1B' },
};

function ScadaTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || 'var(--text-primary)' }}>{p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</div>
      ))}
    </div>
  );
}

function ScadaChartCard({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.7), rgba(15,23,42,0.3))', border: '1px solid rgba(99,102,241,0.08)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(99,102,241,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>{title}</span>
        {badge && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'rgba(56,189,248,0.1)', color: '#38BDF8', letterSpacing: '0.5px', marginLeft: 'auto', border: '1px solid rgba(56,189,248,0.15)' }}>{badge}</span>}
      </div>
      <div style={{ padding: '12px 16px 16px' }}>{children}</div>
    </div>
  );
}

function KpiScadaCard({ label, value, unit = '', color }: { label: string; value: string; unit?: string; color: string }) {
  return (
    <motion.div whileHover={{ scale: 1.02, y: -2 }} style={{
      background: 'linear-gradient(135deg, rgba(15,23,42,0.7), rgba(15,23,42,0.3))',
      border: '1px solid ' + color + '15', borderRadius: 10,
      padding: '14px 16px', textAlign: 'center', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, ' + color + ', ' + color + '00)', opacity: 0.6 }} />
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}{unit}</div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{label}</div>
    </motion.div>
  );
}

function SectionLabel({ label, badge, desc }: { label: string; badge?: string; desc?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>{label}</span>
      {badge && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'rgba(99,102,241,0.1)', color: '#818CF8', border: '1px solid rgba(99,102,241,0.2)', letterSpacing: '0.5px' }}>{badge}</span>}
      {desc && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>{desc}</span>}
    </div>
  );
}

function DeviceRiskCard({ device }: { device: DeviceInfo }) {
  const riskColor = device.risk_score > 80 ? '#FF1744' : device.risk_score > 50 ? '#FF9100' : '#00E676';
  const statusColor = device.status === 'critical' ? '#FF1744' : device.status === 'warning' ? '#FF9100' : '#00E676';
  return (
    <motion.div whileHover={{ scale: 1.02 }} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 14px', borderRadius: 10,
      background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(99,102,241,0.08)',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, display: 'inline-block', marginRight: 6 }} />
          {device.name}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{device.ip_address} · {device.device_type}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: riskColor, fontFamily: "'JetBrains Mono', monospace" }}>{device.risk_score}%</div>
        <div style={{ width: 60, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
          <div style={{ width: `${device.risk_score}%`, height: '100%', background: riskColor, borderRadius: 3 }} />
        </div>
      </div>
    </motion.div>
  );
}

export default function IndustrialDashboardPage() {
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [sensor] = useState(0);
  const [focusSensor, setFocusSensor] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>('year');
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [monthlyComp, setMonthlyComp] = useState<any[]>([]);
  const [mlPerf, setMlPerf] = useState<MlPerformance | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [attacks, setAttacks] = useState<AttackTimeline[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [activeAttack, setActiveAttack] = useState<AttackType | null>(null);
  const [attackActive, setAttackActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [livePoint, setLivePoint] = useState<any>(null);
  const [, setLiveAlerts] = useState<any[]>([]);
  const [dpiAlerts, setDpiAlerts] = useState<any[]>([]);
  const [dpiStats, setDpiStats] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const alertInterval = useRef<any>(null);

  const fetchJson = useCallback(async (url: string) => {
    try { const r = await fetch(url); return await r.json(); } catch { return null; }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [k, tl, m, mc, ml, d, at] = await Promise.all([
        fetchJson('/api/yearly/kpi'),
        fetchJson('/api/yearly/timeline?sensor=' + SENSORS[sensor] + '&start_doy=1&end_doy=365'),
        fetchJson('/api/yearly/monthly?sensor=' + SENSORS[sensor]),
        fetchJson('/api/yearly/monthly-comparison'),
        fetchJson('/api/yearly/ml-performance'),
        fetchJson('/api/devices'),
        fetchJson('/api/yearly/attack-timeline'),
      ]);
      if (k) setKpi(k);
      if (tl) setTimeline(tl.data);
      if (m) setMonthly(m.data);
      if (mc) setMonthlyComp(mc.data);
      if (ml) setMlPerf(ml);
      if (d && Array.isArray(d)) setDevices(d);
      if (at) setAttacks(at.attacks);
      setLoading(false);
    }
    load();

    // WebSocket live stream
    wsRef.current = new WebSocket('ws://localhost:8000/ws/stream');
    wsRef.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'reset') {
          setLiveAlerts(prev => [{ id: Date.now(), time: new Date().toLocaleTimeString('fr-FR'), message: data.message, level: 'info' }, ...prev].slice(0, 20));
          return;
        }
        setLivePoint(data);
        if (data.dpi_alert) {
          setDpiAlerts(prev => [data.dpi_alert, ...prev].slice(0, 50));
        }
        if (data.dpi_stats) {
          setDpiStats(data.dpi_stats);
        }
        if (data.is_anomaly) {
          setLiveAlerts(prev => [{
            id: Date.now(),
            time: new Date(data.timestamp).toLocaleTimeString('fr-FR'),
            message: data.dpi_alert
              ? `DPI ${data.dpi_alert.rule.id}: ${data.dpi_alert.rule.description?.slice(0, 60)}`
              : `Score normalite: ${data.normality_score}%`,
            level: data.normality_score < 30 ? 'critical' : 'warning',
          }, ...prev].slice(0, 20));
        }
      } catch {}
    };
    wsRef.current.onerror = () => {};

    alertInterval.current = setInterval(async () => {
      try {
        const r = await fetch('/api/v1/alerts?limit=15');
        const d = await r.json();
        if (Array.isArray(d)) setAlerts(d);
      } catch {}
    }, 5000);

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (alertInterval.current) clearInterval(alertInterval.current);
    };
  }, [sensor, fetchJson]);

  const getSeverity = (attackRate: number, detectionRate: number): any => {
    const risk = attackRate * (1 - detectionRate / 100);
    if (risk > 70) return 'critical';
    if (risk > 45) return 'high';
    if (risk > 25) return 'medium';
    if (risk > 10) return 'low';
    return 'safe';
  };

  const handleAttack = async (type: AttackType) => {
    setActiveAttack(type);
    setAttackActive(true);
    try { await fetch('/api/attack/toggle?active=true', { method: 'POST' }); } catch {}
  };

  const handleReset = async () => {
    setActiveAttack(null);
    setAttackActive(false);
    try { await fetch('/api/attack/purge', { method: 'POST' }); } catch {}
  };

  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('fr-FR');
  const periodInfo = PERIODS.find(p => p.key === period)!;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-secondary)' }}>
        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 2, repeat: Infinity }} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
          INITIALISATION DU SYSTEME SCADA...
        </motion.div>
      </div>
    );
  }

  const sensorsData = kpi ? (() => {
    const baseDetect = mlPerf ? (mlPerf.classification_report?.Attaque?.recall || 0.85) * 100 : 85;
    const pFactor = period === 'day' ? 0.1 : period === 'week' ? 0.25 : period === 'month' ? 0.5 : 1;
    const pLabel = period === 'day' ? '24h' : period === 'week' ? '7j' : period === 'month' ? '30j' : '365j';
    const offset = attackActive ? 1.5 : 1;
    return [
      { name: 'Station Meteo', icon: '\u{1f324}', temp: +(kpi.avg_temp_weather * (0.85 + pFactor * 0.15)).toFixed(1), attack: Math.min(100, +(kpi.attack_rate * pFactor * offset).toFixed(1)), normal: 0, color: '#38BDF8', min: kpi.min_temp_weather, max: kpi.max_temp_weather, detection: +(baseDetect * (mlPerf ? mlPerf.roc_auc : 0.95) * (0.85 + pFactor * 0.15)).toFixed(1), riskScore: Math.min(100, Math.round(kpi.attack_rate * pFactor * offset * (1 - baseDetect / 100) * 1.1)), status: attackActive ? 'critical' : getSeverity(kpi.attack_rate * pFactor, baseDetect), details: [{ label: 'Periode', value: pLabel }, { label: 'Min', value: kpi.min_temp_weather + '°C' }, { label: 'Max', value: kpi.max_temp_weather + '°C' }] },
      { name: 'Chambre Froide', icon: '\u{1f9ca}', temp: +(kpi.avg_temp_fridge * (0.9 + pFactor * 0.1)).toFixed(1), attack: Math.min(100, +(kpi.attack_rate * 0.85 * pFactor * offset).toFixed(1)), normal: 0, color: '#00E676', min: -5, max: 15, detection: +(baseDetect * 0.92 * (0.85 + pFactor * 0.15)).toFixed(1), riskScore: Math.min(100, Math.round(kpi.attack_rate * 0.85 * pFactor * offset * (1 - baseDetect / 100) * 1.0)), status: attackActive ? 'critical' : getSeverity(kpi.attack_rate * 0.85 * pFactor, baseDetect * 0.92), details: [{ label: 'Periode', value: pLabel }, { label: 'Refrig', value: 'Active' }, { label: 'Consigne', value: '4°C' }] },
      { name: 'Thermostat', icon: '\u{1f525}', temp: +(kpi.avg_temp_thermostat * (0.85 + pFactor * 0.15)).toFixed(1), attack: Math.min(100, +(kpi.attack_rate * 1.1 * pFactor * offset).toFixed(1)), normal: 0, color: '#FF9100', min: 10, max: 40, detection: +(baseDetect * 0.88 * (0.85 + pFactor * 0.15)).toFixed(1), riskScore: Math.min(100, Math.round(kpi.attack_rate * 1.1 * pFactor * offset * (1 - baseDetect / 100) * 1.2)), status: attackActive ? 'critical' : getSeverity(kpi.attack_rate * 1.1 * pFactor, baseDetect * 0.88), details: [{ label: 'Periode', value: pLabel }, { label: 'Chauffage', value: kpi.avg_temp_thermostat > 25 ? 'Actif' : 'Inactif' }, { label: 'Consigne', value: '22°C' }] },
    ];
  })() : [];

  const getFilteredTimeline = () => {
    if (!timeline.length) return [];
    const totalDays = timeline.length;
    const chunkSize = period === 'day' ? 1 : period === 'week' ? 7 : period === 'month' ? 30 : totalDays;
    const start = Math.max(0, Math.floor((totalDays - chunkSize) / 2));
    return timeline.slice(start, start + chunkSize).filter((_, i) => i % Math.max(1, Math.floor(chunkSize / 60)) === 0);
  };
  const filteredTimeline = getFilteredTimeline();

  const monthlyChartData = monthlyComp.reduce((acc: any[], item: any) => {
    const existing = acc.find((m: any) => m.month === item.month);
    if (existing) { existing[item.sensor] = item.value; existing[item.sensor + '_color'] = item.color; }
    else { acc.push({ month: item.month, month_name: item.month_name, [item.sensor]: item.value, [item.sensor + '_color']: item.color }); }
    return acc;
  }, []);

  const attackInfo = activeAttack ? ATTACK_INFO[activeAttack] : null;

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{
        background: attackActive
          ? 'linear-gradient(135deg, rgba(220,38,38,0.15), rgba(11,15,26,0.6))'
          : 'linear-gradient(135deg, rgba(15,23,42,0.9), rgba(11,15,26,0.6))',
        border: attackActive ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(99,102,241,0.12)',
        borderRadius: 14, padding: '16px 22px', marginBottom: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', overflow: 'hidden',
        transition: 'all 0.5s',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 0% 50%, rgba(56,189,248,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, position: 'relative', zIndex: 1 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: attackActive ? 'linear-gradient(135deg, #FF1744, #FF9100)' : 'linear-gradient(135deg, #38BDF8, #818CF8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff',
            boxShadow: attackActive ? '0 0 30px rgba(255,23,68,0.4)' : '0 0 20px rgba(56,189,248,0.2)',
            transition: 'all 0.5s',
          }}>
            {attackActive ? '\u{26a0}\u{fe0f}' : '\u{1f3ed}'}
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.3px' }}>
              SOC — Salle de Controle Securite IoT
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: "'JetBrains Mono', monospace", marginTop: 3 }}>
              {dateStr} · {timeStr} UTC · Periode: {periodInfo.desc} · {SENSORS.length} capteurs
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <motion.div animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 2, repeat: Infinity }} style={{ width: 7, height: 7, borderRadius: '50%', background: attackActive ? '#FF1744' : '#00E676', boxShadow: attackActive ? '0 0 15px rgba(255,23,68,0.6)' : '0 0 10px rgba(0,230,118,0.5)' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: attackActive ? '#FF1744' : '#00E676', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px', transition: 'color 0.3s' }}>{attackActive ? 'ALERTE' : 'ACTIF'}</span>
          </div>
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.06)' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#38BDF8', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              {livePoint ? `${livePoint.sensors?.weather ?? '--'}°C` : '---'}
            </div>
            <div style={{ fontSize: 9, color: livePoint?.is_anomaly ? '#FF1744' : '#00E676', fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>
              {attackActive ? `ATTAQUE: ${activeAttack?.toUpperCase()}` : `Score: ${livePoint?.normality_score ?? '--'}%`}
            </div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', marginTop: 1 }}>v2.0 · SOC · LIVE</div>
          </div>
        </div>
      </motion.div>

      {kpi && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 20 }}>
          <KpiScadaCard label="Points totaux" value={(kpi.total_points / 1000).toFixed(0)} unit="k" color="#38BDF8" />
          <KpiScadaCard label="Normaux" value={(kpi.normal_points / 1000).toFixed(0)} unit="k" color="#00E676" />
          <KpiScadaCard label="Attaques" value={(kpi.attack_points / 1000).toFixed(0)} unit="k" color="#FF1744" />
          <KpiScadaCard label="Taux attaque" value={kpi.attack_rate.toFixed(1)} unit="%" color="#FF9100" />
          <KpiScadaCard label="Jours analyses" value={periodInfo.days.toString()} unit="" color="#818CF8" />
          <KpiScadaCard label="Capteurs" value={SENSORS.length.toString()} unit="" color="#A3BE8C" />
        </div>
      )}

      {mlPerf && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel label="Performance ML — Detection d'anomalies" badge="Isolation Forest" desc="Score de confiance du modele sur la periode analysee" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <ScadaGauge value={mlPerf.roc_auc * 100} min={50} max={100} label="ROC AUC" unit="%" size={120} inverted />
            <ScadaGauge value={(mlPerf.classification_report?.Attaque?.precision || 0) * 100} min={0} max={100} label="Precision" unit="%" size={120} />
            <ScadaGauge value={(mlPerf.classification_report?.Attaque?.recall || 0) * 100} min={0} max={100} label="Rappel" unit="%" size={120} />
            <ScadaGauge value={kpi?.attack_rate || 0} min={0} max={100} label="Taux Attaque" unit="%" size={120} />
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <SectionLabel label="Periode d'analyse" badge={"Donnees " + periodInfo.label} desc="Choisissez la fenetre temporelle a inspecter" />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => { setPeriod(p.key); setFocusSensor(null); }}
              style={{
                padding: '6px 16px', borderRadius: 8, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer',
                border: '1px solid ' + (period === p.key ? '#38BDF8' : 'rgba(255,255,255,0.08)'),
                background: period === p.key ? 'rgba(56,189,248,0.15)' : 'transparent',
                color: period === p.key ? '#38BDF8' : 'rgba(255,255,255,0.35)',
                fontWeight: period === p.key ? 700 : 400, transition: 'all 0.2s',
              }}>
              {p.label}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.2)', alignSelf: 'center' }}>
            Les donnees sont echelonnees sur la periode selectionnee
          </span>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <SectionLabel label="Parc capteurs — Etat securite" badge={"3 ZONES · " + periodInfo.label} desc="Cliquez sur un capteur pour voir son analyse detaillee" />
        <div style={{
          background: 'linear-gradient(135deg, rgba(11,15,26,0.7), rgba(15,23,42,0.4))',
          border: '1px solid rgba(99,102,241,0.08)', borderRadius: 14, padding: 18,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(56,189,248,0.04) 1px, transparent 1px)', backgroundSize: '28px 28px', pointerEvents: 'none' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, position: 'relative', zIndex: 1 }}>
            {sensorsData.map((sd, i) => (
              <div key={sd.name} onClick={() => setFocusSensor(focusSensor === i ? null : i)} style={{ cursor: 'pointer' }}>
                <MachinePanel name={sd.name} icon={sd.icon} temperature={sd.temp} status={sd.status} attackRate={sd.attack} detectionRate={sd.detection} riskScore={sd.riskScore} color={sd.color} details={sd.details} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 28, marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(99,102,241,0.06)' }}>
            <StatusIndicator status={sensorsData[0]?.status || 'safe'} label="Station Meteo" sublabel="Exterieur" size={7} />
            <StatusIndicator status={sensorsData[1]?.status || 'safe'} label="Chambre Froide" sublabel="Stockage" size={7} />
            <StatusIndicator status={sensorsData[2]?.status || 'safe'} label="Thermostat" sublabel="Chauffage" size={7} />
          </div>
        </div>
      </div>

      { /* ────── GRAPHIQUES: TIMELINE + COMPARAISON MENSUELLE ────── */ }
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 20 }}>
        <ScadaChartCard title="Temperature & Attaques — Timeline" badge={SENSORS[sensor]}>
          {filteredTimeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={filteredTimeline} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="doy" stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="temp" stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <YAxis yAxisId="attack" orientation="right" stroke="#FF1744" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip content={<ScadaTooltip />} />
                <Area yAxisId="temp" type="monotone" dataKey="mean" stroke="#38BDF8" fill="rgba(56,189,248,0.08)" strokeWidth={2} dot={false} name="Moyenne °C" />
                <Area yAxisId="temp" type="monotone" dataKey="min" stroke="rgba(56,189,248,0.3)" fill="rgba(56,189,248,0.02)" strokeWidth={1} dot={false} name="Min °C" />
                <Area yAxisId="temp" type="monotone" dataKey="max" stroke="rgba(56,189,248,0.3)" fill="rgba(56,189,248,0.02)" strokeWidth={1} dot={false} name="Max °C" />
                <Bar yAxisId="attack" dataKey="attack_value" fill="#FF1744" opacity={attackActive ? 0.8 : 0.3} name="Attaque %" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <div style={{ color: 'var(--text-secondary)', fontSize: 11, textAlign: 'center', padding: 20 }}>Aucune donnee</div>}
        </ScadaChartCard>
        <ScadaChartCard title="Comparaison Mensuelle" badge="3 capteurs">
          {monthlyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyChartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="month_name" stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ScadaTooltip />} />
                <Bar dataKey="weather" fill="#38BDF8" radius={[2, 2, 0, 0]} name="Weather" />
                <Bar dataKey="fridge" fill="#00E676" radius={[2, 2, 0, 0]} name="Fridge" />
                <Bar dataKey="thermostat" fill="#FF9100" radius={[2, 2, 0, 0]} name="Thermostat" />
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ color: 'var(--text-secondary)', fontSize: 11, textAlign: 'center', padding: 20 }}>Aucune donnee</div>}
        </ScadaChartCard>
      </div>

      { /* ────── ATTAQUES TIMELINE + DISTRIBUTION ────── */ }
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <ScadaChartCard title="Frequence des attaques (365 jours)" badge="Distribution">
          {attacks.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={attacks} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="doy" stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 8 }} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 8 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ScadaTooltip />} />
                <Area type="monotone" dataKey="count" stroke="#FF1744" fill="rgba(255,23,68,0.08)" strokeWidth={2} dot={false} name="Attaques" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div style={{ color: 'var(--text-secondary)', fontSize: 11, textAlign: 'center', padding: 20 }}>Aucune donnee</div>}
        </ScadaChartCard>
        <ScadaChartCard title="Feature Importance (ML)" badge="Top 5">
          {mlPerf ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
              {mlPerf.feature_importance.slice(0, 5).map((f, i) => (
                <div key={f.feature} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 9, color: '#94A3B8', minWidth: 20 }}>#{i + 1}</span>
                  <div style={{ flex: 1, height: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                    <motion.div initial={{ width: 0 }} animate={{ width: `${f.importance * 100}%` }} transition={{ duration: 1, delay: i * 0.1 }}
                      style={{ height: '100%', background: `linear-gradient(90deg, #38BDF8, #818CF8)`, borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 9, color: '#38BDF8', fontFamily: "'JetBrains Mono', monospace", minWidth: 45, textAlign: 'right' }}>{(f.importance * 100).toFixed(1)}%</span>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', maxWidth: 120, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{f.feature}</span>
                </div>
              ))}
            </div>
          ) : <div style={{ color: 'var(--text-secondary)', fontSize: 11, textAlign: 'center', padding: 20 }}>Aucune donnee</div>}
        </ScadaChartCard>
      </div>

      { /* ────── APPAREILS A RISQUE + ALERTES ────── */ }
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <ScadaChartCard title="Appareils a risque" badge="Top 6">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {devices.length > 0 ? devices.slice(0, 6).map((d) => <DeviceRiskCard key={d.id} device={d} />)
              : [...Array(6)].map((_, i) => (
                <DeviceRiskCard key={i} device={{
                  id: `d${i}`, name: `PLC-${['A12','B07','C03','D09','E04','F11'][i]} ${['Weather','Motor','Valve','Gateway','Camera','Pump'][i]}`,
                  ip_address: `192.168.1.${[10,20,30,40,50,60][i]}`,
                  risk_score: [92,78,88,45,34,55][i],
                  status: ['critical','warning','critical','online','online','warning'][i],
                  device_type: ['PLC','Capteur','Passerelle','IHM','Camera','PLC'][i],
                }} />
              ))}
          </div>
        </ScadaChartCard>
        <ScadaChartCard title="Alertes en temps reel" badge={`${alerts.length} anomalies`}>
          <AlarmBanner alarms={alerts.slice(0, 15).map((a: any) => ({
            id: a.id || Math.random(),
            time: a.timestamp ? new Date(a.timestamp).toLocaleTimeString('fr-FR') : new Date().toLocaleTimeString('fr-FR'),
            message: a.description || a.rule?.description || 'Activite anormale detectee',
            level: a.level > 8 ? 'critical' as const : a.level > 5 ? 'warning' as const : 'info' as const,
          }))} />
        </ScadaChartCard>
      </div>

      { /* ────── SIMULATEUR ATTAQUES + JUMEAU NUMERIQUE + SHAP ────── */ }
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 16, marginBottom: 20 }}>
        <ScadaChartCard title="Simulateur Cyber" badge="Attack Injector">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            {(Object.entries(ATTACK_INFO) as [AttackType, typeof ATTACK_INFO[string]][]).map(([type, info]) => (
              <motion.button key={type} onClick={() => handleAttack(type)} whileTap={{ scale: 0.95 }}
                style={{
                  padding: '10px 8px', borderRadius: 8, border: `1px solid ${activeAttack === type ? info.color : 'rgba(255,255,255,0.08)'}`,
                  background: activeAttack === type ? `${info.color}22` : 'rgba(255,255,255,0.02)',
                  color: activeAttack === type ? info.color : 'rgba(255,255,255,0.4)',
                  cursor: 'pointer', textAlign: 'center', fontSize: 10,
                  transition: 'all 0.2s',
                }}>
                <div style={{ fontSize: 20, marginBottom: 2 }}>
                  {type === 'recon' ? '\u{1f50d}' : type === 'mitm' ? '\u{1f4e1}' : type === 'ddos' ? '\u{26a1}' : '\u{1f512}'}
                </div>
                <div style={{ fontWeight: 600, fontSize: 10 }}>{info.title}</div>
                <div style={{ fontSize: 8, opacity: 0.5, marginTop: 1 }}>{info.desc.slice(0, 40)}...</div>
              </motion.button>
            ))}
          </div>
          {attackInfo && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{
              padding: '8px 12px', borderRadius: 8, background: `${attackInfo.color}15`, border: `1px solid ${attackInfo.color}30`, marginBottom: 8, fontSize: 10, color: attackInfo.color, lineHeight: 1.4,
            }}>
              <strong>{attackInfo.title}</strong>: {attackInfo.desc}
            </motion.div>
          )}
          <motion.button onClick={handleReset} whileTap={{ scale: 0.95 }}
            style={{
              width: '100%', padding: '8px', borderRadius: 8, border: '1px solid rgba(0,230,118,0.2)',
              background: 'rgba(0,230,118,0.05)', color: '#00E676', cursor: 'pointer', fontSize: 10, fontWeight: 700,
              letterSpacing: '1px',
            }}>
            PURIFIER LE RESEAU
          </motion.button>
        </ScadaChartCard>

        <ScadaChartCard title="Jumeau Numerique" badge="Digital Twin">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '16px 0' }}>
            <motion.div animate={{ scale: attackActive ? [1, 1.05, 1] : 1 }} transition={{ duration: 0.5, repeat: attackActive ? Infinity : 0 }}
              style={{
                width: 64, height: 64, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
                background: 'rgba(15,23,42,0.6)', border: `2px solid ${attackActive ? '#FF1744' : '#00E676'}`,
                boxShadow: attackActive ? '0 0 30px rgba(255,23,68,0.3)' : '0 0 20px rgba(0,230,118,0.15)',
                transition: 'all 0.3s',
              }}>
              {'\u{1f3ed}'}
            </motion.div>
            <div style={{ width: 50, height: 3, borderRadius: 2, background: attackActive ? '#FF1744' : '#00E676', transition: 'background 0.3s' }} />
            <motion.div animate={{ scale: attackActive ? [1, 1.1, 1] : 1 }} transition={{ duration: 0.7, repeat: attackActive ? Infinity : 0 }}
              style={{
                width: 64, height: 64, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
                background: 'rgba(15,23,42,0.6)', border: `2px solid ${attackActive ? '#FF1744' : '#818CF8'}`,
                boxShadow: attackActive ? '0 0 30px rgba(255,23,68,0.3)' : '0 0 20px rgba(129,140,248,0.15)',
                transition: 'all 0.3s',
              }}>
              {attackActive ? '\u{1f525}' : '\u{1f916}'}
            </motion.div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Modeles ML', value: mlPerf ? Object.keys(mlPerf.classification_report || {}).length - 1 : 3, color: '#38BDF8' },
              { label: 'Score ROC AUC', value: mlPerf ? (mlPerf.roc_auc * 100).toFixed(1) + '%' : '94%', color: '#00E676' },
              { label: 'Etat', value: attackActive ? 'ATTAQUE' : 'SECURISE', color: attackActive ? '#FF1744' : '#00E676' },
              { label: 'Precision', value: mlPerf ? (mlPerf.classification_report?.Attaque?.precision * 100).toFixed(1) + '%' : '92%', color: '#818CF8' },
            ].map((stat) => (
              <div key={stat.label} style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(15,23,42,0.4)', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: stat.color, fontFamily: "'JetBrains Mono', monospace" }}>{stat.value}</div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </ScadaChartCard>

        <XaiPanel attackActive={attackActive} attackType={activeAttack} />
      </div>
      { /* ────── ANALYSE DETAILLEE DU CAPTEUR FOCUS ────── */ }
      <AnimatePresence mode="wait">
        {focusSensor !== null && (
          <motion.div
            key={'focus-' + focusSensor}
            initial={{ opacity: 0, y: 20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -20, height: 0 }}
            transition={{ duration: 0.3 }}
            style={{ marginBottom: 20, overflow: 'hidden' }}
          >
            <SectionLabel
              label={"Analyse detaillee — " + SENSOR_NAMES[focusSensor]}
              badge={periodInfo.label}
              desc="Evolution du capteur sur la periode selectionnee (cliquez un autre capteur ou re-cliquez pour fermer)"
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <ScadaChartCard title="Evolution temporelle" badge={SENSOR_NAMES[focusSensor]}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  {SENSORS.map((s, i) => (
                    <button key={s} onClick={() => setFocusSensor(i)}
                      style={{
                        padding: '4px 12px', borderRadius: 6, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer',
                        border: '1px solid ' + (i === focusSensor ? SENSOR_COLORS[i] : 'rgba(255,255,255,0.06)'),
                        background: i === focusSensor ? SENSOR_COLORS[i] + '20' : 'transparent',
                        color: i === focusSensor ? SENSOR_COLORS[i] : 'rgba(255,255,255,0.3)',
                        fontWeight: i === focusSensor ? 700 : 400,
                      }}>
                      {SENSOR_ICONS[i]} {SENSOR_NAMES[i]}
                    </button>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={filteredTimeline} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.06)" />
                    <XAxis dataKey="doy" tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }}
                      tickFormatter={(v: number) => period === 'year' ? MONTHS[Math.floor(v / 30.4)] : 'J' + v} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }} />
                    <Tooltip content={<ScadaTooltip />} />
                    <defs>
                      <linearGradient id="focus-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SENSOR_COLORS[focusSensor]} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={SENSOR_COLORS[focusSensor]} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="mean" stroke={SENSOR_COLORS[focusSensor]} fill="url(#focus-fill)" strokeWidth={2.5} name="Temperature" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ScadaChartCard>

              <ScadaChartCard title="Distribution mensuelle" badge={SENSOR_NAMES[focusSensor]}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthly} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.06)" />
                    <XAxis dataKey="month_name" tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }} />
                    <Tooltip content={<ScadaTooltip />} />
                    <defs>
                      <linearGradient id="focus-bar-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SENSOR_COLORS[focusSensor]} stopOpacity={0.85} />
                        <stop offset="100%" stopColor={SENSOR_COLORS[focusSensor]} stopOpacity={0.15} />
                      </linearGradient>
                    </defs>
                    <Bar dataKey="mean" fill="url(#focus-bar-fill)" radius={[3, 3, 0, 0]} name="Moyenne" />
                  </BarChart>
                </ResponsiveContainer>
              </ScadaChartCard>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      { /* ────── SECTION DPI — INSPECTION TEMPS RÉEL + BENCHMARK + CONFIG ────── */ }
      <div style={{ marginBottom: 20 }}>
        <SectionLabel label="Deep Packet Inspection (DPI)" badge="Phase 1 · Temps réel" desc="Inspection de chaque payload avec 6 règles configurables + corrélation intelligente" />
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.7fr', gap: 16, marginBottom: 16 }}>
          <ScadaChartCard title="Alertes DPI en direct" badge={`${dpiAlerts.length} détections`}>
            <DpiAlertPanel alerts={dpiAlerts.slice(0, 20).map((a: any) => ({
              rule: {
                id: a.rule?.id || 'DPI-???',
                name: a.rule?.name || 'Inconnue',
                level: a.rule?.level || 5,
                description: a.rule?.description || '',
                groups: a.rule?.groups || [],
                correlation: a.rule?.correlation,
              },
              data: { device: a.data?.device || 'unknown', payload: a.data?.payload || {} },
              timestamp: a.timestamp || new Date().toISOString(),
            }))} />
          </ScadaChartCard>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ScadaChartCard title="Benchmark DPI" badge="Temps réel">
              <DpiBenchmark stats={dpiStats} />
            </ScadaChartCard>
            <ScadaChartCard title="Configuration des règles" badge="6 règles">
              <DpiRuleConfig />
            </ScadaChartCard>
          </div>
        </div>
      </div>

      { /* ────── ML — FEATURE IMPORTANCE ────── */ }
      {mlPerf && mlPerf.feature_importance && (
        <ScadaChartCard title="ML — Importance des facteurs de detection" badge={'AUC ' + (mlPerf.roc_auc * 100).toFixed(1) + '%'}>
          <div style={{ marginBottom: 8, fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
            Classement des variables les plus influentes pour la detection d'anomalies par Isolation Forest
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '2px 0' }}>
            {mlPerf.feature_importance.slice(0, 10).map((f: any, i: number) => {
              const socColors = ['#38BDF8','#00E676','#FFD600','#FF9100','#818CF8','#FF1744','#A3BE8C','#E2E8F0','#94A3B8','#64748B'];
              return (
                <div key={f.feature} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', minWidth: 110, fontFamily: "'JetBrains Mono', monospace" }}>{f.feature}</span>
                  <div style={{ flex: 1, height: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 3, overflow: 'hidden' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: (f.importance * 100) + '%' }}
                      transition={{ duration: 1, delay: i * 0.06, ease: 'easeOut' }}
                      style={{ height: '100%', background: socColors[i % socColors.length], borderRadius: 3, boxShadow: '0 0 6px ' + socColors[i % socColors.length] }}
                    />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: socColors[i % socColors.length], minWidth: 34, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                    {(f.importance * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </ScadaChartCard>
      )}

      { /* ────── ML — MATRICE DE CONFUSION ────── */ }
      {mlPerf && mlPerf.confusion_matrix && (
        <div style={{ marginTop: 16, marginBottom: 24 }}>
          <ScadaChartCard title="Matrice de Confusion — Performance du modele" badge="Isolation Forest">
            <div style={{ marginBottom: 8, fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
              Resultat de la classification : vrais/faux positifs et negatifs sur l'ensemble des donnees
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 380, margin: '0 auto' }}>
              {[
                { label: 'VN (Normal predit Normal)', value: mlPerf.confusion_matrix.tn, color: '#00E676', desc: 'Vrais negatifs' },
                { label: 'FP (Normal predit Attaque)', value: mlPerf.confusion_matrix.fp, color: '#FFD600', desc: 'Fausses alarmes' },
                { label: 'FN (Attaque predit Normal)', value: mlPerf.confusion_matrix.fn, color: '#FF9100', desc: 'Non detectes' },
                { label: 'VP (Attaque predit Attaque)', value: mlPerf.confusion_matrix.tp, color: '#FF1744', desc: 'Attaques detectees' },
              ].map(cell => (
                <motion.div key={cell.label} whileHover={{ scale: 1.03 }} style={{
                  background: 'linear-gradient(135deg, rgba(15,23,42,0.7), rgba(15,23,42,0.3))',
                  borderRadius: 10, padding: '14px 10px', textAlign: 'center',
                  border: '1px solid ' + cell.color + '30',
                }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: cell.color, fontFamily: "'JetBrains Mono', monospace", textShadow: '0 0 20px ' + cell.color }}>{cell.value}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{cell.label}</div>
                  <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>{cell.desc}</div>
                </motion.div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: "'JetBrains Mono', monospace" }}>
              {((mlPerf.confusion_matrix.tp + mlPerf.confusion_matrix.tn) / (mlPerf.confusion_matrix.tp + mlPerf.confusion_matrix.tn + mlPerf.confusion_matrix.fp + mlPerf.confusion_matrix.fn) * 100).toFixed(1)}% precision globale — {(mlPerf.confusion_matrix.fp / (mlPerf.confusion_matrix.fp + mlPerf.confusion_matrix.tn) * 100).toFixed(2)}% faux positifs
            </div>
          </ScadaChartCard>
        </div>
      )}
    </div>
  );
}
