import { useRef, useCallback } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export default function PdfExport({ targetId }: { targetId: string }) {
  const loading = useRef(false);

  const handleExport = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const el = document.getElementById(targetId);
      if (!el) return;
      const canvas = await html2canvas(el, { backgroundColor: '#0B1120', scale: 2 } as any);
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a3');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save('dashboard-peaksoft.pdf');
    } catch (e) {
      console.error('PDF export failed', e);
    } finally {
      loading.current = false;
    }
  }, [targetId]);

  return (
    <button
      onClick={handleExport}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200 hover:brightness-125"
      style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent-primary)', border: '1px solid var(--color-accent-primary)' }}
    >
      📄 Export PDF
    </button>
  );
}
