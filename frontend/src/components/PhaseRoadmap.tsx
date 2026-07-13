import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Radio, Brain, Shield, Eye, Activity, CheckCircle2, Clock,
  AlertTriangle, ChevronRight, Server, BarChart3, Satellite,
} from 'lucide-react';

interface PhaseMetric {
  label: string;
  value: string;
  color: string;
}

interface PhaseData {
  id: string;
  label: string;
  number: number;
  icon: React.ReactNode;
  color: string;
  glow: string;
  gradient: string;
  status: 'complete' | 'active' | 'pending';
  progress: number;
  route: string;
  description: string;
  highlights: string[];
  metrics: PhaseMetric[];
  orbitAngle: number;
}

export const PHASES: PhaseData[] = [
  {
    id: 'phase1', number: 1, label: 'Ingestion & DPI',
    icon: <Radio className="w-5 h-5" />,
    color: '#00F5FF', glow: 'rgba(0,245,255,',
    gradient: 'linear-gradient(135deg, #00F5FF, #0891B2)',
    status: 'complete', progress: 100,
    route: '/dashboard/phase1',
    description: 'Inspection profonde des paquets MQTT · Détection d\'intrusions protocolaires en temps réel',
    highlights: ['6 règles DPI', '15K+ messages/s', 'Latence < 350µs', 'Backtesting 94.2%'],
    metrics: [
      { label: 'Messages', value: '15,245', color: '#00F5FF' },
      { label: 'Alertes', value: '24', color: '#F97316' },
      { label: 'Précision', value: '94.2%', color: '#22C55E' },
    ],
    orbitAngle: 90,
  },
  {
    id: 'phase2', number: 2, label: 'ML & Anomalies',
    icon: <Brain className="w-5 h-5" />,
    color: '#818cf8', glow: 'rgba(129,140,248,',
    gradient: 'linear-gradient(135deg, #818cf8, #6366F1)',
    status: 'complete', progress: 100,
    route: '/dashboard/phase2',
    description: '7 modèles ML · Isolation Forest · Autoencodeur PCA · GNN · LSTM',
    highlights: ['7 modèles', 'F1 > 94%', '3 capteurs', '9 types d\'attaques'],
    metrics: [
      { label: 'Modèles', value: '7', color: '#818cf8' },
      { label: 'F1 Moyen', value: '94.7%', color: '#22C55E' },
      { label: 'Détection', value: '95.7%', color: '#22C55E' },
    ],
    orbitAngle: 0,
  },
  {
    id: 'phase3', number: 3, label: 'CVE & Risques',
    icon: <Shield className="w-5 h-5" />,
    color: '#F97316', glow: 'rgba(249,115,22,',
    gradient: 'linear-gradient(135deg, #F97316, #EA580C)',
    status: 'active', progress: 65,
    route: '/dashboard/phase3',
    description: 'Analyse de vulnérabilités · Score de risque prédictif · Intégration CVE · What-If',
    highlights: ['CVE Pipeline', 'Risk Scoring', 'What-If Analysis', 'IEC 62443'],
    metrics: [
      { label: 'CVE Traitées', value: '142', color: '#F97316' },
      { label: 'Score Risque', value: '42.7', color: '#F97316' },
      { label: 'Appareils', value: '412', color: '#00F5FF' },
    ],
    orbitAngle: -90,
  },
  {
    id: 'phase4', number: 4, label: 'Threat Intel',
    icon: <Eye className="w-5 h-5" />,
    color: '#22C55E', glow: 'rgba(34,197,94,',
    gradient: 'linear-gradient(135deg, #22C55E, #16A34A)',
    status: 'pending', progress: 15,
    route: '/dashboard/threats',
    description: 'Tableau de bord CTI · Corrélation multi-source · Rapports conformité · LLM/RAG',
    highlights: ['Threat Dashboard', 'LLM/RAG Analyst', 'Géo-cartographie', 'Rapports PDF'],
    metrics: [
      { label: 'Menaces', value: '—', color: '#8892a8' },
      { label: 'Sources', value: '—', color: '#8892a8' },
      { label: 'Conformité', value: '—', color: '#8892a8' },
    ],
    orbitAngle: 180,
  },
];

/* ───────────────────────────────────────────────
   HOLOGRAPHIC ORBITAL VIEW
   ─────────────────────────────────────────────── */
function OrbitalView({ phases, overallProgress, mousePos }: {
  phases: PhaseData[];
  overallProgress: number;
  mousePos: { x: number; y: number };
}) {
  const [tick, setTick] = useState(0);
  const orbitRef = useRef<HTMLDivElement>(null);
  const [radarAngle, setRadarAngle] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => { setTick(t => t + 1); setRadarAngle(a => (a + 0.8) % 360); }, 50);
    return () => clearInterval(iv);
  }, []);

  const cx = 200, cy = 200, R = 110;

  const phasePositions = useMemo(() =>
    phases.map((p) => {
      const rad = (p.orbitAngle * Math.PI) / 180;
      return { x: cx + R * Math.cos(rad), y: cy + R * Math.sin(rad) };
    }),
  [phases]);

  return (
    <div
      ref={orbitRef}
      className="relative rounded-2xl overflow-hidden"
      style={{
        background: 'var(--color-bg-panel)',
        border: '1px solid var(--color-border)',
        minHeight: 420,
      }}
    >
      {/* Holographic grid overlay */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.08 }}>
        <defs>
          <pattern id="hologrid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="var(--color-accent-cyan)" strokeWidth="0.3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hologrid)" />
      </svg>

      {/* Scan lines */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.04]">
        <div className="absolute inset-0" style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, var(--color-accent-cyan) 2px, var(--color-accent-cyan) 3px)',
        }} />
      </div>

      {/* Aurora backglow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute -top-1/3 -left-1/3 w-2/3 h-2/3 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(ellipse, rgba(0,245,255,0.06), transparent 70%)' }}
          animate={{ x: [0, 20, -10, 0], y: [0, -15, 10, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-1/3 -right-1/3 w-2/3 h-2/3 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(ellipse, rgba(129,140,248,0.06), transparent 70%)' }}
          animate={{ x: [0, -20, 10, 0], y: [0, 15, -10, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Parallax container */}
      <div
        className="relative z-10 w-full h-full flex items-center justify-center p-4"
        style={{
          transform: `translateX(${mousePos.x * 8}px) translateY(${mousePos.y * 8}px)`,
          transition: 'transform 0.2s ease-out',
        }}
      >
        <svg viewBox="0 0 400 400" className="w-full max-w-[400px] h-auto drop-shadow-2xl">
          <defs>
            {/* Glow filters */}
            <filter id="glow-cyan"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <filter id="glow-purple"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <filter id="glow-orange"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <filter id="glow-green"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <filter id="glow-strong"><feGaussianBlur stdDeviation="8" /></filter>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00F5FF" stopOpacity="0.4" />
              <stop offset="40%" stopColor="#818cf8" stopOpacity="0.15" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <radialGradient id="radarGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="60%" stopColor="transparent" />
              <stop offset="80%" stopColor="var(--color-accent-cyan)" stopOpacity="0.03" />
              <stop offset="100%" stopColor="var(--color-accent-cyan)" stopOpacity="0.08" />
            </radialGradient>
            {/* Energy beam gradients */}
            <linearGradient id="beam1" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00F5FF" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="beam2" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#F97316" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="beam3" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#F97316" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#22C55E" stopOpacity="0.6" />
            </linearGradient>
          </defs>

          {/* Radar background cone */}
          <g transform={`rotate(${radarAngle}, 200, 200)`}>
            <path d="M 200 200 L 200 40 A 160 160 0 0 1 360 200 Z" fill="url(#radarGrad)" opacity={0.5} />
          </g>

          {/* Outer orbital rings */}
          {[0.7, 0.85, 1.0].map((scale, i) => (
            <motion.ellipse
              key={i}
              cx={cx} cy={cy}
              rx={R * scale} ry={R * scale * 0.45}
              fill="none"
              stroke="var(--color-text-secondary)"
              strokeOpacity={0.06 + i * 0.04}
              strokeWidth={0.5}
              strokeDasharray={i === 1 ? '4 6' : 'none'}
              transform={`rotate(${15 + i * 5 + tick * 0.1}, ${cx}, ${cy})`}
            />
          ))}

          {/* Dashed orbit path */}
          <motion.ellipse
            cx={cx} cy={cy}
            rx={R} ry={R * 0.45}
            fill="none" stroke="var(--color-accent-cyan)"
            strokeOpacity={0.12} strokeWidth={1}
            strokeDasharray="3 8"
            transform={`rotate(${15 + tick * 0.05}, ${cx}, ${cy})`}
          />

          {/* Connection beams between phases */}
          {phasePositions.map((pos, i) => {
            const next = (i + 1) % phasePositions.length;
            const pNext = phasePositions[next];
            const beamGrad = [`url(#beam1)`, `url(#beam2)`, `url(#beam3)`, `url(#beam1)`][i];
            return (
              <g key={`beam-${i}`}>
                <line
                  x1={pos.x} y1={pos.y} x2={pNext.x} y2={pNext.y}
                  stroke={beamGrad} strokeWidth="1" opacity="0.3" strokeDasharray="4 4"
                />
                {/* Energy orb traveling along beam */}
                <motion.circle
                  r="3"
                  fill={phases[next].color}
                  filter={`url(#glow-${['cyan', 'purple', 'orange', 'green'][next]})`}
                  animate={{
                    offsetDistance: ['0%', '100%'],
                  }}
                  transition={{
                    duration: 2 + i,
                    repeat: Infinity,
                    delay: i * 0.5,
                    ease: 'linear',
                  }}
                  style={{ offsetPath: `path('M ${pos.x} ${pos.y} L ${pNext.x} ${pNext.y}')` }}
                />
              </g>
            );
          })}

          {/* Diagonal crossing lines */}
          {[
            [phasePositions[0], phasePositions[2]],
            [phasePositions[1], phasePositions[3]],
          ].map(([a, b], i) => (
            <line
              key={`cross-${i}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={i === 0 ? '#00F5FF' : '#818cf8'}
              strokeWidth="0.5" opacity="0.15" strokeDasharray="2 6"
            />
          ))}

          {/* Phase orbit nodes */}
          {phases.map((phase, i) => {
            const pos = phasePositions[i];
            const isActive = phase.status === 'active';
            const isComplete = phase.status === 'complete';
            const nodeR = isActive ? 20 : 16;
            return (
              <g key={phase.id}>
                {/* Pulse ring for active phase */}
                {isActive && (
                  <motion.circle
                    cx={pos.x} cy={pos.y} r={nodeR + 8}
                    fill="none" stroke={phase.color}
                    strokeWidth="1.5" opacity="0.4"
                    animate={{ r: [nodeR + 8, nodeR + 20, nodeR + 8], opacity: [0.4, 0, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
                {/* Glow halo */}
                <motion.circle
                  cx={pos.x} cy={pos.y} r={nodeR + 6}
                  fill={phase.glow + '0.1'} stroke="none"
                  animate={{
                    r: isActive ? [nodeR + 6, nodeR + 10, nodeR + 6] : [nodeR + 6, nodeR + 8, nodeR + 6],
                  }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />
                {/* Node background */}
                <circle cx={pos.x} cy={pos.y} r={nodeR} fill="var(--color-bg-panel)" stroke={phase.color} strokeWidth="1.5" opacity="0.9" />
                {/* Status dot */}
                <circle cx={pos.x} cy={pos.y} r={isComplete ? 5 : isActive ? 6 : 3} fill={phase.color}
                  filter={`url(#glow-${['cyan', 'purple', 'orange', 'green'][i]})`} />
                {/* Phase number label */}
                <text x={pos.x} y={pos.y + nodeR + 14} textAnchor="middle" fill={phase.color} fontSize="8" fontWeight="bold" fontFamily="JetBrains Mono, monospace">
                  PHASE {phase.number}
                </text>
                {/* Phase name */}
                <text x={pos.x} y={pos.y + nodeR + 26} textAnchor="middle" fill="var(--color-text-secondary)" fontSize="7" fontFamily="Plus Jakarta Sans, sans-serif">
                  {phase.label}
                </text>
              </g>
            );
          })}

          {/* CENTRAL CORE */}
          <circle cx={cx} cy={cy} r="55" fill="url(#coreGlow)" />
          <circle cx={cx} cy={cy} r="50" fill="none" stroke="var(--color-accent-cyan)" strokeOpacity="0.08" strokeWidth="0.5" />

          {/* Inner rings */}
          {[18, 26, 34].map((r, i) => (
            <motion.circle
              key={`ring-${i}`}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="var(--color-accent-cyan)"
              strokeOpacity={0.1 - i * 0.02}
              strokeWidth={0.5}
              strokeDasharray={i === 1 ? '2 4' : 'none'}
              animate={{ rotate: [0, 360] }}
              style={{ transformOrigin: `${cx}px ${cy}px` }}
              transition={{ duration: 10 + i * 5, repeat: Infinity, ease: 'linear' }}
            />
          ))}

          {/* Central core icon */}
          <motion.g
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
            style={{ transformOrigin: `${cx}px ${cy}px` }}
          >
            {[0, 60, 120, 180, 240, 300].map((angle, i) => {
              const rad = (angle * Math.PI) / 180;
              const x = cx + 22 * Math.cos(rad);
              const y = cy + 22 * Math.sin(rad);
              return (
                <circle key={`sat-${i}`} cx={x} cy={y} r="1.5" fill="#00F5FF" opacity={0.6} />
              );
            })}
          </motion.g>

          {/* Core text */}
          <text x={cx} y={cy - 8} textAnchor="middle" fill="var(--color-accent-cyan)" fontSize="22" fontWeight="900" fontFamily="Space Grotesk, sans-serif" filter="url(#glow-cyan)">
            PS
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--color-text-secondary)" fontSize="6" opacity="0.6" fontFamily="JetBrains Mono, monospace">
            {overallProgress}%
          </text>

          {/* Orbiting particles */}
          {Array.from({ length: 12 }).map((_, i) => {
            const angle = (tick * 0.5 + i * 30) % 360;
            const rad = (angle * Math.PI) / 180;
            const dist = 45 + Math.sin(tick * 0.05 + i) * 10;
            const x = cx + dist * Math.cos(rad);
            const y = cy + dist * Math.sin(rad) * 0.45;
            return (
              <circle key={`particle-${i}`} cx={x} cy={y} r="1.2"
                fill={i % 2 === 0 ? '#00F5FF' : '#818cf8'}
                opacity={0.3 + Math.sin(tick * 0.1 + i) * 0.2}
              />
            );
          })}
        </svg>
      </div>

      {/* Title overlay at top */}
      <div className="absolute top-3 left-4 right-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          >
            <Satellite className="w-4 h-4" style={{ color: 'var(--color-accent-cyan)' }} />
          </motion.div>
          <span className="font-display font-bold text-xs" style={{ color: 'var(--color-text-primary)' }}>
            HOLOGRAPHIC COMMAND CENTER
          </span>
          <motion.span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--color-accent-green)' }}
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        </div>
        <div className="flex items-center gap-3">
          {phases.map((p, i) => (
            <div key={p.id} className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
              <span className="text-[7px] font-mono hidden sm:inline" style={{ color: 'var(--color-text-secondary)' }}>
                P{i + 1}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────
   PHASE CARD — GLASSMORPHISM HOLOGRAPHIC
   ─────────────────────────────────────────────── */
function PhaseCard({ phase, index, expanded, onToggle, mousePos: globalMouse }: {
  phase: PhaseData; index: number; expanded: boolean; onToggle: () => void;
  mousePos: { x: number; y: number };
}) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [localMouse, setLocalMouse] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [flipped, setFlipped] = useState(false);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      setLocalMouse({
        x: ((e.clientX - rect.left) / rect.width - 0.5) * 2,
        y: ((e.clientY - rect.top) / rect.height - 0.5) * 2,
      });
    }
  };

  const statusIcon = {
    complete: <CheckCircle2 className="w-3 h-3" />,
    active: <Activity className="w-3 h-3" />,
    pending: <Clock className="w-3 h-3" />,
  };
  const statusLabel = { complete: 'Terminée', active: 'En cours', pending: 'Planifiée' };
  const statusColor = { complete: 'var(--color-accent-green)', active: 'var(--color-accent-cyan)', pending: 'var(--color-text-secondary)' };

  const mx = isHovered ? localMouse.x : globalMouse.x * 0.3;
  const my = isHovered ? localMouse.y : globalMouse.y * 0.3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 + 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative group"
      style={{ perspective: '1500px' }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setLocalMouse({ x: 0, y: 0 }); }}
    >
      <motion.div
        className="relative rounded-2xl overflow-hidden cursor-pointer"
        style={{
          transform: `rotateX(${-my * 4}deg) rotateY(${mx * 4}deg)`,
          transformStyle: 'preserve-3d',
          background: flipped
            ? 'var(--color-bg-panel)'
            : `linear-gradient(135deg, ${phase.color}08, var(--color-bg-panel) 60%)`,
          border: expanded ? `1.5px solid ${phase.color}50` : '1px solid var(--color-border)',
          boxShadow: isHovered
            ? `0 8px 40px -12px ${phase.color}40, 0 0 60px -20px ${phase.color}20`
            : `0 4px 20px -8px rgba(0,0,0,0.3)`,
        }}
        transition={{ type: 'spring', stiffness: 250, damping: 18 }}
        onClick={() => { if (!flipped) onToggle(); else setFlipped(false); }}
      >
        {/* Holographic glare */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(135deg, transparent 40%, ${phase.color}08 50%, transparent 60%)`,
            opacity: isHovered ? 0.6 : 0,
            transform: `translateX(${mx * 30}px) translateY(${my * 30}px)`,
          }}
          transition={{ duration: 0.3 }}
        />

        {/* Top section */}
        <div className="relative p-4 pb-2">
          <div className="flex items-center gap-2.5 mb-2">
            <motion.div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: `${phase.color}15`,
                color: phase.color,
                boxShadow: isHovered ? `0 0 20px ${phase.color}30` : 'none',
              }}
              animate={isHovered ? { rotate: [0, -5, 5, 0] } : {}}
              transition={{ duration: 0.5 }}
            >
              {phase.icon}
            </motion.div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${phase.color}20`, color: phase.color }}>
                  P{phase.number}
                </span>
                <span className="inline-flex items-center gap-1 text-[7px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${statusColor[phase.status]}12`, color: statusColor[phase.status] }}>
                  {statusIcon[phase.status]}
                  {statusLabel[phase.status]}
                </span>
              </div>
              <h3 className="font-display font-bold text-xs mt-0.5" style={{ color: 'var(--color-text-primary)' }}>
                {phase.label}
              </h3>
            </div>
          </div>

          {/* Mini progress bar */}
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-sidebar)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: phase.gradient }}
              initial={{ width: 0 }}
              animate={{ width: `${phase.progress}%` }}
              transition={{ duration: 1.5, delay: 0.2 + index * 0.1, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Expandable detail */}
        <AnimatePresence>
          {expanded && !flipped && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-2.5" style={{ borderTop: `1px solid ${phase.color}15` }}>
                <p className="text-[9px] pt-2 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {phase.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {phase.highlights.map((h, i) => (
                    <span key={i} className="text-[7px] font-semibold px-1.5 py-0.5 rounded-md" style={{ background: `${phase.color}10`, color: phase.color, border: `1px solid ${phase.color}20` }}>
                      {h}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {phase.metrics.map((m, i) => (
                    <div key={i} className="text-center p-1.5 rounded-lg" style={{ background: 'var(--color-bg-sidebar)' }}>
                      <div className="font-display text-xs font-bold" style={{ color: m.color }}>{m.value}</div>
                      <div className="text-[6px] font-mono mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{m.label}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={(e) => { e.stopPropagation(); navigate(phase.route); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[8px] font-bold cursor-pointer"
                    style={{ background: `${phase.color}15`, color: phase.color, border: `1px solid ${phase.color}30` }}
                  >
                    Explorer <ChevronRight className="w-2.5 h-2.5" />
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={(e) => { e.stopPropagation(); setFlipped(!flipped); }}
                    className="px-2.5 py-1.5 rounded-lg text-[8px] font-bold cursor-pointer"
                    style={{ background: 'var(--color-bg-sidebar)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    Détails
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Flipped back — matrix view */}
        <AnimatePresence>
          {flipped && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-4 space-y-2"
              style={{ borderTop: `1px solid ${phase.color}15` }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: phase.color }}>DÉTAILS TECHNIQUES</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: 'Précision', value: phase.status === 'pending' ? '—' : '94.2%', c: '#818cf8' },
                  { label: 'Rappel', value: phase.status === 'pending' ? '—' : '95.7%', c: '#22C55E' },
                  { label: 'F1-Score', value: phase.status === 'pending' ? '—' : '94.7%', c: '#F97316' },
                  { label: 'Statut', value: statusLabel[phase.status], c: statusColor[phase.status] },
                ].map((d, i) => (
                  <div key={i} className="p-2 rounded-lg" style={{ background: 'var(--color-bg-sidebar)' }}>
                    <div className="text-[6px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>{d.label}</div>
                    <div className="text-[10px] font-bold font-mono" style={{ color: d.c }}>{d.value}</div>
                  </div>
                ))}
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
                className="w-full py-1.5 rounded-lg text-[8px] font-bold cursor-pointer"
                style={{ background: 'var(--color-bg-sidebar)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                ← Retour
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

/* ───────────────────────────────────────────────
   PHASE 2 — ML & ANOMALIES (HOLOGRAPHIC COMMAND CENTER)
   ─────────────────────────────────────────────── */
export function PhaseTwoSection({ phases, overallProgress, mousePos, expandedIndex, onToggle }: {
  phases: PhaseData[];
  overallProgress: number;
  mousePos: { x: number; y: number };
  expandedIndex: number | null;
  onToggle: (i: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(129,140,248,0.15)' }}>
          <Brain className="w-4 h-4" style={{ color: '#818cf8' }} />
        </div>
        <div>
          <h2 className="font-display font-bold text-sm flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
            PHASE 2 — ML &amp; Anomalies
            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full" style={{ background: 'rgba(129,140,248,0.12)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.2)' }}>
              HOLOGRAPHIC COMMAND CENTER
            </span>
          </h2>
          <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            7 modèles ML · Isolation Forest · Autoencodeur PCA · GNN · LSTM
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-3">
        <div className="min-h-0">
          <OrbitalView phases={phases} overallProgress={overallProgress} mousePos={mousePos} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 content-start">
          {phases.filter(p => p.number !== 4).map((phase, i) => (
            <PhaseCard
              key={phase.id}
              phase={phase}
              index={i}
              expanded={expandedIndex === i}
              onToggle={() => onToggle(i)}
              mousePos={mousePos}
            />
          ))}
        </div>
      </div>

      {/* Quick stats */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-2"
      >
        {[
          { icon: <Brain className="w-3 h-3" />, label: 'Modèles ML', value: '7', color: '#818cf8', sub: 'En production' },
          { icon: <Server className="w-3 h-3" />, label: 'Appareils', value: '412', color: '#00F5FF', sub: 'Surveillés' },
          { icon: <BarChart3 className="w-3 h-3" />, label: 'F1 Moyen', value: '94.7%', color: '#22C55E', sub: 'Précision' },
          { icon: <AlertTriangle className="w-3 h-3" />, label: 'CVE', value: '142', color: '#F97316', sub: 'Traitées' },
        ].map((s, i) => (
          <motion.div
            key={i}
            whileHover={{ scale: 1.02, y: -1 }}
            className="flex items-center gap-2.5 p-2.5 rounded-xl cursor-default"
            style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${s.color}12`, color: s.color }}>
              {s.icon}
            </div>
            <div>
              <div className="font-display font-bold text-xs" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[7px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>{s.label} · {s.sub}</div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

/* ───────────────────────────────────────────────
   MAIN EXPORT (empty — content moved to Phase2Page)
   ─────────────────────────────────────────────── */
export default function PhaseRoadmap() {
  return null;
}
