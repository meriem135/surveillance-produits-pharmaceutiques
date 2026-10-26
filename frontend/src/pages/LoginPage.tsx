import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import AuthShell, { Field, inputClass, primaryButtonClass } from '../components/AuthShell';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Veuillez remplir tous les champs');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Connexion"
      subtitle="Accédez au tableau de bord de supervision."
      topLink={{ to: '/', label: 'Accueil' }}
      footer={<>Pas encore de compte ? <Link to="/register" className="font-medium" style={{ color: 'var(--accent-primary)' }}>Créer un compte</Link></>}
    >
      {error && (
        <div role="alert" className="mb-5 flex items-center gap-2.5 px-3.5 py-2.5 rounded-md text-sm"
          style={{ background: 'color-mix(in srgb, var(--accent-danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-danger) 30%, transparent)', color: 'var(--accent-danger)' }}>
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Identifiant ou e-mail">
          <input type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="nom d’utilisateur" className={inputClass} />
        </Field>
        <Field label="Mot de passe">
          <div className="relative">
            <input type={showPwd ? 'text' : 'password'} autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={`${inputClass} pr-10`} />
            <button type="button" onClick={() => setShowPwd(!showPwd)} aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--text-muted)' }}>
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
        <button type="submit" disabled={loading} className={`${primaryButtonClass} mt-2`}>
          {loading
            ? <><span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} /> Connexion…</>
            : <><LogIn className="w-4 h-4" /> Se connecter</>}
        </button>
      </form>
    </AuthShell>
  );
}
