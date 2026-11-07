import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { Wordmark } from '../components/BandMark';
import { SCENARIO_FR, Tally, TallyLegend } from '../components/etude/kit';

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

const STEPS = [
  { title: 'Collecte et préparation des données', desc: 'Exploration et prétraitement de 5 jours de mesures réelles TON_IoT (frigo, thermostat, météo, du 31 mars au 4 avril 2019) : nettoyage, fusion des trois capteurs au pas de 5 s, puis injection d’attaques de transmission (MITM et injection) sur ces traces.' },
  { title: 'Modélisation et explicabilité', desc: 'Six modèles supervisés comparés (Extra Trees, Random Forest, XGBoost, HistGradientBoosting, Régression Logistique, MLP) sur 20 répétitions, avec un seul réglage d’alerte choisi sur la validation : précision d’au moins 90 %, au plus une fausse alerte toutes les deux heures. Chaque détection est expliquée avec SHAP.' },
  { title: 'Déploiement de la plateforme', desc: 'API FastAPI, tableau de bord React (rejeu temps réel, entraînement suivi en direct, SHAP, rapport pour l’opérateur) et base PostgreSQL qui conserve chaque entraînement et chaque chiffre affiché.' },
];

const ZONES = [
  { title: 'Météo extérieure', where: 'Logistique', desc: 'Conditions climatiques pendant le transport des produits pharmaceutiques.' },
  { title: 'Chambre froide', where: 'Stockage, 1 à 14 °C', desc: 'Vaccins, médicaments et matières premières en entrepôt réfrigéré.', band: true },
  { title: 'Thermostat', where: 'Production', desc: 'Lignes de fabrication, salles blanches et conditionnement.' },
];

const nf = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${nf(x * 100, d)}\u202f%`);
const day = (iso: string) => new Date(iso.replace(' ', 'T')).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

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

const scrollTo = (e: React.MouseEvent, href: string) => {
  e.preventDefault();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.querySelector(href)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
};

function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="max-w-[64ch] mb-8">
      <h2 className="text-[32px] sm:text-[38px] leading-[1.05]" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      {children && <p className="mt-3 text-[16px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{children}</p>}
    </div>
  );
}

export default function HomePage() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { data: kpi, failed } = useTransmissionKpi();
  const [menu, setMenu] = useState(false);
  const m = kpi?.meilleur;
  const ctaTo = user ? '/dashboard' : '/login';
  const ctaLabel = user ? 'Ouvrir le tableau de bord' : 'Se connecter';

  const links = [['#demarche', 'Démarche'], ['#attaques', 'Attaques'], ['#fonctionnement', 'Fonctionnement'], ['#capteurs', 'Capteurs'], ['#rapport', 'Rapport']];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* ── Barre de navigation ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40" style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-8">
          <Link to="/" className="no-underline" aria-label="VigiloChain, accueil"><Wordmark /></Link>
          <nav className="hidden lg:flex items-center gap-6 text-[15px]" aria-label="Sections">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={(e) => scrollTo(e, href)}
                className="no-underline hover:underline underline-offset-4 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{label}</a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
              className="h-9 w-9 flex items-center justify-center rounded-[4px] border" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}>
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link to={ctaTo} className="vc-btn vc-btn-primary no-underline hidden sm:inline-flex">{ctaLabel}</Link>
            <button className="lg:hidden h-9 w-9 flex items-center justify-center rounded-[4px] border" aria-label={menu ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={menu} onClick={() => setMenu(v => !v)} style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}>
              {menu ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {menu && (
          <nav className="lg:hidden px-4 pb-4 flex flex-col gap-1" aria-label="Sections">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={(e) => { setMenu(false); scrollTo(e, href); }}
                className="py-2 text-[15px] no-underline" style={{ color: 'var(--text-secondary)' }}>{label}</a>
            ))}
            <Link to={ctaTo} className="vc-btn vc-btn-primary no-underline justify-center mt-1 h-10">{ctaLabel}</Link>
          </nav>
        )}
      </header>

      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-14 sm:pt-20 sm:pb-20">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 lg:gap-14 items-start">
          <div>
            <p className="text-[15px] font-semibold" style={{ color: 'var(--accent-primary)' }}>Projet de fin d’études en sécurité IoT</p>
            <h1 className="mt-3 text-[44px] sm:text-[60px] leading-[0.98]" style={{ color: 'var(--text-primary)' }}>
              Les mesures de la chaîne du froid <span className="whitespace-nowrap">sont-elles vraies&nbsp;?</span>
            </h1>
            <p className="mt-6 text-[17px] sm:text-[18px] leading-relaxed max-w-[52ch]" style={{ color: 'var(--text-secondary)' }}>
              VigiloChain surveille les capteurs qui protègent les produits pharmaceutiques (chambre froide, thermostat de production,
              météo du transport) et repère les mesures falsifiées en transit : interception MITM, injection de fausses valeurs.
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
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--accent-primary)' }}>Résultat de référence, {m.nom}</span>
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

      {/* ── Démarche ────────────────────────────────────────────────────── */}
      <section id="demarche" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <SectionHead title="De la donnée brute à la plateforme déployée" />
        <ol className="grid md:grid-cols-3 gap-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="vc-card p-6">
              <span className="vc-readout-value" style={{ fontSize: 40, color: 'var(--accent-primary)' }} aria-hidden>{i + 1}</span>
              <h3 className="mt-2 text-[22px] leading-tight" style={{ color: 'var(--text-primary)' }}>{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Attaques simulées ──────────────────────────────────────────── */}
      <section id="attaques" className="py-14 sm:py-20" style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionHead title="Comment un attaquant falsifie une mesure">
            Un attaquant placé entre le capteur et le serveur peut altérer ce que le serveur reçoit, sans toucher au capteur.
            Voici les {kpi ? kpi.scenarios : 9} scénarios simulés dans l’étude : le modèle doit repérer que la valeur reçue n’est pas la vraie.
          </SectionHead>
          {kpi ? (
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {kpi.detection_par_scenario.map(sc => {
                const mitm = sc.scenario.startsWith('MITM');
                const capteur = sc.scenario.includes('thermostat') ? 'thermostat' : 'frigo';
                return (
                  <li key={sc.scenario} className="vc-card p-5">
                    <div className="text-[12.5px] font-semibold" style={{ color: 'var(--accent-primary)' }}>
                      {mitm ? 'Interception (MITM)' : 'Injection de valeurs'} · {capteur}
                    </div>
                    <h3 className="mt-1.5 text-[19px] leading-snug" style={{ color: 'var(--text-primary)' }}>{SCENARIO_FR[sc.scenario] ?? sc.scenario}</h3>
                    <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{sc.description}.</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>
              {failed ? 'La liste des scénarios n’est pas disponible : l’API ne répond pas.' : 'Chargement des scénarios…'}
            </p>
          )}
        </div>
      </section>

      {/* ── Fonctionnement du modèle ───────────────────────────────────── */}
      <section id="fonctionnement" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <SectionHead title="Comment le modèle décide">
          À chaque mesure, le modèle calcule un score de risque. Une alerte n’est levée que si ce score reste élevé assez longtemps :
          un pic isolé ne suffit pas.
        </SectionHead>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            ['Une mesure arrive', `Les mesures des trois capteurs arrivent${kpi ? ` au pas de ${kpi.traces.pas.replace('s', ' s')}` : ''}.`],
            ['Variables sur le passé', 'Moyennes, écarts-types et quantiles sur 1 à 15 minutes. Le modèle ne regarde jamais le futur.'],
            ['Score de risque', `${m ? m.nom : 'Le modèle'} donne un score de 0 à 100 % : plus il est haut, plus la mesure est suspecte.`],
            ['Règle d’alerte', m && m.seuil != null && m.k != null && m.n != null
              ? `Alerte si au moins ${m.k} mesures sur ${m.n} (${m.n * (parseInt(kpi!.traces.pas) || 5)} s) ont un score d’au moins ${nf(m.seuil * 100, 0)} %.`
              : 'Alerte si le score dépasse le seuil sur assez de mesures consécutives.'],
          ].map(([t, d], i) => (
            <li key={t} className="vc-card p-5">
              <span className="vc-readout-value" style={{ fontSize: 32, color: 'var(--accent-primary)' }} aria-hidden>{i + 1}</span>
              <h3 className="mt-2 text-[19px] leading-tight" style={{ color: 'var(--text-primary)' }}>{t}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Capteurs ────────────────────────────────────────────────────── */}
      <section id="capteurs" className="py-14 sm:py-20" style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionHead title="Trois capteurs, un maillon chacun">
            Du transport au stockage puis à la production, chaque capteur couvre un maillon de la chaîne des produits pharmaceutiques.
            Un jumeau numérique fusionne les trois flux.
          </SectionHead>
          <ol className="grid md:grid-cols-3">
            {ZONES.map((z, i) => (
              <li key={z.title} className="relative py-5 md:py-0 md:px-6 first:md:pl-0 border-t md:border-t-0 md:border-l first:border-0" style={{ borderColor: 'var(--border-strong)' }}>
                <div className="text-[13px] font-semibold" style={{ color: 'var(--text-muted)' }}>Maillon {i + 1} : {z.where}</div>
                <h3 className="mt-1 text-[26px] leading-tight" style={{ color: 'var(--text-primary)' }}>{z.title}</h3>
                {z.band && (
                  <div className="mt-2 inline-flex items-center gap-2 text-[13px]" style={{ color: 'var(--accent-primary)' }}>
                    <span className="vc-band inline-block w-10 h-3" aria-hidden /> plage des mesures 1 à 14 °C
                  </div>
                )}
                <p className="mt-2 text-[15px] leading-relaxed max-w-[36ch]" style={{ color: 'var(--text-secondary)' }}>{z.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Rapport de recommandations ─────────────────────────────────── */}
      <section id="rapport" className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20">
        <SectionHead title="Que faire quand une alerte tombe : le rapport pour l’opérateur">
          Détecter ne suffit pas : l’opérateur doit savoir quoi faire. La plateforme génère un rapport de recommandations à partir des
          résultats de l’étude.
        </SectionHead>
        <ol className="grid md:grid-cols-3 gap-5">
          {[
            ['À chaque alerte', 'Des règles valables pour toute alerte : vérifier d’abord sur place avec un thermomètre de contrôle, ne jamais libérer un lot sur une mesure contestée, isoler le capteur et vérifier le broker, journaliser la décision.'],
            ['Une fois la cause identifiée', 'Une fiche par type d’attaque (mesure figée, rejeu, valeurs plausibles injectées, décalage, dérive) : le risque pour les produits, les signes à repérer et les actions à mener.'],
            ['Ce que mesure le modèle', 'Pour chaque scénario : le niveau de détection (bien, partiellement ou mal détecté), les variables les plus influentes (SHAP) et les limites connues. Le rapport se télécharge en Markdown.'],
          ].map(([t, d], i) => (
            <li key={t} className="vc-card p-6">
              <span className="vc-readout-value" style={{ fontSize: 32, color: 'var(--accent-primary)' }} aria-hidden>{i + 1}</span>
              <h3 className="mt-2 text-[20px] leading-tight" style={{ color: 'var(--text-primary)' }}>{t}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex">
          <Link to={user ? '/dashboard/rapport' : '/login'} className="vc-btn no-underline h-11 px-5 text-[15px] shrink-0 justify-center">
            {user ? 'Ouvrir le rapport' : 'Se connecter pour voir le rapport'}
          </Link>
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
          <span>Projet de fin d’études{kpi ? `, résultats générés le ${day(kpi.generated_at)}` : ''}</span>
        </div>
      </footer>
    </div>
  );
}
