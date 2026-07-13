import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import {
  Shield, Brain, Radio,
  ArrowRight, ChevronDown, ShieldCheck,
  Cpu, Lock, Zap, Network, Eye,
  Activity
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

// ─── Hook: prefers-reduced-motion ───────────────────────────────────────────

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// ─── Data ───────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: Radio, title: 'Phase 1 — DPI & MQTT', desc: 'Deep Packet Inspection sur flux MQTT. Analyse temps réel des protocoles industriels avec 6 règles DPI et inspection de 15K+ messages/s.', color: '#00F5FF', tag: 'Réseau' },
  { icon: Brain, title: 'Phase 2 — ML & Anomalies', desc: '7 modèles ML (Isolation Forest, Autoencodeur PCA, GNN, LSTM) pour la détection d\'anomalies comportementales avec un F1 moyen de 94.7%.', color: '#818cf8', tag: 'Machine Learning' },
  { icon: Shield, title: 'Phase 3 — CVE & Risques', desc: 'Analyse de vulnérabilités, score de risque prédictif, intégration CVE et simulation What-If pour 412 appareils surveillés.', color: '#F97316', tag: 'Sécurité' },
];

const STATS = [
  { value: 412, display: '412', label: 'Appareils', suffix: 'surveillés', icon: Cpu, color: '#00F5FF', format: (n: number) => `${Math.round(n)}` },
  { value: 7, display: '7', label: 'Modèles ML', suffix: 'déployés', icon: Brain, color: '#818cf8', format: (n: number) => `${Math.round(n)}` },
  { value: 94.7, display: '94.7%', label: 'F1 Score', suffix: 'détection anomalies', icon: Zap, color: '#22C55E', format: (n: number) => `${n.toFixed(1)}%` },
  { value: 15000, display: '15 000+', label: 'Messages/s', suffix: 'inspectés DPI', icon: Shield, color: '#F97316', format: (n: number) => `${n >= 1000 ? `${(n / 1000).toFixed(0)} 000+` : Math.round(n)}` },
];

const TECHNOLOGIES = [
  { name: 'React', cat: 'Frontend' },
  { name: 'TypeScript', cat: 'Frontend' },
  { name: 'TailwindCSS', cat: 'Frontend' },
  { name: 'FastAPI', cat: 'Backend' },
  { name: 'Python', cat: 'Backend' },
  { name: 'scikit-learn', cat: 'ML' },
  { name: 'SHAP', cat: 'ML' },
  { name: 'MQTT', cat: 'Protocol' },
  { name: 'Modbus', cat: 'Protocol' },
  { name: 'Wazuh', cat: 'SIEM' },
  { name: 'PostgreSQL', cat: 'Data' },
  { name: 'Docker', cat: 'DevOps' },
  { name: 'WebSocket', cat: 'RT' },
  { name: 'OpenSearch', cat: 'Search' },
];

const ARCH_STEPS = [
  { icon: Radio, title: 'Phase 1 — DPI', desc: 'Deep Packet Inspection sur MQTT, 6 règles, 15K+ msg/s', color: '#00F5FF', step: '1' },
  { icon: Brain, title: 'Phase 2 — ML', desc: '7 modèles, F1 94.7%, détection anomalies comportementales', color: '#818cf8', step: '2' },
  { icon: Shield, title: 'Phase 3 — CVE', desc: 'Score risque prédictif, intégration CVE, 412 appareils', color: '#F97316', step: '3' },
];

const THREAT_FEED = [
  { type: 'CRITIQUE', msg: 'Tentative d\'intrusion Modbus détectée — PLC-07', time: '00:03', color: '#EF4444' },
  { type: 'ALERTE', msg: 'Anomalie trafic MQTT — Broker central', time: '01:22', color: '#F97316' },
  { type: 'INFO', msg: 'Scan réseau automatisé bloqué — 192.168.1.44', time: '02:11', color: '#818cf8' },
  { type: 'OK', msg: 'Baseline ML mise à jour — 10 247 capteurs', time: '03:45', color: '#22C55E' },
  { type: 'ALERTE', msg: 'Pic d\'activité OPC-UA — Zone B3', time: '04:18', color: '#F97316' },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: 'easeOut' as const } },
};

// ─── Canvas Particle Network ────────────────────────────────────────────────

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();

    // Particules initialisées APRÈS le premier resize() pour éviter
    // que x/y soient calculés contre un canvas non dimensionné (0x0).
    const particles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number; hue: number }[] = [];
    for (let i = 0; i < 70; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        size: Math.random() * 1.8 + 0.4,
        alpha: Math.random() * 0.35 + 0.1,
        hue: Math.random() * 60 + 170,
      });
    }

    window.addEventListener('resize', resize);

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${p.alpha})`;
        ctx.fill();
      }
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `hsla(185, 100%, 65%, ${0.07 * (1 - dist / 130)})`;
            ctx.lineWidth = 0.4;
            ctx.stroke();
          }
        }
      }
      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, [reducedMotion]);

  if (reducedMotion) return null;

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0" aria-hidden="true" />;
}

// ─── Hexagonal Grid Background ──────────────────────────────────────────────

function HexGrid() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ opacity: 0.04 }} aria-hidden="true">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="hex" x="0" y="0" width="56" height="48" patternUnits="userSpaceOnUse">
            <polygon points="28,2 52,14 52,34 28,46 4,34 4,14" fill="none" stroke="var(--accent-primary)" strokeWidth="0.8" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hex)" />
      </svg>
    </div>
  );
}

// ─── Floating Orb ───────────────────────────────────────────────────────────

function FloatingOrb({ color, size, x, y, delay = 0 }: { color: string; size: number; x: string; y: string; delay?: number }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className="absolute rounded-full blur-[80px] pointer-events-none"
      style={{ width: size, height: size, left: x, top: y, background: color, opacity: 0.12 }}
      animate={reducedMotion ? {} : { x: [0, 25, -18, 0], y: [0, -35, 18, 0], scale: [1, 1.1, 0.95, 1] }}
      transition={reducedMotion ? { duration: 0 } : { duration: 14 + delay, repeat: Infinity, ease: 'easeInOut', delay }}
      aria-hidden="true"
    />
  );
}

// ─── Animated Counter ───────────────────────────────────────────────────────

function AnimatedCounter({ target, format }: { target: number; format?: (n: number) => string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (reducedMotion) { setCount(target); return; }
    let start = 0; const duration = 1800; const step = 16;
    const timer = setInterval(() => {
      start += step;
      const progress = Math.min(start / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(eased * target);
      if (progress >= 1) clearInterval(timer);
    }, step);
    return () => clearInterval(timer);
  }, [visible, target, reducedMotion]);

  const display = format ? format(count) : Math.floor(count).toString();
  return <span ref={ref}>{display}</span>;
}

// ─── Live Threat Ticker ──────────────────────────────────────────────────────

function ThreatTicker() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIndex(i => (i + 1) % THREAT_FEED.length), 3000);
    return () => clearInterval(t);
  }, []);
  const item = THREAT_FEED[index];
  return (
    <div className="flex items-center gap-3 overflow-hidden">
      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono shrink-0"
        style={{ background: `${item.color}20`, color: item.color, border: `1px solid ${item.color}40` }}>
        {item.type}
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          className="text-xs font-mono truncate"
          style={{ color: 'var(--text-secondary)' }}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3 }}
        >
          {item.msg}
        </motion.span>
      </AnimatePresence>
      <span className="text-[10px] font-mono shrink-0 opacity-40" style={{ color: 'var(--text-secondary)' }}>{item.time}s ago</span>
    </div>
  );
}

// ─── Navbar ──────────────────────────────────────────────────────────────────

function Navbar() {
  const navigate = useNavigate();
  const { theme, nextTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handler);
    return () => window.removeEventListener('scroll', handler);
  }, []);
  const THEME_ICONS: Record<string, string> = { dark: '🌙', cyberpunk: '⚡', matrix: '💚', light: '☀️' };
  const navLinks = [
    { label: 'Fonctionnalités', href: '#features' },
    { label: 'Architecture', href: '#architecture' },
    { label: 'Technologies', href: '#tech' },
  ];
  return (
    <motion.nav
      className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center justify-between px-6 lg:px-12 transition-all duration-500"
      style={{
        background: scrolled ? 'color-mix(in srgb, var(--bg-base) 90%, transparent)' : 'transparent',
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
        backdropFilter: scrolled ? 'blur(24px)' : 'none',
      }}
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.1 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="relative w-9 h-9">
          <div className="absolute inset-0 rounded-lg animate-pulse-glow" style={{ background: 'var(--accent-primary)', opacity: 0.2, filter: 'blur(6px)' }} aria-hidden="true" />
          <div className="relative w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-bold font-mono"
            style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))', color: '#000', boxShadow: '0 0 18px color-mix(in srgb, var(--accent-primary) 40%, transparent)' }}>
            PS
          </div>
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-display font-bold text-sm tracking-wider" style={{ color: 'var(--text-primary)' }}>PEAKSOFT</span>
          <span className="text-[9px] font-mono tracking-[0.15em] opacity-50" style={{ color: 'var(--accent-primary)' }}>CYBER-GUARDIAN v2</span>
        </div>
      </div>

      {/* Desktop Links */}
      <div className="hidden md:flex items-center gap-6">
        {navLinks.map(link => (
          <a key={link.label} href={link.href}
            className="text-sm font-medium transition-all duration-200 hover:opacity-100 opacity-60"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
            onClick={e => { e.preventDefault(); document.querySelector(link.href)?.scrollIntoView({ behavior: 'smooth' }); }}>
            {link.label}
          </a>
        ))}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3">
        <button onClick={nextTheme} aria-label={`Changer de thème (actuel : ${theme})`}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm cursor-pointer transition-all hover:scale-110"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <span aria-hidden="true">{THEME_ICONS[theme]}</span>
        </button>
        <motion.button
          onClick={() => navigate('/login')}
          aria-label="Accéder à la page de connexion"
          className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold font-mono tracking-wide cursor-pointer transition-all duration-300"
          style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))', color: '#000', boxShadow: '0 0 20px color-mix(in srgb, var(--accent-primary) 25%, transparent)' }}
          whileHover={{ scale: 1.05, boxShadow: '0 0 32px color-mix(in srgb, var(--accent-primary) 40%, transparent)' }}
          whileTap={{ scale: 0.97 }}
        >
          <Lock className="w-3 h-3" aria-hidden="true" />
          CONNEXION
        </motion.button>
        <button
          className="md:hidden p-2 rounded-lg"
          style={{ color: 'var(--text-primary)' }}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={menuOpen}
        >
          <div className="w-4 h-0.5 mb-1 transition-all" style={{ background: 'currentColor' }} />
          <div className="w-4 h-0.5 mb-1 transition-all" style={{ background: 'currentColor' }} />
          <div className="w-4 h-0.5 transition-all" style={{ background: 'currentColor' }} />
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="absolute top-16 left-0 right-0 p-4 flex flex-col gap-3"
            style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
          >
            {navLinks.map(link => (
              <a key={link.label} href={link.href}
                className="text-sm py-2 px-3 rounded-lg" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)' }}
                onClick={e => { e.preventDefault(); setMenuOpen(false); document.querySelector(link.href)?.scrollIntoView({ behavior: 'smooth' }); }}>
                {link.label}
              </a>
            ))}
            <button onClick={() => navigate('/login')}
              className="py-2 px-3 rounded-lg text-sm font-semibold"
              style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))', color: '#000' }}>
              Connexion
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

// ─── Hero Section ────────────────────────────────────────────────────────────

function HeroSection() {
  const navigate = useNavigate();
  const [glitch, setGlitch] = useState(false);
  const [typedText, setTypedText] = useState('');
  const fullText = 'Sécurisez votre infrastructure IoT industrielle.';
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);
  const heroY = useTransform(scrollY, [0, 400], [0, 80]);
  const reducedMotion = useReducedMotion();

  // Glitch interval — cleanup correct du setTimeout interne pour éviter
  // un setState sur composant démonté.
  useEffect(() => {
    if (reducedMotion) return;
    let glitchTimeout: ReturnType<typeof setTimeout>;
    const glitchInterval = setInterval(() => {
      setGlitch(true);
      glitchTimeout = setTimeout(() => setGlitch(false), 250);
    }, 5000);
    return () => {
      clearInterval(glitchInterval);
      clearTimeout(glitchTimeout);
    };
  }, [reducedMotion]);

  useEffect(() => {
    let i = 0;
    let typeInterval: ReturnType<typeof setInterval>;
    const delay = setTimeout(() => {
      typeInterval = setInterval(() => {
        i++;
        setTypedText(fullText.slice(0, i));
        if (i >= fullText.length) clearInterval(typeInterval);
      }, 40);
    }, 1200);
    return () => { clearTimeout(delay); clearInterval(typeInterval); };
  }, []);

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <ParticleField />
      <HexGrid />

      {/* Background orbs */}
      <FloatingOrb color="var(--accent-primary)" size={700} x="-15%" y="-25%" delay={0} />
      <FloatingOrb color="var(--accent-purple)" size={550} x="65%" y="20%" delay={4} />
      <FloatingOrb color="var(--accent-success)" size={400} x="35%" y="65%" delay={8} />
      <FloatingOrb color="#EF4444" size={300} x="80%" y="70%" delay={2} />

      {/* Radial vignette */}
      <div className="absolute inset-0 z-[1]" style={{ background: 'radial-gradient(ellipse at 50% 40%, transparent 0%, var(--bg-base) 75%)' }} aria-hidden="true" />

      {/* Scan lines */}
      <div className="absolute inset-0 z-[1] overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="animate-scanline-fast absolute inset-0 opacity-[0.03]"
          style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, var(--accent-primary) 2px, var(--accent-primary) 3px)' }} />
      </div>

      {/* Main content */}
      <motion.div className="relative z-10 text-center px-6 max-w-5xl mx-auto" style={{ opacity: heroOpacity, y: heroY }}>

        {/* Status badge */}
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-[11px] font-mono tracking-[0.15em] mb-10"
          style={{ border: '1px solid color-mix(in srgb, var(--accent-primary) 35%, transparent)', color: 'var(--accent-primary)', background: 'color-mix(in srgb, var(--accent-primary) 7%, transparent)' }}
        >
          <span className="relative flex w-2 h-2" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: 'var(--accent-primary)' }} />
            <span className="relative inline-flex rounded-full w-2 h-2" style={{ background: 'var(--accent-primary)' }} />
          </span>
          PEAKSOFT Cyber-Guardian
          <Activity className="w-3 h-3" aria-hidden="true" />
        </motion.div>

        {/* Main title */}
        <motion.div
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35 }}
        >
          <h1 className={`text-[clamp(3rem,10vw,6.5rem)] font-display font-black leading-[0.95] mb-4 ${glitch ? 'animate-glitch' : ''}`}>
            <span className="block bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-purple)] to-[var(--accent-success)] bg-clip-text text-transparent animate-gradient">
              PEAKSOFT
            </span>
            <span className="block" style={{ color: 'var(--text-primary)' }}>
              Cyber<span className="text-transparent" style={{ WebkitTextStroke: '1px var(--accent-primary)' }}>-Guardian</span>
            </span>
          </h1>
        </motion.div>

        {/* Typewriter subtitle */}
        <motion.div
          className="h-8 mb-6 flex items-center justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.6 }}
        >
          <span className="text-lg md:text-xl font-mono" style={{ color: 'var(--accent-primary)' }}>
            {typedText}
            <span className="inline-block w-0.5 h-5 ml-0.5 animate-pulse" style={{ background: 'var(--accent-primary)', verticalAlign: 'middle' }} aria-hidden="true" />
          </span>
        </motion.div>

        {/* Subtext */}
        <motion.p
          className="text-base md:text-lg max-w-2xl mx-auto mb-10 leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.75 }}
        >
          Plateforme de détection d'intrusions IoT industrielle.
          3 phases : <strong style={{ color: 'var(--accent-primary)' }}>DPI MQTT</strong>,
          <strong style={{ color: 'var(--accent-primary)' }}>ML & Anomalies</strong>,
          <strong style={{ color: 'var(--accent-primary)' }}>CVE & Risques</strong>.
        </motion.p>

        {/* CTA buttons */}
        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.9 }}
        >
          <motion.button
            onClick={() => navigate('/login')}
            aria-label="Accéder au tableau de bord"
            className="group relative flex items-center gap-3 px-8 py-3.5 rounded-xl text-sm font-semibold font-mono cursor-pointer overflow-hidden"
            style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))', color: '#000' }}
            whileHover={{ scale: 1.05, boxShadow: '0 0 48px color-mix(in srgb, var(--accent-primary) 50%, transparent)' }}
            whileTap={{ scale: 0.97 }}
          >
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-primary))' }} aria-hidden="true" />
            <span className="relative z-10 flex items-center gap-2">
              <Lock className="w-4 h-4" aria-hidden="true" />
              ACCÉDER AU DASHBOARD
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
            </span>
          </motion.button>

          <motion.button
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="Découvrir les fonctionnalités"
            className="flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-300"
            style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'color-mix(in srgb, var(--bg-card) 80%, transparent)', backdropFilter: 'blur(8px)' }}
            whileHover={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)', scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            <Eye className="w-4 h-4" aria-hidden="true" />
            Découvrir
          </motion.button>
        </motion.div>

        {/* Live threat ticker */}
        <motion.div
          className="inline-flex items-center gap-3 px-5 py-3 rounded-xl max-w-lg w-full"
          style={{ background: 'color-mix(in srgb, var(--bg-card) 60%, transparent)', border: '1px solid var(--border)', backdropFilter: 'blur(12px)' }}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 1.1 }}
        >
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#EF4444' }} aria-hidden="true" />
            <span className="text-[10px] font-mono font-bold tracking-wider" style={{ color: '#EF4444' }}>LIVE</span>
          </div>
          <div className="w-px h-4 opacity-30" style={{ background: 'var(--border)' }} />
          <ThreatTicker />
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2"
        animate={reducedMotion ? {} : { y: [0, 8, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
      >
        <span className="text-[10px] font-mono tracking-widest opacity-40" style={{ color: 'var(--text-secondary)' }}>SCROLL</span>
        <ChevronDown className="w-5 h-5 opacity-40" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
      </motion.div>
    </section>
  );
}

// ─── Stats Section ───────────────────────────────────────────────────────────

function StatsSection() {
  return (
    <section className="relative py-20 px-6 overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(var(--text-primary) 0.5px, transparent 0.5px)', backgroundSize: '28px 28px' }} aria-hidden="true" />

      <div className="max-w-6xl mx-auto relative">
        {/* Section header */}
        <motion.div className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <span className="text-[10px] font-mono tracking-[0.25em] uppercase" style={{ color: 'var(--accent-primary)' }}>Métriques en Temps Réel</span>
        </motion.div>

        <motion.div
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          variants={containerVariants} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-80px' }}
        >
          {STATS.map((stat) => {
            const Icon = stat.icon;
            return (
              <motion.div
                key={stat.label}
                variants={itemVariants}
                whileHover={{ y: -4, scale: 1.02 }}
                className="group relative p-6 rounded-2xl text-center overflow-hidden cursor-default"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
              >
                {/* Hover glow */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl"
                  style={{ background: `radial-gradient(ellipse at center, color-mix(in srgb, ${stat.color} 10%, transparent) 0%, transparent 70%)` }} aria-hidden="true" />

                {/* Corner accent */}
                <div className="absolute top-0 left-0 w-16 h-16 rounded-br-full opacity-[0.07]"
                  style={{ background: stat.color }} aria-hidden="true" />

                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
                    style={{ background: `color-mix(in srgb, ${stat.color} 12%, transparent)`, color: stat.color }}>
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="text-3xl md:text-4xl font-display font-black mb-1" style={{ color: stat.color }}>
                    <AnimatedCounter target={stat.value} format={stat.format} />
                  </div>
                  <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>{stat.label}</div>
                  <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>{stat.suffix}</div>
                </div>

                {/* Bottom glow line */}
                <div className="absolute bottom-0 left-4 right-4 h-0.5 opacity-0 group-hover:opacity-60 transition-opacity duration-500"
                  style={{ background: `linear-gradient(90deg, transparent, ${stat.color}, transparent)` }} aria-hidden="true" />
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Features Section ────────────────────────────────────────────────────────

function FeaturesSection() {
  const [activeFeature, setActiveFeature] = useState<string | null>(null);

  return (
    <section id="features" className="relative py-28 px-6" style={{ background: 'var(--bg-panel)' }}>
      <HexGrid />

      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, color-mix(in srgb, var(--accent-primary) 4%, transparent) 0%, transparent 70%)' }} aria-hidden="true" />

      <div className="max-w-6xl mx-auto relative">
        <motion.div className="text-center mb-16"
          initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4"
            style={{ background: 'color-mix(in srgb, var(--accent-primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)' }}>
            <Zap className="w-3 h-3" style={{ color: 'var(--accent-primary)' }} aria-hidden="true" />
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase" style={{ color: 'var(--accent-primary)' }}>3 Phases</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-display font-black mb-4" style={{ color: 'var(--text-primary)' }}>
            Détection d'Intrusions
            <br />
            <span className="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-purple)] bg-clip-text text-transparent">
              IoT Industrielle
            </span>
          </h2>
          <p className="max-w-xl mx-auto text-base" style={{ color: 'var(--text-secondary)' }}>
            DPI → ML → CVE : pipeline complet de cybersécurité IoT temps réel.
          </p>
        </motion.div>

        <motion.div
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-5"
          variants={containerVariants} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }}
        >
          {FEATURES.map((f) => {
            const Icon = f.icon;
            const isActive = activeFeature === f.title;
            return (
              <motion.div
                key={f.title}
                variants={itemVariants}
                whileHover={{ y: -6 }}
                onHoverStart={() => setActiveFeature(f.title)}
                onHoverEnd={() => setActiveFeature(null)}
                className="group relative p-6 rounded-2xl cursor-default overflow-hidden transition-all duration-300"
                style={{
                  background: isActive
                    ? `color-mix(in srgb, ${f.color} 6%, var(--bg-card))`
                    : 'var(--bg-card)',
                  border: `1px solid ${isActive ? `color-mix(in srgb, ${f.color} 35%, transparent)` : 'var(--border)'}`,
                  boxShadow: isActive ? `0 20px 60px color-mix(in srgb, ${f.color} 12%, transparent)` : 'none',
                  transition: 'all 0.3s ease',
                }}
              >
                {/* Top accent bar */}
                <div className="absolute top-0 left-0 right-0 h-px transition-opacity duration-300"
                  style={{ background: `linear-gradient(90deg, transparent, ${f.color}, transparent)`, opacity: isActive ? 1 : 0 }} aria-hidden="true" />

                {/* Tag */}
                <div className="absolute top-4 right-4">
                  <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full"
                    style={{ background: `color-mix(in srgb, ${f.color} 12%, transparent)`, color: f.color, border: `1px solid color-mix(in srgb, ${f.color} 30%, transparent)` }}>
                    {f.tag}
                  </span>
                </div>

                <div className="relative z-10 pr-12">
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5 transition-all duration-300"
                    style={{
                      background: `color-mix(in srgb, ${f.color} ${isActive ? 20 : 12}%, transparent)`,
                      color: f.color,
                      boxShadow: isActive ? `0 0 20px color-mix(in srgb, ${f.color} 25%, transparent)` : 'none',
                      transform: isActive ? 'scale(1.1) rotate(3deg)' : 'scale(1)',
                    }}>
                    <Icon className="w-6 h-6" aria-hidden="true" />
                  </div>

                  <h3 className="font-display font-bold text-base mb-2 transition-colors duration-300"
                    style={{ color: isActive ? f.color : 'var(--text-primary)' }}>
                    {f.title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{f.desc}</p>
                </div>

                {/* Arrow indicator */}
                <div className="absolute bottom-4 right-4 transition-all duration-300"
                  style={{ opacity: isActive ? 1 : 0, transform: isActive ? 'translate(0,0)' : 'translate(4px, 4px)', color: f.color }} aria-hidden="true">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Architecture Section ────────────────────────────────────────────────────

function ArchitectureSection() {
  return (
    <section id="architecture" className="relative py-28 px-6 overflow-hidden">
      <div className="absolute inset-0 opacity-[0.025]"
        style={{ backgroundImage: 'radial-gradient(var(--text-primary) 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }} aria-hidden="true" />

      {/* Vertical accent line */}
      <div className="absolute left-1/2 top-40 bottom-40 w-px opacity-10 hidden md:block"
        style={{ background: 'linear-gradient(to bottom, transparent, var(--accent-primary), transparent)' }} aria-hidden="true" />

      <div className="max-w-5xl mx-auto relative">
        <motion.div className="text-center mb-20"
          initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4"
            style={{ background: 'color-mix(in srgb, var(--accent-purple) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 25%, transparent)' }}>
            <Network className="w-3 h-3" style={{ color: 'var(--accent-purple)' }} aria-hidden="true" />
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase" style={{ color: 'var(--accent-purple)' }}>Pipeline</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-display font-black mb-4" style={{ color: 'var(--text-primary)' }}>
            Les{' '}
            <span className="bg-gradient-to-r from-[var(--accent-purple)] to-[var(--accent-primary)] bg-clip-text text-transparent">
              3 Phases
            </span>
          </h2>
          <p className="max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            DPI → Détection ML → Scoring CVE
          </p>
        </motion.div>

        {/* Steps */}
          <div className="grid md:grid-cols-3 gap-6 relative">
            {/* Connecting line */}
            <div className="absolute top-[52px] left-[12%] right-[12%] h-px hidden md:block"
              style={{ background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-purple), #F97316)', opacity: 0.25 }} aria-hidden="true" />

          {ARCH_STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.title}
                className="flex flex-col items-center text-center relative group"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.12 }}
                whileHover={{ y: -4 }}
              >
                {/* Step number badge */}
                <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono font-bold z-20"
                  style={{ background: step.color, color: '#000' }} aria-hidden="true">
                  {step.step}
                </div>

                {/* Icon container */}
                <div className="relative mb-5">
                  <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-lg"
                    style={{ background: step.color }} aria-hidden="true" />
                  <div className="relative w-[100px] h-[100px] rounded-2xl flex items-center justify-center border transition-all duration-300 group-hover:border-opacity-60"
                    style={{
                      background: `color-mix(in srgb, ${step.color} 8%, var(--bg-card))`,
                      border: `1px solid color-mix(in srgb, ${step.color} 25%, transparent)`,
                      boxShadow: `0 0 0 0 color-mix(in srgb, ${step.color} 20%, transparent)`,
                    }}>
                    <Icon className="w-10 h-10 transition-transform duration-300 group-hover:scale-110" style={{ color: step.color }} aria-hidden="true" />
                  </div>
                </div>

                <h4 className="font-display font-bold text-base mb-2 transition-colors duration-200 group-hover:opacity-100"
                  style={{ color: 'var(--text-primary)' }}>
                  {step.title}
                </h4>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{step.desc}</p>

                {/* Arrow (not on last) */}
                {i < ARCH_STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-[52px] -right-3 z-10" aria-hidden="true">
                    <ArrowRight className="w-4 h-4 opacity-30" style={{ color: 'var(--text-secondary)' }} />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Tech Stack Section ──────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  Frontend: '#00F5FF', Backend: '#818cf8', ML: '#22C55E',
  Protocol: '#F97316', SIEM: '#EF4444', Data: '#a855f7',
  DevOps: '#F97316', RT: '#22C55E', Search: '#818cf8',
};

function TechSection() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const categories = [...new Set(TECHNOLOGIES.map(t => t.cat))];

  return (
    <section id="tech" className="relative py-28 px-6">
      <div className="max-w-4xl mx-auto">
        <motion.div className="text-center mb-12"
          initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4"
            style={{ background: 'color-mix(in srgb, var(--accent-success) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-success) 25%, transparent)' }}>
            <Cpu className="w-3 h-3" style={{ color: 'var(--accent-success)' }} aria-hidden="true" />
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase" style={{ color: 'var(--accent-success)' }}>Stack Technique</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-display font-black mb-4" style={{ color: 'var(--text-primary)' }}>
            Technologies
          </h2>
          {/* Category filters */}
          <div className="flex flex-wrap justify-center gap-2 mt-6" role="group" aria-label="Filtrer par catégorie">
            <button
              className="px-3 py-1 rounded-full text-xs font-mono transition-all"
              style={{
                background: activeCategory === null ? 'var(--accent-primary)' : 'var(--bg-card)',
                color: activeCategory === null ? '#000' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
              onClick={() => setActiveCategory(null)}
              aria-pressed={activeCategory === null}
            >
              Tout
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                className="px-3 py-1 rounded-full text-xs font-mono transition-all"
                style={{
                  background: activeCategory === cat ? CAT_COLORS[cat] : 'var(--bg-card)',
                  color: activeCategory === cat ? '#000' : 'var(--text-secondary)',
                  border: `1px solid ${activeCategory === cat ? CAT_COLORS[cat] : 'var(--border)'}`,
                }}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                aria-pressed={activeCategory === cat}
              >
                {cat}
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div
          className="flex flex-wrap justify-center gap-3"
          variants={containerVariants} initial="hidden" whileInView="visible" viewport={{ once: true }}
        >
          {TECHNOLOGIES.filter(t => !activeCategory || t.cat === activeCategory).map((tech) => {
            const color = CAT_COLORS[tech.cat];
            return (
              <motion.div
                key={tech.name}
                variants={itemVariants}
                className="group flex items-center gap-2 px-4 py-2.5 rounded-xl cursor-default transition-all duration-300"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                whileHover={{
                  scale: 1.08,
                  borderColor: `color-mix(in srgb, ${color} 50%, transparent)`,
                  background: `color-mix(in srgb, ${color} 8%, var(--bg-card))`,
                }}
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
                <span className="text-xs font-mono font-medium" style={{ color: 'var(--text-secondary)' }}>{tech.name}</span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

// ─── CTA Section ─────────────────────────────────────────────────────────────

function CtaSection() {
  const navigate = useNavigate();
  return (
    <section className="relative py-32 px-6 overflow-hidden" style={{ background: 'var(--bg-panel)' }}>
      <HexGrid />
      <FloatingOrb color="var(--accent-primary)" size={500} x="10%" y="-30%" delay={0} />
      <FloatingOrb color="var(--accent-purple)" size={400} x="70%" y="40%" delay={5} />

      <div className="max-w-3xl mx-auto text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }} whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }} transition={{ duration: 0.7 }}
        >
          {/* Glowing shield icon */}
          <div className="relative w-20 h-20 mx-auto mb-8">
            <div className="absolute inset-0 rounded-2xl blur-xl opacity-40" style={{ background: 'var(--accent-primary)' }} aria-hidden="true" />
            <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)' }}>
              <ShieldCheck className="w-10 h-10" style={{ color: 'var(--accent-primary)' }} aria-hidden="true" />
            </div>
          </div>

          <h2 className="text-3xl md:text-5xl font-display font-black mb-5" style={{ color: 'var(--text-primary)' }}>
            Prêt à{' '}
            <span className="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-purple)] bg-clip-text text-transparent">
              Sécuriser
            </span>
            <br />
            votre Infrastructure ?
          </h2>
          <p className="text-base mb-10 max-w-lg mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Accédez au tableau de bord temps réel, explorez les capacités ML et prenez le contrôle
            de votre cybersécurité industrielle.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <motion.button
              onClick={() => navigate('/login')}
              aria-label="Accéder au tableau de bord"
              className="group relative flex items-center gap-3 px-10 py-4 rounded-xl text-sm font-semibold font-mono tracking-wide cursor-pointer overflow-hidden"
              style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))', color: '#000' }}
              whileHover={{ scale: 1.05, boxShadow: '0 0 60px color-mix(in srgb, var(--accent-primary) 50%, transparent)' }}
              whileTap={{ scale: 0.97 }}
            >
              <Lock className="w-4 h-4" aria-hidden="true" />
              ACCÉDER AU DASHBOARD
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
            </motion.button>
          </div>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-6 mt-10 flex-wrap">
            {[
              { icon: Shield, text: 'Sécurité by Design' },
              { icon: Zap, text: 'Temps Réel' },
              { icon: Brain, text: 'IA Embarquée' },
            ].map(item => {
              const Icon = item.icon;
              return (
                <div key={item.text} className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} aria-hidden="true" />
                  <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{item.text}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="py-10 px-6" style={{ background: 'var(--bg-base)', borderTop: '1px solid var(--border)' }}>
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative w-7 h-7">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono"
              style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))', color: '#000' }}>
              PS
            </div>
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display font-bold text-xs" style={{ color: 'var(--text-primary)' }}>PEAKSOFT Cyber-Guardian</span>
            <span className="text-[9px] font-mono opacity-40" style={{ color: 'var(--text-secondary)' }}>Industrie 4.0 Security Platform</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono flex-wrap justify-center" style={{ color: 'var(--text-secondary)' }}>
          <span className="opacity-40">© {new Date().getFullYear()} PeakSoft</span>
          <span className="opacity-20" aria-hidden="true">|</span>
          <span className="opacity-40">Protection IA Industrielle</span>
          <span className="opacity-20" aria-hidden="true">|</span>
          <span className="px-2 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: 'var(--accent-primary)', border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)' }}>
            v2.0.0
          </span>
        </div>
      </div>
    </footer>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div style={{ background: 'var(--bg-base)' }}>
      <Navbar />
      <HeroSection />
      <StatsSection />
      <FeaturesSection />
      <ArchitectureSection />
      <TechSection />
      <CtaSection />
      <Footer />
    </div>
  );
}