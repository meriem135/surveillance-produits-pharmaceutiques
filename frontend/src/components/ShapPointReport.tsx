/**
 * Rapport détaillé d'un point du jeu de données de l'année simulée (archive phase 2) :
 * explication SHAP du point (GET /api/shap/point) et recommandation opérateur
 * (POST /api/v1/pharma/point-report, CVE comprises). Utilisé dans la fenêtre de la page SHAP
 * et en pleine page (/dashboard/shap/report?timestamp=…).
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Loader2, X } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { authHeaders } from '../lib/auth';
import { Meter, Readouts, Stat, State, Table, nf, pct, type StateKind } from './etude/kit';

// ─── Types partagés avec les pages SHAP ──────────────────────────────────────
export interface ShapCause {
  feature: string;
  label?: string;
  shap_value: number;
  feature_value: number;
  interpretation?: string;
  group?: string;
}
export interface ShapPointResponse {
  available: boolean;
  error?: string;
  timestamp: string;
  requested_timestamp?: string;
  index: number;
  is_anomaly: boolean;
  anomaly_score: number;
  prediction: number;
  label: number;
  month: number;
  season: string;
  risk_score_per_100: number;
  sensor_values: Record<string, number>;
  group_shap: Record<string, number>;
  dominant_group: string;
  dominant_sensor: string;
  top_causes: ShapCause[];
  top_normal: ShapCause[];
  model_kind: string;
  shap_method: string;
}
interface CveItem {
  cve_id: string;
  description: string;
  cvss_score: number | null;
  cvss_severity: string;
  epss_score: number | null;
  published: string;
  risk_score: number;
  references: string[];
}
interface CveReport {
  available: boolean;
  sensor: string;
  risk_score: number;
  total_cves: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  source: string;
  top_cves: CveItem[];
  error?: string;
}
export interface PharmaReportResponse {
  report: string;
  guardian: string;
  sensor: string;
  sensor_label: string;
  domain: 'production' | 'stock' | 'logistics';
  domain_label: string;
  sensor_role: string;
  product_impact: string;
  attack_id: string | null;
  attack_name: string | null;
  attack_category: string | null;
  severity: string;
  risk_score_per_100: number;
  label: number;
  is_anomaly: boolean;
  season: string | null;
  device: string | null;
  sensor_values: Record<string, number>;
  why: string;
  shap_causes_summary: string[];
  impact: { production_impact: number; stock_impact: number; effect: string };
  actions: string[];
  disposition: { label: string; description: string };
  regulatory: string[];
  mitigation: string[];
  ai_context_enabled: boolean;
  cve?: CveReport;
  error?: string;
}

/** Charge l'explication SHAP d'un point puis la recommandation opérateur associée
 *  (mêmes appels que l'ancienne page : GET /api/shap/point puis POST /api/v1/pharma/point-report). */
export async function loadPointReport(timestamp: string) {
  const p = await fetch(`/api/shap/point?timestamp=${encodeURIComponent(timestamp)}`);
  if (!p.ok) {
    const d = await p.json().catch(() => null);
    throw new Error(d?.error || `HTTP ${p.status}`);
  }
  const point: ShapPointResponse = await p.json();
  if (!point.available) throw new Error(point.error || 'SHAP indisponible');
  const sov = point.sensor_values || {};
  const r = await fetch('/api/v1/pharma/point-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      sensor: point.dominant_sensor || 'thermostat',
      attack_id: null,
      risk_score: point.risk_score_per_100,
      is_anomaly: point.is_anomaly,
      label: point.label,
      season: point.season,
      sensor_values: { weather: sov.weather, fridge: sov.fridge, thermostat: sov.thermostat },
      top_causes: point.top_causes.slice(0, 5),
    }),
  });
  const pharma: PharmaReportResponse = await r.json();
  if (pharma.report !== 'ok') throw new Error(pharma.error || 'Rapport indisponible');
  return { point, pharma };
}

// ─── Libellés ────────────────────────────────────────────────────────────────
export const GROUP_LABELS: Record<string, string> = {
  weather: 'Météo', fridge: 'Frigo', thermostat: 'Thermostat', time: 'Temporel', cross: 'Inter-capteurs', other: 'Autre',
};
export const SEASON_LABELS: Record<string, string> = { winter: 'Hiver', spring: 'Printemps', summer: 'Été', autumn: 'Automne' };
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const reportHref = (timestamp: string) => `/dashboard/shap/report?timestamp=${encodeURIComponent(timestamp)}`;

const CVE_SEV: Record<string, { label: string; kind: StateKind }> = {
  CRITICAL: { label: 'critique', kind: 'manque' }, HIGH: { label: 'élevée', kind: 'manque' },
  MEDIUM: { label: 'moyenne', kind: 'alerte' }, LOW: { label: 'basse', kind: 'neutre' }, NONE: { label: 'aucune', kind: 'neutre' },
};
const severityKind = (s: string): StateKind => (s === 'critique' || s === 'élevée' ? 'manque' : s === 'moyenne' ? 'alerte' : 'neutre');
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), 4)}`;
const tsFr = (ts: string) =>
  new Date(ts.replace(' ', 'T')).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {children}
    </div>
  );
}

export default function ShapPointReport({ point, pharma, onClose, showFullPageLink = false }: {
  point: ShapPointResponse;
  pharma: PharmaReportResponse;
  onClose?: () => void;
  showFullPageLink?: boolean;
}) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const sv = point.sensor_values || {};
  const causes = point.top_causes.slice(0, 5);
  const normals = point.top_normal.slice(0, 4);
  const impact = pharma.impact;
  const cve = pharma.cve;
  const fmtSigned = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(4)}`;

  const exportPdf = async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const { autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      type RGB = [number, number, number];
      const INK: RGB = [26, 32, 38];
      const BLUE: RGB = [31, 95, 166];
      const RED: RGB = [179, 38, 30];
      const AMBER: RGB = [227, 154, 28];
      let y = 15;
      const ensureSpace = (needed: number) => {
        if (y + needed > pageHeight - 20) { doc.addPage(); y = 15; }
      };
      const sectionHeader = (text: string, color: RGB = INK) => {
        ensureSpace(18);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(...color);
        doc.text(text, margin, y);
        y += 6;
        doc.setDrawColor(...color);
        doc.setLineWidth(0.3);
        doc.line(margin, y, pageWidth - margin, y);
        y += 5;
      };
      const bodyText = (text: string, color: RGB = [55, 65, 81]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(...color);
        for (const line of doc.splitTextToSize(text, contentWidth) as string[]) {
          ensureSpace(5);
          doc.text(line, margin, y);
          y += 4.5;
        }
      };
      const smallItalic = (text: string) => {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        for (const l of doc.splitTextToSize(text, contentWidth) as string[]) {
          ensureSpace(5);
          doc.text(l, margin, y);
          y += 4.2;
        }
        y += 2;
      };
      const bullet = (text: string) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(55, 65, 81);
        (doc.splitTextToSize(text, contentWidth - 8) as string[]).forEach((line, i) => {
          ensureSpace(5);
          doc.text(i === 0 ? `•  ${line}` : line, i === 0 ? margin : margin + 8, y);
          y += 4.5;
        });
      };
      let tableY = 0;
      const drawTable = (head: string[], body: string[][]) => {
        ensureSpace(30);
        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [head],
          body,
          theme: 'grid',
          headStyles: { fillColor: INK, textColor: [255, 255, 255], fontSize: 9 },
          styles: { fontSize: 9, cellPadding: 2, textColor: [40, 50, 70] },
          didDrawPage: (data) => { if (data.cursor?.y) tableY = data.cursor.y; },
        });
        y = tableY + 10;
      };
      const drawBar = (label: string, value: number, color: RGB) => {
        ensureSpace(12);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(40, 50, 70);
        doc.text(`${label}  ${value}/100`, margin, y);
        y += 2.5;
        doc.setFillColor(230, 236, 242);
        doc.rect(margin, y, contentWidth, 3, 'F');
        doc.setFillColor(...color);
        doc.rect(margin, y, Math.min(contentWidth, (value / 100) * contentWidth), 3, 'F');
        y += 6.5;
      };

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(...INK);
      doc.text('Recommandation opérateur : point du jeu de données', margin, 18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text('VigiloChain · archive de l’année simulée 2019 (phase 2) · interprétabilité SHAP', margin, 25);
      doc.setDrawColor(...BLUE);
      doc.setLineWidth(0.8);
      doc.line(margin, 29, pageWidth - margin, 29);
      y = 38;

      drawTable(['Information', 'Valeur'], [
        ['Date du point', point.timestamp.replace('T', ' ')],
        ["Score d'anomalie", point.anomaly_score.toFixed(4)],
        ['Risque / 100', String(point.risk_score_per_100)],
        ['Label', point.label === 1 ? 'Attaque (label=1)' : 'Normal (label=0)'],
        ['Modèle', point.prediction === 1 ? 'Anomalie détectée' : 'Non détectée'],
        ['Sévérité', pharma.severity],
        ['Saison', SEASON_LABELS[point.season] || point.season],
        ['Capteur dominant', GROUP_LABELS[point.dominant_sensor] || point.dominant_sensor],
        ['SHAP', `${point.shap_method} · ${point.model_kind}`],
      ]);
      sectionHeader('Mesures capteurs');
      drawTable(['Capteur', 'Valeur (°C)'], [
        ['Météo', sv.weather !== undefined ? sv.weather.toFixed(2) : 'N/A'],
        ['Frigo', sv.fridge !== undefined ? sv.fridge.toFixed(2) : 'N/A'],
        ['Thermostat', sv.thermostat !== undefined ? sv.thermostat.toFixed(2) : 'N/A'],
      ]);
      sectionHeader(pharma.domain_label, BLUE);
      bodyText(`${pharma.sensor_role} : ${pharma.product_impact}`);
      bodyText(`Décision : ${pharma.disposition.label}. ${pharma.disposition.description}`, RED);
      sectionHeader('Pourquoi ce point est signalé : explication SHAP', RED);
      bodyText(pharma.why);
      drawTable(['Cause (SHAP)', 'Valeur SHAP', 'Valeur feature'],
        causes.map(c => [c.interpretation || c.feature, fmtSigned(c.shap_value), c.feature_value.toFixed(3)]));
      if (normals.length > 0) {
        sectionHeader('Contre-arguments (vers « normal »)', BLUE);
        normals.forEach(c => bullet(`${c.interpretation || c.feature} (${fmtSigned(c.shap_value)})`));
      }
      sectionHeader('Impact potentiel (indice 0-100)', AMBER);
      drawBar('Production', impact.production_impact, RED);
      drawBar('Stock / chaîne du froid', impact.stock_impact, BLUE);
      smallItalic(impact.effect);
      sectionHeader('Recommandations opérateur', BLUE);
      pharma.actions.forEach(a => bullet(a));
      if (cve) {
        sectionHeader('Vulnérabilités CVE', RED);
        if (cve.available && cve.total_cves > 0) {
          smallItalic(`Score de vulnérabilité : ${Math.round(cve.risk_score)}/100 · ${cve.total_cves} CVE (${cve.critical_count} critiques, ${cve.high_count} élevées, ${cve.medium_count} moyennes, ${cve.low_count} basses). ${cve.source}`);
          drawTable(['CVE', 'Sévérité', 'CVSS', 'Risque/100'], cve.top_cves.slice(0, 8).map(c => [
            c.cve_id, c.cvss_severity || 'UNKNOWN', c.cvss_score != null ? String(c.cvss_score) : '—', String(Math.round(c.risk_score)),
          ]));
        } else bodyText(cve.available ? 'Aucune CVE trouvée pour ce capteur.' : cve.error || 'Données CVE indisponibles.');
      }
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(150, 160, 175);
        doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} · VigiloChain`, margin, pageHeight - 10);
        doc.text(`Page ${i} / ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
      }
      doc.save(`rapport_shap_${point.timestamp.replace(/[^0-9a-zA-Z_-]/g, '_')}.pdf`);
    } catch (err) {
      toast({ title: 'Erreur PDF', description: `Échec : ${err instanceof Error ? err.message : ''}`, variant: 'destructive' });
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <article className="vc-panel overflow-hidden min-w-0">
      <header className="vc-panel-head flex flex-wrap items-start justify-between gap-3 px-4 sm:px-5 pt-3.5 pb-3">
        <div className="min-w-0">
          <h2 className="text-[20px] leading-tight" style={{ color: 'var(--text-primary)' }}>Point du {tsFr(point.timestamp)}</h2>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            {SEASON_LABELS[point.season] || point.season}{point.month ? `, ${MONTHS[point.month - 1]}` : ''} · SHAP : {point.shap_method} · modèle {point.model_kind}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showFullPageLink && (
            <Link to={reportHref(point.requested_timestamp || point.timestamp)} className="vc-btn">
              <ExternalLink className="w-3.5 h-3.5" aria-hidden /> Pleine page
            </Link>
          )}
          <button type="button" onClick={exportPdf} disabled={pdfLoading} className="vc-btn">
            {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Download className="w-3.5 h-3.5" aria-hidden />}
            {pdfLoading ? 'Génération…' : 'Exporter en PDF'}
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="vc-btn" aria-label="Fermer le rapport">
              <X className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
      </header>

      <div className="p-4 sm:p-5 space-y-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {point.label === 1 ? <State kind="manque">Attaque réelle (label = 1)</State> : <State kind="neutre">Normal (label = 0)</State>}
          {point.prediction === 1 ? <State kind="ok">Signalé par le modèle</State> : <State kind="neutre">Non signalé par le modèle</State>}
          <State kind={severityKind(pharma.severity)}>Sévérité {pharma.severity}</State>
          <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            Capteur dominant : <strong style={{ color: 'var(--text-primary)' }}>{GROUP_LABELS[point.dominant_sensor] || point.dominant_sensor}</strong>
          </span>
        </div>

        <Readouts cols={5}>
          <Stat label="Score d'anomalie" value={nf(point.anomaly_score, 3)} />
          <Stat label="Risque" value={nf(point.risk_score_per_100, 1)} unit="/100" />
          {(['weather', 'fridge', 'thermostat'] as const).map(k => (
            <Stat key={k} label={GROUP_LABELS[k]} value={sv[k] !== undefined ? nf(sv[k], 2) : '—'} unit={sv[k] !== undefined ? '°C' : undefined} />
          ))}
        </Readouts>

        <div className="grid gap-6 lg:grid-cols-2">
          <Block title={pharma.domain_label}>
            <p className="text-[14px] leading-relaxed max-w-[80ch]" style={{ color: 'var(--text-primary)' }}>
              {pharma.sensor_role} : {pharma.product_impact}
            </p>
            <p className="mt-3 text-[14px] leading-relaxed p-3 rounded-[3px] max-w-[80ch]" style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Décision : {pharma.disposition.label}.</strong> {pharma.disposition.description}
            </p>
          </Block>
          <Block title="Impact potentiel (indice de 0 à 100)">
            <div className="space-y-3">
              {[
                { l: 'Production', v: impact.production_impact, c: 'var(--accent-danger)' },
                { l: 'Stock / chaîne du froid', v: impact.stock_impact, c: 'var(--accent-primary)' },
              ].map(m => (
                <div key={m.l}>
                  <div className="flex justify-between text-[13px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                    <span>{m.l}</span><span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{nf(m.v)}/100</span>
                  </div>
                  <Meter value={m.v} color={m.c} />
                </div>
              ))}
            </div>
            <p className="text-[13px] mt-3 max-w-[80ch]" style={{ color: 'var(--text-muted)' }}>{impact.effect}</p>
          </Block>
        </div>

        <Block title="Pourquoi ce point est signalé">
          <p className="text-[14px] leading-relaxed max-w-[90ch] mb-3" style={{ color: 'var(--text-primary)' }}>{pharma.why}</p>
          <Table min={520}>
            <thead><tr><th>Cause</th><th>Variable</th><th className="vc-num">Valeur</th><th className="vc-num">Contribution SHAP</th></tr></thead>
            <tbody>
              {causes.map(c => (
                <tr key={c.feature}>
                  <td>{c.interpretation || c.label || c.feature}</td>
                  <td><code className="text-[12.5px]">{c.feature}</code></td>
                  <td className="vc-num">{nf(c.feature_value, 3)}</td>
                  <td className="vc-num" style={{ color: c.shap_value < 0 ? 'var(--accent-danger)' : undefined }}>{signed(c.shap_value)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {normals.length > 0 && (
            <p className="text-[13px] mt-3 max-w-[90ch]" style={{ color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Contre-arguments (tirent vers « normal ») : </strong>
              {normals.map(c => `${c.interpretation || c.feature} (${signed(c.shap_value)})`).join(' ; ')}.
            </p>
          )}
          <p className="text-[12.5px] mt-2 max-w-[90ch]" style={{ color: 'var(--text-muted)' }}>
            Pour ce modèle (OneClassSVM), une contribution négative pousse le point vers l’anomalie.
          </p>
        </Block>

        <div className="grid gap-6 lg:grid-cols-2">
          <Block title="Recommandations opérateur">
            <ol className="list-decimal pl-5 space-y-1.5 text-[14px] leading-relaxed max-w-[80ch]" style={{ color: 'var(--text-primary)' }}>
              {pharma.actions.map(a => <li key={a}>{a}</li>)}
            </ol>
          </Block>
          {pharma.regulatory?.length > 0 && (
            <Block title="Référentiels">
              <ul className="list-disc pl-5 space-y-1 text-[13.5px]" style={{ color: 'var(--text-secondary)' }}>
                {[...new Set(pharma.regulatory)].map(r => <li key={r}>{r}</li>)}
              </ul>
            </Block>
          )}
        </div>

        {cve && (
          <Block title={`Vulnérabilités CVE du capteur${cve.available ? ` : score ${nf(cve.risk_score, 0)}/100` : ''}`}>
            {cve.available && cve.total_cves > 0 ? (
              <>
                <p className="text-[13px] mb-2 max-w-[90ch]" style={{ color: 'var(--text-secondary)' }}>
                  {cve.total_cves} CVE au total : {cve.critical_count} critiques, {cve.high_count} élevées, {cve.medium_count} moyennes, {cve.low_count} basses. Source : {cve.source}.
                </p>
                <Table min={760}>
                  <thead><tr><th>CVE</th><th>Sévérité</th><th className="vc-num">CVSS</th><th className="vc-num">EPSS</th><th className="vc-num">Risque</th><th>Description</th></tr></thead>
                  <tbody>
                    {cve.top_cves.slice(0, 6).map(c => {
                      const s = CVE_SEV[c.cvss_severity] ?? { label: c.cvss_severity || 'inconnue', kind: 'neutre' as StateKind };
                      return (
                        <tr key={c.cve_id}>
                          <td className="whitespace-nowrap"><code className="text-[12.5px]">{c.cve_id}</code></td>
                          <td><State kind={s.kind}>{s.label}</State></td>
                          <td className="vc-num">{c.cvss_score != null ? nf(c.cvss_score, 1) : '—'}</td>
                          <td className="vc-num">{c.epss_score != null ? pct(c.epss_score) : '—'}</td>
                          <td className="vc-num">{nf(c.risk_score, 0)}/100</td>
                          <td className="text-[13px] min-w-[260px]" style={{ color: 'var(--text-secondary)' }}>{c.description}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </>
            ) : (
              <p className="text-[13.5px]" style={{ color: 'var(--text-secondary)' }}>
                {cve.available ? 'Aucune CVE trouvée pour ce capteur.' : cve.error || 'Données CVE indisponibles.'}
              </p>
            )}
          </Block>
        )}
      </div>
    </article>
  );
}
