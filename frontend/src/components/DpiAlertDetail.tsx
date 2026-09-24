import { motion } from 'framer-motion';

interface DpiAlert {
  rule: {
    id: string;
    name: string;
    level: number;
    description: string;
    groups: string[];
    correlation?: {
      matched_rules: string[];
      count: number;
      boost: number;
    };
  };
  data: {
    device: string;
    payload: Record<string, any>;
  };
  timestamp: string;
}

interface Props {
  alert: DpiAlert | null;
  onClose: () => void;
  inline?: boolean;
}

const LEVEL_META: Record<number, { label: string; color: string }> = {
  12: { label: 'CRITIQUE', color: '#FF1744' },
  9: { label: 'ÉLEVÉ', color: '#FF9100' },
  7: { label: 'MOYEN', color: '#FFD600' },
  6: { label: 'MOYEN', color: '#FFD600' },
  5: { label: 'FAIBLE', color: '#38BDF8' },
  3: { label: 'INFO', color: '#00E676' },
};

const RULE_DOCS: Record<string, { problem: string; impact: string; action: string }> = {
  'DPI-001': {
    problem: 'Le label de la trame MQTT indique une attaque explicite (champ label=1 ou "attack")',
    impact: 'Intégrité des données compromise, risque de commandes malveillantes sur les actionneurs',
    action: 'Vérifier la source de la trame, isoler le capteur compromis, analyser les logs MQTT',
  },
  'DPI-002': {
    problem: 'Le facteur de bruit dépasse le seuil de 0.04, indiquant un comportement anormal du capteur',
    impact: 'Mesures non fiables, fausses lectures pouvant déclencher des actions incorrectes',
    action: 'Inspecter le capteur pour défaillance matérielle ou interférence réseau',
  },
  'DPI-003': {
    problem: 'Perte de paquet simulée détectée (packet_loss_sim = 1)',
    impact: 'Données manquantes dans la séquence temporelle, lacunes dans l\'historique',
    action: 'Vérifier la connectivité réseau et l\'intégrité du lien MQTT',
  },
  'DPI-004': {
    problem: 'Une valeur de capteur dépasse les limites acceptables pour ce type d\'équipement',
    impact: 'Risque de dommages matériels ou de déclenchement intempestif d\'alarmes',
    action: 'Comparer avec les capteurs voisins, vérifier l\'étalonnage',
  },
  'DPI-005': {
    problem: 'Pic de température au-delà de la moyenne saisonnière + 3.5σ (seuil ~46°C l\u2019été, adapté à chaque saison)',
    impact: 'Emballement thermique, risque d\u2019incendie ou injection de fausses valeurs',
    action: 'Analyser la tendance sur les dernières minutes, contrôler l\u2019environnement, vérifier le capteur',
  },
  'DPI-006': {
    problem: 'Valeur d\'humidité en dehors de la plage valide [0%, 100%]',
    impact: 'Capteur défaillant ou donnée falsifiée',
    action: 'Vérifier le capteur d\'humidité, remplacer si nécessaire',
  },
};

export default function DpiAlertDetail({ alert, onClose, inline }: Props) {
  if (!alert) return null;
  const meta = LEVEL_META[alert.rule.level] || { label: 'INFO', color: '#94A3B8' };
  const docs = RULE_DOCS[alert.rule.id] || {
    problem: 'Règle déclenchée par le moteur DPI',
    impact: 'À déterminer selon le contexte',
    action: 'Consulter les logs pour plus de détails',
  };

  const inner = (
    <div style={{
      background: 'linear-gradient(135deg, #0F172A, #1E293B)',
      border: `1px solid ${meta.color}25`,
      borderRadius: 12, overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: `1px solid ${meta.color}12`,
        background: `linear-gradient(135deg, ${meta.color}08, transparent)`,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 5,
              background: `${meta.color}20`, color: meta.color,
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.5px',
            }}>{alert.rule.id}</span>
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '1px 8px', borderRadius: 3,
              background: `${meta.color}15`, color: meta.color, letterSpacing: '0.8px',
            }}>{meta.label} · NIVEAU {alert.rule.level}/15</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#E2E8F0' }}>
            {alert.rule.name}
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
            {new Date(alert.timestamp).toLocaleString('fr-FR')}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.06)', border: 'none', color: 'rgba(255,255,255,0.3)',
          width: 26, height: 26, borderRadius: 6, cursor: 'pointer', fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✕</button>
      </div>
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: `${meta.color}06`, border: `1px solid ${meta.color}10`,
        }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: meta.color, letterSpacing: '1px', marginBottom: 3 }}>
            PROBLÈME DÉTECTÉ
          </div>
          <div style={{ fontSize: 10, color: '#CBD5E1', lineHeight: 1.5 }}>
            {docs.problem}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '1px', marginBottom: 2 }}>
            IMPACT
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
            {docs.impact}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#00E676', letterSpacing: '1px', marginBottom: 2 }}>
            ACTION RECOMMANDÉE
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
            {docs.action}
          </div>
        </div>
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(99,102,241,0.08)',
        }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#818CF8', letterSpacing: '1px', marginBottom: 6 }}>
            DONNÉES DE LA TRAME
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
            {Object.entries(alert.data.payload).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 4, fontSize: 8 }}>
                <span style={{ color: 'rgba(255,255,255,0.2)', fontFamily: "'JetBrains Mono', monospace", minWidth: 60 }}>
                  {k}
                </span>
                <span style={{
                  color: typeof v === 'number' ? '#38BDF8' : 'rgba(255,255,255,0.5)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: typeof v === 'number' ? 600 : 400,
                }}>
                  {typeof v === 'number' ? v.toFixed(2) : String(v).slice(0, 18)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {alert.rule.groups.map(g => (
            <span key={g} style={{
              fontSize: 7, padding: '1px 7px', borderRadius: 3,
              background: 'rgba(99,102,241,0.1)', color: '#818CF8',
            }}>{g}</span>
          ))}
        </div>
      </div>
    </div>
  );

  if (inline) {
    return (
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 4 }}>
        {inner}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 20 }}
        transition={{ duration: 0.2 }}
        onClick={e => e.stopPropagation()}
        style={{ width: '90%', maxWidth: 520, maxHeight: '80vh', overflowY: 'auto' }}
      >
        {inner}
      </motion.div>
    </motion.div>
  );
}
