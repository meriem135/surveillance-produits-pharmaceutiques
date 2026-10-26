import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  History, Loader2, UserPlus, Pencil, KeyRound, Power, Trash2, Eraser, CheckCircle,
} from 'lucide-react';
import { authHeaders } from '../lib/auth';

interface AuditEntry {
  id: number;
  admin_id: number;
  admin_username: string;
  action: string;
  target_user_id: number | null;
  target_username: string | null;
  details: string | null;
  created_at: string;
}

const ACTION_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  create: { icon: UserPlus, color: '#22c55e', label: 'Création' },
  update: { icon: Pencil, color: '#3b82f6', label: 'Modification' },
  delete: { icon: Trash2, color: '#ef4444', label: 'Suppression' },
  activate: { icon: Power, color: '#22c55e', label: 'Activation' },
  deactivate: { icon: Power, color: '#f97316', label: 'Désactivation' },
  reset_password: { icon: KeyRound, color: '#eab308', label: 'Reset MDP' },
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    fetch('/api/v1/auth/audit-logs', { headers: authHeaders() })
      .then(r => r.json())
      .then(setLogs)
      .finally(() => setLoading(false));
  }, []);

  const handleDeleteAll = async () => {
    if (!confirm('Supprimer tout l\'historique des actions ?')) return;
    setDeleting(true);
    try {
      const r = await fetch('/api/v1/auth/audit-logs', { method: 'DELETE', headers: authHeaders() });
      if (r.ok) {
        setLogs([]);
        setFlash('Historique supprimé');
        setTimeout(() => setFlash(''), 3000);
      }
    } finally { setDeleting(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-muted)' }} />
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--accent-glow)' }}>
            <History className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>Historique des actions</h1>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{logs.length} entrées</p>
          </div>
        </div>
        <button onClick={handleDeleteAll} disabled={deleting || logs.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors hover:bg-white/5"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}>
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />} Supprimer l'historique
        </button>
      </div>

      {flash && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
          style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>
          <CheckCircle className="w-4 h-4" /> {flash}
        </div>
      )}

      <div className="rounded-xl overflow-x-auto" style={{ background: 'var(--color-bg-panel)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th className="text-left px-5 py-3 text-[10px] font-mono uppercase" style={{ color: 'var(--color-text-secondary)' }}>Action</th>
              <th className="text-left px-5 py-3 text-[10px] font-mono uppercase" style={{ color: 'var(--color-text-secondary)' }}>Admin</th>
              <th className="text-left px-5 py-3 text-[10px] font-mono uppercase" style={{ color: 'var(--color-text-secondary)' }}>Cible</th>
              <th className="text-left px-5 py-3 text-[10px] font-mono uppercase" style={{ color: 'var(--color-text-secondary)' }}>Détails</th>
              <th className="text-right px-5 py-3 text-[10px] font-mono uppercase" style={{ color: 'var(--color-text-secondary)' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => {
              const cfg = ACTION_CONFIG[log.action] || { icon: Pencil, color: '#888', label: log.action };
              const Icon = cfg.icon;
              return (
                <motion.tr key={log.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                  className="hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: cfg.color }}>
                      <Icon className="w-3.5 h-3.5" /> {cfg.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--color-text-primary)' }}>
                    {log.admin_username}
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: 'var(--color-text-primary)' }}>
                    {log.target_username || '—'}
                  </td>
                  <td className="px-5 py-3 text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                    {log.details || '—'}
                  </td>
                  <td className="px-5 py-3 text-[10px] font-mono text-right" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(log.created_at).toLocaleString('fr-FR')}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
        {logs.length === 0 && (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Aucune action enregistrée
          </div>
        )}
      </div>
    </div>
  );
}
