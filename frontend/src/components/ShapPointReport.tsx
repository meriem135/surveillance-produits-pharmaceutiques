import { useState } from 'react';
import { Activity, Download, Loader2, Zap } from 'lucide-react';

interface ShapCause {
  feature: string;
  label?: string;
  shap_value: number;
  feature_value: number;
  interpretation?: string;
  group?: string;
}
interface ShapPointResponse {
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
interface PharmaReportResponse {
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

const GROUP_COLORS: Record<string, string> = {
  weather: '#0891B2',
  fridge: '#0D9488',
  thermostat: '#7C3AED',
  time: '#E11D48',
  cross: '#D97706',
  other: '#64748B',
};
const GROUP_LABELS: Record<string, string> = {
  weather: 'Météo',
  fridge: 'Frigo',
  thermostat: 'Thermostat',
  time: 'Temporel',
  cross: 'Inter-Capteurs',
};
const SEASON_LABELS: Record<string, string> = {
  winter: 'Hiver',
  spring: 'Printemps',
  summer: 'Été',
  autumn: 'Automne',
};
const MONTHS = [
  'Jan',
  'Fev',
  'Mar',
  'Avr',
  'Mai',
  'Jun',
  'Jul',
  'Aou',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const CVE_SEV_STYLE: Record<string, string> = {
  CRITICAL: '#E11D48',
  HIGH: '#D97706',
  MEDIUM: '#0891B2',
  LOW: '#0D9488',
  NONE: '#0D9488',
};

export default function ShapPointReport({
  point,
  pharma,
  onClose,
}: {
  point: ShapPointResponse;
  pharma: PharmaReportResponse;
  onClose?: () => void;
}) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const accent = GROUP_COLORS[point.dominant_sensor] || '#D97706';
  const severityColor =
    pharma.severity === 'critique'
      ? '#E11D48'
      : pharma.severity === 'élevée'
        ? '#D97706'
        : pharma.severity === 'moyenne'
          ? '#0891B2'
          : '#0D9488';
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
      let y = 15;

      const ensureSpace = (needed: number) => {
        if (y + needed > pageHeight - 20) {
          doc.addPage();
          y = 15;
        }
      };
      const sectionHeader = (
        text: string,
        color: [number, number, number],
      ) => {
        ensureSpace(18);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(color[0], color[1], color[2]);
        doc.text(text, margin, y);
        y += 6;
        doc.setDrawColor(color[0], color[1], color[2]);
        doc.setLineWidth(0.3);
        doc.line(margin, y, pageWidth - margin, y);
        y += 5;
      };
      const bodyText = (text: string, color?: [number, number, number]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(
          color ? color[0] : 55,
          color ? color[1] : 65,
          color ? color[2] : 81,
        );
        const lines = doc.splitTextToSize(text, contentWidth) as string[];
        for (const line of lines) {
          ensureSpace(5);
          doc.text(line, margin, y);
          y += 4.5;
        }
      };
      const bullet = (text: string) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(55, 65, 81);
        const lines = doc.splitTextToSize(text, contentWidth - 8) as string[];
        lines.forEach((line, i) => {
          ensureSpace(5);
          doc.text(i === 0 ? `•  ${line}` : line, i === 0 ? margin : margin + 8, y);
          y += 4.5;
        });
      };
      let tableY = 0;
      const drawTable = (head: string[], body: Array<string[]>) => {
        ensureSpace(30);
        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [head],
          body,
          theme: 'grid',
          headStyles: { fillColor: [13, 23, 42], textColor: [255, 255, 255], fontSize: 9 },
          styles: { fontSize: 9, cellPadding: 2, textColor: [40, 50, 70] },
          didDrawPage: (data) => {
            if (data.cursor?.y) tableY = data.cursor.y;
          },
        });
        y = tableY + 10;
      };
      const drawBar = (label: string, value: number, color: [number, number, number]) => {
        ensureSpace(12);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(40, 50, 70);
        doc.text(`${label}  ${value}/100`, margin, y);
        y += 2.5;
        doc.setFillColor(230, 236, 242);
        doc.roundedRect(margin, y, contentWidth, 3, 1, 1, 'F');
        doc.setFillColor(color[0], color[1], color[2]);
        doc.roundedRect(margin, y, Math.min(contentWidth, (value / 100) * contentWidth), 3, 1, 1, 'F');
        y += 6.5;
      };

      // ── En-tête ──
      doc.setFillColor(11, 17, 32);
      doc.rect(0, 0, pageWidth, 30, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(13, 148, 136);
      doc.text('Recommandation Opérateur — Point du Dataset', margin, 18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(170, 190, 215);
      doc.text('VigiloChain Security Platform · Interprétabilité SHAP · OneClassSVM', margin, 25);
      y = 42;

      // ── Infos du point ──
      drawTable(
        ['Information', 'Valeur'],
        [
          ['Date du point', point.timestamp.replace('T', ' ')],
          ["Score d'anomalie", point.anomaly_score.toFixed(4)],
          ['Risque / 100', String(point.risk_score_per_100)],
          ['Label', point.label === 1 ? 'Attaque (label=1)' : 'Normal (label=0)'],
          ['Modèle', point.prediction === 1 ? 'Anomalie détectée' : 'Non détectée'],
          ['Sévérité', pharma.severity],
          ['Saison', SEASON_LABELS[point.season] || point.season],
          ['Capteur dominant', GROUP_LABELS[point.dominant_sensor] || point.dominant_sensor],
          ['SHAP', `${point.shap_method} · ${point.model_kind}`],
        ],
      );

      // ── Mesures capteurs ──
      sectionHeader('Mesures capteurs', [0, 229, 255]);
      drawTable(
        ['Capteur', 'Valeur (°C)'],
        [
          ['Weather (météo)', sv.weather !== undefined ? sv.weather.toFixed(2) : 'N/A'],
          ['Fridge (frigo)', sv.fridge !== undefined ? sv.fridge.toFixed(2) : 'N/A'],
          ['Thermostat', sv.thermostat !== undefined ? sv.thermostat.toFixed(2) : 'N/A'],
        ],
      );

      // ── Domaine opérateur ──
      sectionHeader(pharma.domain_label.toUpperCase(), [13, 148, 136]);
      bodyText(`${pharma.sensor_role} — ${pharma.product_impact}`);
      bodyText(
        `Décision : ${pharma.disposition.label} — ${pharma.disposition.description}`,
        [225, 29, 72],
      );

      // ── Pourquoi & SHAP ──
      sectionHeader('Pourquoi ce point est signalé — explication SHAP', [225, 29, 72]);
      bodyText(pharma.why);
      drawTable(
        ['Cause (SHAP)', 'Valeur SHAP', 'Valeur feature'],
        causes.map((c) => [
          c.interpretation || c.feature,
          fmtSigned(c.shap_value),
          c.feature_value.toFixed(3),
        ]),
      );
      if (normals.length > 0) {
        sectionHeader('Contre-arguments (vers « normal », positives)', [13, 148, 136]);
        normals.forEach((c) =>
          bullet(`${c.interpretation || c.feature} (${fmtSigned(c.shap_value)})`),
        );
      }

      // ── Impact ──
      sectionHeader('Impact potentiel (index 0-100)', [255, 184, 48]);
      drawBar('Production', impact.production_impact, [225, 29, 72]);
      drawBar('Stock / Chaîne du froid', impact.stock_impact, [0, 229, 255]);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      const effLines = doc.splitTextToSize(impact.effect, contentWidth) as string[];
      effLines.forEach((l) => {
        ensureSpace(5);
        doc.text(l, margin, y);
        y += 4.2;
      });
      y += 2;

      // ── Recommandations ──
      sectionHeader('Recommandations opérateur', [0, 229, 255]);
      pharma.actions.forEach((a) => bullet(a));

      // ── Vulnérabilités CVE ──
      if (cve) {
        sectionHeader('Vulnérabilités CVE', [225, 29, 72]);
        if (cve.available && cve.total_cves > 0) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8.5);
          doc.setTextColor(100, 116, 139);
          const cveNote = `Score de vulnérabilité : ${Math.round(cve.risk_score)}/100 · ${cve.total_cves} CVE (${cve.critical_count} critiques, ${cve.high_count} élevées, ${cve.medium_count} moyennes, ${cve.low_count} basses). ${cve.source}`;
          const cveLines = doc.splitTextToSize(cveNote, contentWidth) as string[];
          cveLines.forEach((l) => {
            ensureSpace(5);
            doc.text(l, margin, y);
            y += 4.2;
          });
          y += 2;
          drawTable(
            ['CVE', 'Sévérité', 'CVSS', 'Risque/100'],
            cve.top_cves.slice(0, 8).map((c) => [
              c.cve_id,
              c.cvss_severity || 'UNKNOWN',
              c.cvss_score != null ? String(c.cvss_score) : '—',
              String(Math.round(c.risk_score)),
            ]),
          );
        } else if (cve.available) {
          bodyText('Aucune CVE matchée pour ce capteur.');
        } else {
          bodyText(cve.error || 'Données CVE indisponibles.');
        }
      }

      // ── Pied de page ──
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(150, 160, 175);
        doc.text(
          `Généré le ${new Date().toLocaleDateString('fr-FR')} · VigiloChain Security Platform`,
          margin,
          pageHeight - 10,
        );
        doc.text(`Page ${i} / ${pageCount}`, pageWidth - margin, pageHeight - 10, {
          align: 'right',
        });
      }

      doc.save(`rapport_shap_${point.timestamp.replace(/[^0-9a-zA-Z_-]/g, '_')}.pdf`);
    } catch {
      console.error('Export PDF échoué');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div
      className="rounded-2xl glass glass-border overflow-hidden"
      style={{ borderColor: `${accent}35` }}
    >
      <div
        className="h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          boxShadow: `0 0 12px ${accent}`,
        }}
      />
      {/* ── En-tête ── */}
      <div
        className="px-6 py-4 flex items-center gap-3"
        style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: `${accent}18` }}
        >
          <Zap className="w-4 h-4" style={{ color: accent }} />
        </div>
        <div className="flex-1">
          <h3
            className="font-display font-bold text-sm"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Recommandation Opérateur — Point du Dataset
          </h3>
          <div
            className="text-[9px] font-mono flex items-center gap-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {point.timestamp.replace('T', ' ')} · score{' '}
            {point.anomaly_score.toFixed(4)} ·{' '}
            {SEASON_LABELS[point.season] || point.season}{' '}
            {point.month ? `· ${MONTHS[point.month - 1]}` : ''}
          </div>
        </div>
        <span
          className="px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider"
          style={{
            background: `${severityColor}15`,
            border: `1px solid ${severityColor}40`,
            color: severityColor,
          }}
        >
          {pharma.severity}
        </span>
        <button
          onClick={exportPdf}
          disabled={pdfLoading}
          className="inline-flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
          style={{
            background: 'rgba(13,148,136,0.10)',
            border: '1px solid rgba(13,148,136,0.25)',
            color: '#0D9488',
          }}
        >
          {pdfLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          {pdfLoading ? 'Génération…' : 'Exporter en PDF'}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="text-lg cursor-pointer px-2"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Fermer"
          >
            ×
          </button>
        )}
      </div>
      <div className="p-6 space-y-5">
        {/* ── Contexte du point ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="px-2 py-1 rounded-lg text-[8px] font-black"
            style={{
              background:
                point.label === 1
                  ? 'rgba(225,29,72,0.15)'
                  : 'rgba(13,148,136,0.10)',
              color: point.label === 1 ? '#E11D48' : '#0D9488',
            }}
          >
            {point.label === 1 ? 'ATTaque (label=1)' : 'Normal (label=0)'}
          </span>
          <span
            className="px-2 py-1 rounded-lg text-[8px] font-black"
            style={{
              background:
                point.prediction === 1
                  ? 'rgba(124,58,237,0.18)'
                  : 'color-mix(in srgb, var(--text-primary) 6%, transparent)',
              color:
                point.prediction === 1 ? '#7C3AED' : 'var(--color-text-muted)',
            }}
          >
            Modèle : {point.prediction === 1 ? 'Anomalie détectée' : 'Non détecté'}
          </span>
          <span
            className="px-2 py-1 rounded-lg text-[8px] font-black"
            style={{ background: `${accent}12`, color: accent }}
          >
            Capteur dominant :{' '}
            {GROUP_LABELS[point.dominant_sensor] || point.dominant_sensor}
          </span>
          <span
            className="text-[8px] font-mono ml-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            SHAP : {point.shap_method} · {point.model_kind}
          </span>
        </div>
        {/* ── Mesures capteurs ── */}
        <div className="grid grid-cols-3 gap-2">
          {['weather', 'fridge', 'thermostat'].map((k) => (
            <div
              key={k}
              className="rounded-xl p-3 text-center"
              style={{
                background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)',
                border: `1px solid ${GROUP_COLORS[k]}25`,
              }}
            >
              <div
                className="text-[8px] uppercase tracking-wider"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {k}
              </div>
              <div
                className="text-lg font-mono font-bold mt-1"
                style={{ color: GROUP_COLORS[k] }}
              >
                {sv[k] !== undefined ? `${sv[k].toFixed(2)}°C` : 'N/A'}
              </div>
            </div>
          ))}
        </div>
        {/* ── Domaine opérateur ── */}
        <div
          className="rounded-xl p-4"
          style={{ background: `${accent}08`, border: `1px solid ${accent}28` }}
        >
          <div
            className="text-[9px] font-black uppercase tracking-wider mb-1"
            style={{ color: accent }}
          >
            {pharma.domain_label}
          </div>
          <div
            className="text-[10px] leading-relaxed"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {pharma.sensor_role} — {pharma.product_impact}
          </div>
          <div
            className="mt-2 rounded-lg px-3 py-2 text-[9px]"
            style={{
              background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <b style={{ color: severityColor }}>
              Décision : {pharma.disposition.label}
            </b>{' '}
            — {pharma.disposition.description}
          </div>
        </div>
        {/* ── Pourquoi & SHAP (fusionnés) ── */}
        <div>
          <div
            className="text-[9px] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Pourquoi ce point est signalé — explication SHAP
          </div>
          <div
            className="text-[10px] leading-relaxed rounded-lg px-3 py-2 mb-2"
            style={{
              background: 'rgba(225,29,72,0.03)',
              border: '1px solid rgba(225,29,72,0.10)',
              color: 'var(--color-text-primary)',
            }}
          >
            {pharma.why}
          </div>
          <div className="space-y-2">
            {causes.map((c, i) => (
              <div
                key={i}
                className="rounded-xl p-3"
                style={{
                  background: 'rgba(225,29,72,0.04)',
                  border: '1px solid rgba(225,29,72,0.12)',
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {c.interpretation || c.feature}
                  </span>
                  <span
                    className="text-[9px] font-mono font-bold"
                    style={{ color: '#E11D48' }}
                  >
                    {fmtSigned(c.shap_value)}
                  </span>
                </div>
                <div
                  className="text-[8px] font-mono"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {c.feature} · valeur : {c.feature_value.toFixed(3)}
                </div>
              </div>
            ))}
          </div>
          {normals.length > 0 && (
            <div className="pt-2">
              <div
                className="text-[8px] font-bold uppercase tracking-wider mb-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Contre-arguments (vers « normal », positives)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {normals.map((c, i) => (
                  <span
                    key={i}
                    className="text-[8px] px-2 py-1 rounded-full"
                    style={{
                      background: 'rgba(13,148,136,0.08)',
                      border: '1px solid rgba(13,148,136,0.15)',
                      color: '#0D9488',
                    }}
                  >
                    {c.interpretation || c.feature} ({fmtSigned(c.shap_value)})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* ── Impact production / stock ── */}
        <div>
          <div
            className="text-[9px] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Impact potentiel (index 0-100)
          </div>
          <div className="space-y-2">
            <div>
              <div className="flex items-center justify-between text-[9px] mb-1">
                <span className="font-bold" style={{ color: '#D97706' }}>
                  Production
                </span>
                <span
                  className="font-mono"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {impact.production_impact}/100
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: 'rgba(255,184,48,0.10)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${impact.production_impact}%`,
                    background: 'linear-gradient(90deg, #D97706, #E11D48)',
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[9px] mb-1">
                <span className="font-bold" style={{ color: '#0891B2' }}>
                  Stock / Chaîne du froid
                </span>
                <span
                  className="font-mono"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {impact.stock_impact}/100
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: 'rgba(8,145,178,0.10)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${impact.stock_impact}%`,
                    background: 'linear-gradient(90deg, #0891B2, #0D9488)',
                  }}
                />
              </div>
            </div>
          </div>
          <div
            className="text-[9px] mt-2 italic"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {impact.effect}
          </div>
        </div>
        {/* ── Recommandations ── */}
        <div>
          <div
            className="text-[9px] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Recommandations opérateur
          </div>
          <div className="space-y-1.5">
            {pharma.actions.map((a, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg px-3 py-2 text-[9px]"
                style={{
                  background: 'color-mix(in srgb, var(--text-primary) 3%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--text-primary) 6%, transparent)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <Activity
                  className="w-3 h-3 shrink-0 mt-0.5"
                  style={{ color: accent }}
                />
                {a}
              </div>
            ))}
          </div>
        </div>
        {/* ── Vulnérabilités CVE ── */}
        {cve && (
          <div>
            <div
              className="text-[9px] font-bold uppercase tracking-wider mb-2"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Vulnérabilités CVE
              {cve.available ? ` · score ${Math.round(cve.risk_score)}/100` : ''}
            </div>
            {cve.available && cve.total_cves > 0 ? (
              <div className="space-y-1.5">
                {cve.top_cves.slice(0, 6).map((c) => (
                  <div
                    key={c.cve_id}
                    className="rounded-lg px-3 py-2 text-[9px]"
                    style={{
                      background: 'color-mix(in srgb, var(--text-primary) 3%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--text-primary) 6%, transparent)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="font-mono font-bold"
                        style={{ color: CVE_SEV_STYLE[c.cvss_severity] || '#0D9488' }}
                      >
                        {c.cve_id}
                      </span>
                      <span
                        className="text-[8px] font-bold px-1.5 py-0.5 rounded"
                        style={{
                          background: `color-mix(in srgb, ${CVE_SEV_STYLE[c.cvss_severity] || '#0D9488'} 14%, transparent)`,
                          color: CVE_SEV_STYLE[c.cvss_severity] || '#0D9488',
                        }}
                      >
                        {c.cvss_severity || 'UNKNOWN'}
                      </span>
                      <span className="font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                        CVSS {c.cvss_score ?? '—'}
                      </span>
                      <span className="font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                        EPSS {c.epss_score != null ? `${(c.epss_score * 100).toFixed(1)}%` : '—'}
                      </span>
                      <span
                        className="ml-auto font-bold"
                        style={{ color: CVE_SEV_STYLE[c.cvss_severity] || '#0D9488' }}
                      >
                        {Math.round(c.risk_score)}/100
                      </span>
                    </div>
                    <p className="mt-1 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      {c.description}
                    </p>
                  </div>
                ))}
                <div className="text-[8px] italic" style={{ color: 'var(--color-text-secondary)' }}>
                  {cve.total_cves} CVE au total · {cve.critical_count} critiques · {cve.high_count} élevées
                  {' · '}{cve.medium_count} moyennes · {cve.low_count} basses — {cve.source}
                </div>
              </div>
            ) : (
              <div className="text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
                {cve.available
                  ? 'Aucune CVE matchée pour ce capteur.'
                  : cve.error || 'Données CVE indisponibles.'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}