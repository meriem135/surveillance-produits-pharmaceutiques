/** Logo VigiloChain : un thermomètre d'enregistreur dont la plage 2–8 °C est marquée en bleu froid. */
export default function BandMark({ size = 28, inverted = false }: { size?: number; inverted?: boolean }) {
  const ink = inverted ? 'var(--bg-panel)' : 'var(--text-primary)';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false" className="shrink-0">
      <rect x="10.5" y="3" width="11" height="26" rx="5.5" fill="none" stroke={ink} strokeWidth="2" />
      <rect x="11.5" y="12" width="9" height="8.5" fill="var(--accent-primary)" />
      <path d="M23.5 12h5M23.5 20.5h5" stroke="var(--accent-primary)" strokeWidth="2" />
      <path d="M4 8h4M5.5 16h2.5M4 24h4" stroke={ink} strokeWidth="1.5" opacity="0.55" />
    </svg>
  );
}

export function Wordmark({ sub }: { sub?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <BandMark />
      <span className="leading-none text-left">
        <span className="block text-[22px] font-semibold" style={{ fontFamily: 'var(--display)', color: 'var(--text-primary)' }}>VigiloChain</span>
        {sub && <span className="block text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
      </span>
    </span>
  );
}
