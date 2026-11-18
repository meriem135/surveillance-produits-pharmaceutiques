/** Rapport d'une alerte en pleine page : une feuille A4 organisée en sections (gravité, chiffres clés, analyse,
 *  explication du modèle, plan d'action, validation par l'opérateur). Bouton PDF : ouvre la feuille seule dans une
 *  fenêtre d'impression (choisir « Enregistrer au format PDF »). Les textes viennent de recommandations.ts. */
import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronUp, Download, Gauge, Target, Thermometer, Timer } from 'lucide-react';
import { Meter, dateFr, minutes, nf, pct } from '../../components/etude/kit';
import { FAMILLE_FR, capteurDe, estimer, type AlerteRapport, type Contribution, type Rapport } from './recommandations';

export type AlerteFiche = AlerteRapport & { debut: string; explication?: Contribution[] };

const GRAVITE: Record<Rapport['gravite'], { couleur: string; fond: string; phrase: string }> = {
  'Élevée': { couleur: '#C92A2A', fond: 'rgba(201, 42, 42, 0.10)', phrase: 'Agir tout de suite : mettre les produits en quarantaine puis vérifier.' },
  Moyenne: { couleur: '#D97706', fond: 'rgba(245, 158, 11, 0.14)', phrase: 'À traiter rapidement : vérifier le capteur et les produits.' },
  'À vérifier': { couleur: '#475569', fond: 'rgba(100, 116, 139, 0.12)', phrase: 'Probable fausse alerte : contrôler avant toute action sur les produits.' },
};
const ETAPE: Record<string, string> = { Immédiat: '#C92A2A', Vérification: '#D97706', Suivi: '#3B5BDB' };

export default function RapportAlerte({ rap, al, seuil, onClose }: { rap: Rapport; al: AlerteFiche; seuil: number | null; onClose: () => void }) {
  const feuille = useRef<HTMLDivElement>(null);
  const haut = useRef<HTMLDivElement>(null);
  // Le rapport s'affiche dans la page, sous l'alerte : on le fait défiler dans la vue à l'ouverture.
  useEffect(() => { haut.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);

  const g = GRAVITE[rap.gravite];
  const cap = capteurDe(al);
  const est = estimer(al.explication ?? []);
  const expl = (al.explication ?? []).filter(c => c.shap > 0);
  const maxShap = Math.max(1e-9, ...expl.map(c => c.shap));
  const titre = `Rapport d’alerte du ${dateFr(al.debut)}`;
  const cause = !al.vraie ? 'Fausse alerte probable' : est.famille === 'indetermine' ? 'Non déterminée' : FAMILLE_FR[est.famille];
  const cles = [
    { icone: <Thermometer className="w-5 h-5" />, k: 'Capteur concerné', v: cap },
    { icone: <Timer className="w-5 h-5" />, k: 'Durée de l’alerte', v: minutes(al.duree_min) },
    { icone: <Gauge className="w-5 h-5" />, k: 'Score maximal', v: nf(al.score_max, 2), s: seuil != null ? `seuil d’alerte : ${nf(seuil, 2)}` : undefined },
    { icone: <Target className="w-5 h-5" />, k: 'Cause probable', v: cause },
  ];

  return (
    <div ref={haut} className="sticky left-0 w-full max-w-[920px] py-3 scroll-mt-4" aria-label={titre}>
      {/* Barre d'actions (absente du PDF) */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <button className="vc-btn" onClick={onClose}><ChevronUp className="w-4 h-4" />Masquer le rapport</button>
        <button className="vc-btn vc-btn-primary" onClick={() => exporterPdf(feuille.current, titre)}><Download className="w-4 h-4" />Télécharger en PDF</button>
      </div>

      <div>
        <div ref={feuille} className="vc-report mx-auto max-w-[860px] text-[14px] leading-relaxed"
          style={{ background: '#FFFFFF', color: '#334155', border: '1px solid #E5E9F2', borderRadius: 16, overflow: 'hidden', boxShadow: '0 10px 40px -18px rgba(15,23,42,0.35)' }}>

          {/* Bandeau titre */}
          <header className="px-6 sm:px-8 py-6" style={{ background: '#1E2A5A', color: '#FFFFFF' }}>
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#AFC0FF' }}>VigiloChain · Surveillance de la chaîne du froid</div>
            <h1 className="text-[28px] sm:text-[32px] leading-tight mt-1" style={{ color: '#FFFFFF' }}>Rapport d’alerte</h1>
            <p className="mt-1 text-[15px]" style={{ color: '#D7DEFF' }}>Alerte du {dateFr(al.debut)} · capteur {cap} · statut : terminée après {minutes(al.duree_min)}</p>
          </header>

          {/* Gravité */}
          <div className="px-6 sm:px-8 py-4 flex flex-wrap items-center gap-x-5 gap-y-1" style={{ background: g.fond, borderBottom: `3px solid ${g.couleur}` }}>
            <div className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: '#475569' }}>Gravité</div>
            <div className="text-[26px] font-bold leading-none" style={{ color: g.couleur }}>{rap.gravite}</div>
            <div className="text-[14.5px] font-medium" style={{ color: '#1E293B' }}>{g.phrase}</div>
          </div>

          <div className="px-6 sm:px-8 py-6 space-y-7">
            {/* Chiffres clés */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {cles.map(c => (
                <div key={c.k} className="rounded-[12px] p-3.5" style={{ background: '#F6F8FC', border: '1px solid #E5E9F2' }}>
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#64748B' }}><span style={{ color: '#3B5BDB' }}>{c.icone}</span>{c.k}</div>
                  <div className="text-[19px] font-bold mt-1 leading-tight" style={{ color: '#0F172A' }}>{c.v}</div>
                  {c.s && <div className="text-[12px] mt-0.5" style={{ color: '#64748B' }}>{c.s}</div>}
                </div>
              ))}
            </div>

            {/* Analyse : deux colonnes */}
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="space-y-5">
                <Bloc n={1} titre="Ce qui s’est passé"><p>{rap.synthese}</p></Bloc>
                <Bloc n={2} titre="Cause probable">
                  <p>{rap.hypothese}</p>
                  {al.vraie && est.famille !== 'indetermine' && (
                    <div className="mt-2.5 flex items-center gap-3">
                      <span className="text-[12.5px] shrink-0" style={{ color: '#64748B' }}>Confiance</span>
                      <div className="flex-1"><Meter value={est.confiance * 100} /></div>
                      <span className="tabular-nums text-[13px] font-bold" style={{ color: '#0F172A' }}>{pct(est.confiance, 0)}</span>
                    </div>
                  )}
                </Bloc>
              </div>
              <Bloc n={3} titre="Pourquoi le modèle a alerté">
                {expl.length ? (
                  <>
                    <p className="mb-2 text-[12.5px]" style={{ color: '#64748B' }}>Signaux qui ont le plus pesé : plus la barre est longue, plus le signal a pesé.</p>
                    <ul className="space-y-2.5">
                      {expl.map(c => (
                        <li key={c.feature}>
                          <div className="flex justify-between gap-3 text-[13px]">
                            <span style={{ color: '#0F172A' }}>{c.libelle}</span>
                            <span className="tabular-nums shrink-0 font-semibold">{nf(c.valeur, 2)} <span className="font-normal" style={{ color: '#64748B' }}>(normal : {nf(c.valeur_normale, 2)})</span></span>
                          </div>
                          <div className="mt-1"><Meter value={(c.shap / maxShap) * 100} /></div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : <p style={{ color: '#64748B' }}>Pas d’explication détaillée disponible pour cette alerte.</p>}
              </Bloc>
            </div>

            {/* Plan d'action */}
            <Bloc n={4} titre="Plan d’action, dans l’ordre">
              <div className="grid sm:grid-cols-3 gap-3 mt-1">
                {rap.etapes.map((e, i) => (
                  <div key={e.niveau} className="rounded-[12px] overflow-hidden" style={{ border: `1px solid ${ETAPE[e.niveau]}` }}>
                    <div className="px-3.5 py-2 flex items-center gap-2 font-bold text-[14px]" style={{ background: ETAPE[e.niveau], color: '#FFFFFF' }}>
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[12.5px]" style={{ background: '#FFFFFF', color: ETAPE[e.niveau] }}>{i + 1}</span>{e.niveau}
                    </div>
                    <ul className="p-3.5 space-y-2 text-[13.5px]">
                      {e.items.map(it => (
                        <li key={it} className="flex gap-2"><span className="shrink-0 mt-[3px] w-3.5 h-3.5 rounded-[3px]" style={{ border: '1.5px solid #64748B' }} />{it}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Bloc>

            {/* Validation */}
            <Bloc n={5} titre="Validation par l’opérateur">
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 mt-3">
                {['Nom de l’opérateur', 'Date et heure', 'Décision prise', 'Signature'].map(k => (
                  <div key={k}>
                    <div className="h-7" style={{ borderBottom: '1.5px solid #94A3B8' }} />
                    <div className="text-[12px] mt-1" style={{ color: '#64748B' }}>{k}</div>
                  </div>
                ))}
              </div>
            </Bloc>
          </div>

          <footer className="px-6 sm:px-8 py-3.5 text-[12px]" style={{ background: '#F6F8FC', borderTop: '1px solid #E5E9F2', color: '#64748B' }}>
            Actions suggérées, à confirmer par un opérateur. La cause est une estimation d’après les signaux du modèle, qui répond seulement
            « attaque » ou « normal ». Document généré par VigiloChain le {dateFr(new Date().toISOString())}.
          </footer>
        </div>
      </div>
    </div>
  );
}

function Bloc({ n, titre, children }: { n: number; titre: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="flex items-center gap-2 text-[16px] font-bold mb-2" style={{ color: '#0F172A', fontFamily: 'inherit' }}>
        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[12.5px]" style={{ background: '#3B5BDB', color: '#FFFFFF' }}>{n}</span>{titre}
      </h2>
      <div>{children}</div>
    </section>
  );
}

/** Ouvre la seule feuille dans une fenêtre propre (papier A4) et lance l'impression : « Enregistrer au format PDF ». */
function exporterPdf(noeud: HTMLElement | null, titre: string) {
  if (!noeud) return;
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { window.alert('Le navigateur a bloqué la fenêtre : autorisez les pop-ups pour ce site, puis réessayez.'); return; }
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(n => n.outerHTML).join('');
  w.document.write(`<!doctype html><html lang="fr" data-theme="light"><head><meta charset="utf-8"><title>${titre.replace(/</g, '')}</title>`
    + `<base href="${location.href}">${styles}`
    + '<style>@page{size:A4;margin:10mm}body{background:#fff;margin:0}'
    + '.vc-report{border:0!important;border-radius:0!important;box-shadow:none!important;max-width:none!important}'
    + '.vc-report *{-webkit-print-color-adjust:exact;print-color-adjust:exact;break-inside:avoid}</style></head>'
    + `<body>${noeud.outerHTML}</body></html>`);
  w.document.close();
  w.focus();
  window.setTimeout(() => { w.print(); }, 700);
}
