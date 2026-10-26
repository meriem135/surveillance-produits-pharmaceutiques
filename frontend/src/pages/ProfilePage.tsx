import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Shield, KeyRound, Save, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { authHeaders } from '../lib/auth';

const ROLE_COLORS: Record<string, string> = { admin: '#ef4444', operator: '#3b82f6' };
const ROLE_LABELS: Record<string, string> = { admin: 'Administrateur', operator: 'Opérateur' };

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const flash = (m: string) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 3000); };

  const handleProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const r = await fetch('/api/v1/auth/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ full_name: fullName, email }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.detail || 'Erreur'); return; }
      const data = await r.json();
      updateUser({ full_name: data.full_name, email: data.email });
      flash('Profil mis à jour');
    } catch { setErr('Erreur réseau'); }
    finally { setSaving(false); }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const r = await fetch('/api/v1/auth/me/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.detail || 'Erreur'); return; }
      setCurrentPwd(''); setNewPwd(''); flash('Mot de passe changé');
    } catch { setErr('Erreur réseau'); }
    finally { setSaving(false); }
  };

  const inputStyle = {
    background: 'var(--color-bg-base)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)',
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)' }}>
          <User className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>Mon profil</h1>
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Gérez vos informations personnelles</p>
        </div>
      </div>

      {/* Role badge */}
      <div className="rounded-xl p-4" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5" style={{ color: ROLE_COLORS[user?.role || 'operator'] }} />
          <div>
            <div className="text-sm font-bold" style={{ color: ROLE_COLORS[user?.role || 'operator'] }}>
              {ROLE_LABELS[user?.role || 'operator']}
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
              @{user?.username} · Identifiant #{user?.id}
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
          style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>
          <CheckCircle className="w-4 h-4" /> {msg}
        </motion.div>
      )}
      {err && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}>
          <AlertCircle className="w-4 h-4" /> {err}
        </motion.div>
      )}

      {/* Edit profile */}
      <div className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
        <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Informations</h2>
        <form onSubmit={handleProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>NOM COMPLET</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
              <input value={fullName} onChange={e => setFullName(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>EMAIL</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
            </div>
          </div>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Enregistrer
          </button>
        </form>
      </div>

      {/* Change password */}
      <div className="rounded-xl p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
        <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>Changer le mot de passe</h2>
        <form onSubmit={handlePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>MOT DE PASSE ACTUEL</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
              <input type="password" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} required
                className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>NOUVEAU MOT DE PASSE (6+)</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} required minLength={6}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
            </div>
          </div>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Changer
          </button>
        </form>
      </div>
    </div>
  );
}
