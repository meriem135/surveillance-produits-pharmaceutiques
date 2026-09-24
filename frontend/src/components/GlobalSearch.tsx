import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, ShieldAlert, Cpu, Brain, X } from 'lucide-react';
import { authHeaders } from '../lib/auth';
import type { GlobalSearchResponse } from '../types';

const API = '/api/v1';

const GROUP_ICONS: Record<string, React.ReactNode> = {
  alerts: <ShieldAlert className="w-3.5 h-3.5" />,
  devices: <Cpu className="w-3.5 h-3.5" />,
  models: <Brain className="w-3.5 h-3.5" />,
};

const GROUP_COLORS: Record<string, string> = {
  alerts: '#FF2D78',
  devices: '#38BDF8',
  models: '#00FFA3',
};

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GlobalSearchResponse | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (query: string) => {
    if (query.trim().length < 2) { setData(null); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API}/advanced-analytics/global-search?q=${encodeURIComponent(query.trim())}&limit=7`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) return;
    debounceRef.current = setTimeout(() => run(q), 260);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, run]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const go = useCallback((href?: string) => {
    if (href) navigate(href);
    setOpen(false);
    setQ('');
    setData(null);
  }, [navigate]);

  const grouped = data?.groups.filter(g => g.items.length > 0) ?? [];
  const total = data?.total ?? 0;

  return (
    <div ref={wrapRef} className="relative hidden md:block" style={{ width: 260 }}>
      <div className="flex items-center gap-2 rounded-lg px-3 h-8"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {loading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: 'var(--accent-primary)' }} />
          : <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />}
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); if (e.target.value.trim().length < 2) { setData(null); setLoading(false); } setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Recherche globale… ( / )"
          className="w-full bg-transparent outline-none text-xs"
          style={{ color: 'var(--text-primary)' }}
        />
        {q && (
          <button onClick={() => { setQ(''); setData(null); inputRef.current?.focus(); }} className="shrink-0">
            <X className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute top-11 right-0 z-50 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1"
          style={{ width: 380, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
          <div className="px-4 py-2.5 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              {loading ? 'Recherche en cours…' : `${total} résultat${total === 1 ? '' : 's'} pour « ${data?.query ?? q} »`}
            </span>
          </div>

          {loading && !data ? (
            <div className="px-4 py-10 flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Recherche transverse…</span>
            </div>
          ) : grouped.length === 0 ? (
            data && (
              <div className="px-4 py-8 text-center">
                <Search className="w-6 h-6 mx-auto mb-2 opacity-40" style={{ color: 'var(--text-secondary)' }} />
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Aucun résultat pour « {data.query} »
                </div>
              </div>
            )
          ) : (
            <div className="max-h-80 overflow-y-auto scrollbar-thin">
              {grouped.map(g => (
                <div key={g.key}>
                  <div className="px-4 py-1.5 flex items-center gap-1.5"
                    style={{ background: 'color-mix(in srgb, var(--border) 40%, transparent)' }}>
                    <span style={{ color: GROUP_COLORS[g.key] }}>{GROUP_ICONS[g.key]}</span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      {g.label} · {g.items.length}
                    </span>
                  </div>
                  {g.items.map(item => (
                    <button
                      key={item.key}
                      onClick={() => go(item.href)}
                      className="w-full text-left px-4 py-2 hover:bg-white/5 transition-colors flex items-start gap-2.5 border-t"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{
                        background: item.status ?? (item.level !== undefined && item.level >= 10 ? '#FF2D78' : GROUP_COLORS[g.key]),
                      }} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.title}</span>
                        <span className="block text-[10px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{item.subtitle}</span>
                      </span>
                      {item.meta && (
                        <span className="shrink-0 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{item.meta}</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}