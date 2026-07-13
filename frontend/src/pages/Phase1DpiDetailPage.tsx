import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import DpiAlertDetail from '../components/DpiAlertDetail';


export default function Phase1DpiDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const alert = (location.state as any)?.alert;

  const now = new Date();

  if (!alert) {
    return (
      <div style={{ maxWidth: 1400, margin: '0 auto', textAlign: 'center', paddingTop: 80, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>{'\u{26a0}\u{fe0f}'}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#E2E8F0', marginBottom: 8 }}>Alerte introuvable</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 24 }}>
          Les alertes DPI sont stockées dans la session. Reviens au dashboard Phase 1 et clique sur une alerte.
        </div>
        <button onClick={() => navigate('/phase1')} style={{
          background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)',
          color: '#818CF8', cursor: 'pointer', fontSize: 11, fontWeight: 600,
          padding: '10px 24px', borderRadius: 8,
        }}>
          ← Retour à la Phase 1
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{
        background: 'linear-gradient(135deg, rgba(15,23,42,0.8), rgba(11,15,26,0.5))',
        border: '1px solid rgba(99,102,241,0.1)',
        borderRadius: 16, padding: '18px 24px', marginBottom: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 14,
            background: 'linear-gradient(135deg, #818CF8, #38BDF8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, color: '#fff',
          }}>
            {'\u{1f50d}'}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.5px' }}>
              Détail DPI — {alert.rule.id}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: "'JetBrains Mono', monospace" }}>
                {now.toLocaleDateString('fr-FR')} · {now.toLocaleTimeString('fr-FR')}
              </span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', fontFamily: "'JetBrains Mono', monospace" }}>
                {alert.rule.name}
              </span>
            </div>
          </div>
        </div>
        <button onClick={() => navigate('/phase1')} style={{
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.1)',
          color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
          padding: '8px 20px', borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          ← Retour Phase 1
        </button>
      </motion.div>

      <DpiAlertDetail alert={alert} onClose={() => navigate('/phase1')} />
    </div>
  );
}
