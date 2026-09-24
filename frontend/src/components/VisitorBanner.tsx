export default function VisitorBanner() {
  return (
    <div className="flex items-center gap-4 bg-gradient-to-r from-accent-cyan/[0.08] to-accent-green/[0.08] border border-border-panel rounded-2xl px-6 py-5 animate-slide-up" style={{ animationDelay: '0.1s' }}>
      <div className="w-[60px] h-[60px] rounded-xl bg-white/5 flex items-center justify-center text-3xl shrink-0">
        🤖
      </div>
      <div>
        <h4 className="font-display font-bold text-base text-accent-cyan mb-1">
          Qu'est-ce que vous regardez ?
        </h4>
        <p className="text-text-secondary text-xs leading-relaxed">
          Ce dashboard représente un <strong className="text-text-primary">"Jumeau Numérique"</strong>. Une Intelligence Artificielle (One-Class SVM) surveille notre usine industrielle physique.
          Elle analyse chaque signal et lève immédiatement la main (alerte rouge) si un pirate ou un dysfonctionnement perturbe les capteurs.
        </p>
      </div>
    </div>
  );
}
