import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye, EyeOff, ArrowRight, Shield, AlertCircle,
  User, KeyRound, Mail, UserPlus, CheckCircle, Users,
} from 'lucide-react';
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
          {Array.from({ length: 20 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}
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

const ROLE_OPTIONS = [
  { value: 'operator', label: 'Opérateur', desc: 'Simulation, IA, rapports, tout' },
];

const ROLE_COLORS: Record<string, string> = {
  operator: '#3b82f6',
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const { nextTheme, theme } = useTheme();
  const [form, setForm] = useState({ email: '', username: '', password: '', full_name: '', role: 'operator' });
  const [showPwd, setShowPwd] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  const [createdUsername, setCreatedUsername] = useState('');

  const THEME_ICONS: Record<string, string> = { dark: '🌙', cyberpunk: '⚡', matrix: '💚', light: '☀️' };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const r = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data.detail || 'Erreur lors de la création');
        return;
      }
      setCreatedUsername(form.username);
      setCreated(true);
    } catch {
      setError('Erreur de connexion au serveur');
    } finally {
      setCreating(false);
    }
  };

  const inputStyle = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  };

  const focusHandlers = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'var(--accent-primary)';
    e.target.style.boxShadow = '0 0 20px color-mix(in srgb, var(--accent-primary) 15%, transparent)';
  };
  const blurHandlers = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'var(--border)';
    e.target.style.boxShadow = 'none';
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
        <Link to="/login" className="text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:scale-105" style={{
          color: 'var(--text-secondary)', border: '1px solid var(--border)',
        }}>
          Connexion
        </Link>
      </div>

      <div className="relative z-10 flex w-full">
        {/* Left panel */}
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
              <Users className="w-10 h-10 text-white" />
            </motion.div>
            <motion.h1
              className="text-4xl font-display font-bold mb-4"
              style={{ color: 'var(--text-primary)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            >
              VigiloChain
            </motion.h1>
            <motion.p
              className="text-lg mb-6"
              style={{ color: 'var(--text-secondary)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
            >
              Créer votre compte
            </motion.p>
            <motion.div
              className="space-y-3 text-left"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
            >
              {[
                'Choisissez votre rôle selon vos besoins',
                'Accédez au tableau de bord en temps réel',
                'Collaborez avec votre équipe SOC',
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

        {/* Right panel */}
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
                <Users className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>Créer un compte</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Rejoignez la plateforme VigiloChain</p>
            </div>
            <div className="hidden lg:block mb-10">
              <h2 className="text-3xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>Créer un compte</h2>
              <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>Rejoignez la plateforme VigiloChain Security</p>
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

            <AnimatePresence>
              {created && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="mb-6 p-6 rounded-xl text-center"
                  style={{
                    background: 'color-mix(in srgb, var(--accent-success) 8%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent-success) 25%, transparent)',
                  }}
                >
                  <motion.div
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, delay: 0.1 }}
                  >
                    <CheckCircle className="w-14 h-14 mx-auto mb-3" style={{ color: '#22c55e' }} />
                  </motion.div>
                  <div className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Compte créé !</div>
                  <div className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                    Bienvenue <strong style={{ color: 'var(--accent-primary)' }}>{createdUsername}</strong>
                  </div>
                  <button onClick={() => navigate('/login')}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all hover:scale-105"
                    style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))', color: '#fff' }}>
                    Se connecter
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {!created && (
              <form onSubmit={handleCreate} className="space-y-5">
                <div>
                  <label className="block text-xs font-mono mb-2 tracking-wider" style={{ color: 'var(--text-secondary)' }}>IDENTIFIANT *</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <input
                      type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                      placeholder="jean.dupont" required
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl text-sm outline-none transition-all duration-300"
                      style={inputStyle} onFocus={focusHandlers} onBlur={blurHandlers}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-mono mb-2 tracking-wider" style={{ color: 'var(--text-secondary)' }}>EMAIL *</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <input
                      type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="jean@vigilochain.fr" required
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl text-sm outline-none transition-all duration-300"
                      style={inputStyle} onFocus={focusHandlers} onBlur={blurHandlers}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-mono mb-2 tracking-wider" style={{ color: 'var(--text-secondary)' }}>NOM COMPLET</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <input
                      type="text" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                      placeholder="Jean Dupont"
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl text-sm outline-none transition-all duration-300"
                      style={inputStyle} onFocus={focusHandlers} onBlur={blurHandlers}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-mono mb-2 tracking-wider" style={{ color: 'var(--text-secondary)' }}>MOT DE PASSE * (6+ caractères)</label>
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <input
                      type={showPwd ? 'text' : 'password'} value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="••••••••••" required minLength={6}
                      className="w-full pl-11 pr-11 py-3.5 rounded-xl text-sm outline-none transition-all duration-300"
                      style={inputStyle} onFocus={focusHandlers} onBlur={blurHandlers}
                    />
                    <button type="button" onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer transition-colors"
                      style={{ color: 'var(--text-secondary)' }}>
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-mono mb-2 tracking-wider" style={{ color: 'var(--text-secondary)' }}>VOTRE RÔLE *</label>
                  <div className="grid grid-cols-2 gap-2">
                    {ROLE_OPTIONS.map(r => (
                      <button key={r.value} type="button"
                        onClick={() => setForm(f => ({ ...f, role: r.value }))}
                        className="p-3 rounded-xl text-left transition-all duration-200"
                        style={{
                          background: form.role === r.value
                            ? `color-mix(in srgb, ${ROLE_COLORS[r.value]} 10%, transparent)`
                            : 'var(--bg-card)',
                          border: `1px solid ${form.role === r.value ? ROLE_COLORS[r.value] : 'var(--border)'}`,
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <Shield className="w-3 h-3" style={{ color: ROLE_COLORS[r.value] }} />
                          <span className="text-xs font-bold" style={{ color: ROLE_COLORS[r.value] }}>{r.label}</span>
                        </div>
                        <div className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>{r.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <motion.button type="submit" disabled={creating}
                  className="relative w-full py-3.5 rounded-xl text-sm font-semibold cursor-pointer overflow-hidden transition-all duration-300 disabled:opacity-60"
                  style={{
                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
                    color: '#fff', boxShadow: '0 0 30px color-mix(in srgb, var(--accent-primary) 25%, transparent)',
                  }}
                  whileHover={{ scale: 1.02, boxShadow: '0 0 50px color-mix(in srgb, var(--accent-primary) 45%, transparent)' }}
                  whileTap={{ scale: 0.98 }}
                >
                  {creating ? (
                    <span className="flex items-center justify-center gap-2">
                      <motion.span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block"
                        animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
                      Création...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <UserPlus className="w-4 h-4" />
                      Créer mon compte
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  )}
                </motion.button>
              </form>
            )}

            <div className="mt-8 pt-6 text-center" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Déjà un compte ?{' '}
                <Link to="/login" className="hover:underline font-medium" style={{ color: 'var(--accent-primary)' }}>
                  Se connecter
                </Link>
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
