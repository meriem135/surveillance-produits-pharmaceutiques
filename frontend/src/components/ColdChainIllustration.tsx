/**
 * Illustration du projet (industrie 4.0) : les mesures de la chambre froide passent par
 * VigiloChain, qui les déclare « vraies » ou « falsifiées ».
 * SVG en ligne : suit le thème clair / sombre grâce aux variables CSS.
 */
export default function ColdChainIllustration({ className = '' }: { className?: string }) {
  const carte = { fill: 'var(--bg-subtle)', stroke: 'var(--border-strong)', strokeWidth: 2.5 };
  const texte = { fontSize: 14, fontWeight: 700, textAnchor: 'middle' as const, fill: 'var(--text-primary)' };
  return (
    <svg viewBox="0 0 600 300" role="img" className={className}
      aria-label="Les mesures de la chambre froide passent par VigiloChain, qui indique si elles sont vraies ou falsifiées">
      <defs>
        <marker id="vc-fleche" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--text-muted)" />
        </marker>
      </defs>
      <rect x="1" y="1" width="598" height="298" rx="20" fill="var(--bg-panel)" stroke="var(--border)" strokeWidth="2" />

      {/* flèches */}
      <g fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" markerEnd="url(#vc-fleche)">
        <path d="M176 150 L272 150" />
        <path d="M372 136 L418 98" />
        <path d="M372 164 L418 202" />
      </g>

      {/* source 1 : chambre froide */}
      <rect x="24" y="105" width="150" height="90" rx="12" {...carte} />
      <g transform="translate(99 139)" stroke="var(--accent-primary)" strokeWidth="4" strokeLinecap="round">
        <line x1="0" y1="-18" x2="0" y2="18" />
        <line x1="-16" y1="-9" x2="16" y2="9" />
        <line x1="-16" y1="9" x2="16" y2="-9" />
      </g>
      <text x="99" y="181" {...texte}>Chambre froide</text>

      {/* VigiloChain */}
      <g transform="translate(322 150) scale(0.95)">
        <path d="M0 -54 L46 -39 V8 C46 34 21 51 0 60 C-21 51 -46 34 -46 8 V-39 Z" fill="var(--accent-primary)" />
        <path d="M-19 4 l13 14 l27 -31" fill="none" stroke="var(--accent-primary-fg)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x="322" y="236" {...texte}>VigiloChain</text>

      {/* résultat */}
      <rect x="420" y="70" width="156" height="44" rx="10" fill="var(--accent-glow)" stroke="var(--accent-primary)" strokeWidth="2" />
      <text x="498" y="98" {...texte} fill="var(--accent-primary)">✓ Mesure vraie</text>
      <rect x="420" y="186" width="156" height="44" rx="10" fill="none" stroke="var(--accent-danger)" strokeWidth="2" />
      <text x="498" y="214" {...texte} fill="var(--accent-danger)">⚠ Falsifiée : alerte</text>
    </svg>
  );
}
