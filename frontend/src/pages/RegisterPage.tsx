import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, UserPlus, CheckCircle2 } from 'lucide-react';
import AuthShell, { Field, inputClass, primaryButtonClass } from '../components/AuthShell';

export default function RegisterPage() {
  const navigate = useNavigate();
  // Les comptes créés ici ont le rôle « opérateur » (le rôle admin se donne depuis la page Comptes).
  const [form, setForm] = useState({ email: '', username: '', password: '', full_name: '', role: 'operator' });
  const [showPwd, setShowPwd] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdUsername, setCreatedUsername] = useState<string | null>(null);

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
        setError(typeof data.detail === 'string' ? data.detail : 'Erreur lors de la création');
        return;
      }
      setCreatedUsername(form.username);
    } catch {
      setError('Erreur de connexion au serveur');
    } finally {
      setCreating(false);
    }
  };

  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Compte opérateur : consultation des résultats, SHAP et rapports."
      topLink={{ to: '/login', label: 'Connexion' }}
      footer={<>Déjà un compte ? <Link to="/login" className="font-medium" style={{ color: 'var(--accent-primary)' }}>Se connecter</Link></>}
    >
      {error && (
        <div role="alert" className="mb-5 flex items-center gap-2.5 px-3.5 py-2.5 rounded-md text-sm"
          style={{ background: 'color-mix(in srgb, var(--accent-danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-danger) 30%, transparent)', color: 'var(--accent-danger)' }}>
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {createdUsername ? (
        <div className="vc-card p-6 text-center">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--accent-success)' }} />
          <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Compte créé</div>
          <div className="text-sm mt-1 mb-5" style={{ color: 'var(--text-secondary)' }}>
            Bienvenue <strong style={{ color: 'var(--text-primary)' }}>{createdUsername}</strong>, vous pouvez maintenant vous connecter.
          </div>
          <button onClick={() => navigate('/login')} className={primaryButtonClass}>Se connecter</button>
        </div>
      ) : (
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Identifiant">
            <input type="text" autoComplete="username" required value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="jean.dupont" className={inputClass} />
          </Field>
          <Field label="E-mail">
            <input type="email" autoComplete="email" required value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jean@exemple.fr" className={inputClass} />
          </Field>
          <Field label="Nom complet" hint="facultatif">
            <input type="text" autoComplete="name" value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jean Dupont" className={inputClass} />
          </Field>
          <Field label="Mot de passe" hint="6 caractères minimum">
            <div className="relative">
              <input type={showPwd ? 'text' : 'password'} autoComplete="new-password" required minLength={6} value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" className={`${inputClass} pr-10`} />
              <button type="button" onClick={() => setShowPwd(!showPwd)} aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--text-muted)' }}>
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <button type="submit" disabled={creating} className={`${primaryButtonClass} mt-2`}>
            {creating
              ? <><span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} /> Création…</>
              : <><UserPlus className="w-4 h-4" /> Créer mon compte</>}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
