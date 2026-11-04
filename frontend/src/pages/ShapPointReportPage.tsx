/** Rapport d'un point en pleine page (archive phase 2) : /dashboard/shap/report?timestamp=…
 *  GET /api/shap/point puis POST /api/v1/pharma/point-report (voir loadPointReport). */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Empty, Loading, PageHeader } from '../components/etude/kit';
import ShapPointReport, { loadPointReport, type PharmaReportResponse, type ShapPointResponse } from '../components/ShapPointReport';

export default function ShapPointReportPage() {
  const [searchParams] = useSearchParams();
  const timestamp = searchParams.get('timestamp') || '';
  const [data, setData] = useState<{ point: ShapPointResponse; pharma: PharmaReportResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!timestamp) {
      setError('Point non spécifié (timestamp manquant dans l’URL).');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    loadPointReport(timestamp)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur lors du chargement du rapport'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [timestamp, nonce]);

  return (
    <div className="space-y-6">
      <PageHeader title="Rapport d’un point"
        subtitle="Archive de l’année simulée 2019 (phase 2), pas l’étude de référence sur traces réelles : explication SHAP du point et recommandation opérateur."
        loading={loading} onRefresh={timestamp ? () => setNonce(n => n + 1) : undefined}>
        <Link to="/dashboard/shap" className="vc-btn"><ArrowLeft className="w-3.5 h-3.5" aria-hidden /> Retour à l’analyse SHAP</Link>
      </PageHeader>
      {loading && !data ? <Loading />
        : error || !data ? <Empty>Rapport indisponible : {error || 'impossible de charger ce point.'}</Empty>
        : <ShapPointReport point={data.point} pharma={data.pharma} />}
    </div>
  );
}
