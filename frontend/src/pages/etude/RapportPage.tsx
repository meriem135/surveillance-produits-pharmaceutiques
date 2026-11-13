/** Rapport pour l'opérateur — GET /api/v1/transmission/report (étude de référence lue en base). */
import { Download } from 'lucide-react';
import { Empty, Loading, Note, PageHeader, Readouts, Section, Stat, State, type StateKind, minutes, nf, pct, useApi } from '../../components/etude/kit';

interface Scen { scenario: string; capteur: string; description: string; famille: string; taux_detection: number | null; niveau: string; niveau_raison?: string;
  lignes_signalees: number | null; episodes: string; delai_median_min: number | null; ce_que_le_modele_regarde: string[]; risque: string; actions: string[];
  famille_deduite?: string[]; deduction_correcte?: boolean | null }
interface Report {
  titre: string; date: string; source: string; message?: string; markdown: string; desequilibre: string; regles_generales: string[]; limites?: string[]; critere_niveau?: string; type_attaque?: string; identification?: string;
  modele: null | { nom: string; point_fonctionnement: string; recall: number; precision: number; f1: number; fausses_alertes_par_heure: number;
    delai_median_min: number | null; episodes: string; lecture: string; seuil: string };
  scenarios: Scen[];
}

const kind = (n: string): StateKind => (n.startsWith('bien') ? 'ok' : n.startsWith('détecté') ? 'alerte' : n.startsWith('mal') ? 'manque' : 'neutre');
const tone = (n: string) => ({ ok: 'var(--accent-primary)', alerte: 'var(--alarm-amber-fill)', manque: 'var(--accent-danger)', neutre: 'var(--border-strong)' })[kind(n)];

export default function RapportPage() {
  const { data, error, loading, reload } = useApi<Report>('/api/v1/transmission/report');
  const download = () => {
    if (!data?.markdown) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data.markdown], { type: 'text/markdown;charset=utf-8' }));
    a.download = 'rapport_operateur_transmission.md';
    a.click();
  };
  const header = (
    <PageHeader title="Rapport pour l'opérateur" loading={loading} onRefresh={reload}
      subtitle="Que faire quand une alerte tombe : le modèle en service, ses performances et les consignes par type d'attaque.">
      <button onClick={download} disabled={!data?.markdown} className="vc-btn vc-btn-primary"><Download className="w-4 h-4" />Télécharger le rapport (Markdown)</button>
    </PageHeader>
  );
  if (!data) return <div className="space-y-5">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  const m = data.modele;
  return (
    <div className="space-y-6">
      {header}
      {!m ? <Empty>{data.message}</Empty> : (
        <section className="vc-fiche overflow-hidden">
          <div className="p-5 sm:p-6">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--accent-primary)' }}>Le modèle en service</div>
            <h2 className="mt-1 text-[36px] leading-none" style={{ color: 'var(--text-primary)' }}>{m.nom}</h2>
            <p className="mt-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>Réglage « {m.point_fonctionnement} ». Source : {data.source}, {data.date}.</p>
            <p className="text-[15px] mt-3 max-w-[75ch]" style={{ color: 'var(--text-secondary)' }}>{m.lecture}</p>
          </div>
          <div className="border-t" style={{ borderColor: 'var(--border)' }}>
            <Readouts cols={5} className="!border-0 !rounded-none">
              <Stat label="Épisodes détectés" value={m.episodes} tone="var(--accent-primary)" />
              <Stat label="Fausses alertes par heure" value={nf(m.fausses_alertes_par_heure, 2)} tone="var(--alarm-amber-fill)" />
              <Stat label="Précision" value={pct(m.precision)} />
              <Stat label="Rappel" value={pct(m.recall)} />
              <Stat label="Délai médian" value={nf(m.delai_median_min, 1)} unit="min" />
            </Readouts>
          </div>
          <p className="px-5 sm:px-6 py-3 text-[13px] border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>{m.seuil}</p>
        </section>
      )}

      <div>
        <h2 className="text-[24px]" style={{ color: 'var(--text-primary)' }}>Consignes par type d’attaque</h2>
        <p className="text-[14px] mt-1 max-w-[75ch]" style={{ color: 'var(--text-secondary)' }}>Chaque fiche dit ce que le modèle regarde, le risque pour les produits et quoi faire.</p>
      </div>
      {data.type_attaque && (
        <div className="vc-panel px-4 sm:px-5 py-3.5 -mt-2" data-testid="type-attaque">
          <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Le modèle ne nomme pas l’attaque</div>
          <p className="text-[13.5px] mt-1 max-w-[110ch] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{data.type_attaque}</p>
          {data.identification && <p className="text-[13.5px] mt-1 max-w-[110ch]" style={{ color: 'var(--text-muted)' }}>{data.identification}</p>}
        </div>
      )}
      {data.critere_niveau && (
        <div className="vc-panel px-4 sm:px-5 py-3.5 -mt-2" data-testid="critere-niveau">
          <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Comment le niveau est attribué</div>
          <p className="text-[13.5px] mt-1 max-w-[110ch] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{data.critere_niveau}</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            <State kind="ok">bien détecté</State><State kind="alerte">détecté partiellement / tardivement</State><State kind="manque">mal détecté</State>
          </div>
        </div>
      )}
      <div className="grid lg:grid-cols-2 3xl:grid-cols-3 gap-6">
        {data.scenarios.map(s => (
          <article key={s.scenario} className="vc-panel overflow-hidden" style={{ borderLeft: `4px solid ${tone(s.niveau)}` }}>
            <div className="vc-panel-head px-4 sm:px-5 pt-3.5 pb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[19px] leading-tight" style={{ color: 'var(--text-primary)' }}>{s.famille}, {s.capteur}</h3>
                <p className="text-[13px] mt-1" style={{ color: 'var(--text-secondary)' }}>{s.description}</p>
              </div>
              <State kind={kind(s.niveau)}>{s.niveau}</State>
            </div>
            {s.niveau_raison && (
              <p className="px-4 sm:px-5 pt-3 -mb-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Pourquoi ce niveau :</span> {s.niveau_raison}
              </p>
            )}
            <div className="p-4 sm:p-5 text-[14px] space-y-3" style={{ color: 'var(--text-secondary)' }}>
              <dl className="grid grid-cols-3 gap-3">
                <div><dt className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Épisodes détectés</dt><dd className="vc-readout-value" style={{ fontSize: 24 }}>{s.episodes}</dd></div>
                <div><dt className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Délai médian</dt><dd className="vc-readout-value" style={{ fontSize: 24 }}>{minutes(s.delai_median_min)}</dd></div>
                <div><dt className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Mesures signalées</dt><dd className="vc-readout-value" style={{ fontSize: 24 }}>{s.lignes_signalees != null ? `${nf(s.lignes_signalees, 0)}\u202f%` : '—'}</dd></div>
              </dl>
              <p><strong style={{ color: 'var(--text-primary)' }}>Ce que le modèle regarde :</strong> {s.ce_que_le_modele_regarde.join(', ')}</p>
              <p><strong style={{ color: 'var(--text-primary)' }}>Famille déduite de ces indices :</strong>{' '}
                {s.famille_deduite && s.famille_deduite.length > 0
                  ? `${s.famille_deduite.join(' ou ')} ${s.deduction_correcte ? '✔' : '✘'}`
                  : 'non identifiée'}</p>
              <p><strong style={{ color: 'var(--text-primary)' }}>Risque :</strong> {s.risque}</p>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Que faire</strong>
                <ol className="list-decimal pl-5 mt-1 space-y-1">{s.actions.map(a => <li key={a}>{a}</li>)}</ol>
              </div>
            </div>
          </article>
        ))}
      </div>
      {data.limites && data.limites.length > 0 && (
        <Section title="Limites connues"><ul className="list-disc pl-5 text-[14.5px] space-y-1.5 max-w-[90ch]" style={{ color: 'var(--text-secondary)' }}>{data.limites.map(l => <li key={l}>{l}</li>)}</ul></Section>
      )}
      <Section title="Règles générales"><ul className="list-disc pl-5 text-[14.5px] space-y-1.5 max-w-[90ch]" style={{ color: 'var(--text-secondary)' }}>{data.regles_generales.map(l => <li key={l}>{l}</li>)}</ul>
        <Note>{data.desequilibre}</Note></Section>
    </div>
  );
}
