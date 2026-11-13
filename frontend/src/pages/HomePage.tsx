import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { Wordmark } from '../components/BandMark';
import { Tally, TallyLegend } from '../components/etude/kit';

// Chiffres réels : résultats de référence lus en base (GET /api/v1/transmission/kpis, public).
interface TransmissionKpi {
  generated_at: string;
  traces: { debut: string; fin: string; pas: string; mesures: number; heures: number };
  capteurs: string[];
  repetitions: number;
  scenarios: number;
  part_attaques_test?: number;
  meilleur: {
    id: string; nom: string; f1: number; f2?: number; precision: number; recall: number; roc_auc: number;
    fausses_alarmes_par_heure?: number; episodes: number; episodes_detectes: number; delai_median_min: number | null;
    seuil?: number; k?: number; n?: number;
  };
  cible_rappel?: number; critere?: string;
  modeles: { id: string; nom: string; f1: number }[];
  detection_par_scenario: { scenario: string; description: string; taux: number; episodes?: number; detectes?: number; lignes_signalees?: number }[];
}

const nf = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${nf(x * 100, d)}\u202f%`);

function useTransmissionKpi() {
  const [data, setData] = useState<TransmissionKpi | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/v1/transmission/kpis')
      .then(r => (r.ok ? r.json() : null))
      .then((json: TransmissionKpi | null) => { if (active) { setData(json); setFailed(!json); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  return { data, failed };
}

export default function HomePage() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { data: kpi, failed } = useTransmissionKpi();
  const m = kpi?.meilleur;
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
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 lg:gap-14 items-start">
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

          {/* Fiche de synthèse : le registre des épisodes (chiffres lus en base) */}
          <div className="vc-fiche overflow-hidden" aria-live="polite">
            {kpi && m ? (
              <>
                <div className="p-5 sm:p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{kpi.repetitions} répétitions</span>
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="vc-readout-value" style={{ fontSize: 56 }}>{nf(m.episodes_detectes)}</span>
                    <span className="text-[19px]" style={{ fontFamily: 'var(--display)', color: 'var(--text-secondary)' }}>
                      attaques détectées sur {nf(m.episodes)}
                    </span>
                  </div>
                  <div className="mt-3"><Tally detected={m.episodes_detectes} total={m.episodes} animate /></div>
                  <div className="mt-3"><TallyLegend /></div>
                  <p className="mt-3 text-[13.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    Épisodes d’attaque injectés dans des heures jamais vues à l’entraînement, avec un réglage d’alerte unique
                    {m.seuil != null ? ` (score ≥ ${nf(m.seuil, 2)}, ${m.k} mesures sur ${m.n})` : ''} choisi sur la validation.
                  </p>
                </div>
                <dl className="vc-readouts grid-cols-3 !border-0 !border-t !rounded-none">
                  {[
                    ['Précision', pct(m.precision), ''],
                    ['Fausses alertes', nf(m.fausses_alarmes_par_heure, 2), 'par heure'],
                    ['Délai médian', m.delai_median_min == null ? '—' : nf(m.delai_median_min, 1), 'min'],
                  ].map(([k, v, u]) => (
                    <div key={k}>
                      <dt className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{k}</dt>
                      <dd className="mt-1.5"><span className="vc-readout-value" style={{ fontSize: 28 }}>{v}</span>{u && <span className="vc-readout-unit" style={{ fontSize: 15 }}>{u}</span>}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <div className="p-6 text-[15px]" style={{ color: 'var(--text-secondary)' }}>
                {failed ? 'Les résultats de référence ne sont pas disponibles : l’API ne répond pas. Réessayez dans un instant.' : 'Chargement des résultats…'}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Accès au tableau de bord ────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <div className="vc-fiche p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <h3 className="text-[26px] leading-tight" style={{ color: 'var(--text-primary)' }}>Explorer le tableau de bord</h3>
            <p className="text-[15px] mt-1" style={{ color: 'var(--text-secondary)' }}>Rejeu temps réel, détection face à la réalité, résultats des modèles, explications SHAP et rapport pour l’opérateur.</p>
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
