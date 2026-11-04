/**
 * Briques communes aux pages de la plateforme (Jeu de données, Résultats, SHAP, Détection vs réalité,
 * Temps réel, Entraînement…) : mise en page, formatage français, lecture de l'API, libellés.
 * Les chiffres viennent tous de l'API, qui ne lit que la base de données.
 *
 * Langage visuel (voir index.css) : panneaux gris calmes ; bleu froid = conforme / détecté,
 * ambre = alerte levée, rouge = attaque réelle ou détection manquée.
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, Database, Info, RefreshCw, Square, XOctagon } from 'lucide-react';
import { authHeaders } from '../../lib/auth';
import { useTheme } from '../../contexts/ThemeContext';

// ─── Formatage ───────────────────────────────────────────────────────────────
export const nf = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${nf(v * 100, d)}\u202f%`);
export const minutes = (v: number | null | undefined) => (v == null ? '—' : `${nf(v, 1)}\u00a0min`);
export const dateFr = (iso: string | null | undefined, withTime = true) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

// ─── Libellés ────────────────────────────────────────────────────────────────
export const SCENARIO_FR: Record<string, string> = {
  MITM_gel: 'Gel du frigo (MITM)', MITM_rejeu: 'Rejeu du frigo (MITM)', Injection_nominale: 'Valeurs nominales injectées',
  'Injection_biais_0.5': 'Biais de −0,5 °C injecté', 'Injection_biais_1.0': 'Biais de −1 °C injecté',
  'Injection_biais_2.0': 'Biais de −2 °C injecté', Injection_derive: 'Dérive lente injectée',
  MITM_gel_thermostat: 'Gel du thermostat (MITM)', Injection_biais_thermostat: 'Biais injecté au thermostat',
  normal: 'Normal',
};
export const ROLE_FR: Record<string, string> = { train: 'Entraînement', val: 'Validation', test: 'Test' };
export const MODEL_FR: Record<string, string> = {
  RandomForest: 'Random Forest', ExtraTrees: 'Extra Trees', XGBoost: 'XGBoost', HistGB: 'HistGradientBoosting',
  Logistique: 'Régression Logistique', MLP: 'MLP', RF_v1: 'Random Forest, anciennes features (avant)',
};

/**
 * Couleurs des graphiques. Discipline « salle de contrôle » : la série principale en bleu froid,
 * les séries de comparaison en gris d'encre ; ambre = alerte, rouge = attaque réelle.
 */
export function usePalette() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  return {
    dark,
    series: dark ? ['#7AAEE8', '#C9D0D6', '#8D97A0', '#B9A4E0', '#D59BB8', '#6F7A84']
      : ['#1F5FA6', '#3A444D', '#8A949D', '#6B5BA6', '#9A4F74', '#B0B7BD'],
    ink: dark ? '#E4E8EB' : '#1A2026',
    grid: dark ? '#38424A' : '#D5DADE',
    axis: dark ? '#AEB7BF' : '#46515B',
    attack: dark ? 'rgba(242,133,122,0.26)' : 'rgba(179,38,30,0.15)',
    attackLine: dark ? '#F2857A' : '#B3261E',
    alert: dark ? '#E0A23A' : '#E39A1C',
    ok: dark ? '#7AAEE8' : '#1F5FA6',
    danger: dark ? '#F2857A' : '#B3261E',
  };
}

export const tooltipStyle = {
  contentStyle: { background: 'var(--bg-panel)', border: '1px solid var(--border-strong)', borderRadius: 3, fontSize: 12.5, color: 'var(--text-primary)' },
  labelStyle: { color: 'var(--text-secondary)' },
};

// ─── Lecture de l'API ────────────────────────────────────────────────────────
export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(url, { headers: authHeaders() });
      if (!r.ok) {
        let detail = `HTTP ${r.status}`;
        try { detail = (await r.json()).detail ?? detail; } catch { /* corps vide */ }
        throw new Error(detail);
      }
      setData(await r.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

// ─── Mise en page ────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, onRefresh, loading, children }: {
  title: string; subtitle?: ReactNode; onRefresh?: () => void; loading?: boolean; children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-1">
      <div className="min-w-0">
        <h1 className="text-[30px] sm:text-[34px] leading-[1.05]" style={{ color: 'var(--text-primary)' }}>{title}</h1>
        {subtitle && <p className="text-[15px] mt-2 max-w-[68ch] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading} className="vc-btn">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </button>
        )}
      </div>
    </header>
  );
}

/** Panneau à en-tête. `source` : la table interrogée, affichée comme une ligne de traçabilité. */
export function Section({ title, subtitle, source, action, children, className = '', flush = false }: {
  title: string; subtitle?: ReactNode; source?: string; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <section className={`vc-panel overflow-hidden min-w-0 ${className}`}>
      <div className="vc-panel-head flex flex-wrap items-start justify-between gap-3 px-4 sm:px-5 pt-3.5 pb-3">
        <div className="min-w-0">
          <h2 className="text-[20px] leading-tight" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          {subtitle && <p className="text-[13.5px] mt-1 max-w-[100ch]" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className={flush ? '' : 'p-4 sm:p-5'}>{children}</div>
      {source && <SourceLine source={source} />}
    </section>
  );
}

export function SourceLine({ source }: { source: string }) {
  return (
    <div className="vc-panel-foot px-4 sm:px-5 py-2 flex items-start gap-1.5">
      <Database className="w-3 h-3 shrink-0 mt-[3px]" aria-hidden />
      <span className="min-w-0 break-words"><span className="whitespace-nowrap mr-1.5">Lu en base&nbsp;:</span><code>{source}</code></span>
    </div>
  );
}

/** Rangée de lectures chiffrées, séparées par des traits (pas des cartes). */
export function Readouts({ children, cols = 4, className = '' }: { children: ReactNode; cols?: 3 | 4 | 5; className?: string }) {
  const c = cols === 5 ? 'lg:grid-cols-5' : cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4';
  return <div className={`vc-readouts grid-cols-2 ${c} ${className}`}>{children}</div>;
}

/** Une lecture : libellé, valeur en chiffres d'instrument, note. `tone` colore le repère carré
 *  à gauche du libellé (bleu = conforme, ambre = alerte, rouge = attaque). */
export function Stat({ label, value, unit, sub, tone, alarm }: {
  icon?: ReactNode; label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: string; alarm?: boolean;
}) {
  return (
    <div style={alarm ? { background: 'color-mix(in srgb, var(--accent-danger) 9%, var(--bg-panel))' } : undefined}>
      <div className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        {tone && <span className="w-2 h-2 shrink-0" style={{ background: tone }} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2.5 vc-readout-value" style={alarm ? { color: 'var(--accent-danger)' } : undefined}>
        {value}{unit && <span className="vc-readout-unit">{unit}</span>}
      </div>
      {sub && <div className="mt-2 text-[12.5px] leading-snug" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[3px] p-4 text-sm" style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: '1px dashed var(--border-strong)' }}>
      <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
      <div>{children}</div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed mt-3 max-w-[90ch]" style={{ color: 'var(--text-muted)' }}>{children}</p>;
}

export function Meter({ value, color = 'var(--accent-primary)' }: { value: number | null; color?: string }) {
  return (
    <div className="vc-meter w-full" role="presentation">
      <span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} />
    </div>
  );
}

/** État lisible sans la couleur : forme + mot. */
export type StateKind = 'ok' | 'alerte' | 'manque' | 'neutre';
export function State({ kind, children }: { kind: StateKind; children: ReactNode }) {
  const map = {
    ok: { c: 'var(--accent-primary)', I: Square, fill: true },
    alerte: { c: 'var(--accent-warning)', I: AlertTriangle, fill: false },
    manque: { c: 'var(--accent-danger)', I: XOctagon, fill: false },
    neutre: { c: 'var(--text-secondary)', I: Square, fill: false },
  }[kind];
  const I = map.I;
  return (
    <span className="vc-state" style={{ color: map.c }}>
      <I className="w-3.5 h-3.5 shrink-0" fill={map.fill ? 'currentColor' : 'none'} aria-hidden />{children}
    </span>
  );
}

/** Ancienne pastille : conservée pour les pages qui l'utilisent, rendue comme un état. */
export function Pill({ children, tone = 'var(--accent-primary)' }: { children: ReactNode; tone?: string }) {
  const kind: StateKind = tone.includes('danger') ? 'manque' : tone.includes('warning') ? 'alerte' : tone.includes('success') || tone.includes('primary') ? 'ok' : 'neutre';
  return <State kind={kind}>{children}</State>;
}

/** Sélecteur segmenté accessible (aria-pressed). */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="vc-seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/**
 * Registre des épisodes : un repère par épisode d'attaque, plein (bleu froid) s'il a été détecté,
 * hachuré rouge s'il a été manqué. Lecture immédiate de « combien d'attaques sont passées ».
 */
export function Tally({ detected, total, animate = false, label }: { detected: number; total: number; animate?: boolean; label?: string }) {
  const cells = Array.from({ length: Math.max(0, total) }, (_, i) => i < detected);
  return (
    <div className={`vc-tally ${animate ? 'vc-tally-animate' : ''}`} role="img"
      aria-label={label ?? `${detected} épisodes détectés sur ${total}`}>
      {cells.map((ok, i) => (
        <i key={i} data-miss={ok ? undefined : ''} style={animate ? ({ animationDelay: `${Math.min(i * 12, 900)}ms` } as CSSProperties) : undefined} />
      ))}
    </div>
  );
}

export function TallyLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
      <span className="inline-flex items-center gap-1.5"><span className="vc-tally"><i style={{ width: 9, height: 12 }} /></span>épisode détecté</span>
      <span className="inline-flex items-center gap-1.5"><span className="vc-tally"><i data-miss="" style={{ width: 9, height: 12 }} /></span>épisode manqué</span>
    </div>
  );
}

/** Fond « papier d'enregistreur » pour les courbes temporelles. */
export function Paper({ children, height, className = '' }: { children: ReactNode; height: number; className?: string }) {
  return <div className={`vc-paper ${className}`} style={{ height }}>{children}</div>;
}

/** Légende manuelle des bandes (attaque réelle / alerte) au-dessus d'une courbe. */
export function BandLegend({ items }: { items: { label: string; color: string; kind?: 'band' | 'line' | 'dash' }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.kind === 'line' ? <span className="w-4 h-[2px]" style={{ background: it.color }} />
            : it.kind === 'dash' ? <span className="w-4 h-0 border-t-2 border-dashed" style={{ borderColor: it.color }} />
            : <span className="w-3 h-3" style={{ background: it.color }} />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Tableau défilant horizontalement sur téléphone. */
export function Table({ children, min = 560 }: { children: ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="vc-table w-full text-sm" style={{ minWidth: min }}>{children}</table>
    </div>
  );
}

export function Loading() {
  return (
    <div className="vc-readouts grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Chargement">
      {[0, 1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse" />)}
    </div>
  );
}
