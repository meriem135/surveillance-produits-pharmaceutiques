import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun, ShieldCheck, Radio, Brain, FileText } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

/** Mise en page commune des écrans Connexion / Création de compte. */
export default function AuthShell({ title, subtitle, children, footer, topLink }: {
  title: string; subtitle: string; children: ReactNode; footer?: ReactNode; topLink: { to: string; label: string };
}) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" style={{ background: 'var(--bg-base)' }}>
      {/* Panneau de présentation */}
      <aside className="hidden lg:flex flex-col justify-between p-12" style={{ background: '#0B2530', color: '#E3F1F5' }}>
        <Link to="/" className="flex items-center gap-2.5 no-underline" style={{ color: '#fff' }}>
          <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#2CB5D0', color: '#04121A' }}>
            <ShieldCheck className="w-5 h-5" />
          </span>
          <span className="font-semibold">VigiloChain</span>
        </Link>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight" style={{ color: '#fff' }}>
            Détection d’intrusions IoT pour la chaîne du froid pharmaceutique
          </h1>
          <p className="mt-4 text-sm leading-relaxed" style={{ color: '#A9C6CF' }}>
            Surveillance des capteurs frigo, thermostat et météo : attaques de transmission (MITM, injection)
            détectées par apprentissage supervisé et expliquées avec SHAP.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {[
              { icon: Radio, t: 'Traces réelles TON_IoT, attaques MITM et injection simulées' },
              { icon: Brain, t: 'Modèles supervisés comparés, entraînement suivi en direct' },
              { icon: FileText, t: 'Rapport de recommandation pour l’opérateur' },
            ].map(({ icon: Icon, t }) => (
              <li key={t} className="flex items-center gap-3" style={{ color: '#CFE3E9' }}>
                <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: 'rgba(44,181,208,0.15)', color: '#5FD0E6' }}>
                  <Icon className="w-4 h-4" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="text-xs" style={{ color: '#7FA3AE' }}>Projet de fin d’études — sécurité IoT, produits pharmaceutiques</div>
      </aside>

      {/* Formulaire */}
      <main className="flex flex-col min-h-screen">
        <div className="flex items-center justify-between px-5 sm:px-8 h-16">
          <Link to="/" className="lg:hidden flex items-center gap-2 no-underline" style={{ color: 'var(--text-primary)' }}>
            <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
              <ShieldCheck className="w-[18px] h-[18px]" />
            </span>
            <span className="font-semibold text-sm">VigiloChain</span>
          </Link>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Changer de thème"
              className="h-9 w-9 flex items-center justify-center rounded-md border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link to={topLink.to} className="h-9 px-3 inline-flex items-center rounded-md border text-sm no-underline"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>{topLink.label}</Link>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-5 pb-12">
          <div className="w-full max-w-[400px]">
            <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h2>
            <p className="text-sm mt-1.5 mb-7" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>
            {children}
            {footer && <div className="mt-8 pt-5 text-sm text-center" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
        {label}{hint && <span className="font-normal" style={{ color: 'var(--text-muted)' }}> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full h-10 px-3 rounded-md text-sm outline-none border bg-[var(--bg-card)] border-[var(--border-strong)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-glow)]';

export const primaryButtonClass =
  'w-full h-10 rounded-md text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 hover:brightness-110 bg-[var(--accent-primary)] text-[var(--accent-primary-fg)]';
