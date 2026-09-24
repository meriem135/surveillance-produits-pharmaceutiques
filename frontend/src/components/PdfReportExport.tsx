import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Download, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { authHeaders } from '../lib/auth';

interface ReportData {
  model_metrics?: Record<string, any>;
  feature_selection?: Record<string, any>;
  grid_search?: Record<string, any>;
  shap?: Record<string, any>;
  training_info?: Record<string, any>;
  attack_metrics?: Array<Record<string, any>>;
  monthly_breakdown?: Array<Record<string, any>>;
  seasonal_breakdown?: Array<Record<string, any>>;
}

export default function PdfReportExport({ trainResult }: { trainResult?: ReportData | null }) {
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const generatePdf = async () => {
    setGenerating(true);
    setStatus(null);
    try {
      // Gather all data for the report
      const payload: Record<string, any> = {};

      // Fetch fresh data from APIs
      const resultsData = await fetch('/api/v1/phase2/results').then(r => r.json()).catch(() => null);

      if (trainResult) payload.train_result = trainResult;
      if (resultsData && !resultsData.error) payload.model_comparison = resultsData;

      // Also get attack metrics
      const attackData = await fetch('/api/v1/phase2/attack-metrics').then(r => r.json()).catch(() => null);
      if (attackData?.metrics) payload.attack_metrics = attackData.metrics;

      // Send to backend PDF endpoint
      const resp = await fetch('/api/v1/analyst/phase2-period-report-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      // Download the PDF blob
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport_datascience_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus({ ok: true, msg: 'Rapport PDF téléchargé avec succès' });
    } catch (err: unknown) {
      // Fallback: try client-side PDF generation via existing jsPDF
      try {
        const { jsPDF } = await import('jspdf');
        await import('jspdf-autotable');
        const doc = new jsPDF('p', 'mm', 'a4');
        let y = 20;

        // Title
        doc.setFontSize(18);
        doc.setTextColor(15, 23, 42);
        doc.text('Rapport Data Science — VigiloChain Security', 20, y);
        y += 10;
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, 20, y);
        y += 15;

        // Model metrics section
        if (trainResult?.model_metrics) {
          doc.setFontSize(14);
          doc.setTextColor(34, 197, 94);
          doc.text('Métriques du Modèle', 20, y);
          y += 10;
          doc.setFontSize(10);
          doc.setTextColor(55, 65, 81);
          const m = trainResult.model_metrics;
          const metricsData = [
            ['F1 Score', `${((m.f1 || 0) * 100).toFixed(2)}%`],
            ['Précision', `${((m.precision || 0) * 100).toFixed(2)}%`],
            ['Rappel', `${((m.recall || 0) * 100).toFixed(2)}%`],
            ['ROC-AUC', `${((m.roc_auc || 0) * 100).toFixed(2)}%`],
            ['VP/FP/FN/VN', `${m.tp || 0}/${m.fp || 0}/${m.fn || 0}/${m.tn || 0}`],
          ];
          (doc as any).autoTable({ startY: y, head: [['Métrique', 'Valeur']], body: metricsData, theme: 'grid', headStyles: { fillColor: [34, 197, 94] } });
          y = (doc as any).lastAutoTable.finalY + 15;
        }

        // Training info
        if (trainResult?.training_info) {
          doc.setFontSize(14);
          doc.setTextColor(168, 139, 250);
          doc.text('Informations d\'Entraînement', 20, y);
          y += 10;
          doc.setFontSize(10);
          doc.setTextColor(55, 65, 81);
          const ti = trainResult.training_info;
          const infoData = [
            ['Durée', `${ti.duration_seconds || 0}s`],
            ['Échantillons total', `${(ti.n_total_samples || 0).toLocaleString()}`],
            ['Normaux', `${(ti.n_normal_samples || 0).toLocaleString()}`],
            ['Attaques', `${(ti.n_attack_samples || 0).toLocaleString()}`],
            ['Features originales', `${ti.n_features_original || 0}`],
            ['Features sélectionnées', `${ti.n_features_selected || 0}`],
          ];
          (doc as any).autoTable({ startY: y, head: [['Info', 'Valeur']], body: infoData, theme: 'grid', headStyles: { fillColor: [168, 139, 250] } });
          y = (doc as any).lastAutoTable.finalY + 15;
        }

        // Grille manuelle section
        if (trainResult?.grid_search) {
          doc.setFontSize(14);
          doc.setTextColor(245, 158, 11);
          doc.text('Optimisation Hyperparamètres (Grille manuelle)', 20, y);
          y += 10;
          doc.setFontSize(10);
          doc.setTextColor(55, 65, 81);
          const g = trainResult.grid_search;
          const gData = [
            ['Configurations', `${g.n_trials || 0}`],
            ['Best CV ROC-AUC', `${g.best_cv_roc_auc || 0}`],
            ['Recherche', `${g.search_type || '3 nu × 4 gamma'}`],
            ...Object.entries(g.best_params || {}).map(([k, v]) => [k, String(v)]),
          ];
          (doc as any).autoTable({ startY: y, head: [['Paramètre', 'Valeur']], body: gData, theme: 'grid', headStyles: { fillColor: [245, 158, 11] } });
          y = (doc as any).lastAutoTable.finalY + 15;
        }

        // Feature importance
        if (trainResult?.shap?.global_importance) {
          doc.setFontSize(14);
          doc.setTextColor(99, 102, 241);
          doc.text('Importance des Features (SHAP)', 20, y);
          y += 10;
          doc.setFontSize(10);
          doc.setTextColor(55, 65, 81);
          const featData = trainResult.shap.global_importance.slice(0, 15).map((f: any) => [f.feature, f.shap_importance.toFixed(6)]);
          if (featData.length > 0) {
            (doc as any).autoTable({ startY: y, head: [['Feature', 'Importance SHAP']], body: featData, theme: 'grid', headStyles: { fillColor: [99, 102, 241] } });
            y = (doc as any).lastAutoTable.finalY + 15;
          }
        }

        // Attack metrics
        const atkMetrics = trainResult?.attack_metrics;
        if (atkMetrics && atkMetrics.length > 0) {
          doc.setFontSize(14);
          doc.setTextColor(239, 68, 68);
          doc.text('Métriques par Attaque', 20, y);
          y += 10;
          doc.setFontSize(10);
          doc.setTextColor(55, 65, 81);
          const atkData = atkMetrics.map((a: any) => [
            a.attack_type || '—', `${a.n_total || 0}`, `${a.n_detected || 0}`,
            `${a.detection_rate || 0}%`, `${a.avg_score || 0}`,
          ]);
          (doc as any).autoTable({ startY: y, head: [['Type', 'Total', 'Détectés', 'Taux', 'Score']], body: atkData, theme: 'grid', headStyles: { fillColor: [239, 68, 68] } });
          y = (doc as any).lastAutoTable.finalY + 15;
        }

        // Footer
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text('VigiloChain Security Platform — Rapport généré automatiquement par le module Data Science', 20, 285);

        doc.save(`rapport_datascience_${new Date().toISOString().slice(0, 10)}.pdf`);
        setStatus({ ok: true, msg: 'Rapport PDF téléchargé (client)' });
      } catch (innerErr) {
        setStatus({ ok: false, msg: `Erreur: ${err instanceof Error ? err.message : 'Génération impossible'}` });
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="rounded-2xl overflow-hidden glass glass-border" style={{ borderColor: 'rgba(59,130,246,0.15)' }}>
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <FileText className="w-4 h-4" style={{ color: '#3B82F6' }} />
          <h3 className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>📄 Rapport Data Science</h3>
        </div>
        <div className="p-5">
          <p className="text-[10px] mb-4" style={{ color: 'var(--color-text-secondary)' }}>
            Exportez un rapport PDF complet incluant les métriques du modèle, l'optimisation par grille manuelle, l'importance SHAP, et les performances par type d'attaque. Idéal pour présenter vos résultats.
          </p>
          <button onClick={generatePdf} disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-all"
            style={{
              background: generating ? 'rgba(255,255,255,0.04)' : 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(139,92,246,0.2))',
              color: generating ? 'var(--color-text-secondary)' : '#3B82F6',
              border: `1px solid ${generating ? 'rgba(255,255,255,0.06)' : 'rgba(59,130,246,0.3)'}`,
            }}>
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {generating ? 'Génération...' : 'Télécharger le rapport PDF'}
          </button>
          {status && (
            <div className={`flex items-center gap-1.5 mt-3 text-[10px] ${status.ok ? '' : ''}`} style={{ color: status.ok ? '#22C55E' : '#EF4444' }}>
              {status.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {status.msg}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
