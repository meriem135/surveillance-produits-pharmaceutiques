/**
 * Briques communes aux pages de l'étude (Jeu de données, Résultats, SHAP, Détection vs réalité,
 * Temps réel, Entraînement) : mise en page, formatage français, lecture de l'API, libellés.
 * Les chiffres viennent tous de l'API /api/v1/etude/*, qui ne lit que la base de données.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Database, Info, RefreshCw } from 'lucide-react';
import { authHeaders } from '../../lib/auth';
import { useTheme } from '../../contexts/ThemeContext';

// ─── Formatage ───────────────────────────────────────────────────────────────
export const nf = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${nf(v * 100, d)} %`);
export const minutes = (v: number | null | undefined) => (v == null ? '—' : `${nf(v, 1)} min`);
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
  MITM_gel: 'MITM · gel du frigo', MITM_rejeu: 'MITM · rejeu du frigo', Injection_nominale: 'Injection · valeurs nominales',
  'Injection_biais_0.5': 'Injection · biais −0,5 °C', 'Injection_biais_1.0': 'Injection · biais −1 °C',
  'Injection_biais_2.0': 'Injection · biais −2 °C', Injection_derive: 'Injection · dérive lente',
  MITM_gel_thermostat: 'MITM · gel du thermostat', Injection_biais_thermostat: 'Injection · biais thermostat',
  normal: 'Normal',
};
export const ROLE_FR: Record<string, string> = { train: 'Entraînement', val: 'Validation', test: 'Test' };
export const MODEL_FR: Record<string, string> = {
  RandomForest: 'Random Forest', ExtraTrees: 'Extra Trees', XGBoost: 'XGBoost', HistGB: 'HistGradientBoosting',
  Logistique: 'Régression Logistique', MLP: 'MLP', RF_v1: 'Random Forest, anciennes features (avant)',
};

/** Palette catégorielle (clair / sombre) : bleu, orange, vert, violet, rose, gris. */
export function usePalette() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  return {
    dark,
    series: dark ? ['#3987e5', '#d95926', '#199e70', '#9a7ff0', '#e0609b', '#8d99ab']
      : ['#2a78d6', '#eb6834', '#1baf7a', '#7b5bd6', '#c8457f', '#6b7789'],
    grid: dark ? '#22304a' : '#e3e8ef',
    axis: dark ? '#9daabd' : '#4f5d73',
    attack: dark ? 'rgba(240,106,106,0.20)' : 'rgba(220,38,38,0.12)',
    alert: dark ? '#e9a93a' : '#b45309',
    ok: dark ? '#34c26b' : '#15803d',
    danger: dark ? '#f06a6a' : '#dc2626',
  };
}

export const tooltipStyle = {
  contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-primary)' },
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
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h1>
        {subtitle && <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {children}
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </button>
        )}
      </div>
    </div>
  );
}

export function Section({ title, subtitle, source, action, children, className = '' }: {
  title: string; subtitle?: ReactNode; source?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`vc-card overflow-hidden min-w-0 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 sm:px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
      {source && (
        <div className="px-4 sm:px-5 py-2 text-[11px] flex items-center gap-1.5" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
          <Database className="w-3 h-3 shrink-0" /> <span className="truncate">Source : <code className="font-mono">{source}</code></span>
        </div>
      )}
    </section>
  );
}

export function Stat({ icon, label, value, sub, tone }: { icon?: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="vc-card p-4 min-w-0">
      <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {icon && (
          <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{ background: 'var(--bg-subtle)', color: tone ?? 'var(--accent-primary)', border: '1px solid var(--border)' }}>{icon}</span>
        )}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-3 text-[24px] leading-none font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div className="mt-2 text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg p-4 text-sm" style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: '1px dashed var(--border-strong)' }}>
      <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
      <div>{children}</div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed mt-3" style={{ color: 'var(--text-muted)' }}>{children}</p>;
}

export function Meter({ value, color = 'var(--accent-primary)' }: { value: number | null; color?: string }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden w-full" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} />
    </div>
  );
}

export function Pill({ children, tone = 'var(--accent-primary)' }: { children: ReactNode; tone?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color: tone, border: `1px solid color-mix(in srgb, ${tone} 40%, transparent)`, background: `color-mix(in srgb, ${tone} 10%, transparent)` }}>
      {children}
    </span>
  );
}

/** Tableau défilant horizontalement sur téléphone. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="vc-table w-full text-sm min-w-[560px]">{children}</table>
    </div>
  );
}

export function Loading() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map(i => <div key={i} className="vc-card h-28 animate-pulse" />)}
    </div>
  );
}
