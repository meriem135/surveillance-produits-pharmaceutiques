import { Link } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { Wordmark } from '../components/BandMark';
import ColdChainIllustration from '../components/ColdChainIllustration';

export default function HomePage() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const ctaTo = user ? '/dashboard' : '/login';
  const ctaLabel = user ? 'Ouvrir le tableau de bord' : 'Se connecter';

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* ── Barre de navigation ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40" style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-8">
          <Link to="/" className="no-underline" aria-label="VigiloChain, accueil"><Wordmark /></Link>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
              className="h-9 w-9 flex items-center justify-center rounded-[4px] border" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}>
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link to={ctaTo} className="vc-btn vc-btn-primary no-underline hidden sm:inline-flex">{ctaLabel}</Link>
            <Link to={ctaTo} className="vc-btn vc-btn-primary no-underline sm:hidden h-9">{ctaLabel}</Link>
          </div>
        </div>
      </header>

      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-14 sm:pt-20 sm:pb-20">
        <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-10 lg:gap-14 items-center">
          <div>
            <h1 className="text-[44px] sm:text-[60px] leading-[0.98]" style={{ color: 'var(--text-primary)' }}>
              Les mesures de la chaîne du froid <span className="whitespace-nowrap">sont-elles vraies&nbsp;?</span>
            </h1>
            <p className="mt-6 text-[17px] sm:text-[18px] leading-relaxed max-w-[52ch]" style={{ color: 'var(--text-secondary)' }}>
              VigiloChain surveille les capteurs qui protègent les produits pharmaceutiques (chambre froide, thermostat de production,
              météo du transport).
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={ctaTo} className="vc-btn vc-btn-primary no-underline h-11 px-5 text-[15px]">{user ? 'Ouvrir le tableau de bord' : 'Accéder au tableau de bord'}</Link>
            </div>
          </div>
          <ColdChainIllustration className="w-full max-w-[560px] mx-auto h-auto" />
        </div>
      </section>

      {/* ── Accès au tableau de bord ────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <div className="vc-fiche p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <h3 className="text-[26px] leading-tight" style={{ color: 'var(--text-primary)' }}>Explorer le tableau de bord</h3>
          </div>
          <Link to={ctaTo} className="vc-btn vc-btn-primary no-underline h-11 px-5 text-[15px] shrink-0 justify-center">{ctaLabel}</Link>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row gap-2 justify-between text-[13px]" style={{ color: 'var(--text-muted)' }}>
          <span>VigiloChain : détection d’intrusions IoT pour la chaîne du froid pharmaceutique</span>
        </div>
      </footer>
    </div>
  );
}
