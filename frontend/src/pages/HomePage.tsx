import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, Brain, ArrowRight, Database, Rocket, CloudSun, Boxes, Factory, Moon, Sun,
  CheckCircle2, MinusCircle, XCircle, Menu, X,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';

// Chiffres réels : résultats de référence sur les traces TON_IoT (GET /api/v1/transmission/kpis, public).
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
  };
  cible_rappel?: number;
  modeles: { id: string; nom: string; f1: number }[];
  detection_par_scenario: { scenario: string; description: string; taux: number; points: number; detectes: number }[];
}

const STEPS = [
  { icon: Database, title: 'Collecte et préparation des données', desc: 'J’ai exploré et prétraité 5 jours de mesures réelles TON_IoT (frigo, thermostat, météo, du 31 mars au 4 avril 2019) : nettoyage, fusion des trois capteurs au pas de 5 s, puis injection d’attaques de transmission (MITM et injection) sur ces traces.' },
  { icon: Brain, title: 'Modélisation et explicabilité', desc: 'J’ai entraîné et comparé quatre modèles supervisés (Random Forest, XGBoost, Régression Logistique et MLP) sur 20 répétitions, retenu le meilleur sur la validation avec un seuil réglé pour un rappel cible (priorité : ne rater aucune attaque), puis expliqué chaque détection avec SHAP.' },
  { icon: Rocket, title: 'Déploiement de la plateforme', desc: 'J’ai construit l’API FastAPI, le tableau de bord React (entraînement suivi en direct, SHAP, rapport de recommandation pour l’opérateur) et une base PostgreSQL qui conserve chaque entraînement.' },
];

const ZONES = [
  { icon: CloudSun, title: 'Météo — logistique', desc: 'Conditions climatiques pendant le transport des produits pharmaceutiques.' },
  { icon: Boxes, title: 'Stock — chaîne du froid', desc: 'Chambre froide des entrepôts : vaccins, médicaments, matières premières (2–8 °C).' },
  { icon: Factory, title: 'Production — usine', desc: 'Lignes de fabrication, salles blanches et conditionnement pilotés par thermostat.' },
];

const TECH = ['React', 'TypeScript', 'Tailwind CSS', 'FastAPI', 'Python', 'scikit-learn', 'XGBoost', 'SHAP', 'PostgreSQL', 'WebSocket', 'Docker'];

const SENSOR_FR: Record<string, string> = { fridge: 'frigo', thermostat: 'thermostat', weather: 'météo' };
const SCENARIO_FR: Record<string, string> = {
  MITM_gel: 'MITM · gel du frigo', MITM_rejeu: 'MITM · rejeu du frigo', Injection_nominale: 'Injection · valeurs nominales au frigo',
  'Injection_biais_0.5': 'Injection · biais −0,5 °C au frigo', 'Injection_biais_1.0': 'Injection · biais −1 °C au frigo',
  'Injection_biais_2.0': 'Injection · biais −2 °C au frigo', Injection_derive: 'Injection · dérive lente du frigo',
  MITM_gel_thermostat: 'MITM · gel du thermostat', Injection_biais_thermostat: 'Injection · biais −1,5 °C au thermostat',
};

const nf = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${nf(x * 100, d)} %`);
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

function SectionHead({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl mb-10">
      <div className="vc-kicker" style={{ color: 'var(--accent-primary)' }}>{kicker}</div>
      <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      {children && <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{children}</p>}
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

  const links = [['#resultats', 'Résultats'], ['#demarche', 'Démarche'], ['#zones', 'Zones surveillées'], ['#technologies', 'Technologies']];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* ── Barre de navigation ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40" style={{ background: 'color-mix(in srgb, var(--bg-panel) 92%, transparent)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5 no-underline" style={{ color: 'var(--text-primary)' }}>
            <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
              <ShieldCheck className="w-[18px] h-[18px]" />
            </span>
            <span className="font-semibold">VigiloChain</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm" aria-label="Sections">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={(e) => { e.preventDefault(); document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' }); }}
                className="no-underline hover:underline" style={{ color: 'var(--text-secondary)' }}>{label}</a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Changer de thème"
              className="h-9 w-9 flex items-center justify-center rounded-md border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link to={ctaTo} className="hidden sm:inline-flex h-9 px-4 items-center gap-1.5 rounded-md text-sm font-semibold no-underline"
              style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
              {user ? 'Tableau de bord' : 'Connexion'} <ArrowRight className="w-4 h-4" />
            </Link>
            <button className="md:hidden h-9 w-9 flex items-center justify-center rounded-md border" aria-label="Menu"
              onClick={() => setMenu(v => !v)} style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              {menu ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {menu && (
          <nav className="md:hidden px-4 pb-4 flex flex-col gap-1" aria-label="Sections">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={(e) => { e.preventDefault(); setMenu(false); document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' }); }}
                className="py-2 text-sm no-underline" style={{ color: 'var(--text-secondary)' }}>{label}</a>
            ))}
            <Link to={ctaTo} className="mt-1 h-10 inline-flex items-center justify-center rounded-md text-sm font-semibold no-underline"
              style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>{user ? 'Tableau de bord' : 'Connexion'}</Link>
          </nav>
        )}
      </header>

      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-12 sm:pt-20 sm:pb-16 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-xs font-medium"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)' }}>
            Projet de fin d’études · sécurité IoT
          </div>
          <h1 className="mt-5 text-[34px] sm:text-5xl font-semibold tracking-tight leading-[1.1]" style={{ color: 'var(--text-primary)' }}>
            Détecter les attaques sur les capteurs de la chaîne du froid
          </h1>
          <p className="mt-5 text-base sm:text-lg leading-relaxed max-w-xl" style={{ color: 'var(--text-secondary)' }}>
            VigiloChain surveille les capteurs qui protègent les produits pharmaceutiques — chambre froide,
            thermostat de production, météo du transport — et repère les mesures falsifiées en transit
            (interception MITM, injection de fausses valeurs).
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={ctaTo} className="h-11 px-5 inline-flex items-center gap-2 rounded-md text-sm font-semibold no-underline"
              style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
              Accéder au tableau de bord <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#resultats" onClick={(e) => { e.preventDefault(); document.querySelector('#resultats')?.scrollIntoView({ behavior: 'smooth' }); }}
              className="h-11 px-5 inline-flex items-center rounded-md text-sm font-medium border no-underline"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}>
              Voir les résultats
            </a>
          </div>
        </div>

        {/* Carte de synthèse (chiffres réels) */}
        <div className="vc-card p-5 sm:p-6" aria-live="polite">
          <div className="flex items-center justify-between">
            <div className="vc-kicker">Résultat de référence</div>
            {kpi && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{kpi.repetitions} répétitions</div>}
          </div>
          {kpi && m ? (
            <>
              <div className="mt-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{m.nom}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Seuil réglé sur la validation pour un rappel cible de {nf(kpi.cible_rappel, 2)} · mesures sur le test
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-px rounded-lg overflow-hidden" style={{ background: 'var(--border)' }}>
                {[
                  ['Rappel', pct(m.recall)],
                  ['Fausses alertes / h', nf(m.fausses_alarmes_par_heure, 1)],
                  ['Délai médian', m.delai_median_min == null ? '—' : `${nf(m.delai_median_min, 1)} min`],
                  ['Épisodes détectés', `${nf(m.episodes_detectes)} / ${nf(m.episodes)}`],
                ].map(([k, v]) => (
                  <div key={k} className="p-3.5" style={{ background: 'var(--bg-card)' }}>
                    <dt className="text-xs" style={{ color: 'var(--text-secondary)' }}>{k}</dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Priorité au rappel : ne rater aucune attaque coûte des fausses alertes (précision {pct(m.precision)}).
              </p>
            </>
          ) : (
            <div className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {failed ? 'Résultats de référence indisponibles pour le moment.' : 'Chargement des résultats…'}
            </div>
          )}
        </div>
      </section>

      {/* ── Résultats ───────────────────────────────────────────────────── */}
      <section id="resultats" className="py-14 sm:py-20" style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionHead kicker="Résultats" title="Ce que détecte le modèle, scénario par scénario">
            {kpi
              ? <>Sur {nf(kpi.traces.mesures)} mesures réelles ({nf(kpi.traces.heures, 1)} h au pas de {kpi.traces.pas}, du {day(kpi.traces.debut)} au {day(kpi.traces.fin)}), {kpi.scenarios} scénarios d’attaque ont été injectés sur les capteurs {kpi.capteurs.map(c => SENSOR_FR[c] ?? c).join(', ')}.</>
              : 'Les chiffres sont lus dans les résultats de référence au chargement de la page.'}
          </SectionHead>
          {kpi ? (
            <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
              <div className="vc-card p-5">
                <ul className="space-y-4">
                  {kpi.detection_par_scenario.map(s => {
                    const tone = s.taux >= 80 ? 'var(--accent-success)' : s.taux >= 40 ? 'var(--accent-warning)' : 'var(--accent-danger)';
                    const Icon = s.taux >= 80 ? CheckCircle2 : s.taux >= 40 ? MinusCircle : XCircle;
                    return (
                      <li key={s.scenario}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="inline-flex items-center gap-1.5 min-w-0 font-medium" style={{ color: 'var(--text-primary)' }}>
                            <Icon className="w-4 h-4 shrink-0" style={{ color: tone }} />
                            <span className="truncate">{SCENARIO_FR[s.scenario] ?? s.scenario}</span>
                          </span>
                          <span className="tabular-nums font-semibold whitespace-nowrap shrink-0">{nf(s.taux, 1)} %</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                          <div className="h-full rounded-full" style={{ width: `${s.taux}%`, background: tone }} />
                        </div>
                        <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{s.description}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="space-y-6">
                <div className="vc-card p-5">
                  <div className="vc-kicker">Modèles comparés (F1 au seuil max-F1, test)</div>
                  <ul className="mt-4 space-y-3">
                    {kpi.modeles.map(md => (
                      <li key={md.id}>
                        <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-primary)' }}>{md.nom}</span><span className="tabular-nums font-medium">{nf(md.f1, 3)}</span></div>
                        <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                          <div className="h-full rounded-full" style={{ width: `${md.f1 * 100}%`, background: md.id === m?.id ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="vc-card p-5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  <div className="vc-kicker mb-2">Lecture</div>
                  {(() => {
                    const sc = [...kpi.detection_par_scenario].sort((a, b) => b.taux - a.taux);
                    if (!sc.length) return null;
                    const top = sc[0]; const low = sc[sc.length - 1];
                    return <>Le scénario le mieux détecté est « {SCENARIO_FR[top.scenario] ?? top.scenario} » ({nf(top.taux, 1)} %) ;
                      le plus difficile est « {SCENARIO_FR[low.scenario] ?? low.scenario} » ({nf(low.taux, 1)} %), dont l’écart reste proche
                      des variations naturelles du capteur.</>;
                  })()}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Démarche ────────────────────────────────────────────────────── */}
      <section id="demarche" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <SectionHead kicker="Démarche" title="De la donnée brute à la plateforme déployée">
          De la collecte des données des capteurs jusqu’au déploiement : la démarche complète menée pour protéger
          le stock, la production et la logistique des produits pharmaceutiques.
        </SectionHead>
        <ol className="grid md:grid-cols-3 gap-5">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="vc-card p-6">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)' }}><Icon className="w-[18px] h-[18px]" /></span>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>Étape {i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold" style={{ color: 'var(--text-primary)' }}>{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{s.desc}</p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── Zones ───────────────────────────────────────────────────────── */}
      <section id="zones" className="py-14 sm:py-20" style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionHead kicker="Zones surveillées" title="Trois capteurs, une chaîne complète">
            Météo → stock → production : chaque capteur couvre un maillon de la chaîne des produits pharmaceutiques.
          </SectionHead>
          <div className="grid md:grid-cols-3 gap-5">
            {ZONES.map((z) => {
              const Icon = z.icon;
              return (
                <div key={z.title} className="rounded-xl p-6 border" style={{ borderColor: 'var(--border)', background: 'var(--bg-base)' }}>
                  <Icon className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
                  <h3 className="mt-4 font-semibold" style={{ color: 'var(--text-primary)' }}>{z.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{z.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Technologies ────────────────────────────────────────────────── */}
      <section id="technologies" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <SectionHead kicker="Technologies" title="Pile technique" />
        <ul className="flex flex-wrap gap-2">
          {TECH.map(t => (
            <li key={t} className="px-3 py-1.5 rounded-md text-sm border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>{t}</li>
          ))}
        </ul>
        <div className="mt-14 vc-card p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Explorer le tableau de bord</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Entraînements enregistrés, comparaison des modèles, explications SHAP et rapport opérateur.</p>
          </div>
          <Link to={ctaTo} className="h-11 px-5 inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold no-underline shrink-0"
            style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}>
            {user ? 'Ouvrir le tableau de bord' : 'Se connecter'} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row gap-2 justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>VigiloChain — détection d’intrusions IoT pour la chaîne du froid pharmaceutique</span>
          <span>Projet de fin d’études{kpi ? ` · résultats générés le ${day(kpi.generated_at)}` : ''}</span>
        </div>
      </footer>
    </div>
  );
}
