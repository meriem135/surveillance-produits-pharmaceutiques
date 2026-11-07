/** Logo VigiloChain : un thermomètre d'enregistreur dont la plage de mesure est marquée en bleu froid. */
export default function BandMark({ size = 28, inverted = false }: { size?: number; inverted?: boolean }) {
  void inverted;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false" className="shrink-0">
      <defs>
        <linearGradient id="vc-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent-primary)" />
          <stop offset="1" stopColor="var(--accent-purple)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#vc-logo-g)" />
      <rect x="12.5" y="7" width="7" height="18" rx="3.5" fill="none" stroke="#fff" strokeWidth="1.8" />
      <rect x="13.7" y="15" width="4.6" height="8" rx="2.3" fill="#fff" />
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
