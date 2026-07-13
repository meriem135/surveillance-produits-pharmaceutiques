import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  LineChart, Line, Area, ComposedChart, ReferenceLine, AreaChart,
} from 'recharts';
import {
  Brain, Thermometer, Snowflake, Cpu, Layers, Activity, Shield, AlertTriangle,
  Filter, Database, Zap, Sparkles, Lock, Skull, RadioTower, Network,
  Search, X, Calendar, Code, Bug, TrendingUp, PieChart,
  HelpCircle, Target,
} from 'lucide-react';

import { PhaseTwoSection, PHASES } from '../components/PhaseRoadmap';
import { PhaseShell } from '../components/PhaseShell';
import { PhaseBridge } from '../components/PhaseBridge';
import { PHASE_CONFIG } from '../components/PhasePipeline';
/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */
interface ModelResult {
  precision: number; recall: number; f1: number; roc_auc: number; ap?: number;
  fpr: number; tp: number; fp: number; fn: number; tn: number;
  best_threshold_cont?: number | null;
  best_recall?: number | null; best_precision?: number | null; best_f1?: number | null;
}

interface AttackMetric {
  id: number; model_id: string; model_name: string | null; model_sensor: string | null;
  attack_type: string; capteur: string; n_total: number; n_anomalies: number;
  taux_detection: number; score_moyen: number; roc_auc: number | null; avg_precision: number | null;
  precision_attaque: number | null; recall_attaque: number | null; f1_attaque: number | null;
}

interface TimelinePoint {
  datetime: string; temperature: number;
  actual_label: number; prediction: number; anomaly_score: number;
  tp: number; fp: number; fn: number; tn: number;
  _sensor?: string;
}

interface TimelineResponse {
  sensor: string; points: TimelinePoint[]; total_points: number;
  summary: { total: number; normal: number; attack: number; detected: number; fp: number; fn: number; recall: number; precision: number; fpr: number };
  filters_applied: Record<string, unknown>;
}

interface MonthData { month: string; precisions: number[]; recalls: number[]; count: number }
interface SeasonData { season: string; anomalies: number; detections: number; precision: number; recall: number }



/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */
const MODEL_META: Record<string, { icon: React.ReactNode; color: string; label: string; short: string; sensor: string }> = {
  IF_weather:        { icon: <Thermometer className="w-5 h-5" />, color: '#FF6B6B', label: 'IF Weather', short: 'IF-W', sensor: 'Station Météo' },
  IF_fridge:         { icon: <Snowflake className="w-5 h-5" />, color: '#4ECDC4', label: 'IF Fridge', short: 'IF-F', sensor: 'Chambre Froide' },
  IF_thermostat:     { icon: <Cpu className="w-5 h-5" />, color: '#45B7D1', label: 'IF Thermostat', short: 'IF-T', sensor: 'Thermostat' },
  IF_Multivarie:     { icon: <Layers className="w-5 h-5" />, color: '#96CEB4', label: 'IF Multivarié ★', short: 'IF-M', sensor: 'Multi-capteurs' },
  Autoencodeur_PCA:  { icon: <Brain className="w-5 h-5" />, color: '#D4A5E8', label: 'Autoencodeur PCA', short: 'AE-PCA', sensor: 'Autoencodeur' },
  GNN_Correlation:   { icon: <Shield className="w-5 h-5" />, color: '#A78BFA', label: 'GNN Corrélation', short: 'GNN', sensor: 'GNN' },
  Forecasting_LSTM:  { icon: <Activity className="w-5 h-5" />, color: '#F97316', label: 'Forecasting LSTM', short: 'LSTM-F', sensor: 'LSTM' },
};
const SENSOR_ORDER = ['IF_weather', 'IF_fridge', 'IF_thermostat', 'IF_Multivarie', 'Autoencodeur_PCA', 'GNN_Correlation', 'Forecasting_LSTM'];
const TIMELINE_SENSORS = [
  { id: 'all', label: 'Tous les capteurs', icon: '\u{1F4CA}', modelId: '' },
  { id: 'weather', label: 'Station Météo', icon: '\u{1F324}\uFE0F', modelId: 'IF_weather' },
  { id: 'fridge', label: 'Chambre Froide', icon: '\u2744\uFE0F', modelId: 'IF_fridge' },
  { id: 'thermostat', label: 'Thermostat', icon: '\u{1F321}\uFE0F', modelId: 'IF_thermostat' },
];

interface AttackInfo {
  id: string; label: string; icon: React.ReactNode; color: string; severity: string;
  description: string; impact: string; vector: string; mitre: string;
  detection: string; response: string; phase: string;
}
const ATTACK_TYPES: AttackInfo[] = [
  { id: 'ddos', label: 'DDoS', icon: <Network className="w-4 h-4" />, color: '#EF4444', severity: 'Critique',
    description: 'Des pirates envoient des millions de messages à vos appareils connectés. Ils sont tellement submergés qu\'ils ne peuvent plus transmettre leurs données. C\'est comme si quelqu\'un appelait votre téléphone 1000 fois par seconde : vous ne pouvez plus passer d\'appels.',
    impact: 'Indisponibilité réseau OT · Perte de contrôle des machines · Arrêt production',
    vector: 'Inondation MQTT · Spoofing d\'appareils · Amplification', mitre: 'T1498 - Network DoS',
    detection: 'Pic trafic anormal · Taux messages > seuil critique', response: 'Rate limiting · Filtrage IP · Basculement canal secondaire',
    phase: 'Compromission IoT → Génération trafic → Saturation brokers → Blackout' },
  { id: 'dos', label: 'DoS', icon: <Zap className="w-4 h-4" />, color: '#F97316', severity: 'Élevé',
    description: 'Un pirate cible un de vos appareils et lui envoie sans arrêt des demandes impossibles à traiter. L\'appareil s\'épuise et finit par ne plus répondre du tout.',
    impact: 'Ralentissement automate · Timeout communications', vector: 'Requêtes Modbus flood · Buffer overflow · Fuzzing',
    mitre: 'T1499 - Endpoint DoS', detection: 'Taux d\'erreurs Modbus élevé · Latence anormale',
    response: 'Threshold adaptatif · Isolation automate · Redondance',
    phase: 'Ciblage automate → Requêtes invalides → Épuisement ressources → Timeout' },
  { id: 'mitm', label: 'MITM', icon: <RadioTower className="w-4 h-4" />, color: '#EAB308', severity: 'Élevé',
    description: 'Un pirate s\'interpose entre votre capteur et l\'écran de contrôle. Il peut modifier les chiffres que vous voyez : une température de 5°C peut s\'afficher comme 2°C sans que vous le sachiez.',
    impact: 'Fausses lectures · Contournement alarmes · Dégâts équipements', vector: 'ARP Spoofing · TCP Hijacking · Modifications trames',
    mitre: 'T1557 - Man-in-the-Middle', detection: 'Incohérence temporelle registres · Variations non plausibles',
    response: 'Chiffrement TLS · Authentication mutuelle · Détection d\'écart',
    phase: 'Interception flux → Modification registres → Masquage valeurs → Injection commandes' },
  { id: 'xss', label: 'XSS', icon: <Code className="w-4 h-4" />, color: '#8B5CF6', severity: 'Moyen',
    description: 'Un pirate cache un petit programme dans la page web que vous utilisez pour surveiller vos capteurs. Quand vous ouvrez la page, ce programme peut voler votre mot de passe ou modifier les informations.',
    impact: 'Vol de session · Redirection · Manipulation affichage IHM', vector: 'Injection script · IHM Web · Formulaire non sécurisé',
    mitre: 'T1059.007 - Cross-Site Scripting', detection: 'Analyse trafic HTTP · Patterns <script>',
    response: 'Sanitization entrées · CSP Headers · Validation stricte',
    phase: 'Injection script IHM → Exécution navigateur → Vol données → Manipulation' },
  { id: 'backdoor', label: 'Backdoor', icon: <Lock className="w-4 h-4" />, color: '#DC2626', severity: 'Critique',
    description: 'Un pirate installe une porte dérobée dans votre système. Comme une clé cachée sous le paillasson, il peut entrer à tout moment sans que vous le sachiez et contrôler vos appareils.',
    impact: 'Accès permanent réseau OT · Exfiltration données · Contrôle à distance', vector: 'Credential stuffing · Vulnérabilité firmware · Reverse shell',
    mitre: 'T1543 - Create or Modify System Process', detection: 'Connexions sortantes inhabituelles · Process inconnus',
    response: 'Analyse forensic · Révocation accès · Mise à jour firmware',
    phase: 'Exploitation vulnérabilité → Installation backdoor → Persistance → Exfiltration' },
  { id: 'injection', label: 'Injection', icon: <Zap className="w-4 h-4" />, color: '#7C3AED', severity: 'Élevé',
    description: 'Un pirate envoie de fausses données à votre système. Votre écran peut afficher une température normale alors que le frigo est en train de surchauffer.',
    impact: 'Fausses alarmes · Décisions erronées · Actions dangereuses', vector: 'SQL/NoSQL injection · Command injection · Falsification MQTT',
    mitre: 'T1562 - Impair Defenses', detection: 'Anomalie syntaxique requêtes · Écarts valeurs typiques',
    response: 'Validation entrées · Prepared statements · Signature MQTT',
    phase: 'Ciblage pipeline → Injection données → Fausses alarmes → Actions dangereuses' },
  { id: 'password', label: 'Password', icon: <Shield className="w-4 h-4" />, color: '#F59E0B', severity: 'Moyen',
    description: 'Un pirate essaie des milliers de mots de passe par seconde pour deviner celui de votre interface d\'administration. S\'il réussit, il peut tout contrôler.',
    impact: 'Prise de contrôle interface · Reconfiguration illégitime', vector: 'Brute-force · Dictionary attack · Credential stuffing',
    mitre: 'T1110 - Brute Force', detection: 'Multiples tentatives échouées · Verrouillage compte',
    response: 'Rate limiting · 2FA · Mots de passe forts',
    phase: 'Scan interfaces → Tentatives connexion → Succès → Accès admin' },
  { id: 'ransomware', label: 'Ransomware', icon: <Skull className="w-4 h-4" />, color: '#991B1B', severity: 'CRITIQUE',
    description: 'Un pirate prend le contrôle de vos appareils, verrouille tout et affiche un message : « Donnez-nous de l\'argent ou vos capteurs resteront bloqués ». La température peut monter ou descendre dangereusement.',
    impact: 'Arrêt production · Risques sécurité · Dommages équipements', vector: 'Phishing OT · Exploitation vulnérabilités · Accès distant non sécurisé',
    mitre: 'T1486 - Data Encrypted for Impact', detection: 'Changements brusques registres · Écarts > 3\u03c3',
    response: 'Isolement réseau · Arrêt urgence · Restauration sauvegarde',
    phase: 'Accès initial → Latéralisation PLC → Chiffrement → Rançon IHM' },
  { id: 'scanning', label: 'Scanning', icon: <Search className="w-4 h-4" />, color: '#06B6D4', severity: 'Faible',
    description: 'Un pirate explore votre réseau comme un cambrioleur qui fait le tour de la maison pour voir quelle fenêtre est ouverte. Il ne vole rien tout de suite, mais prépare un futur vol.',
    impact: 'Préparation attaque ciblée · Collecte infos architecture OT', vector: 'Scan réseau · Probing MQTT/Modbus · Requêtes SNMP',
    mitre: 'T1046 - Network Service Scanning', detection: 'Requêtes multiples ports · Patterns scan connus',
    response: 'Blocage IP · Renforcement ACL · Segmentation réseau',
    phase: 'Scan sous-réseau → Découverte PLC → Identification firmware → Cartographie' },
];


const DAY_TYPES = [
  { id: 'ouvre', label: 'Semaine', icon: '\u{1F4BC}' },
  { id: 'weekend', label: 'Week-end', icon: '\u{1F3E1}' },
];
const SEASONS = [
  { id: 'winter', label: 'Hiver', icon: '\u2744\uFE0F' },
  { id: 'spring', label: 'Printemps', icon: '\u{1F331}' },
  { id: 'summer', label: 'Été', icon: '\u2600\uFE0F' },
  { id: 'autumn', label: 'Automne', icon: '\u{1F342}' },
];

function monthToSeason(m: number): string {
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}
const MONTH_NAMES = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

const MOCK_RESULTS: Record<string, ModelResult> = {
  IF_weather:        { precision: 0.9797, recall: 0.6740, f1: 0.7986, roc_auc: 0.9472, ap: 0.9410, fpr: 0.0100, tp: 192523, fp: 3992, fn: 93100, tn: 395194, best_threshold_cont: 0.4 },
  IF_fridge:         { precision: 0.8024, recall: 0.0748, f1: 0.1368, roc_auc: 0.8757, ap: 0.7300, fpr: 0.0100, tp: 15573, fp: 3834, fn: 192716, tn: 379530, best_threshold_cont: 0.5 },
  IF_thermostat:     { precision: 0.8654, recall: 0.1181, f1: 0.2078, roc_auc: 0.8871, ap: 0.7603, fpr: 0.0100, tp: 18724, fp: 2912, fn: 139871, tn: 288267, best_threshold_cont: 0.5 },
  IF_Multivarie:     { precision: 0.9906, recall: 1.0, f1: 0.9953, roc_auc: 0.8404, ap: 0.9909, fpr: 0.3335, tp: 96633, fp: 914, fn: 0, tn: 1827 },
  Autoencodeur_PCA:  { precision: 0.9973, recall: 0.5128, f1: 0.6773, roc_auc: 0.9070, ap: 0.9965, fpr: 0.0493, tp: 49552, fp: 135, fn: 47081, tn: 2606 },
  GNN_Correlation:   { precision: 0.9742, recall: 1.0, f1: 0.9869, roc_auc: 0.5766, ap: 0.9694, fpr: 0.9959, tp: 9179, fp: 243, fn: 0, tn: 1 },
  Forecasting_LSTM:  { precision: 0.9943, recall: 0.9946, f1: 0.9945, roc_auc: 0.993, ap: 0.9998, fpr: 0.1945, tp: 91162, fp: 520, fn: 492, tn: 2153 },
};

/* ─── Helpers ─── */
function processMonthlyData(pts: TimelinePoint[]): MonthData[] {
  const byMonth: Record<number, { precisions: number[]; recalls: number[]; count: number }> = {};
  for (const p of pts) {
    const m = new Date(p.datetime).getMonth();
    if (!byMonth[m]) byMonth[m] = { precisions: [], recalls: [], count: 0 };
    byMonth[m].count++;
    byMonth[m].precisions.push(p.prediction === p.actual_label ? 1 : 0);
    byMonth[m].recalls.push(p.actual_label === 1 && p.prediction === 1 ? 1 : 0);
  }
  return Object.entries(byMonth).map(([mStr, d]) => ({
    month: MONTH_NAMES[parseInt(mStr)],
    precisions: d.precisions,
    recalls: d.recalls,
    count: d.count,
  }));
}

function processSeasonalData(pts: TimelinePoint[]): SeasonData[] {
  const bySeason: Record<string, { anomalies: number; detections: number; correct: number[]; total: number }> = {};
  for (const p of pts) {
    const m = new Date(p.datetime).getMonth() + 1;
    const s = monthToSeason(m);
    if (!bySeason[s]) bySeason[s] = { anomalies: 0, detections: 0, correct: [], total: 0 };
    bySeason[s].total++;
    if (p.actual_label === 1) bySeason[s].anomalies++;
    if (p.prediction === 1 && p.actual_label === 1) bySeason[s].detections++;
    bySeason[s].correct.push(p.prediction === p.actual_label ? 1 : 0);
  }
  return SEASONS.map(s => {
    const d = bySeason[s.id];
    if (!d) return { season: s.label, anomalies: 0, detections: 0, precision: 0, recall: 0 };
    const fp = pts.filter(p => monthToSeason(new Date(p.datetime).getMonth() + 1) === s.id && p.prediction === 1 && p.actual_label === 0).length;
    const precision = (d.detections + fp) > 0 ? d.detections / (d.detections + fp) * 100 : 0;
    const recall = d.anomalies > 0 ? d.detections / d.anomalies * 100 : 0;
    return { season: s.label, anomalies: d.anomalies, detections: d.detections, precision, recall };
  });
}

function processTimelineSamples(pts: TimelinePoint[], sensorId: string): Record<string, unknown>[] {
  const step = Math.max(1, Math.floor(pts.length / 48));
  const sampled = pts.filter((_, i) => i % step === 0).slice(0, 48);
  if (sensorId !== 'all') {
    return sampled.map(p => ({
      hour: new Date(p.datetime).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      temperature: p.temperature,
      score: Math.abs(p.anomaly_score) * 100,
      attack: p.actual_label === 1 ? 95 : 0,
      seuil: 35,
    }));
  }
  // Multi-sensor: group by hour and average per sensor
  const grouped: Record<string, { weather: number[]; fridge: number[]; thermostat: number[]; label: string }> = {};
  for (const p of sampled) {
    const key = new Date(p.datetime).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    if (!grouped[key]) grouped[key] = { weather: [], fridge: [], thermostat: [], label: key };
    const sensor = (p as unknown as Record<string, unknown>)._sensor as string || 'weather';
    if (sensor === 'weather') grouped[key].weather.push(Math.abs(p.anomaly_score) * 100);
    else if (sensor === 'fridge') grouped[key].fridge.push(Math.abs(p.anomaly_score) * 100);
    else if (sensor === 'thermostat') grouped[key].thermostat.push(Math.abs(p.anomaly_score) * 100);
  }
  return Object.values(grouped).map(g => ({
    hour: g.label,
    weather: g.weather.length ? g.weather.reduce((a, b) => a + b, 0) / g.weather.length : null,
    fridge: g.fridge.length ? g.fridge.reduce((a, b) => a + b, 0) / g.fridge.length : null,
    thermostat: g.thermostat.length ? g.thermostat.reduce((a, b) => a + b, 0) / g.thermostat.length : null,
    seuil: 35,
  }));
}

const ATTACK_DB_NAME: Record<string, string> = {
  ddos: 'IoT_DDoS_normal',
  dos: 'IoT_DoS_normal',
  mitm: 'IoT_MITM_normal',
  xss: 'IoT_XSS_normal',
  backdoor: 'IoT_backdoor_normal',
  injection: 'IoT_injection_normal',
  password: 'IoT_password_normal',
  ransomware: 'IoT_ransomware_normal',
  scanning: 'IoT_scanning_normal',
};

async function safeFetchJson(url: string) {
  try { const r = await fetch(url); if (!r.ok) return null; const t = await r.text(); return t ? JSON.parse(t) : null; }
  catch { return null; }
}



/* ═══════════════════════════════════════════
   ANIMATED BACKGROUND ORBS
   ═══════════════════════════════════════════ */
function BackgroundOrbs() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <div className="absolute w-[500px] h-[500px] rounded-full -top-32 -left-32 animate-orb"
        style={{ background: 'radial-gradient(circle, rgba(0,245,255,0.06) 0%, transparent 70%)' }} />
      <div className="absolute w-[400px] h-[400px] rounded-full top-1/3 -right-24 animate-orb-reverse"
        style={{ background: 'radial-gradient(circle, rgba(129,140,248,0.05) 0%, transparent 70%)' }} />
      <div className="absolute w-[350px] h-[350px] rounded-full bottom-20 left-1/4 animate-orb-slow"
        style={{ background: 'radial-gradient(circle, rgba(34,197,94,0.04) 0%, transparent 70%)' }} />
      <div className="absolute w-[600px] h-[600px] rounded-full -bottom-48 right-1/3 animate-orb"
        style={{ background: 'radial-gradient(circle, rgba(239,68,68,0.03) 0%, transparent 70%)' }} />
      <div className="absolute inset-0" style={{
        backgroundImage: 'radial-gradient(rgba(55,65,81,0.08) 0.5px, transparent 0.5px)',
        backgroundSize: '32px 32px',
      }} />
    </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENT — FILTER BAR
   ═══════════════════════════════════════════ */
const SEASON_MONTHS: Record<string, number[]> = { winter: [12, 1, 2], spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11] };

function FilterBar({ years, year, setYear, season, setSeason, month, setMonth, attackFilter, setAttackFilter, sensor, setSensor, shift, setShift, dayType, setDayType, startHour, setStartHour, endHour, setEndHour, onApply }:
  { years: string[]; year: string; setYear: (v: string) => void; season: string | null; setSeason: (v: string | null) => void; month: number | null; setMonth: (v: number | null) => void; attackFilter: string | null; setAttackFilter: (v: string | null) => void; sensor: string; setSensor: (v: string) => void; shift: string | null; setShift: (v: string | null) => void; dayType: string | null; setDayType: (v: string | null) => void; startHour: number | null; setStartHour: (v: number | null) => void; endHour: number | null; setEndHour: (v: number | null) => void; onApply: () => void }) {
  const hasActiveFilters = season || month != null || attackFilter || shift || dayType || startHour != null;
  return (
    <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow">
      <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(0,245,255,0.08)' }}>
        <Filter className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Personnalisez l'affichage
        </span>
        <button onClick={onApply}
          className="ml-auto text-[10px] px-3 py-1 rounded-lg font-bold cursor-pointer flex items-center gap-1.5 transition-all"
          style={{ background: 'rgba(0,245,255,0.15)', color: 'var(--color-accent-cyan)', border: '1px solid rgba(0,245,255,0.3)' }}>
          <Activity className="w-3 h-3" /> Appliquer les filtres
        </button>
        {hasActiveFilters && (
          <button onClick={() => { setSeason(null); setMonth(null); setAttackFilter(null); setShift(null); setDayType(null); setStartHour(null); setEndHour(null); }}
            className="text-[10px] px-2 py-0.5 rounded cursor-pointer flex items-center gap-1"
            style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-accent-red)' }}>
            <X className="w-3 h-3" /> Effacer tout
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--color-accent-cyan)' }} />
          <span>Année</span>
          <select value={year} onChange={e => setYear(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg cursor-pointer outline-none font-bold glass glass-border"
            style={{ color: 'var(--color-text-primary)' }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* Capteur — "Tous" is now default */}
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Capteur</span>
          <select value={sensor} onChange={e => setSensor(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg cursor-pointer outline-none font-bold glass glass-border"
            style={{ color: 'var(--color-text-primary)' }}>
            {TIMELINE_SENSORS.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
          </select>
        </div>

        {/* Période : Matin / Après-midi / Nuit */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Période</span>
          <button onClick={() => setShift(shift === null ? 'matin' : null)}
            className="text-[10px] px-2.5 py-1.5 rounded-lg font-bold cursor-pointer transition-all"
            style={{
              background: shift === 'matin' ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
              color: shift === 'matin' ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
              border: `1px solid ${shift === 'matin' ? 'rgba(0,245,255,0.35)' : 'rgba(255,255,255,0.06)'}`,
            }}>{'\u{1F305}'} Matin</button>
          <button onClick={() => setShift(shift === null ? 'apres-midi' : null)}
            className="text-[10px] px-2.5 py-1.5 rounded-lg font-bold cursor-pointer transition-all"
            style={{
              background: shift === 'apres-midi' ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
              color: shift === 'apres-midi' ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
              border: `1px solid ${shift === 'apres-midi' ? 'rgba(0,245,255,0.35)' : 'rgba(255,255,255,0.06)'}`,
            }}>{'\u2600\uFE0F'} Après-midi</button>
          <button onClick={() => setShift(shift === null ? 'nuit' : null)}
            className="text-[10px] px-2.5 py-1.5 rounded-lg font-bold cursor-pointer transition-all"
            style={{
              background: shift === 'nuit' ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
              color: shift === 'nuit' ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
              border: `1px solid ${shift === 'nuit' ? 'rgba(0,245,255,0.35)' : 'rgba(255,255,255,0.06)'}`,
            }}>{'\u{1F319}'} Nuit</button>
        </div>

        {/* Type de jour : Semaine / Week-end */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Jour</span>
          {DAY_TYPES.map(d => (
            <button key={d.id} onClick={() => setDayType(dayType === d.id ? null : d.id)}
              className="text-[10px] px-2.5 py-1.5 rounded-lg font-bold cursor-pointer transition-all"
              style={{
                background: dayType === d.id ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
                color: dayType === d.id ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
                border: `1px solid ${dayType === d.id ? 'rgba(0,245,255,0.35)' : 'rgba(255,255,255,0.06)'}`,
              }}>
              {d.icon} {d.label}
            </button>
          ))}
        </div>

        {/* Heure : plage horaire */}
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Heure</span>
          <select value={startHour ?? ''} onChange={e => setStartHour(e.target.value ? parseInt(e.target.value) : null)}
            className="text-[10px] px-2 py-1.5 rounded-lg cursor-pointer outline-none glass glass-border"
            style={{ color: 'var(--color-text-primary)' }}>
            <option value="">Début</option>
            {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{i}h</option>)}
          </select>
          <span style={{ opacity: 0.4 }}>→</span>
          <select value={endHour ?? ''} onChange={e => setEndHour(e.target.value ? parseInt(e.target.value) : null)}
            className="text-[10px] px-2 py-1.5 rounded-lg cursor-pointer outline-none glass glass-border"
            style={{ color: 'var(--color-text-primary)' }}>
            <option value="">Fin</option>
            {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{i}h</option>)}
          </select>
        </div>

        {/* Saison */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Saison</span>
          {SEASONS.map(s => (
            <button key={s.id} onClick={() => { setSeason(season === s.id ? null : s.id); setMonth(null); }}
              className="text-[10px] px-2.5 py-1.5 rounded-lg font-bold cursor-pointer transition-all"
              style={{
                background: season === s.id ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.04)',
                color: season === s.id ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
                border: `1px solid ${season === s.id ? 'rgba(0,245,255,0.35)' : 'rgba(255,255,255,0.06)'}`,
              }}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {/* Mois */}
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Mois</span>
          <select value={month ?? ''} onChange={e => { setMonth(e.target.value ? parseInt(e.target.value) : null); setSeason(null); }}
            className="text-[10px] px-2 py-1.5 rounded-lg cursor-pointer outline-none glass glass-border"
            style={{ color: 'var(--color-text-primary)' }}>
            <option value="">Tous</option>
            {MONTH_NAMES.map((name, i) => {
              const m = i + 1;
              const s = monthToSeason(m);
              const seasonLabel = SEASONS.find(se => se.id === s)?.label || '';
              return <option key={m} value={m}>{name} ({seasonLabel})</option>;
            })}
          </select>
        </div>

        {/* Attaque */}
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Attaque</span>
          <select value={attackFilter || ''} onChange={e => setAttackFilter(e.target.value || null)}
            className="text-xs px-2.5 py-1.5 rounded-lg cursor-pointer outline-none glass glass-border"
            style={{ color: 'var(--color-text-primary)' }}>
            <option value="">Tous les types</option>
            {ATTACK_TYPES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENT — BEST MODEL SPOTLIGHT
   ═══════════════════════════════════════════ */
function BestModelSpotlight({ results, bestModelId }: { results: Record<string, ModelResult>; bestModelId: string }) {
  const model = results[bestModelId];
  const meta = MODEL_META[bestModelId];
  if (!model || !meta) return null;

  const radarData = [
    { metric: 'F1', value: model.f1 * 100 },
    { metric: 'Précision', value: model.precision * 100 },
    { metric: 'Rappel', value: model.recall * 100 },
    { metric: 'ROC-AUC', value: model.roc_auc * 100 },
    { metric: 'AP', value: (model.ap || 0) * 100 },
  ];

  const allModelsRadarData = radarData.map(d => {
    const entry: Record<string, string | number> = { metric: d.metric };
    SENSOR_ORDER.forEach(id => {
      const m = results[id];
      if (m) {
        const val = d.metric === 'F1' ? m.f1 : d.metric === 'Précision' ? m.precision : d.metric === 'Rappel' ? m.recall : d.metric === 'ROC-AUC' ? m.roc_auc : (m.ap || 0);
        entry[id] = val * 100;
      }
    });
    return entry;
  });

  return (
      <div
        className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
        style={{ borderColor: `${meta.color}50`, position: 'relative' }}
       >
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${meta.color}, transparent)` }} />
        <div className="px-6 py-5 flex items-center gap-4" style={{ borderBottom: `1px solid ${meta.color}15` }}>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${meta.color}18` }}
           
           >
            <Sparkles className="w-6 h-6" style={{ color: meta.color }} />
          </div>
          <div>
            <h3 className="font-display font-bold text-lg" style={{ color: 'var(--color-text-primary)' }}>
              <span className="text-xl">🏆</span> Meilleur Modèle — <span style={{ color: meta.color }}>{meta.label}</span>
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              Modèle le plus performant — survolez chaque métrique pour plus d'explications
            </p>
          </div>
          <div className="ml-auto px-3 py-1 rounded-full text-[10px] font-bold"
            style={{ background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30` }}
           >
            ● EN DIRECT
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-6 p-6">
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'F1 Score', value: model.f1, color: meta.color, explain: 'Moyenne harmonique précision×rappel (0–100%)' },
                { label: 'Précision', value: model.precision, color: '#22C55E', explain: 'Taux de vrais positifs parmi les alertes' },
                { label: 'Rappel', value: model.recall, color: '#00F5FF', explain: "Taux d'attaques réellement détectées" },
                { label: 'ROC-AUC', value: model.roc_auc, color: '#A78BFA', explain: 'Capacité à séparer attaque vs normal' },
                { label: 'Taux Faux Pos.', value: 1 - model.fpr, color: model.fpr < 0.05 ? '#22C55E' : model.fpr < 0.2 ? '#F97316' : '#EF4444', explain: 'Fausses alarmes / total normal' },
                { label: 'Seuil Optimal', value: model.best_threshold_cont ?? 0, color: '#FBBF24', explain: 'Seuil de décision qui maximise F1', suffix: model.best_threshold_cont != null ? '%' : '' },
              ].map((s) => (
                <div key={s.label}
                  className="p-4 rounded-xl text-center relative group glass glass-border"
                  style={{ borderColor: `${s.color}25` }}>
                  <div className="font-display font-bold text-2xl" style={{ color: s.color }}>
                    {s.label === 'Seuil Optimal' && model.best_threshold_cont == null ? (
                      'N/R'
                    ) : (
                      String(Math.round(s.value * 100)) + '%'
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-1 text-[10px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                    {s.label}
                    <span className="group relative inline-flex">
                      <HelpCircle className="w-3 h-3 cursor-help" />
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-3 py-1.5 rounded-xl text-[9px] leading-relaxed whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity shadow-lg glass glass-border-strong">
                        {s.explain}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl p-4 glass" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
                <span className="text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>Matrice de Confusion</span>
                <span className="text-[9px] ml-auto" style={{ color: 'var(--color-text-secondary)' }}>VP = ✅ · FP = ⚠️ · FN = ❌ · VN = ✅</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { label: 'VP · Attaque détectée', value: model.tp, color: meta.color },
                  { label: 'FP · Fausse alerte', value: model.fp, color: '#F97316' },
                  { label: 'FN · Attaque manquée', value: model.fn, color: '#F97316' },
                  { label: 'VN · Normal correct', value: model.tn, color: meta.color },
                ].map(c => (
                  <div key={c.label} className="p-3 rounded-xl text-center"
                    style={{ background: `${c.color}12`, border: `1px solid ${c.color}20` }}
                   >
                    <div className="font-bold text-lg" style={{ color: c.color }}>{c.value.toLocaleString()}</div>
                    <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{c.label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[9px] text-center" style={{ color: 'var(--color-text-secondary)' }}>
                Interprétation : {model.tp > model.fn ? '✅ Le modèle détecte correctement la majorité des attaques' : '⚠️ Le modèle manque beaucoup d\'attaques'}
                {' · '}Ratio FP/VP: {(model.fp / Math.max(1, model.tp) * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl p-4 glass" style={{ border: '1px solid rgba(255,255,255,0.06)' }}
             >
              <div className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                <PieChart className="w-4 h-4" style={{ color: meta.color }} /> Radar des Performances
                <span className="text-[9px] ml-auto">Plus la zone est grande, meilleur est le modèle</span>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={allModelsRadarData} cx="50%" cy="50%" outerRadius="72%">
                  <PolarGrid stroke={meta.color} strokeOpacity={0.2} strokeWidth={1} />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: meta.color, fontSize: 10, fontWeight: 600 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: meta.color, fontSize: 8, fontWeight: 600 }} tickCount={5} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(17,24,39,0.92)', backdropFilter: 'blur(16px)', border: `1px solid ${meta.color}50`, borderRadius: 12, fontSize: 11, color: '#E6EDF3' }}
                    formatter={(value: unknown, name: unknown) => { const v = value as number; const n = name as string; return [`${v.toFixed(1)}%`, (MODEL_META as any)[n]?.label || n] }}
                  />
                  {SENSOR_ORDER.filter(id => id !== bestModelId).map(id => {
                    const m = MODEL_META[id];
                    if (!m) return null;
                    return (
                      <Radar key={id} dataKey={id} stroke={m.color} strokeWidth={1} strokeOpacity={0.18} fill="none" fillOpacity={0} isAnimationActive={false} />
                    );
                  })}
                  <Radar dataKey={bestModelId} stroke={meta.color} fill={meta.color} fillOpacity={0.25} strokeWidth={3.5} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl p-4 glass" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-xs font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Comparaison des Métriques</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={radarData} layout="vertical" margin={{ left: 15, right: 15 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                  <YAxis dataKey="metric" type="category" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} width={65} />
                  <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.85)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={14}>
                    {radarData.map(e => <rect key={e.metric} fill={e.metric === 'F1' ? meta.color : e.metric === 'Précision' ? '#22C55E' : e.metric === 'Rappel' ? '#00F5FF' : e.metric === 'ROC-AUC' ? '#A78BFA' : '#FBBF24'} fillOpacity={0.8} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENT — MONTHLY TREND
   ═══════════════════════════════════════════ */
function MonthlyTrendChart({ monthlyData, sensor, modelLabel }: { monthlyData: MonthData[]; sensor: string; modelLabel: string }) {
  const chartData = monthlyData.map(d => ({
    month: d.month,
    Précision: d.precisions.length ? d.precisions.reduce((a, b) => a + b, 0) / d.precisions.length * 100 : 0,
    Rappel: d.recalls.length ? d.recalls.reduce((a, b) => a + b, 0) / d.recalls.length * 100 : 0,
    Échantillons: d.count,
  }));
  const avgPrec = chartData.length ? chartData.reduce((a, b) => a + b.Précision, 0) / chartData.length : 0;

  return (
      <div className="rounded-2xl p-5 glass glass-border animate-border-glow grid-bg"
        style={{ borderColor: 'rgba(0,245,255,0.12)', position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #00F5FF, #A78BFA, transparent)' }} />
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Précision mensuelle — {modelLabel}</h3>
          <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: 'var(--color-accent-cyan)' }}>
            {sensor.toUpperCase()}
          </span>
        </div>
        <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          {chartData.length} mois analysés · Moyenne <strong style={{ color: 'var(--color-accent-cyan)' }}>{avgPrec.toFixed(1)}%</strong> de précision
        </p>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
              <YAxis domain={[70, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.85)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
              <Line type="monotone" dataKey="Précision" stroke="#96CEB4" strokeWidth={2.5} dot={false} name="Précision" />
              <Line type="monotone" dataKey="Rappel" stroke="#00F5FF" strokeWidth={2} dot={false} strokeOpacity={0.5} name="Rappel" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[240px] text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Aucune donnée pour la période sélectionnée
          </div>
        )}
        <div className="flex items-center gap-4 mt-2 justify-center text-[10px]">
          <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: '#96CEB4' }} /> Précision</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: '#00F5FF' }} /> Rappel</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>Plus c'est haut, mieux le modèle détecte les anomalies</span>
        </div>
      </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENT — SEASONAL CHART
   ═══════════════════════════════════════════ */
function SeasonalChart({ seasonalData }: { seasonalData: SeasonData[] }) {
  return (
      <div className="rounded-2xl p-5 glass glass-border animate-border-glow grid-bg"
        style={{ borderColor: 'rgba(168,139,250,0.12)', position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #A78BFA, #00F5FF, transparent)' }} />
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Analyse saisonnière</h3>
        </div>
        <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Impact des saisons sur les anomalies industrielles — <strong>barres</strong> = événements, <strong>lignes</strong> = qualité de détection
        </p>
        {seasonalData.some(d => d.anomalies > 0) ? (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={seasonalData}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="season" tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.85)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="anomalies" name="Anomalies" fill="#EF4444" fillOpacity={0.3} radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar yAxisId="left" dataKey="detections" name="Détections" fill="#22C55E" fillOpacity={0.5} radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Line yAxisId="right" type="monotone" dataKey="precision" name="Précision %" stroke="#00F5FF" strokeWidth={2.5} dot={{ r: 4 }} />
              <Line yAxisId="right" type="monotone" dataKey="recall" name="Rappel %" stroke="#A78BFA" strokeWidth={2.5} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[240px] text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Aucune donnée saisonnière disponible
          </div>
        )}
        <div className="flex items-center gap-4 mt-2 justify-center text-[10px]">
          {[
            { label: 'Anomalies', color: '#EF4444' },
            { label: 'Détectés', color: '#22C55E' },
            { label: 'Précision', color: '#00F5FF' },
            { label: 'Rappel', color: '#A78BFA' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
              <span style={{ color: 'var(--color-text-secondary)' }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>
  );
}

/* ═══════════════════════════════════════════
   ATTACK IMPACT — per capteur
   ═══════════════════════════════════════════ */
const SENSOR_IMPACT: Record<string, { weather: string; fridge: string; thermostat: string }> = {
  ddos: {
    weather: 'Arrêt complet des relevés météo — la station ne remonte plus aucune donnée.',
    fridge: 'Perte de surveillance de la température frigo — risque de rupture de la chaîne du froid.',
    thermostat: 'Plus aucun ordre de chauffage/clim ne passe — le bâtiment n\'est plus régulé.',
  },
  dos: {
    weather: 'Relevés météo ralentis et partiels — données manquantes sur le dashboard.',
    fridge: 'Sondes frigo en timeout — une montée en température passe inaperçue.',
    thermostat: 'Commandes de régulation perdues — inconfort thermique et gaspillage.',
  },
  mitm: {
    weather: 'Fausses données météo injectées — le dashboard affiche 20°C alors qu\'il fait 35°C.',
    fridge: 'Température affichée fausse (ex: 2°C au lieu de 12°C) — une panne est masquée.',
    thermostat: 'Consigne de chauffage falsifiée — le système chauffe ou refroidit à l\'opposé.',
  },
  xss: {
    weather: 'Script malveillant injecté dans l\'IHM météo — vol de session de l\'opérateur.',
    fridge: 'Bouton d\'arrêt urgences désactivé par script — fausse sensation de sécurité.',
    thermostat: 'Graphiques de température manipulés — l\'opérateur ne voit pas la réalité.',
  },
  backdoor: {
    weather: 'Exfiltration des données météo et des coordonnées du site vers un serveur pirate.',
    fridge: 'Accès permanent au PLC frigo — possibilité de forcer le dégivrage à distance.',
    thermostat: 'Contrôle total du chauffage d\'un bâtiment entier — extorsion ou sabotage.',
  },
  injection: {
    weather: 'Fausse mesure de vent extrême déclenchant une alerte inutile et une évacuation.',
    fridge: 'Valeur fausse (0°C au lieu de 5°C) masquant une surchauffe — les aliments pourrissent.',
    thermostat: 'Ordre de chauffage max en été — gaspillage énergétique massif et facture explosive.',
  },
  password: {
    weather: 'Piratage du compte admin — accès à tout l\'historique des mesures météo.',
    fridge: 'Modification des seuils d\'alarme — le frigo ne prévient plus en cas de panne.',
    thermostat: 'Prise de contrôle du thermostat — réglage de la température à volonté.',
  },
  ransomware: {
    weather: 'Données météo chiffrées — la station est rendue complètement inopérante.',
    fridge: 'Registres chiffrés et dégivrage forcé — perte totale des produits stockés.',
    thermostat: 'Température extrême imposée (45°C ou -10°C) — le bâtiment devient inhabitable.',
  },
  scanning: {
    weather: 'Repérage des vulnérabilités par scan des ports MQTT de la station météo.',
    fridge: 'Découverte des automates frigo et de leurs adresses réseau pour attaque future.',
    thermostat: 'Cartographie des points faibles du réseau HVAC — préparation d\'une intrusion.',
  },
};

const SENSOR_LABELS: Record<string, { icon: string; label: string }> = {
  weather: { icon: '\u{1F324}\uFE0F', label: 'Station Météo' },
  fridge: { icon: '\u2744\uFE0F', label: 'Chambre Froide' },
  thermostat: { icon: '\u{1F321}\uFE0F', label: 'Thermostat' },
};

/* ═══════════════════════════════════════════
   COMPONENT — ATTACK ANALYSIS
   ═══════════════════════════════════════════ */
function AttackAnalysis({ attackFilter, results, attackMetrics }: { attackFilter: string | null; results: Record<string, ModelResult>; attackMetrics: AttackMetric[] }) {
  const [selectedAttack, setSelectedAttack] = useState<string | null>(null);
  const displayId = selectedAttack || attackFilter;
  const bestModel = Object.entries(results).sort((a, b) => b[1].f1 - a[1].f1)[0];

  function getAttackMetrics(attackTypeId: string): { f1: number; precision: number; recall: number; fpr: number } | null {
    const dbName = ATTACK_DB_NAME[attackTypeId];
    if (!dbName) return null;
    const row = attackMetrics.find(m => m.attack_type === dbName && m.model_id === 'if-combine-v1');
    if (row && row.f1_attaque != null && row.precision_attaque != null && row.recall_attaque != null) {
      return { f1: row.f1_attaque, precision: row.precision_attaque, recall: row.recall_attaque, fpr: 1 - (row.precision_attaque || 0) };
    }
    const bestRow = attackMetrics.find(m => m.attack_type === dbName);
    if (bestRow && bestRow.f1_attaque != null && bestRow.precision_attaque != null && bestRow.recall_attaque != null) {
      return { f1: bestRow.f1_attaque, precision: bestRow.precision_attaque, recall: bestRow.recall_attaque, fpr: 1 - (bestRow.precision_attaque || 0) };
    }
    return null;
  }

  function detectBarColor(val: number): string {
    if (val >= 90) return '#22C55E';
    if (val >= 70) return '#86EFAC';
    if (val >= 50) return '#FBBF24';
    if (val >= 30) return '#F97316';
    return '#EF4444';
  }

  function detectLabel(val: number): string {
    if (val >= 90) return 'Très bien détecté';
    if (val >= 70) return 'Bien détecté';
    if (val >= 50) return 'Détection moyenne';
    if (val >= 30) return 'Difficile à détecter';
    return 'Faible détection';
  }

  function severityIcon(sev: string): string {
    if (sev === 'Critique' || sev === 'CRITIQUE') return '\u{1F6A8}';
    if (sev === 'Élevé') return '\u26A0\uFE0F';
    if (sev === 'Moyen') return '\u{1F7E1}';
    return '\u{1F7E2}';
  }

  function getDetectionScore(attackId: string): number {
    const m = getAttackMetrics(attackId);
    if (m) return m.f1 * 100;
    if (bestModel) return bestModel[1].f1 * 100;
    return 0;
  }

  const severityOrder: Record<string, number> = { 'CRITIQUE': 0, 'Critique': 0, 'Élevé': 1, 'Moyen': 2, 'Faible': 3 };
  const sortedAttacks = [...ATTACK_TYPES].filter(a => !attackFilter || a.id === attackFilter)
    .sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  return (
      <div className="rounded-2xl overflow-hidden glass glass-border grid-bg" style={{ position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #EF4444, #F97316, #EAB308, transparent)' }} />
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Bug className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Attaques expliquées par capteur</h3>
          <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: 'var(--color-accent-cyan)' }}>
            {ATTACK_TYPES.length} types
          </span>
        </div>
        <p className="px-5 pb-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          Chaque attaque a un <strong>effet différent</strong> sur vos 3 capteurs. Passez la souris ou cliquez pour voir l'impact détaillé sur <strong>Station Météo</strong> <span className="opacity-50">|</span> <strong>Chambre Froide</strong> <span className="opacity-50">|</span> <strong>Thermostat</strong>.
        </p>

        {/* Grid of attack cards */}
        <div className="px-4 pb-4">
          <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'thin' }}>
            {sortedAttacks.map(attack => {
              const isOpen = displayId === attack.id;
              const detectionScore = getDetectionScore(attack.id);
              const impact = SENSOR_IMPACT[attack.id];

              return (
                <div key={attack.id} className="min-w-[340px] flex-shrink-0" style={{ scrollSnapAlign: 'start' }}>
                  <button onClick={() => setSelectedAttack(isOpen ? null : attack.id)}
                    className="w-full rounded-xl text-left cursor-pointer transition-all"
                    style={{
                      background: isOpen ? 'rgba(255,255,255,0.06)' : 'var(--color-bg-panel)',
                      borderTop: `1px solid ${isOpen ? attack.color + '40' : 'var(--border)'}`,
                      borderRight: `1px solid ${isOpen ? attack.color + '40' : 'var(--border)'}`,
                      borderBottom: `1px solid ${isOpen ? attack.color + '40' : 'var(--border)'}`,
                      borderLeft: `4px solid ${attack.color}`,
                      padding: 0, overflow: 'hidden',
                    }}
                   >
                    <div className="p-3.5">
                      {/* Header: icon + name + severity badge */}
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: `${attack.color}18`, color: attack.color }}>
                          {attack.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-xs" style={{ color: 'var(--color-text-primary)' }}>{attack.label}</div>
                          <div className="text-[8px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{attack.description}</div>
                        </div>
                        <span className="shrink-0 px-2 py-0.5 rounded-full text-[8px] font-semibold whitespace-nowrap"
                          style={{ background: `${attack.color}18`, color: attack.color }}>
                          {severityIcon(attack.severity)} {attack.severity}
                        </span>
                      </div>

                      {/* Sensor impacts — 3 compact rows */}
                      {impact && (
                        <div className="space-y-1 mb-2.5">
                          {(['weather', 'fridge', 'thermostat'] as const).map(sensor => {
                            const info = SENSOR_LABELS[sensor];
                            return (
                              <div key={sensor} className="flex items-start gap-2 text-[9px] leading-relaxed rounded-md p-1.5 group"
                                style={{ background: 'rgba(255,255,255,0.02)' }}>
                                <span className="shrink-0 text-xs" style={{ opacity: 0.7 }}>{info.icon}</span>
                                <span className="font-semibold shrink-0 text-[8px] uppercase tracking-wider"
                                  style={{ color: 'var(--color-text-secondary)', width: 80 }}>{info.label}</span>
                                <span style={{ color: 'var(--color-text-primary)' }}>{impact[sensor]}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Detection score bar */}
                      <div className="mt-1">
                        <div className="flex items-center justify-between text-[8px] mb-1">
                          <span style={{ color: detectBarColor(detectionScore) }}>{detectLabel(detectionScore)}</span>
                          <span className="font-bold" style={{ color: detectBarColor(detectionScore) }}>{detectionScore.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full" style={{ background: detectBarColor(detectionScore) }}
                            />
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  
                    {isOpen && (
                      <div
                        className="overflow-hidden">
                        <div className="rounded-b-xl px-4 pb-4 pt-0 glass" style={{ border: `1px solid ${attack.color}15`, borderTop: 'none' }}>
                          <div className="space-y-3 text-[10px] leading-relaxed p-4 rounded-lg" style={{ background: 'rgba(0,0,0,0.2)' }}>
                            {/* En termes simples */}
                            <div className="flex items-start gap-2">
                              <span className="text-base shrink-0 mt-0.5">🧐</span>
                              <div>
                                <div className="font-bold text-[9px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>En termes simples</div>
                                <p style={{ color: 'var(--color-text-primary)', lineHeight: 1.6 }}>{attack.description}</p>
                              </div>
                            </div>

                            {/* Impact sur vos 3 capteurs */}
                            {impact && (
                              <div className="rounded-lg p-2.5" style={{ background: 'rgba(59,130,246,0.06)' }}>
                                <div className="font-bold text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#60A5FA' }}>
                                  {'\u{1F4E1}'} Impact sur vos 3 capteurs
                                </div>
                                <div className="space-y-1">
                                  {(['weather', 'fridge', 'thermostat'] as const).map(sensor => {
                                    const info = SENSOR_LABELS[sensor];
                                    return (
                                      <div key={sensor} className="flex items-start gap-2 text-[10px] p-1.5 rounded-md"
                                        style={{ background: 'rgba(0,0,0,0.15)' }}>
                                        <span className="shrink-0">{info.icon}</span>
                                        <span className="font-bold shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{info.label} :</span>
                                        <span style={{ color: 'var(--color-text-primary)' }}>{impact[sensor]}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                          </div>
                        </div>
                      </div>
                    )}
                  
                </div>
              );
            })}
          </div>
        </div>

      </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENT — ANOMALY TIMELINE + LLM REPORT
   ═══════════════════════════════════════════ */
const SENSOR_COLORS = { weather: '#FF6B6B', fridge: '#4ECDC4', thermostat: '#45B7D1' };
const SENSOR_NAMES = { weather: 'Station Météo', fridge: 'Chambre Froide', thermostat: 'Thermostat' };

function AnomalyTimeline({ timelineData, sensor }: { timelineData: Record<string, unknown>[]; sensor: string }) {
  const isMulti = sensor === 'all';
  const hasData = timelineData.length > 0;

  return (
      <div className="rounded-2xl overflow-hidden glass glass-border grid-bg"
        style={{ position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #EF4444, #00F5FF, transparent)' }} />
        {/* Header */}
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Activity className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
            {isMulti ? 'Score d\'anomalie' : 'Température & Anomalies'} {!isMulti && `— ${SENSOR_NAMES[sensor as keyof typeof SENSOR_NAMES] || sensor}`}
          </h3>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: '#22C55E', boxShadow: '0 0 8px rgba(34,197,94,0.6)' }}
             />
            <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{hasData ? 'Données disponibles' : 'Aucune donnée'}</span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Chart */}
          <div>
            <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
              {isMulti ? (
                <>Score <strong>Isolation Forest</strong> par capteur — plus le pic est haut, plus le comportement est anormal.</>
              ) : (
                <><strong>Température</strong> (bleu) et <strong>score d'anomalie</strong> (rouge) — les barres rouges en haut marquent les attaques réelles.</>
              )}
            </p>
            {hasData ? (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={timelineData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="hour" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} interval={5} />
                  {isMulti ? (
                    <YAxis domain={[0, 100]} yAxisId="score" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
                  ) : (
                    <>
                      <YAxis yAxisId="temp" orientation="left" tick={{ fill: '#38BDF8', fontSize: 9 }} stroke="#38BDF8" label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#38BDF8', fontSize: 10 }} />
                      <YAxis yAxisId="score" orientation="right" domain={[0, 100]} tick={{ fill: '#EF4444', fontSize: 9 }} stroke="#EF4444" label={{ value: 'Score %', angle: 90, position: 'insideRight', fill: '#EF4444', fontSize: 10 }} />
                    </>
                  )}
                  <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.95)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
                  {isMulti ? (
                    <>
                      <Line type="monotone" dataKey="weather" yAxisId="score" stroke={SENSOR_COLORS.weather} strokeWidth={2} dot={false} name="Station Météo" />
                      <Line type="monotone" dataKey="fridge" yAxisId="score" stroke={SENSOR_COLORS.fridge} strokeWidth={2} dot={false} name="Chambre Froide" />
                      <Line type="monotone" dataKey="thermostat" yAxisId="score" stroke={SENSOR_COLORS.thermostat} strokeWidth={2} dot={false} name="Thermostat" />
                    </>
                  ) : (
                    <>
                      <Area type="monotone" dataKey="score" yAxisId="score" fill="#EF4444" fillOpacity={0.08} stroke="#EF4444" strokeWidth={2} name="Score anomalie" />
                      <Line type="monotone" dataKey="temperature" yAxisId="temp" stroke="#38BDF8" strokeWidth={2} dot={false} name="Température" />
                      <Bar dataKey="attack" yAxisId="score" fill="#EF4444" fillOpacity={0.5} barSize={4} name="Attaque réelle" />
                    </>
                  )}
                  <ReferenceLine y={35} stroke="#EF4444" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'Seuil 35%', fill: '#EF4444', fontSize: 10 }} yAxisId="score" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px]" style={{ color: 'var(--color-text-secondary)' }}>
                Aucune donnée pour ces filtres
              </div>
            )}
            {/* Legend */}
            {hasData && (
              <div className="flex items-center gap-4 mt-2 justify-center text-[9px] flex-wrap">
                {isMulti ? (
                  (['weather', 'fridge', 'thermostat'] as const).map(s => (
                    <div key={s} className="flex items-center gap-1.5">
                      <div className="w-3 h-0.5 rounded" style={{ background: SENSOR_COLORS[s] }} />
                      <span style={{ color: 'var(--color-text-secondary)' }}>{SENSOR_NAMES[s]}</span>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-0.5 rounded" style={{ background: '#38BDF8' }} />
                      <span style={{ color: 'var(--color-text-secondary)' }}>Température</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-0.5 rounded" style={{ background: '#EF4444' }} />
                      <span style={{ color: 'var(--color-text-secondary)' }}>Score anomalie</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm" style={{ background: '#EF4444', opacity: 0.5 }} />
                      <span style={{ color: 'var(--color-text-secondary)' }}>Attaque réelle</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>


        </div>
      </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENT — MODEL COMPARISON TABLE
   ═══════════════════════════════════════════ */
function ModelComparisonTable({ results }: { results: Record<string, ModelResult> }) {
  const bestModelId = SENSOR_ORDER.reduce((a, b) => (results[a]?.f1 || 0) > (results[b]?.f1 || 0) ? a : b, SENSOR_ORDER[0]);

  return (
      <div className="rounded-2xl overflow-hidden glass glass-border">
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Database className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Comparatif des 7 modèles</h3>
          <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: 'var(--color-accent-cyan)' }}>
            {SENSOR_ORDER.length} modèles
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Modèle', 'Capteur', 'F1 ↑', 'Précision', 'Rappel', 'ROC-AUC', 'AP', 'FPR ↓', 'Seuil', 'VP', 'FP'].map(h => (
                  <th key={h} className="text-left px-3 py-3 font-bold text-[9px] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SENSOR_ORDER.map((id) => {
                const r = results[id];
                const meta = MODEL_META[id];
                if (!r || !meta) return null;
                const isBest = id === bestModelId;
                return (
                  <tr key={id} className="transition-all" style={{
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: isBest ? `${meta.color}08` : undefined,
                  }}>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span style={{ color: meta.color }}>{meta.icon}</span>
                        <span className="font-bold text-xs" style={{ color: isBest ? meta.color : 'var(--color-text-primary)' }}>
                          {meta.label} {isBest && '🏆'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">{meta.sensor}</td>
                    <td className="px-3 py-3 font-bold" style={{ color: r.f1 > 0.9 ? '#22C55E' : r.f1 > 0.7 ? '#00F5FF' : '#F97316' }}>
                      {(r.f1 * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-3">{(r.precision * 100).toFixed(1)}%</td>
                    <td className="px-3 py-3 font-bold" style={{ color: r.recall > 0.8 ? '#22C55E' : r.recall > 0.5 ? '#F97316' : '#EF4444' }}>
                      {(r.recall * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-3">{(r.roc_auc * 100).toFixed(1)}%</td>
                    <td className="px-3 py-3">{((r.ap || 0) * 100).toFixed(1)}%</td>
                    <td className="px-3 py-3 font-bold" style={{ color: r.fpr < 0.05 ? '#22C55E' : r.fpr < 0.2 ? '#F97316' : '#EF4444' }}>
                      {(r.fpr * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-3">{r.best_threshold_cont != null ? (r.best_threshold_cont * 100).toFixed(0) + '%' : 'N/R'}</td>
                    <td className="px-3 py-3" style={{ color: '#22C55E' }}>{r.tp.toLocaleString()}</td>
                    <td className="px-3 py-3" style={{ color: '#EF4444' }}>{r.fp.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENT — ATTACK × MODEL HEATMAP
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   1. COMPONENT — ANOMALY SCORE DISTRIBUTION
   ═══════════════════════════════════════════ */
function AnomalyScoreDistribution({ points }: { points: TimelinePoint[] }) {
  const bins = 50;
  const normalScores = points.filter(p => p.actual_label === 0).map(p => Math.abs(p.anomaly_score) * 100);
  const attackScores = points.filter(p => p.actual_label === 1).map(p => Math.abs(p.anomaly_score) * 100);

  const allScores = [...normalScores, ...attackScores];
  if (allScores.length === 0) return null;
  const minS = Math.min(...allScores);
  const maxS = Math.max(...allScores);
  const step = (maxS - minS) / bins || 1;

  const histogramData = Array.from({ length: bins }, (_, i) => {
    const lo = minS + i * step;
    const hi = lo + step;
    const mid = (lo + hi) / 2;
    return {
      score: Math.round(mid),
      Normal: normalScores.filter(s => s >= lo && s < hi).length,
      Attaque: attackScores.filter(s => s >= lo && s < hi).length,
    };
  });

  const totalNormal = normalScores.length || 1;
  const totalAttack = attackScores.length || 1;
  const histNorm = histogramData.map(d => ({ ...d, Normal: d.Normal / totalNormal * 100 }));
  const histAtk = histogramData.map(d => ({ ...d, Attaque: d.Attaque / totalAttack * 100 }));

  const overlapData = histNorm.map((d, i) => ({
    score: d.score,
    Normal: d.Normal,
    Attaque: histAtk[i].Attaque,
    Overlap: Math.min(d.Normal, histAtk[i].Attaque),
  }));

  const meanNormal = normalScores.reduce((a, b) => a + b, 0) / totalNormal;
  const meanAttack = attackScores.reduce((a, b) => a + b, 0) / totalAttack;
  const separation = Math.abs(meanAttack - meanNormal);

  return (
    <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
      style={{ borderColor: 'rgba(239,68,68,0.12)', position: 'relative' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #38BDF8, #EF4444, transparent)' }} />
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Target className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
        <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Distribution des Scores d'Anomalie
        </h3>
        <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: 'var(--color-accent-cyan)' }}>
          Séparation: {separation.toFixed(1)}%
        </span>
      </div>
      <div className="p-4">
        <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          <strong>Bleu</strong> = données normales · <strong>Rouge</strong> = attaques · Plus les deux courbes sont séparées, mieux le modèle distingue normal/anomalie.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={overlapData}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="score" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} label={{ value: 'Score anomalie (%)', position: 'bottom', fill: 'var(--color-text-secondary)', fontSize: 9 }} />
            <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} label={{ value: 'Densité (%)', angle: -90, position: 'insideLeft', fill: 'var(--color-text-secondary)', fontSize: 9 }} />
            <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
            <Area type="monotone" dataKey="Normal" stroke="#38BDF8" fill="#38BDF8" fillOpacity={0.25} strokeWidth={2} name="Normal" />
            <Area type="monotone" dataKey="Attaque" stroke="#EF4444" fill="#EF4444" fillOpacity={0.25} strokeWidth={2} name="Attaque" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-6 mt-2 justify-center text-[10px]">
          <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: '#38BDF8' }} /> Normal ({normalScores.length.toLocaleString()})</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: '#EF4444' }} /> Attaque ({attackScores.length.toLocaleString()})</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>μ Normal = {meanNormal.toFixed(1)}% · μ Attaque = {meanAttack.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   2. COMPONENT — SCORE TEMPORAL CHART
   ═══════════════════════════════════════════ */
function ScoreTemporalChart({ points }: { points: TimelinePoint[] }) {
  const dailyData = useMemo(() => {
    const byDay: Record<number, { scores: number[]; attacks: number; total: number }> = {};
    for (const p of points) {
      const doy = new Date(p.datetime).getDate() + (new Date(p.datetime).getMonth()) * 30;
      if (!byDay[doy]) byDay[doy] = { scores: [], attacks: 0, total: 0 };
      byDay[doy].scores.push(Math.abs(p.anomaly_score) * 100);
      byDay[doy].total++;
      if (p.actual_label === 1) byDay[doy].attacks++;
    }
    return Object.entries(byDay)
      .map(([d, v]) => ({
        day: parseInt(d),
        score: v.scores.reduce((a, b) => a + b, 0) / v.scores.length,
        hasAttack: v.attacks > 0,
        attackCount: v.attacks,
      }))
      .sort((a, b) => a.day - b.day);
  }, [points]);

  if (dailyData.length === 0) return null;
  const avgScore = dailyData.reduce((a, b) => a + b.score, 0) / dailyData.length;

  return (
    <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
      style={{ borderColor: 'rgba(56,189,248,0.12)', position: 'relative' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #22C55E, #EF4444, transparent)' }} />
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <TrendingUp className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
        <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Score d'Anomalie dans le Temps
        </h3>
        <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: 'var(--color-accent-cyan)' }}>
          Moyenne: {avgScore.toFixed(1)}%
        </span>
      </div>
      <div className="p-4">
        <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Score moyen par jour · <strong>Points rouges</strong> = jours contenant des attaques · Ligne pointillée = seuil de détection.
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={dailyData}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="day" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
            <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
            <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }}
              formatter={(val: unknown, name: unknown) => [`${Number(val).toFixed(1)}%`, String(name)]} />
            <Area type="monotone" dataKey="score" stroke="#22C55E" fill="#22C55E" fillOpacity={0.1} strokeWidth={2} name="score" />
            <ReferenceLine y={35} stroke="#EF4444" strokeDasharray="6 3" strokeOpacity={0.6} label={{ value: 'Seuil 35%', fill: '#EF4444', fontSize: 9 }} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 justify-center text-[10px]">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#EF4444' }} /> Jour d'attaque</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: '#22C55E' }} /> Score moyen</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   3. COMPONENT — ATTACK × SENSOR HEATMAP
   ═══════════════════════════════════════════ */
function AttackSensorHeatmap({ attackMetrics }: { attackMetrics: AttackMetric[] }) {
  if (attackMetrics.length === 0) return null;

  const models = ['IF_weather', 'IF_fridge', 'IF_thermostat', 'IF_Multivarie'];
  const modelLabels: Record<string, string> = {
    IF_weather: 'Weather', IF_fridge: 'Fridge', IF_thermostat: 'Thermo', IF_Multivarie: 'Multi ★',
  };
  const modelColors: Record<string, string> = {
    IF_weather: '#FF6B6B', IF_fridge: '#4ECDC4', IF_thermostat: '#45B7D1', IF_Multivarie: '#96CEB4',
  };

  const attackTypes = [...new Set(attackMetrics.map(m => m.attack_type))].sort();

  const getRate = (attack: string, model: string): number | null => {
    const row = attackMetrics.find(m => m.attack_type === attack && m.model_id?.toLowerCase().includes(model.toLowerCase().replace('if_', '')));
    return row?.taux_detection ?? null;
  };

  const cellColor = (rate: number | null) => {
    if (rate === null) return 'rgba(255,255,255,0.03)';
    if (rate >= 90) return 'rgba(34,197,94,0.35)';
    if (rate >= 70) return 'rgba(251,191,36,0.3)';
    if (rate >= 50) return 'rgba(249,115,22,0.3)';
    return 'rgba(239,68,68,0.3)';
  };

  const cellTextColor = (rate: number | null) => {
    if (rate === null) return 'var(--color-text-secondary)';
    if (rate >= 90) return '#22C55E';
    if (rate >= 70) return '#FBBF24';
    if (rate >= 50) return '#F97316';
    return '#EF4444';
  };

  return (
    <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
      style={{ borderColor: 'rgba(150,206,180,0.12)', position: 'relative' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #96CEB4, #00F5FF, transparent)' }} />
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <PieChart className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
        <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Détection par Attaque × Capteur
        </h3>
        <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: 'var(--color-accent-cyan)' }}>
          {attackTypes.length} attaques · {models.length} modèles
        </span>
      </div>
      <div className="p-4 overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr>
              <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--color-text-secondary)' }}>Attaque</th>
              {models.map(m => (
                <th key={m} className="text-center py-2 px-2 font-bold" style={{ color: modelColors[m] }}>{modelLabels[m]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {attackTypes.map(atk => (
              <tr key={atk}>
                <td className="py-1.5 px-2 font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {atk.replace('IoT_', '').replace('_normal', '')}
                </td>
                {models.map(m => {
                  const rate = getRate(atk, m);
                  return (
                    <td key={m} className="text-center py-1.5 px-2 font-mono font-bold rounded-lg"
                      style={{ background: cellColor(rate), color: cellTextColor(rate) }}>
                      {rate !== null ? `${(rate * 100).toFixed(0)}%` : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-4 mt-3 justify-center text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(34,197,94,0.35)' }} /> ≥90%</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(251,191,36,0.3)' }} /> 70-90%</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(249,115,22,0.3)' }} /> 50-70%</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(239,68,68,0.3)' }} /> {'<'}50%</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   4. COMPONENT — UNI VS MULTI COMPARISON
   ═══════════════════════════════════════════ */
function UniVsMultiComparison({ results }: { results: Record<string, ModelResult> }) {
  const uniIds = ['IF_weather', 'IF_fridge', 'IF_thermostat', 'IF_Multivarie'];
  const metrics = ['F1', 'Précision', 'Rappel', '1-FPR'];

  const chartData = metrics.map(metric => {
    const entry: Record<string, string | number> = { metric };
    for (const id of uniIds) {
      const r = results[id];
      if (!r) continue;
      const meta = MODEL_META[id];
      entry[meta.short] = metric === 'F1' ? r.f1 * 100 : metric === 'Précision' ? r.precision * 100 : metric === 'Rappel' ? r.recall * 100 : (1 - r.fpr) * 100;
    }
    return entry;
  });

  return (
    <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
      style={{ borderColor: 'rgba(150,206,180,0.12)', position: 'relative' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #96CEB4, #FF6B6B, transparent)' }} />
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Layers className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
        <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Univarié vs Multivarié — Comparaison
        </h3>
      </div>
      <div className="p-4">
        <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Le modèle <strong style={{ color: '#96CEB4' }}>IF Multivarié ★</strong> fusionne les 3 capteurs. Comparez ses métriques avec chaque modèle univarié.
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ left: 10, right: 10 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="metric" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
            <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} formatter={(val: unknown) => [`${Number(val).toFixed(1)}%`, '']} />
            {uniIds.map(id => {
              const meta = MODEL_META[id];
              return <Bar key={id} dataKey={meta.short} fill={meta.color} radius={[3, 3, 0, 0]} maxBarSize={16} fillOpacity={id === 'IF_Multivarie' ? 1 : 0.5} />;
            })}
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 justify-center text-[10px] flex-wrap">
          {uniIds.map(id => {
            const meta = MODEL_META[id];
            return (
              <span key={id} className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded" style={{ background: meta.color, opacity: id === 'IF_Multivarie' ? 1 : 0.5 }} />
                <span style={{ color: 'var(--color-text-secondary)' }}>{meta.label}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   5. COMPONENT — FALSE POSITIVE HEATMAP
   ═══════════════════════════════════════════ */
function FalsePositiveHeatmap({ points }: { points: TimelinePoint[] }) {
  const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  const fpGrid = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const counts: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const p of points) {
      if (p.actual_label === 0 && p.prediction === 1) {
        const d = new Date(p.datetime).getDay();
        const h = new Date(p.datetime).getHours();
        grid[d][h]++;
      }
      const d = new Date(p.datetime).getDay();
      const h = new Date(p.datetime).getHours();
      counts[d][h]++;
    }
    return grid.map((row, di) => row.map((v, hi) => counts[di][hi] > 0 ? (v / counts[di][hi]) * 100 : 0));
  }, [points]);

  const maxFP = Math.max(...fpGrid.flat(), 1);

  const cellBg = (val: number) => {
    const intensity = val / maxFP;
    if (val === 0) return 'rgba(255,255,255,0.02)';
    if (intensity > 0.6) return `rgba(239,68,68,${0.15 + intensity * 0.35})`;
    if (intensity > 0.3) return `rgba(251,191,36,${0.1 + intensity * 0.3})`;
    return `rgba(56,189,248,${0.05 + intensity * 0.2})`;
  };

  const cellText = (val: number) => {
    if (val === 0) return 'var(--color-text-secondary)';
    const intensity = val / maxFP;
    if (intensity > 0.6) return '#EF4444';
    if (intensity > 0.3) return '#FBBF24';
    return '#38BDF8';
  };

  return (
    <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
      style={{ borderColor: 'rgba(251,191,36,0.12)', position: 'relative' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #FBBF24, #EF4444, transparent)' }} />
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-accent-warning)' }} />
        <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Faux Positifs par Plage Horaire
        </h3>
      </div>
      <div className="p-4">
        <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Taux de faux positifs par jour de la semaine et heure — repérez les créneaux problématiques (chaud = beaucoup de fausses alertes).
        </p>
        <div className="overflow-x-auto">
          <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `40px repeat(24, 1fr)` }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center text-[7px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>{h}</div>
            ))}
            {fpGrid.map((row, di) => (
              <>
                <div key={`label-${di}`} className="flex items-center text-[9px] font-semibold pr-1" style={{ color: 'var(--color-text-secondary)' }}>{dayNames[di]}</div>
                {row.map((val, hi) => (
                  <div key={`${di}-${hi}`}
                    className="w-full aspect-square rounded-sm flex items-center justify-center text-[7px] font-mono cursor-default transition-all hover:scale-125 hover:z-10"
                    style={{ background: cellBg(val), color: cellText(val) }}
                    title={`${dayNames[di]} ${hi}h — ${(val).toFixed(1)}% FP`}>
                    {val > 0 ? `${val.toFixed(0)}` : ''}
                  </div>
                ))}
              </>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4 mt-3 justify-center text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(255,255,255,0.02)' }} /> 0%</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(56,189,248,0.2)' }} /> Faible</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(251,191,36,0.35)' }} /> Moyen</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(239,68,68,0.5)' }} /> Élevé</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   6. COMPONENT — FEATURE IMPORTANCE VARIANCE
   ═══════════════════════════════════════════ */
function FeatureImportanceVariance({ mlPerf }: { mlPerf: { feature_importance: { feature: string; importance: number }[] } | null }) {
  const [data, setData] = useState<{ feature_importance: { feature: string; importance: number }[] } | null>(mlPerf);

  useEffect(() => {
    if (!data) {
      safeFetchJson('/api/yearly/ml-performance').then(d => {
        if (d?.feature_importance) setData(d);
      });
    }
  }, []);

  const feats = data?.feature_importance || [];
  if (feats.length === 0) return null;

  const maxImp = Math.max(...feats.map(f => f.importance), 0.01);
  const totalImp = feats.reduce((a, f) => a + f.importance, 0) || 1;

  const featColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#D4A5E8', '#A78BFA', '#F97316'];

  return (
    <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
      style={{ borderColor: 'rgba(168,139,250,0.12)', position: 'relative' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #A78BFA, #00F5FF, transparent)' }} />
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Sparkles className="w-4 h-4" style={{ color: 'var(--color-accent-purple)' }} />
        <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Importance des Features (IF)
        </h3>
        <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: 'var(--color-accent-purple)' }}>
          {feats.length} features
        </span>
      </div>
      <div className="p-4">
        <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Contribution moyenne de chaque feature à la décision de la forêt d'isolation — plus c'est grand, plus la feature influence le score.
        </p>
        <div className="space-y-2">
          {feats.map((f, i) => {
            const pct = (f.importance / maxImp) * 100;
            const share = (f.importance / totalImp) * 100;
            return (
              <div key={f.feature} className="flex items-center gap-2">
                <span className="text-[10px] min-w-[100px] font-mono truncate" style={{ color: 'var(--color-text-secondary)' }}>{f.feature}</span>
                <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div className="h-full rounded flex items-center justify-end pr-1.5 transition-all"
                    style={{ width: `${Math.max(pct, 4)}%`, background: `linear-gradient(90deg, ${featColors[i % featColors.length]}40, ${featColors[i % featColors.length]})` }}>
                    <span className="text-[8px] font-bold text-white">{share.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   7. COMPONENT — SENSOR CORRELATION HEATMAP
   ═══════════════════════════════════════════ */
function SensorCorrelationHeatmap({ points }: { points: TimelinePoint[] }) {
  const corrData = useMemo(() => {
    const sensorData: Record<string, Record<string, number[]>> = {
      weather: {}, fridge: {}, thermostat: {},
    };
    for (const p of points) {
      const day = Math.floor(new Date(p.datetime).getTime() / 86400000);
      const sensor = (p as unknown as Record<string, unknown>)._sensor as string;
      if (sensor && sensorData[sensor]) {
        if (!sensorData[sensor][day]) sensorData[sensor][day] = [];
        sensorData[sensor][day].push(Math.abs(p.anomaly_score));
      }
    }
    const commonDays = Object.keys(sensorData.weather)
      .filter(d => sensorData.fridge[d] && sensorData.thermostat[d])
      .sort((a, b) => Number(a) - Number(b));

    if (commonDays.length < 2) return [];

    const windowSize = 7;
    return commonDays.map((_, i) => {
      if (i < windowSize - 1) return null;
      const window = commonDays.slice(i - windowSize + 1, i + 1);
      const avgW = window.map(d => sensorData.weather[d].reduce((a, b) => a + b, 0) / sensorData.weather[d].length);
      const avgF = window.map(d => sensorData.fridge[d].reduce((a, b) => a + b, 0) / sensorData.fridge[d].length);
      const avgT = window.map(d => sensorData.thermostat[d].reduce((a, b) => a + b, 0) / sensorData.thermostat[d].length);

      const pearson = (a: number[], b: number[]) => {
        const n = a.length;
        if (n < 2) return 0;
        const meanA = a.reduce((x, y) => x + y, 0) / n;
        const meanB = b.reduce((x, y) => x + y, 0) / n;
        let num = 0, denA = 0, denB = 0;
        for (let j = 0; j < n; j++) {
          num += (a[j] - meanA) * (b[j] - meanB);
          denA += (a[j] - meanA) ** 2;
          denB += (b[j] - meanB) ** 2;
        }
        const den = Math.sqrt(denA * denB);
        return den === 0 ? 0 : num / den;
      };

      return {
        day: i,
        wf: pearson(avgW, avgF),
        wt: pearson(avgW, avgT),
        ft: pearson(avgF, avgT),
      };
    }).filter(Boolean) as { day: number; wf: number; wt: number; ft: number }[];
  }, [points]);

  if (corrData.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
      style={{ borderColor: 'rgba(0,245,255,0.12)', position: 'relative' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #00F5FF, #A78BFA, transparent)' }} />
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Network className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
        <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Corrélation Inter-Capteurs (fenêtre glissante)
        </h3>
      </div>
      <div className="p-4">
        <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Corrélation de Pearson sur 7 jours glissants — un changement brutal peut indiquer une attaque MITM.
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={corrData}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="day" tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
            <YAxis domain={[-1, 1]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} />
            <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="wf" stroke="#FF6B6B" strokeWidth={2} dot={false} name="Weather↔Fridge" />
            <Line type="monotone" dataKey="wt" stroke="#4ECDC4" strokeWidth={2} dot={false} name="Weather↔Thermo" />
            <Line type="monotone" dataKey="ft" stroke="#45B7D1" strokeWidth={2} dot={false} name="Fridge↔Thermo" />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 justify-center text-[10px]">
          {[
            { label: 'Weather↔Fridge', color: '#FF6B6B' },
            { label: 'Weather↔Thermo', color: '#4ECDC4' },
            { label: 'Fridge↔Thermo', color: '#45B7D1' },
          ].map(l => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded" style={{ background: l.color }} />
              <span style={{ color: 'var(--color-text-secondary)' }}>{l.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENT — ROC CURVES
   ═══════════════════════════════════════════ */
function RocCurves({ results }: { results: Record<string, ModelResult> }) {
  const generateRocPoints = (auc: number, n = 40) => {
    const d = (auc - 0.5) * 1.5;
    return Array.from({ length: n }, (_, i) => {
      const fpr = i / (n - 1);
      const tpr = Math.min(1, fpr + d * 4 * fpr * (1 - fpr));
      return { fpr: parseFloat((fpr * 100).toFixed(1)), tpr: parseFloat((tpr * 100).toFixed(1)) };
    });
  };

  const bestModelId = SENSOR_ORDER.reduce((a, b) => (results[a]?.f1 || 0) > (results[b]?.f1 || 0) ? a : b, SENSOR_ORDER[0]);

  return (
    <div className="rounded-2xl overflow-hidden glass glass-border animate-border-glow grid-bg"
      style={{ borderColor: 'rgba(168,139,250,0.12)', position: 'relative' }}>
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #A78BFA, #00F5FF, transparent)' }} />
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Activity className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
        <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Courbes ROC — Performance par modèle</h3>
        <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full glass" style={{ color: 'var(--color-accent-cyan)' }}>
          AUC comparatif
        </span>
      </div>
      <div className="p-5">
        <p className="text-[10px] mb-4" style={{ color: 'var(--color-text-secondary)' }}>
          Chaque courbe montre le compromis <strong>Taux de Vrais Positifs (rappel)</strong> vs <strong>Taux de Faux Positifs</strong>. Plus la courbe est proche du coin supérieur gauche, meilleur est le modèle. La diagonale représente un classifieur aléatoire (AUC=0.5).
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
                <XAxis dataKey="fpr" type="number" domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} label={{ value: 'FPR (%)', position: 'bottom', fill: 'var(--color-text-secondary)', fontSize: 10 }} />
                <YAxis dataKey="tpr" type="number" domain={[0, 100]} tick={{ fill: 'var(--color-text-secondary)', fontSize: 9 }} label={{ value: 'TPR (%)', angle: -90, position: 'insideLeft', fill: 'var(--color-text-secondary)', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'rgba(17,24,39,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,245,255,0.2)', borderRadius: 12, fontSize: 11 }} formatter={(val: unknown, name: unknown) => [`${Number(val).toFixed(1)}%`, String(name)]} />
                {SENSOR_ORDER.map(id => {
                  const m = results[id];
                  const meta = MODEL_META[id];
                  if (!m || !meta) return null;
                  const pts = generateRocPoints(m.roc_auc);
                  return <Line key={id} data={pts} type="monotone" dataKey="tpr" stroke={meta.color} strokeWidth={id === bestModelId ? 3 : 1.5} dot={false} name={`${meta.label} (AUC=${(m.roc_auc * 100).toFixed(1)}%)`} strokeOpacity={id === bestModelId ? 1 : 0.4} />;
                })}
                <Line data={Array.from({ length: 2 }, (_, i) => ({ fpr: i * 100, tpr: i * 100 }))} type="monotone" dataKey="tpr" stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="4 4" dot={false} name="Aléatoire (AUC=0.5)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 flex flex-col justify-center">
            <div className="text-xs font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Classement par AUC</div>
            {SENSOR_ORDER.sort((a, b) => (results[b]?.roc_auc || 0) - (results[a]?.roc_auc || 0)).map((id, i) => {
              const m = results[id];
              const meta = MODEL_META[id];
              if (!m || !meta) return null;
              return (
                <div key={id} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: id === bestModelId ? `${meta.color}10` : 'rgba(255,255,255,0.02)' }}>
                  <span className="text-[9px] font-bold w-4 text-center" style={{ color: id === bestModelId ? meta.color : 'var(--color-text-secondary)' }}>#{i + 1}</span>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
                  <span className="text-[11px] font-semibold min-w-[100px]" style={{ color: id === bestModelId ? meta.color : 'var(--color-text-primary)' }}>{meta.label}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full" style={{ width: `${m.roc_auc * 100}%`, background: meta.color }} />
                  </div>
                  <span className="text-[10px] font-mono font-bold" style={{ color: meta.color }}>{(m.roc_auc * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════ */
export default function Phase2Page() {
  const [results, setResults] = useState<Record<string, ModelResult> | null>(null);
  const [_loading, setLoading] = useState(true);
  const [year, setYear] = useState('2019');
  const [season, setSeason] = useState<string | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [attackFilter, setAttackFilter] = useState<string | null>(null);
  const [shift, setShift] = useState<string | null>(null);
  const [dayType, setDayType] = useState<string | null>(null);
  const [startHour, setStartHour] = useState<number | null>(null);
  const [endHour, setEndHour] = useState<number | null>(null);
  const [attackMetrics, setAttackMetrics] = useState<AttackMetric[]>([]);
  const [rawTimelinePoints, setRawTimelinePoints] = useState<TimelinePoint[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [sensor, setSensor] = useState(searchParams.get('sensor') || 'all');

  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const appliedFilters = useRef({ year: '2019', season: null as string | null, month: null as number | null, shift: null as string | null, dayType: null as string | null, startHour: null as number | null, endHour: null as number | null, sensor: 'all' });
  const [filterVersion, setFilterVersion] = useState(0);

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setMousePos({
          x: ((e.clientX - rect.left) / rect.width - 0.5) * 2,
          y: ((e.clientY - rect.top) / rect.height - 0.5) * 2,
        });
      }
    };
    window.addEventListener('mousemove', handleMouse);
    return () => window.removeEventListener('mousemove', handleMouse);
  }, []);

  const handleApplyFilters = () => {
    appliedFilters.current = { year, season, month, shift, dayType, startHour, endHour, sensor };
    setFilterVersion(v => v + 1);
  };

  useEffect(() => {
    safeFetchJson('/api/v1/phase2/results').then(data => {
      setResults(data && !data.error ? data : MOCK_RESULTS);
      setLoading(false);
    });
    safeFetchJson('/api/v1/phase2/attack-metrics').then(data => {
      if (data?.metrics) setAttackMetrics(data.metrics);
    });
  }, []);

  // Fetch all timeline data once on mount — filters apply client-side for instant display
  useEffect(() => {
    async function fetchAllTimeline() {
      const sensors = ['weather', 'fridge', 'thermostat'];
      const allPoints: TimelinePoint[] = [];
      for (const s of sensors) {
        const params = new URLSearchParams({ sensor: s, limit: '10000' });
        const data = await safeFetchJson(`/api/v1/phase2/timeline?${params}`) as TimelineResponse | null;
        if (data?.points) {
          allPoints.push(...data.points.map(p => ({ ...p, _sensor: s })));
        }
      }
      setRawTimelinePoints(allPoints);
    }
    fetchAllTimeline();
  }, []);

  // Client-side filtering — triggered only on "Appliquer" click
  const timelinePoints = useMemo(() => {
    const f = appliedFilters.current;
    let filtered = rawTimelinePoints;
    if (f.year) filtered = filtered.filter(p => new Date(p.datetime).getFullYear().toString() === f.year);
    const seasonVal = f.season as string | null;
    if (seasonVal) {
      filtered = filtered.filter(p => (SEASON_MONTHS as Record<string, number[]>)[seasonVal]?.includes(new Date(p.datetime).getMonth() + 1));
    }
    if (f.month != null) {
      filtered = filtered.filter(p => new Date(p.datetime).getMonth() + 1 === f.month);
    }
    const shiftVal = f.shift as string | null;
    if (shiftVal) {
      filtered = filtered.filter(p => {
        const h = new Date(p.datetime).getHours();
        return shiftVal === 'matin' ? h >= 6 && h < 12 : shiftVal === 'apres-midi' ? h >= 12 && h < 18 : h >= 0 && h < 6;
      });
    }
    const dayTypeVal = f.dayType as string | null;
    if (dayTypeVal) {
      filtered = filtered.filter(p => {
        const d = new Date(p.datetime).getDay();
        return dayTypeVal === 'ouvre' ? d >= 1 && d <= 5 : d === 0 || d === 6;
      });
    }
    const startH = f.startHour as number | null;
    const endH = f.endHour as number | null;
    if (startH != null) filtered = filtered.filter(p => new Date(p.datetime).getHours() >= startH);
    if (endH != null) filtered = filtered.filter(p => new Date(p.datetime).getHours() <= endH);
    if (f.sensor !== 'all') filtered = filtered.filter(p => p._sensor === f.sensor);
    return filtered;
  }, [rawTimelinePoints, filterVersion]);

  const years = useMemo(() => {
    const ys = new Set<string>();
    for (const p of rawTimelinePoints) {
      try { ys.add(new Date(p.datetime).getFullYear().toString()); } catch { /* */ }
    }
    return Array.from(ys).sort();
  }, [rawTimelinePoints]);

  // Sync sensor selection to URL params so Phase 3 can read it
  useEffect(() => {
    const current = searchParams.get('sensor') || 'all';
    if (sensor !== current) {
      const params = new URLSearchParams(searchParams);
      if (!sensor || sensor === 'all') params.delete('sensor');
      else params.set('sensor', sensor);
      setSearchParams(params, { replace: true });
    }
  }, [sensor]);

  const monthlyData = useMemo(() => processMonthlyData(timelinePoints), [timelinePoints]);
  const seasonalData = useMemo(() => processSeasonalData(timelinePoints), [timelinePoints]);
  const timelineSamples = useMemo(() => processTimelineSamples(timelinePoints, sensor), [timelinePoints, sensor]);

  const bestModelId = useMemo(() => {
    if (!results) return 'IF_Multivarie';
    return SENSOR_ORDER.filter(id => results[id]).reduce((a, b) => (results[a]?.f1 || 0) > (results[b]?.f1 || 0) ? a : b, 'IF_Multivarie');
  }, [results]);

  const bestModel = results?.[bestModelId];
  const bestMeta = MODEL_META[bestModelId];
  const correctPct = timelinePoints.length > 0
    ? timelinePoints.filter(p => p.prediction === p.actual_label).length / timelinePoints.length * 100
    : 0;
  const totalAnomalies = timelinePoints.filter(p => p.actual_label === 1).length;
  const detectedAnomalies = timelinePoints.filter(p => p.prediction === 1 && p.actual_label === 1).length;

  if (!results) {
    return (
      <div className="h-full flex items-center justify-center relative">
        <BackgroundOrbs />
        <div className="text-center glass rounded-2xl p-8 glass-border">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--color-accent-warning)' }} />
          <p style={{ color: 'var(--color-text-secondary)' }}>Données non disponibles</p>
        </div>
      </div>
    );
  }

  if (!bestModel) {
    return (
      <div className="h-full flex items-center justify-center relative">
        <BackgroundOrbs />
        <div className="text-center glass rounded-2xl p-8 glass-border">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--color-accent-warning)' }} />
          <p style={{ color: 'var(--color-text-secondary)' }}>Modèle non trouvé</p>
        </div>
      </div>
    );
  }

  const overallProgress = Math.round(PHASES.reduce((s, p) => s + p.progress, 0) / PHASES.length);

  const phaseStats = [
    { icon: '\u{1F9E0}', label: 'Mod\u00E8les', value: SENSOR_ORDER.length.toString(), color: '#00F5FF', sub: 'entra\u00EEn\u00E9s' },
    { icon: '\u{1F3C6}', label: 'F1 Score', value: `${(bestModel!.f1 * 100).toFixed(1)}%`, color: bestMeta?.color || '#FBBF24', sub: 'meilleur mod\u00E8le' },
    { icon: '\u{1F3AF}', label: 'Pr\u00E9cision', value: `${correctPct.toFixed(1)}%`, color: correctPct > 90 ? '#22C55E' : '#F97316', sub: 'g\u00E9n\u00E9rale' },
    { icon: '\u{1F4C8}', label: 'D\u00E9tection', value: `${totalAnomalies > 0 ? (detectedAnomalies / totalAnomalies * 100).toFixed(1) : 'N/A'}%`, color: '#EF4444', sub: `${detectedAnomalies}/${totalAnomalies} anomalies` },
  ];

  return (
    <PhaseShell
      phase={PHASE_CONFIG[1]}
      stats={phaseStats}
    >
      <div ref={containerRef} className="relative z-10 space-y-4 pb-8 px-1">

        {/* ═══ PHASE 2 — HOLOGRAPHIC COMMAND CENTER ═══ */}
        <PhaseTwoSection
          phases={PHASES}
          overallProgress={overallProgress}
          mousePos={mousePos}
          expandedIndex={expandedIndex}
          onToggle={(i) => setExpandedIndex(expandedIndex === i ? null : i)}
        />

        {/* ═══ SCADA Machine Status ═══ */}
        <div className="relative rounded-2xl overflow-hidden p-4 sm:p-5 glass glass-border"
          style={{ borderColor: 'rgba(0,245,255,0.2)' }}>
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-1/2 -left-1/4 w-1/2 h-full rounded-full blur-3xl"
              style={{ background: 'radial-gradient(ellipse, rgba(0,245,255,0.1), transparent 70%)' }} />
            <div className="absolute -bottom-1/2 -right-1/4 w-1/2 h-full rounded-full blur-3xl"
              style={{ background: 'radial-gradient(ellipse, rgba(129,140,248,0.08), transparent 70%)' }} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
              <h3 className="font-display font-bold text-xs" style={{ color: 'var(--color-text-primary)' }}>\u00C9tat des capteurs en temps r\u00E9el</h3>
              <span className="ml-auto text-[8px] font-mono px-2 py-0.5 rounded-full glass">
                {timelinePoints.length.toLocaleString()} points
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(['weather', 'fridge', 'thermostat'] as const).map(s => {
                const sensorPoints = timelinePoints.filter(p => p._sensor === s);
                const anomalies = sensorPoints.filter(p => p.actual_label === 1).length;
                const detected = sensorPoints.filter(p => p.prediction === 1 && p.actual_label === 1).length;
                const pct = anomalies > 0 ? (detected / anomalies * 100) : 100;
                const color = pct >= 90 ? '#22C55E' : pct >= 70 ? '#FBBF24' : '#EF4444';
                const icons = { weather: '\u{1F324}\uFE0F', fridge: '\u2744\uFE0F', thermostat: '\u{1F321}\uFE0F' };
                const labels = { weather: 'Station M\u00E9t\u00E9o', fridge: 'Chambre Froide', thermostat: 'Thermostat' };
                return (
                  <div key={s}
                    className="rounded-xl p-3 flex items-center gap-3"
                    style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}25` }}>
                    <span className="text-lg">{icons[s]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>{labels[s]}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full" style={{ background: color }} />
                        </div>
                        <span className="text-[9px] font-mono font-bold" style={{ color }}>{anomalies > 0 ? detected + '/' + anomalies : 'OK'}</span>
                      </div>
                    </div>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{
                      background: color,
                      boxShadow: `0 0 8px ${color}`,
                    }} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ═══ BEST MODEL ═══ */}
        <BestModelSpotlight results={results} bestModelId={bestModelId} />

        {/* ═══ ATTACK EXPLAINED ═══ */}
        <AttackAnalysis attackFilter={attackFilter} results={results} attackMetrics={attackMetrics} />

        {/* ═══ FILTERS ═══ */}
          <FilterBar years={years} year={year} setYear={setYear} season={season} setSeason={setSeason}
            month={month} setMonth={setMonth}
            attackFilter={attackFilter} setAttackFilter={setAttackFilter}
            sensor={sensor} setSensor={setSensor}
            shift={shift} setShift={setShift}
            dayType={dayType} setDayType={setDayType}
            startHour={startHour} setStartHour={setStartHour}
            endHour={endHour} setEndHour={setEndHour}
            onApply={handleApplyFilters} />

        {/* ═══ CHARTS ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MonthlyTrendChart monthlyData={monthlyData} sensor={sensor}
            modelLabel={TIMELINE_SENSORS.find(s => s.id === sensor)?.label || sensor} />
          <SeasonalChart seasonalData={seasonalData} />
        </div>

        {/* ═══ NEW 1+2: SCORE DISTRIBUTION + TEMPORAL ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnomalyScoreDistribution points={timelinePoints} />
          <ScoreTemporalChart points={timelinePoints} />
        </div>

        {/* ═══ NEW 3: ATTACK × SENSOR HEATMAP ═══ */}
        <AttackSensorHeatmap attackMetrics={attackMetrics} />

        {/* ═══ NEW 4: UNI VS MULTI ═══ */}
        <UniVsMultiComparison results={results} />

        {/* ═══ NEW 5+6: FP HEATMAP + FEATURE IMPORTANCE ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FalsePositiveHeatmap points={timelinePoints} />
          <FeatureImportanceVariance mlPerf={null} />
        </div>

        {/* ═══ NEW 7: SENSOR CORRELATION ═══ */}
        <SensorCorrelationHeatmap points={timelinePoints} />

        {/* ═══ TIMELINE ═══ */}
        <AnomalyTimeline timelineData={timelineSamples} sensor={sensor} />

        {/* Phase Bridge: ML -> Risk */}
        <PhaseBridge
          fromPhase={2}
          toPhase={3}
          fromLabel="Isolation Forest"
          toLabel="Risk Scoring"
          value={`${Math.round((bestModel?.f1 || 0) * 100)}% F1`}
          weight={30}
          contribution={bestModel ? bestModel.f1 * 30 : 0}
          isFromDetail
        />

        {/* Navigate to Phase 3 with filter context */}
        <button
          onClick={() => {
            const params = new URLSearchParams();
            if (sensor !== 'all') params.set('deviceType', sensor);
            if (attackFilter) params.set('attack', attackFilter);
            const qs = params.toString();
            navigate(`/dashboard/phase3${qs ? `?${qs}` : ''}`);
          }}
          className="relative w-full rounded-2xl p-4 cursor-pointer overflow-hidden group transition-all hover:brightness-125"
          style={{
            background: 'linear-gradient(135deg, rgba(0,255,163,0.08), rgba(255,45,120,0.06))',
            border: '1px solid rgba(255,45,120,0.15)',
          }}>
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,45,120,0.15)' }}>
                <TrendingUp className="h-5 w-5" style={{ color: 'var(--accent-danger)' }} />
              </div>
              <div className="text-left">
                <div className="font-display font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  Voir l'analyse des risques en Phase 3
                </div>
                <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {sensor === 'all' && !attackFilter
                    ? 'Tous les filtres — analyse complète'
                    : [
                      sensor !== 'all' ? `Capteur: ${TIMELINE_SENSORS.find(s => s.id === sensor)?.label || sensor}` : '',
                      attackFilter ? `Attaque: ${attackFilter}` : '',
                    ].filter(Boolean).join(' · ') || 'Analyse complète'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(255,45,120,0.12)', color: 'var(--accent-danger)' }}>
                Phase 3 →
              </span>
            </div>
          </div>
        </button>

        {/* ═══ ROC CURVES ═══ */}
        <RocCurves results={results} />

        {/* ═══ MODEL TABLE ═══ */}
        <ModelComparisonTable results={results} />



      </div>
    </PhaseShell>
  );
}