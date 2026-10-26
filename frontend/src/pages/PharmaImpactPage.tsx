import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RadarChart as Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar as RadarPoly,
  ResponsiveContainer,
} from 'recharts';
import {
  Server, Thermometer, CloudSun, Boxes, Factory, ShieldAlert, AlertTriangle,
  Loader2, Pill, TrendingUp, Droplets, Lock, HardDrive, RefreshCw, Flame,
} from 'lucide-react';

const API_BASE = '/api/v1';

const SENSOR_META: Record<string, { icon: React.ReactNode; color: string }> = {
  weather: { icon: <CloudSun className="w-4 h-4" />, color: '#0891B2' },
  fridge: { icon: <SnowflakeIcon />, color: '#0D9488' },
  thermostat: { icon: <Thermometer className="w-4 h-4" />, color: '#E11D48' },
};

const SENSOR_FULL: Record<string, string> = {
  weather: 'Capteur météo (logistique pharma)',
  fridge: 'Frigo / chambre froide (stock pharma)',
  thermostat: 'Thermostat (production pharma)',
};

function SnowflakeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
      <path d="m20 16-4-4 4-4" /><path d="m4 8 4 4-4 4" /><path d="m16 4-4 4-4-4" /><path d="m8 20 4-4 4 4" />
    </svg>
  );
}

/* ───────── Types ───────── */
interface Signature {
  normal_mean: number; normal_std: number; attack_mean: number; attack_std: number;
  mean_shift_sigma: number; std_ratio: number; roll_std_shift_sigma: number;
  out_of_band_pct: number; jump_rate_pct: number;
}
interface SensorInfo {
  id: string; label: string; role: string; domain: string; product_impact: string;
  stock_weight: number; production_weight: number; exposure_index: number; signature: Signature;
}
interface InfluenceCell {
  score: number; index: number; n_points: number; mean_shift_sigma: number; std_ratio: number;
  roll_std_ratio: number; jump_rate_pct: number; drift_sigma: number; streak_ratio: number;
}
interface AttackType {
  id: string; name: string; category: string; severity: string; severity_weight: number;
  description: string; mode: { disponibilite: number; integrite: number; confidentialite: number };
  influence_mean: number; influence_pct: number; influence: Record<string, InfluenceCell | null>;
  stock_impact: number; production_impact: number; quality_impact: number;
  stock: { score: number; batches_at_risk: number; cost_eur: number; effect: string; products: string; regulatory: string[] };
  production: { score: number; hours_downtime: number; cost_eur: number; effect: string; products: string };
  mitigation: string[];
}
interface ImpactPayload {
  meta: { generated_at: string; dataset: string; normal_rows: number; attack_rows: number; sensors_analyzed: number; attack_types_analyzed: number };
  sensors: SensorInfo[];
  attack_types: AttackType[];
  influence_matrix: { sensors: string[]; sensor_labels: string[]; attacks: string[]; matrix: number[][]; max: number };
  overall: { sensor_exposure: Record<string, number>; stock_risk_index: number; production_risk_index: number; top_stock_attacks: string[]; top_production_attacks: string[] };
}

const ATTACK_LABEL: Record<string, string> = {
  ddos: 'DDoS', dos: 'DoS', injection: 'Injection', mitm: 'MitM', backdoor: 'Backdoor',
  ransomware: 'Ransomware', scanning: 'Scan', password: 'Force brute', xss: 'XSS',
};

/* ───────── Helpers ───────── */
function heatColor(v: number) {
  const t = Math.min(1, Math.max(0, v / 100));
  const stops: Array<[number, [number, number, number]]> = [
    [0, [13, 148, 136]],
    [0.5, [255, 184, 48]],
    [1, [225, 29, 72]],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const f = (t - lo[0]) / (hi[0] - lo[0] || 1);
  const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f);
  const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f);
  const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f);
  return `rgba(${r},${g},${b},0.16)`;
}
function heatText(v: number) {
  return v >= 70 ? 'var(--accent-danger)' : v >= 40 ? 'var(--accent-warning)' : 'var(--accent-success)';
}
function levelOf(v: number) {
  if (v >= 70) return { label: 'Critique', color: 'var(--accent-danger)' };
  if (v >= 50) return { label: 'Élevé', color: 'var(--accent-warning)' };
  if (v >= 30) return { label: 'Modéré', color: '#0891B2' };
  return { label: 'Faible', color: 'var(--accent-success)' };
}
function eur(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M€`;
  if (n >= 1_000) return `${Math.round(n / 1000)} k€`;
  return `${n} €`;
}

/* Variantes d'animation réutilisables */
const pageStagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } },
};
const popIn = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: { opacity: 1, scale: 1, transition: { type: 'spring' as const, stiffness: 320, damping: 24 } },
};

/* Compteur animé (0 → valeur) déclenché à l'apparition */
function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const p = Math.min((t - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(eased * value);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format ? format(n) : Math.round(n)}</>;
}

/* Barre de progression animée */
function AnimatedBar({ value, color, delay = 0 }: { value: number; color: string; delay?: number }) {
  return (
    <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${color}66, ${color})` }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, value)}%` }}
        transition={{ duration: 0.9, delay, ease: 'easeOut' }}
      />
    </div>
  );
}

/* Petit encart "ce que ça veut dire" réutilisable */
function Explication({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-3 py-2 flex items-start gap-2" style={{ background: 'rgba(13,148,136,0.04)', border: '1px dashed rgba(13,148,136,0.18)' }}>
      <span className="text-sm leading-none shrink-0" style={{ color: 'var(--accent-primary)' }}>💡</span>
      <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{children}</div>
    </div>
  );
}

/* Bandeau de niveau : mot simple + couleur */
function NiveauBadge({ value }: { value: number }) {
  const lv = levelOf(value);
  return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold"
      style={{ background: `${lv.color}18`, color: lv.color, border: `1px solid ${lv.color}35` }}>
      {lv.label}
    </span>
  );
}

/* ───────── Composants ───────── */
function KpiCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: React.ReactNode }) {
  return (
    <motion.div
      variants={popIn}
      whileHover={{ y: -4, scale: 1.02, transition: { duration: 0.2 } }}
      className="rounded-2xl p-4 glass glass-border card-hover flex items-center gap-3"
      style={{ borderColor: `${color}25` }}
    >
      <motion.div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${color}14`, color }}
        whileHover={{ rotate: [0, -12, 12, 0] }}
        transition={{ duration: 0.5 }}
      >
        {icon}
      </motion.div>
      <div className="min-w-0">
        <div className="font-display font-bold text-xl leading-none" style={{ color }}>{value}</div>
        <div className="text-[10px] font-semibold uppercase tracking-wider mt-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
        <div className="text-[9px] font-mono truncate opacity-60" style={{ color: 'var(--text-secondary)' }}>{sub}</div>
      </div>
    </motion.div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const c = severity === 'critique' ? 'var(--accent-danger)' : severity === 'élevée' ? 'var(--accent-warning)' : '#0891B2';
  return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase" style={{ background: `${c}18`, color: c, border: `1px solid ${c}30` }}>
      {severity}
    </span>
  );
}

function Gauges({ payload }: { payload: ImpactPayload }) {
  const stock = payload.overall.stock_risk_index;
  const prod = payload.overall.production_risk_index;
  const gauges = [
    { label: 'Risque global sur les STOCKS', value: stock, color: stock >= 70 ? 'var(--accent-danger)' : stock >= 50 ? 'var(--accent-warning)' : 'var(--accent-success)', icon: <Boxes className="w-4 h-4" />, detail: 'vos produits pharmaceutiques entreposés (médicaments, matières premières, vaccins)' },
    { label: 'Risque global sur la PRODUCTION', value: prod, color: prod >= 70 ? 'var(--accent-danger)' : prod >= 50 ? 'var(--accent-warning)' : 'var(--accent-success)', icon: <Factory className="w-4 h-4" />, detail: 'vos lignes de fabrication pharmaceutique, salles blanches et conditionnement' },
  ];
  return (
    <div>
      <Explication>
        Ces deux compteurs résument <strong style={{ color: 'var(--text-primary)' }}>toute la page en un coup d'œil</strong> : plus le
        chiffre est haut (70 et plus = rouge), plus les attaques du dataset menacent vos médicaments.
        Ils sont calculés à partir de l'ensemble des 9 types d'attaques étudiés.
      </Explication>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        {gauges.map(g => (
          <motion.div key={g.label} variants={fadeUp} whileHover={{ y: -3 }} className="rounded-2xl p-4 glass glass-border card-hover">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${g.color}14`, color: g.color }}>{g.icon}</div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{g.label}</div>
                  <div className="text-[9px] leading-tight" style={{ color: 'var(--text-secondary)' }}>{g.detail}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display font-bold text-2xl" style={{ color: g.color }}>
                  <AnimatedNumber value={g.value} />
                  <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>/100</span>
                </div>
                <NiveauBadge value={g.value} />
              </div>
            </div>
            <AnimatedBar value={g.value} color={g.color} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SensorCard({ sensor }: { sensor: SensorInfo }) {
  const meta = SENSOR_META[sensor.id] ?? SENSOR_META.weather;
  const sig = sensor.signature;
  const lv = levelOf(sensor.exposure_index);
  const stats = [
    { label: 'T° moyenne en attaque', value: `${sig.attack_mean}°C`, normale: `${sig.normal_mean}°C en temps normal`, niv: Math.abs(sig.mean_shift_sigma) * 20, color: 'var(--text-primary)' },
    { label: 'Fluctuation des mesures', value: `${sig.std_ratio}×`, normale: 'plus élevé = mesures déréglées', niv: (sig.std_ratio - 1) * 40, color: sig.std_ratio > 1.8 ? 'var(--accent-danger)' : sig.std_ratio > 1.3 ? 'var(--accent-warning)' : 'var(--text-primary)' },
    { label: 'Variations brusques (volatilité)', value: `${sig.roll_std_shift_sigma >= 0 ? '+' : ''}${sig.roll_std_shift_sigma} σ`, normale: 'près de 0 = stable', niv: sig.roll_std_shift_sigma * 15, color: sig.roll_std_shift_sigma > 3 ? 'var(--accent-danger)' : sig.roll_std_shift_sigma > 1.5 ? 'var(--accent-warning)' : 'var(--text-primary)' },
    { label: 'Mesures anormales', value: `${sig.out_of_band_pct} %`, normale: 'près de 0 = tout est normal', niv: sig.out_of_band_pct * 3, color: sig.out_of_band_pct > 15 ? 'var(--accent-danger)' : 'var(--text-primary)' },
    { label: 'Changements brusques (sauts)', value: `${sig.jump_rate_pct} %`, normale: 'près de 0 = stable', niv: sig.jump_rate_pct * 4, color: sig.jump_rate_pct > 8 ? 'var(--accent-danger)' : 'var(--text-primary)' },
  ];
  // Le capteur le plus « bousculé » en cas d'attaque
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -4 }}
      className="rounded-2xl p-4 glass glass-border card-hover flex flex-col gap-3"
      style={{ borderColor: `${meta.color}25` }}
    >
      <div className="flex items-center gap-3">
        <motion.div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${meta.color}14`, color: meta.color }}
          whileHover={{ rotate: [0, 14, -14, 0] }}
          transition={{ duration: 0.5 }}
        >{meta.icon}</motion.div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{sensor.label}</div>
          <div className="text-[10px] leading-tight mt-0.5" style={{ color: 'var(--text-secondary)' }}>{sensor.role}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-display font-bold text-2xl" style={{ color: lv.color }}>
            <AnimatedNumber value={sensor.exposure_index} />
          </div>
          <NiveauBadge value={sensor.exposure_index} />
          <div className="text-[8px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-secondary)' }}>exposition</div>
        </div>
      </div>

      <Explication>
        En cas d'attaque dans le dataset, ce capteur est exposé au niveau{' '}
        <strong style={{ color: lv.color }}>{lv.label.toLowerCase()}</strong>. Cela veut dire que ses mesures
        sont plus ou moins perturbées : la température bouge, fluctue ou devient anormale — d'où un risque
        pour vos produits et vos procédés.
      </Explication>

      <div className="rounded-xl p-2.5" style={{ background: `${meta.color}08` }}>
        <div className="text-[10px] mb-2 flex items-center gap-1.5 flex-wrap">
          <span style={{ color: 'var(--text-secondary)' }}>Ce que laisse l'attaque dans les données du capteur :</span>
        </div>
        <div className="space-y-2">
          {stats.map((s, i) => {
            const nlv = levelOf(s.niv);
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.08, duration: 0.35 }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[9.5px]" style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
                  <span className="text-[10px] font-mono font-bold" style={{ color: s.color }}>{s.value}</span>
                </div>
                <AnimatedBar value={Math.min(100, Math.max(2, s.niv))} color={nlv.color} delay={0.25 + i * 0.08} />
                <div className="flex items-center justify-between gap-1 mt-0.5">
                  <span className="text-[8px]" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{s.normale}</span>
                  <span className="text-[8px] font-bold px-1.5 rounded-full" style={{ background: `${nlv.color}15`, color: nlv.color }}>{nlv.label}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <motion.div
        className="text-[10px] leading-relaxed rounded-xl p-2.5"
        style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)', color: 'var(--text-secondary)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: meta.color }}>Conséquence pour vos produits → </span>
        {sensor.product_impact}
      </motion.div>
    </motion.div>
  );
}

function InfluenceMatrix({ payload }: { payload: ImpactPayload }) {
  const m = payload.influence_matrix;
  return (
    <div className="rounded-2xl p-4 glass glass-border card-hover">
      <h2 className="font-display font-bold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
        Grille : quelle attaque bouscule quel capteur ?
      </h2>
      <Explication>
        Chaque case de cette grille répond à une question simple :{' '}
        <strong style={{ color: 'var(--text-primary)' }}>« cette attaque perturbe-t-elle vraiment ce capteur dans le dataset ? »</strong>.
        Vert / chiffre bas = l'attaque laisse le signal presque intact. Orange puis rouge / chiffre haut = le signal du capteur
        devient instable, anormal ou déréglé.
      </Explication>
      <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: `150px repeat(${m.attacks.length}, minmax(0,1fr))`, marginTop: 10 }}>
        <div />
        {m.attacks.map(a => (
          <div key={a} className="text-center text-[9px] font-bold leading-tight truncate" style={{ color: 'var(--text-secondary)' }}>
            {ATTACK_LABEL[a] ?? a}
          </div>
        ))}
        {m.sensors.map((sid, i) => (
          <SensorRow key={sid} sid={sid} values={m.matrix[i]} rowIndex={i} />
        ))}
      </div>
      <div className="flex justify-end items-center gap-1 mt-3 text-[8px]" style={{ color: 'var(--text-secondary)' }}>
        <span>Peu d'impact </span>
        <div className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, rgba(13,148,136,0.16), rgba(255,184,48,0.16), rgba(225,29,72,0.16))', border: '1px solid var(--border)' }} />
        <span> Fort impact</span>
      </div>
    </div>
  );
}

function SensorRow({ sid, values, rowIndex }: { sid: string; values: number[]; rowIndex: number }) {
  const meta = SENSOR_META[sid] ?? SENSOR_META.weather;
  return (
    <>
      <motion.div
        className="flex items-center gap-2 text-[10px] font-semibold truncate"
        style={{ color: meta.color }}
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2 + rowIndex * 0.08 }}
      >
        {meta.icon}
        <span className="truncate">{SENSOR_FULL[sid] ?? sid}</span>
      </motion.div>
      {values.map((v, j) => (
        <motion.div
          key={j}
          title={`${v}/100 — influence mesurée sur le signal`}
          className="cell-hover h-8 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold select-none"
          style={{
            background: heatColor(v),
            color: heatText(v),
            border: '1px solid transparent',
            ['--cell-c']: heatText(v),
          } as React.CSSProperties}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.25 + rowIndex * 0.09 + j * 0.05, type: 'spring', stiffness: 340, damping: 22 }}
          whileHover={{ scale: 1.12, borderColor: heatText(v) }}
        >
          {Math.round(v)}
        </motion.div>
      ))}
    </>
  );
}

function AttackDetail({ attack }: { attack: AttackType }) {
  const [tab, setTab] = useState<'stock' | 'production'>('stock');
  const radarData = [
    { axis: 'Perturbe les services', value: attack.mode.disponibilite },
    { axis: 'Fausse les données', value: attack.mode.integrite },
    { axis: 'Vole les données', value: attack.mode.confidentialite },
  ];
  const cells: Array<[string, InfluenceCell]> = Object.entries(attack.influence).filter(
    (e): e is [string, InfluenceCell] => e[1] !== null,
  );
  const maxRoll = cells.length ? Math.max(...cells.map(c => c[1].roll_std_ratio)) : 0;
  const maxDrift = cells.length ? Math.max(...cells.map(c => Math.abs(c[1].drift_sigma))) : 0;
  const maxJump = cells.length ? Math.max(...cells.map(c => c[1].jump_rate_pct)) : 0;
  const isInjection = attack.id === 'injection';
  return (
    <motion.div
      key={attack.id}
      variants={pageStagger}
      initial="hidden"
      animate="visible"
      className="rounded-2xl p-4 glass glass-border card-hover"
      style={{ borderColor: isInjection ? 'rgba(225,29,72,0.4)' : 'rgba(13,148,136,0.15)', boxShadow: isInjection ? '0 0 40px rgba(225,29,72,0.08)' : 'none' }}
    >
      {isInjection && (
        <motion.div
          variants={fadeUp}
          className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-[11px] font-bold"
          style={{ background: 'rgba(225,29,72,0.1)', border: '1px dashed rgba(225,29,72,0.45)', color: '#E11D48' }}
        >
          <Flame className="w-4 h-4" />
          Injection de données — fausses températures extrêmes injectées dans la télémétrie (chambre froide, lignes)
        </motion.div>
      )}
      <motion.div className="flex items-start gap-3 mb-3" variants={fadeUp}>
        <motion.div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(225,29,72,0.12)', color: 'var(--accent-danger)' }}
          whileHover={{ rotate: [0, -10, 10, 0] }}
          transition={{ duration: 0.6 }}
        >
          <ShieldAlert className="w-5 h-5" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{attack.name}</h3>
            <SeverityBadge severity={attack.severity} />
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{attack.category}</div>
          <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{attack.description}</p>
        </div>
      </motion.div>

      {/* Explication simple de la menace */}
      <Explication>
        <strong style={{ color: 'var(--accent-danger)' }}>En clair :</strong> cette attaque est de niveau{' '}
        <NiveauBadge value={attack.stock_impact} /> sur votre stock et{' '}
        <NiveauBadge value={attack.production_impact} /> sur votre production (sur 100).
        Ce qu'elle fait dans la vraie vie: <em style={{ color: 'var(--text-primary)' }}>{attack.stock.effect}</em>
      </Explication>
      <div className="mt-2" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Radar du mode opératoire */}
        <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
          <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Quel « dégât » l'attaque provoque-t-elle ?</div>
          <ResponsiveContainer width="100%" height={170}>
            <Radar data={radarData} cx="50%" cy="50%" outerRadius="72%">
              <PolarGrid stroke="var(--border)" strokeOpacity={0.4} />
              <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <RadarPoly dataKey="value" stroke="var(--accent-danger)" fill="var(--accent-danger)" fillOpacity={0.22} strokeWidth={1.5} />
            </Radar>
          </ResponsiveContainer>
          <p className="text-[9px] leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.8 }}>
            Plus le graphique est rempli, plus l'attaque est dangereuse sur ce plan : perturber les services,
            fausser les données ou voler des données.
          </p>
        </div>

        {/* Mesures par capteur */}
        <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
          <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Que se passe-t-il sur les capteurs ?</div>
          <div className="text-[9px] mb-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            C'est mesuré dans le dataset : quand cette attaque a eu lieu, voilà à quel point le signal du capteur
            a été perturbé (0 = rien, 100 = très perturbé).
          </div>
          <div className="space-y-2">
            {cells.map(([sid, cell]) => (
              <div key={sid} className="flex items-center gap-2">
                <div className="w-24 text-[9px] truncate" style={{ color: 'var(--text-secondary)' }}>{SENSOR_FULL[sid]}</div>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}>
                  <div className="h-full rounded-full" style={{ width: `${cell.index}%`, background: heatColor(cell.index) }} />
                </div>
                <NiveauBadge value={cell.index} />
              </div>
            ))}
          </div>
          <div className="text-[9px] mt-2 space-y-1 leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.85 }}>
            <div className="flex items-start gap-1"><span>•</span><span>Les mesures <strong style={{ color: 'var(--text-primary)' }}>s'affolent</strong> : jusqu'à {maxRoll.toFixed(1)}× plus qu'en temps normal.</span></div>
            <div className="flex items-start gap-1"><span>•</span><span>La température <strong style={{ color: 'var(--text-primary)' }}>glisse</strong> : dérive jusqu'à {maxDrift.toFixed(1)} écart-type.</span></div>
            <div className="flex items-start gap-1"><span>•</span><span>Des <strong style={{ color: 'var(--text-primary)' }}>changements brusques</strong> : jusqu'à {maxJump.toFixed(1)} % des mesures.</span></div>
          </div>
        </div>

        {/* Impact business, onglets stock/production */}
        <div className="rounded-xl p-3 flex flex-col" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
          <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Conséquences pour votre entreprise</div>
          <div className="text-[9px] mb-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Si cette attaque réussit, voici ce qui peut arriver :
          </div>
          <div className="flex gap-1 mb-2">
            {(['stock', 'production'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all hover:scale-[1.04] ${tab === t ? '' : 'opacity-50'}`}
                style={tab === t
                  ? { background: t === 'stock' ? 'rgba(13,148,136,0.15)' : 'rgba(124,58,237,0.15)', color: t === 'stock' ? 'var(--accent-success)' : 'var(--accent-purple)', border: `1px solid ${t === 'stock' ? 'rgba(13,148,136,0.3)' : 'rgba(124,58,237,0.3)'}` }
                  : { border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                {t === 'stock' ? 'Surtout les stocks' : 'Surtout la production'}
              </button>
            ))}
          </div>
          {tab === 'stock' ? (
            <div className="space-y-1 flex-1">
              <ImpactRow label="Impact stock" value={attack.stock.score} color="var(--accent-success)" />
              <ImpactRow label="Impact qualité" value={attack.quality_impact} color="var(--accent-warning)" />
              <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{attack.stock.effect}</div>
              <div className="text-[9.5px] leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.9 }}>
                On estime à <strong style={{ color: 'var(--accent-warning)' }}>{attack.stock.batches_at_risk} lots de médicaments</strong> le nombre de lots à risque,
                pour un coût d'environ <strong style={{ color: 'var(--accent-warning)' }}>{eur(attack.stock.cost_eur)}</strong>.
              </div>
            </div>
          ) : (
            <div className="space-y-1 flex-1">
              <ImpactRow label="Impact production" value={attack.production.score} color="var(--accent-purple)" />
              <ImpactRow label="Envie qualité" value={attack.quality_impact} color="var(--accent-warning)" />
              <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{attack.production.effect}</div>
              <div className="text-[9.5px] leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.9 }}>
                On estime l'arrêt de la ligne à <strong style={{ color: 'var(--accent-warning)' }}>{attack.production.hours_downtime} heures</strong>,
                pour un coût d'environ <strong style={{ color: 'var(--accent-warning)' }}>{eur(attack.production.cost_eur)}</strong>.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
          <div className="text-[9px] uppercase tracking-wider mb-1.5 font-bold" style={{ color: 'var(--accent-danger)' }}>Quels produits sont touchés ?</div>
          <div className="text-[9px] mb-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.85 }}>Les produits les plus exposés à cette attaque :</div>
          <div className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{attack.stock.products}</div>
          <div className="text-[9px] uppercase tracking-wider mt-2 mb-1.5 font-bold" style={{ color: 'var(--accent-warning)' }}>Ce qu'exige la réglementation</div>
          <div className="text-[9px] mb-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.85 }}>En cas de problème, la loi vous oblige en particulier à :</div>
          <ul className="space-y-0.5">
            {attack.stock.regulatory.map(r => (
              <li key={r} className="text-[9px] flex items-start gap-1" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--accent-warning)' }}>▸</span>{r}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
          <div className="text-[9px] uppercase tracking-wider mb-1.5 font-bold" style={{ color: 'var(--accent-success)' }}>Comment se protéger ?</div>
          <div className="text-[9px] mb-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.85 }}>Voici ce qu'on peut mettre en place pour éviter ou limiter cette attaque :</div>
          <ul className="space-y-1">
            {attack.mitigation.map(m => (
              <li key={m} className="text-[10px] flex items-start gap-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                <Lock className="w-3 h-3 mt-0.5 shrink-0" style={{ color: 'var(--accent-success)' }} />
                {m}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </motion.div>
  );
}

function ImpactRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-[9px] w-20 shrink-0" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}>
        <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${color}55, ${color})` }}
          initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
      </div>
      <div className="text-[11px] font-mono font-bold w-7 text-right" style={{ color }}>{Math.round(value)}</div>
    </div>
  );
}

/* ───────── Page principale ───────── */
export default function PharmaImpactPage() {
  const [payload, setPayload] = useState<ImpactPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('backdoor');

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/pharma/impact`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((data: ImpactPayload) => {
        setPayload(data);
        setSelectedId(prev => data.attack_types.some(a => a.id === prev) ? prev : data.attack_types[0]?.id ?? '');
      })
      .catch(() => setPayload(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/pharma/impact`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((data: ImpactPayload) => {
        if (cancelled) return;
        setPayload(data);
        setSelectedId(prev => data.attack_types.some(a => a.id === prev) ? prev : data.attack_types[0]?.id ?? '');
      })
      .catch(() => { if (!cancelled) setPayload(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(
    () => payload?.attack_types.find(a => a.id === selectedId) ?? null,
    [payload, selectedId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <div className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>Analyse de l'impact des attaques du dataset…</div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <AlertTriangle className="w-10 h-10" style={{ color: 'var(--accent-warning)' }} />
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Impossible de charger l'analyse. Vérifiez que le backend est démarré.</div>
        <button onClick={load} className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5"
          style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          <RefreshCw className="w-3 h-3" /> Réessayer
        </button>
      </div>
    );
  }

  return (
    <motion.div className="space-y-4" variants={pageStagger} initial="hidden" animate="visible">
      {/* En-tête */}
      <motion.div variants={fadeUp} className="rounded-2xl overflow-hidden glass glass-border card-hover" style={{ borderColor: 'rgba(13,148,136,0.2)', boxShadow: '0 0 40px rgba(13,148,136,0.07)' }}>
        <div className="px-5 py-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #0D948820, #7C3AED08)', color: '#0D9488', boxShadow: '0 0 30px #0D948825' }}>
              <Pill className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Impact des attaques du dataset — Industrie 4.0 pharmaceutique
              </h1>
              <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Comment chaque type d'attaque influence chaque capteur IoT et comment il affecte vos stocks et votre production de produits pharmaceutiques.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[9px] font-mono mt-2" style={{ color: 'var(--text-secondary)' }}>
            <span className="px-2 py-0.5 rounded-full" style={{ background: 'rgba(13,148,136,0.1)', color: 'var(--accent-success)' }}>{payload.meta.dataset} · {payload.meta.normal_rows.toLocaleString('fr-FR')} normal / {payload.meta.attack_rows.toLocaleString('fr-FR')} attaques</span>
            <span>Indice affiché en temps quasi réel</span>
            <span>· {new Date(payload.meta.generated_at).toLocaleString('fr-FR')}</span>
          </div>
        </div>
      </motion.div>

      {/* KPIs */}
      <motion.div className="grid grid-cols-2 gap-3" variants={pageStagger} initial="hidden" animate="visible">
        <KpiCard label="Capteurs étudiés" value={String(payload.meta.sensors_analyzed)} sub="météo · chambre froide · thermostat — usine pharma" color="#0891B2" icon={<Server className="w-4 h-4" />} />
        <KpiCard label="Attaques étudiées" value={String(payload.meta.attack_types_analyzed)} sub="DoS, injection, MitM, ransomware…" color="var(--accent-warning)" icon={<TrendingUp className="w-4 h-4" />} />
      </motion.div>

      {/* Jauges */}
      <motion.div variants={fadeUp}><Gauges payload={payload} /></motion.div>

      {/* Section capteurs */}
      <motion.div className="flex items-center gap-2" variants={fadeUp}>
        <Droplets className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
        <h2 className="font-display font-bold text-sm" style={{ color: 'var(--text-primary)' }}>1 · Comment les attaques du dataset influencent chaque capteur</h2>
      </motion.div>
      <motion.div className="grid grid-cols-1 md:grid-cols-3 gap-3" variants={pageStagger} initial="hidden" animate="visible">
        {payload.sensors.map(s => <SensorCard key={s.id} sensor={s} />)}
      </motion.div>

      {/* Matrice */}
      <motion.div variants={fadeUp}><InfluenceMatrix payload={payload} /></motion.div>

      {/* Détail par attaque */}
      <motion.div className="flex items-center gap-2 mt-2" variants={fadeUp}>
        <HardDrive className="w-4 h-4" style={{ color: 'var(--accent-purple)' }} />
        <h2 className="font-display font-bold text-sm" style={{ color: 'var(--text-primary)' }}>2 · Focus par type d'attaque — impact sur vos produits</h2>
      </motion.div>
      <motion.div className="flex gap-1.5 flex-wrap" variants={pageStagger} initial="hidden" animate="visible">
        {payload.attack_types.map(a => {
          const isInjection = a.id === 'injection';
          const active = selectedId === a.id;
          return (
            <motion.button
              key={a.id}
              variants={popIn}
              whileHover={{ scale: 1.06, y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setSelectedId(a.id)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${active ? '' : 'opacity-60 hover:opacity-100'}`}
              style={active
                ? {
                    background: isInjection ? 'rgba(225,29,72,0.2)' : 'var(--accent-danger)18',
                    color: isInjection ? '#E11D48' : 'var(--accent-danger)',
                    border: isInjection
                      ? '1px solid rgba(225,29,72,0.6)'
                      : '1px solid var(--accent-danger)40',
                    boxShadow: isInjection ? '0 0 22px rgba(225,29,72,0.35)' : 'none',
                  }
                : { border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              {ATTACK_LABEL[a.id] ?? a.id}
            </motion.button>
          );
        })}
      </motion.div>
      <AnimatePresence mode="wait">
        {selected && <motion.div key={selected.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}><AttackDetail attack={selected} /></motion.div>}
      </AnimatePresence>
    </motion.div>
  );
}