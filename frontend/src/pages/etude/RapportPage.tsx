/** Rapport pour l'opérateur — GET /api/v1/transmission/report (étude de référence lue en base). */
import { Download } from 'lucide-react';
import { Empty, Loading, Note, PageHeader, Pill, Section, minutes, nf, pct, useApi } from '../../components/etude/kit';

interface Scen { scenario: string; capteur: string; description: string; famille: string; taux_detection: number | null; niveau: string;
  lignes_signalees: number | null; episodes: string; delai_median_min: number | null; ce_que_le_modele_regarde: string[]; risque: string; actions: string[] }
interface Report {
  titre: string; date: string; source: string; message?: string; markdown: string; desequilibre: string; regles_generales: string[]; limites?: string[];
  modele: null | { nom: string; point_fonctionnement: string; recall: number; precision: number; f1: number; fausses_alertes_par_heure: number;
    delai_median_min: number | null; episodes: string; lecture: string; seuil: string };
  scenarios: Scen[];
}

const tone = (n: string) => (n.startsWith('bien') ? 'var(--accent-success)' : n.startsWith('partiel') ? 'var(--accent-warning)' : 'var(--accent-danger)');

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
      <button onClick={download} disabled={!data?.markdown} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}><Download className="w-3.5 h-3.5" />Markdown</button>
    </PageHeader>
  );
  if (!data) return <div className="space-y-4">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;
  const m = data.modele;
  return (
    <div className="space-y-5">
      {header}
      {!m ? <Empty>{data.message}</Empty> : (
        <Section title={`Le modèle en service : ${m.nom}`} subtitle={`Réglage « ${m.point_fonctionnement} » · source : ${data.source} · ${data.date}`}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            {[['Épisodes détectés', m.episodes], ['Fausses alertes / h', nf(m.fausses_alertes_par_heure, 2)], ['Précision', pct(m.precision)],
              ['Rappel', pct(m.recall)], ['Délai médian', minutes(m.delai_median_min)]].map(([k, v]) => (
              <div key={k} className="rounded-md p-3" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{k}</div>
                <div className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{v}</div>
              </div>
            ))}
          </div>
          <p className="text-sm mt-4" style={{ color: 'var(--text-secondary)' }}>{m.lecture}</p>
          <Note>{m.seuil}</Note>
        </Section>
      )}
      <div className="grid lg:grid-cols-2 gap-5">
        {data.scenarios.map(s => (
          <Section key={s.scenario} title={`${s.famille} — ${s.capteur}`} subtitle={s.description}
            action={<Pill tone={tone(s.niveau)}>{s.niveau}</Pill>}>
            <div className="text-xs space-y-2" style={{ color: 'var(--text-secondary)' }}>
              <div>Épisodes détectés <strong>{s.episodes}</strong> · délai médian <strong>{minutes(s.delai_median_min)}</strong>
                {s.lignes_signalees != null && <> · {nf(s.lignes_signalees, 0)} % des mesures signalées</>}</div>
              <div><strong>Ce que le modèle regarde :</strong> {s.ce_que_le_modele_regarde.join(', ')}</div>
              <div><strong>Risque :</strong> {s.risque}</div>
              <ol className="list-decimal pl-5 space-y-0.5">{s.actions.map(a => <li key={a}>{a}</li>)}</ol>
            </div>
          </Section>
        ))}
      </div>
      {data.limites && data.limites.length > 0 && (
        <Section title="Limites connues"><ul className="list-disc pl-5 text-sm space-y-1" style={{ color: 'var(--text-secondary)' }}>{data.limites.map(l => <li key={l}>{l}</li>)}</ul></Section>
      )}
      <Section title="Règles générales"><ul className="list-disc pl-5 text-sm space-y-1" style={{ color: 'var(--text-secondary)' }}>{data.regles_generales.map(l => <li key={l}>{l}</li>)}</ul>
        <Note>{data.desequilibre}</Note></Section>
    </div>
  );
}
