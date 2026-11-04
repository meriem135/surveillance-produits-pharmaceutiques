import { PageHeader } from '../components/etude/kit';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Shield, UserCheck, Loader2, X,
  Pencil, Power, KeyRound, AlertCircle, CheckCircle,
} from 'lucide-react';
import { authHeaders } from '../lib/auth';

interface UserRow {
  id: number;
  email: string;
  username: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--accent-danger)',
  operator: 'var(--text-secondary)',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  operator: 'Opérateur',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [form, setForm] = useState({ email: '', username: '', password: '', full_name: '', role: 'operator' });
  const [editForm, setEditForm] = useState({ email: '', full_name: '', role: '' });
  const [resetPwd, setResetPwd] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [creating, setCreating] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/auth/users', { headers: authHeaders() });
      if (r.ok) setUsers(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setCreating(true);
    try {
      const r = await fetch('/api/v1/auth/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); setFormError(err.detail || 'Erreur'); return; }
      setForm({ email: '', username: '', password: '', full_name: '', role: 'operator' });
      setShowForm(false); flash('Compte créé'); await loadUsers();
    } finally { setCreating(false); }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editing) return;
    try {
      const r = await fetch(`/api/v1/auth/users/${editing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(editForm),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); setFormError(err.detail || 'Erreur'); return; }
      setEditing(null); flash('Compte modifié'); await loadUsers();
    } catch { setFormError('Erreur réseau'); }
  };

  const handleToggle = async (id: number) => {
    setToggling(id);
    try {
      await fetch(`/api/v1/auth/users/${id}/toggle-active`, { method: 'PATCH', headers: authHeaders() });
      await loadUsers();
    } finally { setToggling(null); }
  };

  const handleResetPwd = async (e: React.FormEvent) => {
    e.preventDefault(); if (!resetting) return;
    try {
      await fetch(`/api/v1/auth/users/${resetting.id}/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ new_password: resetPwd }),
      });
      setResetting(null); setResetPwd(''); flash('Mot de passe réinitialisé');
    } catch { setFormError('Erreur réseau'); }
  };

  const handleDelete = async (id: number, username: string) => {
    if (!confirm(`Supprimer le compte « ${username} » ?`)) return;
    setDeleting(id);
    try {
      await fetch(`/api/v1/auth/users/${id}`, { method: 'DELETE', headers: authHeaders() });
      await loadUsers(); flash('Compte supprimé');
    } finally { setDeleting(null); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-muted)' }} />
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <PageHeader title="Comptes" subtitle={`${users.length} compte${users.length > 1 ? 's' : ''}. L’administrateur gère les accès ; les opérateurs consultent la surveillance et le modèle.`}>
        <button onClick={() => { setShowForm(!showForm); setEditing(null); setResetting(null); }} className="vc-btn vc-btn-primary">
          <Plus className="w-4 h-4" /> Nouveau compte
        </button>
      </PageHeader>

      {/* Flash success */}
      <AnimatePresence>
        {success && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-[4px] text-sm"
            style={{ background: 'var(--accent-glow)', border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)' }}>
            <CheckCircle className="w-4 h-4" /> {success}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {formError && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-[4px] text-sm"
            style={{ background: 'color-mix(in srgb, var(--accent-danger) 9%, transparent)', border: '1px solid var(--accent-danger)', color: 'var(--accent-danger)' }}>
            <AlertCircle className="w-4 h-4 shrink-0" /> {formError}
            <button onClick={() => setFormError('')} className="ml-auto"><X className="w-3 h-3" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="rounded-[4px] p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Créer un compte</h2>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} /></button>
            </div>
            <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
              <Input label="Identifiant *" value={form.username} onChange={v => setForm(f => ({ ...f, username: v }))} required />
              <Input label="Email *" type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} required />
              <Input label="Mot de passe * (6+)" type="password" value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} required minLength={6} />
              <Input label="Nom complet" value={form.full_name} onChange={v => setForm(f => ({ ...f, full_name: v }))} />
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Rôle *</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2 rounded-[4px] text-sm outline-none"
                  style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
                  <option value="operator">Opérateur</option>
                  <option value="admin">Administrateur</option>
                </select>
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={creating}
                  className="flex items-center gap-2 px-4 py-2 rounded-[4px] text-sm font-medium disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />} Créer
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit form */}
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="rounded-[4px] p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                Modifier « {editing.username} »
              </h2>
              <button onClick={() => setEditing(null)}><X className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} /></button>
            </div>
            <form onSubmit={handleEdit} className="grid grid-cols-3 gap-4">
              <Input label="Email" type="email" value={editForm.email} onChange={v => setEditForm(f => ({ ...f, email: v }))} />
              <Input label="Nom complet" value={editForm.full_name} onChange={v => setEditForm(f => ({ ...f, full_name: v }))} />
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Rôle</label>
                <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2 rounded-[4px] text-sm outline-none"
                  style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
                  <option value="operator">Opérateur</option>
                  <option value="admin">Administrateur</option>
                </select>
              </div>
              <div className="flex items-end">
                <button type="submit" className="flex items-center gap-2 px-4 py-2 rounded-[4px] text-sm font-medium"
                  style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
                  <Pencil className="w-4 h-4" /> Enregistrer
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset password form */}
      <AnimatePresence>
        {resetting && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="rounded-[4px] p-5" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                Réinitialiser le mot de passe de « {resetting.username} »
              </h2>
              <button onClick={() => { setResetting(null); setResetPwd(''); }}><X className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} /></button>
            </div>
            <form onSubmit={handleResetPwd} className="flex items-end gap-4">
              <div className="flex-1">
                <Input label="Nouveau mot de passe (6+)" type="password" value={resetPwd} onChange={setResetPwd} required minLength={6} />
              </div>
              <button type="submit" className="px-4 py-2 rounded-[4px] text-sm font-medium"
                style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
                <KeyRound className="w-4 h-4 inline mr-1" /> Réinitialiser
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Users table */}
      <div className="rounded-[4px] overflow-x-auto" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th className="text-left px-5 py-3 text-[12.5px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Utilisateur</th>
              <th className="text-left px-5 py-3 text-[12.5px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Email</th>
              <th className="text-left px-5 py-3 text-[12.5px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Rôle</th>
              <th className="text-left px-5 py-3 text-[12.5px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Statut</th>
              <th className="text-right px-5 py-3 text-[12.5px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                className="transition-colors hover:bg-white/[0.02]">
                <td className="px-5 py-3">
                  <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{u.username}</div>
                  {u.full_name && <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{u.full_name}</div>}
                </td>
                <td className="px-5 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{u.email}</td>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12.5px] font-semibold"
                    style={{
                      background: `color-mix(in srgb, ${ROLE_COLORS[u.role] || 'var(--text-muted)'} 12%, transparent)`,
                      color: ROLE_COLORS[u.role] || 'var(--text-muted)',
                      border: `1px solid color-mix(in srgb, ${ROLE_COLORS[u.role] || 'var(--text-muted)'} 25%, transparent)`,
                    }}>
                    <Shield className="w-2.5 h-2.5" /> {ROLE_LABELS[u.role] || u.role}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className="text-[13px]" style={{ color: u.is_active ? 'var(--accent-primary)' : 'var(--accent-danger)' }}>
                    {u.is_active ? 'Actif' : 'Inactif'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {u.role !== 'admin' && (
                      <>
                        <ActionBtn icon={Pencil} title="Modifier" color="var(--text-secondary)"
                          onClick={() => { setEditing(u); setEditForm({ email: u.email, full_name: u.full_name || '', role: u.role }); setShowForm(false); setResetting(null); }} />
                        <ActionBtn icon={Power} title={u.is_active ? 'Désactiver' : 'Activer'}
                          color={u.is_active ? 'var(--accent-warning)' : 'var(--accent-primary)'} spinning={toggling === u.id}
                          onClick={() => handleToggle(u.id)} />
                        <ActionBtn icon={KeyRound} title="Reset MDP" color="var(--accent-warning)"
                          onClick={() => { setResetting(u); setShowForm(false); setEditing(null); setResetPwd(''); }} />
                        <ActionBtn icon={Trash2} title="Supprimer" color="var(--accent-danger)" spinning={deleting === u.id}
                          onClick={() => handleDelete(u.id, u.username)} />
                      </>
                    )}
                    {u.role === 'admin' && (
                      <span className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text', ...props }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-[4px] text-sm outline-none"
        style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
        {...props} />
    </div>
  );
}

function ActionBtn({ icon: Icon, title, color, onClick, spinning }: {
  icon: any; title: string; color: string; onClick: () => void; spinning?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={spinning} title={title}
      className="p-1.5 rounded-[4px] transition-colors hover:bg-white/5 disabled:opacity-30">
      <Icon className="w-3.5 h-3.5" style={{ color }} />
    </button>
  );
}
