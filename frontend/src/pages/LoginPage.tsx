import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Eye, EyeOff, ArrowRight, Shield, AlertCircle, User, KeyRound } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

function MatrixRain({ count = 30 }: { count?: number }) {
  const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789<>/{}[]|&^%$#@!';
  const falls = Array.from({ length: count }, (_, i) => ({
    left: `${(i / count) * 100}%`,
    delay: Math.random() * 4,
    duration: 2 + Math.random() * 4,
    opacity: 0.1 + Math.random() * 0.2,
  }));
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {falls.map((f, i) => (
        <motion.div
          key={i}
          className="absolute top-0 text-[10px] font-mono leading-none tracking-widest"
          style={{ left: f.left, opacity: f.opacity, color: 'var(--accent-primary)', writingMode: 'vertical-rl' }}
          animate={{ y: [0, 1200] }}
          transition={{ duration: f.duration, repeat: Infinity, delay: f.delay, ease: 'linear' }}
        >
          {Array.from({ length: 20 }, (_, _j) => chars[Math.floor(Math.random() * chars.length)]).join('')}
        </motion.div>
      ))}
    </div>
  );
}

function SecurityHexGrid() {
  return (
    <svg className="absolute inset-0 w-full h-full z-[1] opacity-[0.04]" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="hex" width="56" height="100" patternUnits="userSpaceOnUse" patternTransform="scale(1.2)">
          <path d="M28 0L56 16.67V50L28 66.67L0 50V16.67Z" fill="none" stroke="var(--accent-primary)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hex)" />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { theme, nextTheme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const THEME_ICONS: Record<string, string> = { dark: '🌙', cyberpunk: '⚡', matrix: '💚', light: '☀️' };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Veuillez remplir tous les champs');
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    setLoading(false);
    navigate('/dashboard');
  };

  return (
    <div className="relative min-h-screen flex overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <MatrixRain />
      <SecurityHexGrid />
      <div className="absolute inset-0 z-[2]" style={{
        background: 'radial-gradient(ellipse at 30% 50%, color-mix(in srgb, var(--accent-primary) 6%, transparent) 0%, transparent 60%), radial-gradient(ellipse at 70% 50%, color-mix(in srgb, var(--accent-purple) 6%, transparent) 0%, transparent 60%)',
      }} />
      <div className="absolute top-4 right-4 z-20 flex items-center gap-3">
        <button onClick={nextTheme} className="px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-all hover:scale-110" style={{ color: 'var(--text-secondary)' }}>
          {THEME_ICONS[theme]}
        </button>
        <Link to="/" className="text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:scale-105" style={{
          color: 'var(--text-secondary)', border: '1px solid var(--border)',
        }}>
          Accueil
        </Link>
      </div>
      <div className="relative z-10 flex w-full">
        <motion.div
          className="hidden lg:flex w-1/2 flex-col items-center justify-center p-12 relative"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }}
        >
          <motion.div
            className="absolute inset-0 overflow-hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 0.03 }}
            transition={{ duration: 2 }}
          >
            <div className="animate-scanline-fast absolute inset-0"
              style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, var(--accent-primary) 3px, var(--accent-primary) 4px)' }} />
          </motion.div>
          <div className="relative z-10 text-center max-w-md">
            <motion.div
              className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-8"
              style={{
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
                boxShadow: '0 0 60px color-mix(in srgb, var(--accent-primary) 30%, transparent)',
              }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Shield className="w-10 h-10 text-white" />
            </motion.div>
            <motion.h1
              className="text-4xl font-display font-bold mb-4"
              style={{ color: 'var(--text-primary)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            >
              PEAKSOFT
            </motion.h1>
            <motion.p
              className="text-lg mb-6"
              style={{ color: 'var(--text-secondary)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
            >
              Détection d'Intrusions IoT
            </motion.p>
            <motion.div
              className="space-y-3 text-left"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
            >
              {[
                'Phase 1 — Deep Packet Inspection MQTT',
                'Phase 2 — Détection anomalies par ML (F1 94.7%)',
                'Phase 3 — Analyse CVE & scoring risque prédictif',
              ].map((item, i) => (
                <motion.div
                  key={item}
                  className="flex items-center gap-3 text-sm"
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 + i * 0.1 }}
                >
                  <div className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse-glow" style={{ background: 'var(--accent-primary)' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>{item}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.div>

        <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
          <motion.div
            className="w-full max-w-md"
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <div className="mb-8 lg:hidden">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
              }}>
                <Shield className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>Connexion</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>PEAKSOFT — Détection IoT</p>
            </div>
            <div className="hidden lg:block mb-10">
              <h2 className="text-3xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>Connexion</h2>
              <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>Accédez à votre tableau de bord de sécurité</p>
            </div>
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6 flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: 'color-mix(in srgb, var(--accent-danger) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent-danger) 30%, transparent)',
                    color: 'var(--accent-danger)',
                  }}
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-mono mb-2 tracking-wider" style={{ color: 'var(--text-secondary)' }}>IDENTIFIANT</label>
                <div className="relative group">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }} />
                  <input
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@peaksoft.security"
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl text-sm outline-none transition-all duration-300"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                    onFocus={(e) => { e.target.style.borderColor = 'var(--accent-primary)'; e.target.style.boxShadow = '0 0 20px color-mix(in srgb, var(--accent-primary) 15%, transparent)'; }}
                    onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono mb-2 tracking-wider" style={{ color: 'var(--text-secondary)' }}>MOT DE PASSE</label>
                <div className="relative group">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }} />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••"
                    className="w-full pl-11 pr-11 py-3.5 rounded-xl text-sm outline-none transition-all duration-300"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                    onFocus={(e) => { e.target.style.borderColor = 'var(--accent-primary)'; e.target.style.boxShadow = '0 0 20px color-mix(in srgb, var(--accent-primary) 15%, transparent)'; }}
                    onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                  <input type="checkbox" className="rounded" style={{ accentColor: 'var(--accent-primary)' }} />
                  Se souvenir
                </label>
                <button type="button" className="hover:underline transition-all" style={{ color: 'var(--accent-primary)' }}>
                  Mot de passe oublié ?
                </button>
              </div>
              <motion.button
                type="submit"
                disabled={loading}
                className="relative w-full py-3.5 rounded-xl text-sm font-semibold cursor-pointer overflow-hidden transition-all duration-300 disabled:opacity-60"
                style={{
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
                  color: '#fff',
                  boxShadow: '0 0 30px color-mix(in srgb, var(--accent-primary) 25%, transparent)',
                }}
                whileHover={{ scale: 1.02, boxShadow: '0 0 50px color-mix(in srgb, var(--accent-primary) 45%, transparent)' }}
                whileTap={{ scale: 0.98 }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <motion.span
                      className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    />
                    Connexion...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Lock className="w-4 h-4" />
                    Se Connecter
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </motion.button>
            </form>
            <div className="mt-8 pt-6 text-center" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Plateforme sécurisée — Connexion réservée au personnel autorisé
              </p>
              <div className="flex items-center justify-center gap-1.5 mt-3">
                <Shield className="w-3 h-3" style={{ color: 'var(--accent-success)' }} />
                <span className="text-[10px] font-mono" style={{ color: 'var(--accent-success)' }}>CHIFFRÉ AES-256 · TLS 1.3</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
