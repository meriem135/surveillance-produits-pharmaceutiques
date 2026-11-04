import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { Wordmark } from './BandMark';

/** Mise en page commune des écrans Connexion / Création de compte. */
export default function AuthShell({ title, subtitle, children, footer, topLink }: {
  title: string; subtitle: string; children: ReactNode; footer?: ReactNode; topLink: { to: string; label: string };
}) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" style={{ background: 'var(--bg-base)' }}>
      {/* Panneau de présentation, sur fond de papier d'enregistreur */}
      <aside className="hidden lg:flex flex-col justify-between p-12 vc-paper !border-0 !border-r !rounded-none" style={{ borderColor: 'var(--border)' }}>
        <Link to="/" className="no-underline self-start" aria-label="VigiloChain, accueil"><Wordmark sub="Chaîne du froid" /></Link>
        <div className="max-w-md vc-fiche p-7">
          <h1 className="text-[40px] leading-[1.02]" style={{ color: 'var(--text-primary)' }}>
            Les mesures de la chaîne du froid <span className="whitespace-nowrap">sont-elles vraies&nbsp;?</span>
          </h1>
          <p className="mt-4 text-[15.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Surveillance des capteurs frigo, thermostat et météo : les attaques de transmission (MITM, injection) sont détectées
            par apprentissage supervisé et expliquées avec SHAP.
          </p>
          <ul className="mt-6 space-y-2.5 text-[14.5px]" style={{ color: 'var(--text-secondary)' }}>
            {[
              'Traces réelles TON_IoT, attaques MITM et injection simulées',
              'Modèles comparés sur la validation, entraînement suivi en direct',
              'Rapport de consignes pour l’opérateur',
            ].map(t => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="w-2 h-2 mt-[7px] shrink-0" style={{ background: 'var(--accent-primary)' }} aria-hidden />{t}
              </li>
            ))}
          </ul>
        </div>
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Projet de fin d’études en sécurité IoT, produits pharmaceutiques</div>
      </aside>

      {/* Formulaire */}
      <main className="flex flex-col min-h-screen">
        <div className="flex items-center justify-between px-5 sm:px-8 h-16">
          <Link to="/" className="lg:hidden no-underline" aria-label="VigiloChain, accueil"><Wordmark /></Link>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
              className="h-9 w-9 flex items-center justify-center rounded-[4px] border" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}>
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link to={topLink.to} className="vc-btn no-underline">{topLink.label}</Link>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-5 pb-12">
          <div className="w-full max-w-[400px]">
            <h2 className="text-[34px] leading-tight" style={{ color: 'var(--text-primary)' }}>{title}</h2>
            <p className="text-[15px] mt-1.5 mb-7" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>
            {children}
            {footer && <div className="mt-8 pt-5 text-[14.5px] text-center" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[14px] font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
        {label}{hint && <span className="font-normal" style={{ color: 'var(--text-muted)' }}> ({hint})</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full h-11 px-3 rounded-[4px] text-[15px] outline-none border bg-[var(--bg-panel)] border-[var(--border-strong)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-glow)]';

export const primaryButtonClass =
  'w-full h-11 rounded-[4px] text-[15px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 bg-[var(--accent-primary)] text-[var(--accent-primary-fg)] hover:brightness-95';
