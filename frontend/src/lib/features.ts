/**
 * Regroupe la liste des variables du modèle (lue en base : transmission_runs.result_json.features)
 * par capteur, par type de calcul et par fenêtre de temps. Aucune valeur n'est inventée : tout vient des noms.
 */
export interface FeatureGroup { label: string; count: number }

const SENSORS = ['fridge', 'thermostat', 'weather'];
const sensorsIn = (name: string) => SENSORS.filter(s => name.includes(s));

export function featureSensor(name: string): string {
  if (sensorsIn(name).length >= 2) return 'Écarts entre capteurs';
  if (name.startsWith('fridge')) return 'Frigo';
  if (name.startsWith('thermo')) return 'Thermostat';
  if (name.startsWith('weather')) return 'Météo';
  return 'Autres';
}

export function featureKind(name: string): string {
  if (sensorsIn(name).length >= 2) return 'Écart entre deux capteurs';
  if (/_cond_enc$|_status$/.test(name)) return "État de l'équipement";
  if (/_temp$/.test(name)) return 'Valeur transmise';
  if (/_diff_1$/.test(name)) return "Variation d'une mesure à l'autre";
  if (/_mean_/.test(name)) return 'Moyenne glissante';
  if (/_std_/.test(name)) return 'Écart-type glissant';
  if (/_absdiff_/.test(name)) return 'Variation absolue moyenne';
  if (/_repeat_/.test(name)) return 'Séquence déjà transmise';
  if (/_(min|max)_/.test(name)) return 'Minimum et maximum';
  if (/_q(10|90)_/.test(name)) return 'Quantiles 10 % et 90 %';
  return 'Autres';
}

export function countBy(names: string[], fn: (n: string) => string): FeatureGroup[] {
  const m = new Map<string, number>();
  names.forEach(n => m.set(fn(n), (m.get(fn(n)) ?? 0) + 1));
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** Fenêtres de calcul (en minutes) présentes dans les noms, par ordre croissant. */
export function featureWindows(names: string[]): number[] {
  const w = new Set<number>();
  names.forEach(n => { const k = n.match(/_(\d+)min$/); if (k) w.add(Number(k[1])); });
  return [...w].sort((a, b) => a - b);
}
