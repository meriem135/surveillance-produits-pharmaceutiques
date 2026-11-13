/** Recommandations par alerte, déduites du SHAP de CETTE alerte (transmission_alert_shap).
 *  Le modèle répond seulement « attaque » ou « normal » : la famille ci-dessous est une ESTIMATION fondée sur les
 *  features qui ont poussé l'alerte, pas une sortie du modèle. Elle est validée sur les attaques injectées (voir
 *  la comparaison « famille estimée / scénario réel » affichée dans la page). */

export interface Contribution { feature: string; libelle: string; shap: number; valeur: number | null; valeur_normale: number | null }

export type Famille = 'fige' | 'rejeu' | 'niveau' | 'indetermine';

export const FAMILLE_FR: Record<Famille, string> = {
  fige: 'Signal figé ou trop régulier',
  rejeu: 'Séquence rejouée',
  niveau: 'Décalage ou dérive de niveau',
  indetermine: 'Indéterminé',
};

/** Scénarios injectés → famille attendue (sert à vérifier l'estimation, jamais à la produire). */
export const FAMILLE_REELLE: Record<string, Famille> = {
  MITM_gel: 'fige', MITM_gel_thermostat: 'fige', MITM_rejeu: 'rejeu',
  Injection_nominale: 'fige', 'Injection_biais_0.5': 'niveau', 'Injection_biais_1.0': 'niveau',
  'Injection_biais_2.0': 'niveau', Injection_derive: 'niveau', Injection_biais_thermostat: 'niveau',
};

/** Famille d'une feature d'après son nom (ex. fridge_std_5min, fridge_repeat_2min, fridge_q90_15min). */
export function familleDe(feature: string): Famille {
  if (feature.endsWith('repeat_2min')) return 'rejeu';
  if (/_(std|absdiff)_|_diff_1$/.test(feature)) return 'fige';
  if (/_(mean|min|max|q10|q90)_|_temp$|_diff$|_diff_mean_15min$/.test(feature)) return 'niveau';
  return 'indetermine';
}

export interface Estimation { famille: Famille; confiance: number }

/** Part de l'effet SHAP positif portée par chaque famille ; la famille dominante est retenue si elle pèse au
 *  moins 50 % et si l'effet total est non nul, sinon « indéterminé » (on ne force pas une réponse). */
export function estimer(expl: Contribution[]): Estimation {
  // Règle prioritaire : un écart-type (ou une variation) tombé à moins de 25 % de sa valeur normale est la signature
  // d'un signal figé. Un gel fait aussi baisser la moyenne ; sans cette règle, les features de « niveau » l'emportent
  // à tort. Seuil choisi sur un plateau (0,2 à 0,3 donnent le même résultat) ; confiance = écart à la normale.
  // Règle prioritaire : « séquence de 2 min déjà transmise » active pendant l'alerte (elle vaut 0 en fonctionnement
  // normal) avec un effet SHAP positif = rejeu. Un rejeu copie des valeurs normales : les autres features ne se
  // distinguent presque pas, et le vote pondéré ci-dessous peut donner « niveau » ou « indéterminé » à tort.
  const rejeu = expl.find(c => c.shap > 0 && c.feature.endsWith('repeat_2min') && c.valeur != null
    && c.valeur_normale != null && c.valeur > c.valeur_normale);
  if (rejeu) return { famille: 'rejeu', confiance: Math.min(1, 1 - (rejeu.valeur_normale as number) / (rejeu.valeur as number)) };
  const fige = expl.find(c => c.shap > 0 && /_(std|absdiff)_/.test(c.feature) && c.valeur != null
    && c.valeur_normale != null && c.valeur_normale > 0 && c.valeur <= 0.25 * c.valeur_normale);
  if (fige) return { famille: 'fige', confiance: Math.min(1, 1 - (fige.valeur as number) / (fige.valeur_normale as number)) };
  const poids: Record<Famille, number> = { fige: 0, rejeu: 0, niveau: 0, indetermine: 0 };
  for (const c of expl) if (c.shap > 0) poids[familleDe(c.feature)] += c.shap;
  const total = poids.fige + poids.rejeu + poids.niveau;
  if (total <= 0) return { famille: 'indetermine', confiance: 0 };
  const [famille, p] = (['fige', 'rejeu', 'niveau'] as const).map(f => [f, poids[f]] as const).sort((a, b) => b[1] - a[1])[0];
  const confiance = p / total;
  return confiance >= 0.5 ? { famille, confiance } : { famille: 'indetermine', confiance };
}

const SPECIFIQUES: Record<Famille, string[]> = {
  fige: ['Vérifier que le capteur et la liaison ne sont pas bloqués (valeur gelée ou trop régulière).',
    'Comparer avec le second capteur : un écart qui grandit confirme un capteur figé.'],
  rejeu: ['Vérifier l’intégrité de la liaison capteur → passerelle (données répétées).',
    'Contrôler l’horodatage des mesures reçues : une séquence déjà transmise peut être rejouée.'],
  niveau: ['Vérifier l’étalonnage du capteur et le groupe froid (décalage ou dérive de la valeur).',
    'Chercher une cause réelle (porte ouverte, panne de froid) avant de conclure à une falsification.'],
  indetermine: ['Cause non identifiable avec le SHAP de cette alerte : appliquer les contrôles immédiats et le suivi.'],
};

export interface Etape { niveau: 'Immédiat' | 'Vérification' | 'Suivi'; items: string[] }
export interface Rapport {
  gravite: 'Élevée' | 'Moyenne' | 'À vérifier';
  synthese: string;
  hypothese: string;
  etapes: Etape[];
}

export interface AlerteRapport {
  vraie: boolean; duree_min: number; score_max: number; capteur?: string | null; explication?: Contribution[];
}
export interface Format { date: string; duree: string; nf: (v: number | null | undefined, d?: number) => string; pct: (v: number, d?: number) => string }

const CAPTEUR_FR: Record<string, string> = { fridge: 'frigo', thermostat: 'thermostat', weather: 'météo' };

/** Capteur concerné : celui annoncé par l'épisode injecté, sinon celui de la feature la plus déterminante. */
export function capteurDe(a: AlerteRapport): string {
  const brut = a.capteur ?? (a.explication?.[0]?.feature.split('_')[0] ?? '');
  return CAPTEUR_FR[brut] ?? 'capteur concerné';
}

/** Gravité, calculée uniquement avec ce que l'opérateur connaît au moment de l'alerte (durée et score) : elle
 *  ne dépend PAS de l'étiquette vraie/fausse, qui n'existe que parce que les attaques sont injectées dans l'étude.
 *  Élevée : alerte longue (≥ 15 min) ou score très élevé (≥ 0,95). À vérifier : alerte courte (< 5 min) et score peu
 *  sûr (< 0,80), donc plus probablement une fausse alerte. Moyenne : le reste. Seuils de conception, à ajuster. */
export const GRAVITE_SEUILS = { dureeElevee: 15, scoreEleve: 0.95, dureeCourte: 5, scoreFaible: 0.8 };
export function graviteDe(a: AlerteRapport): Rapport['gravite'] {
  const s = GRAVITE_SEUILS;
  if (a.duree_min >= s.dureeElevee || a.score_max >= s.scoreEleve) return 'Élevée';
  if (a.duree_min < s.dureeCourte && a.score_max < s.scoreFaible) return 'À vérifier';
  return 'Moyenne';
}

/** Rapport rédigé d'une alerte, à partir de ses faits mesurés (durée, score, SHAP) : synthèse, hypothèse
 *  (famille estimée, jamais une certitude) et actions classées par priorité. */
export function rapportAlerte(a: AlerteRapport, f: Format): Rapport {
  const expl = a.explication ?? [];
  const est = estimer(expl);
  const cap = capteurDe(a);
  const c1 = expl[0];
  let synthese = `Le ${f.date}, pendant ${f.duree}, le modèle a signalé une anomalie sur le ${cap} (score maximal ${f.nf(a.score_max, 2)}).`;
  if (c1 && c1.valeur != null && c1.valeur_normale != null)
    synthese += ` Signal le plus déterminant : ${c1.libelle} valait ${f.nf(c1.valeur, 2)} contre ${f.nf(c1.valeur_normale, 2)} en fonctionnement normal.`;
  if (!a.vraie) {
    return { gravite: 'À vérifier', synthese: synthese + ' Aucune mesure falsifiée pendant cette alerte : probable fausse alerte.',
      hypothese: 'Fausse alerte probable : un comportement inhabituel du signal sans manipulation.',
      etapes: [{ niveau: 'Vérification', items: ['Contrôler la température avec un thermomètre de référence avant toute mesure sur les produits.'] },
        { niveau: 'Suivi', items: ['Si la température est conforme, consigner une fausse alerte pour ajuster le seuil.'] }] };
  }
  const hypothese = est.famille === 'indetermine'
    ? 'Cause non identifiable avec le SHAP de cette alerte (hypothèse non retenue : aucune famille ne domine).'
    : `Hypothèse : ${FAMILLE_FR[est.famille].toLowerCase()} (confiance ${f.pct(est.confiance, 0)}). Estimation d’après les features, à confirmer sur le terrain.`;
  return {
    gravite: graviteDe(a), synthese, hypothese,
    etapes: [
      { niveau: 'Immédiat', items: ['Mettre les produits concernés en quarantaine jusqu’à la vérification.',
        `Contrôler la température avec un thermomètre de référence, sans se fier au ${cap}.`] },
      { niveau: 'Vérification', items: SPECIFIQUES[est.famille] },
      { niveau: 'Suivi', items: ['Consigner l’incident et prévenir le responsable qualité.'] },
    ],
  };
}
