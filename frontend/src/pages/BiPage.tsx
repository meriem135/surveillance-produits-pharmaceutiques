import { useState } from 'react';
import { motion } from 'framer-motion';

export default function BiPage() {
  const [embedUrl, setEmbedUrl] = useState('');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-bg-panel border border-border-panel rounded-2xl p-5 mb-6">
        <h2 className="font-display font-semibold text-lg mb-2">📈 Power BI Analytics</h2>
        <p className="text-text-secondary text-xs mb-4">
          Visualisations analytiques avancées avec Power BI. 
          Colle le lien d'embed public de ton rapport ci-dessous.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="https://app.powerbi.com/reportEmbed?reportId=..."
            value={embedUrl}
            onChange={(e) => setEmbedUrl(e.target.value)}
            className="flex-1 bg-bg-card border border-border-panel text-text-primary px-4 py-2.5 rounded-xl text-xs outline-none transition-all focus:border-[var(--accent-primary)]"
          />
          {embedUrl && (
            <button
              onClick={() => setEmbedUrl('')}
              className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer border"
              style={{ color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)', background: 'rgba(239,68,68,0.1)' }}
            >
              Réinitialiser
            </button>
          )}
        </div>
        <div className="mt-4 flex gap-4 text-xs text-text-secondary">
          <span>1. Publie ton rapport sur <strong>Power BI Service</strong> (gratuit avec compte étudiant)</span>
          <span>2. <strong>Fichier → Publier sur le web → Générer le code incorporé</strong></span>
          <span>3. Copie l'URL et colle-la ci-dessus</span>
        </div>
      </div>

      {/* Embed area */}
      {embedUrl ? (
        <div className="flex-1 bg-bg-panel border border-border-panel rounded-2xl overflow-hidden">
          <iframe
            src={embedUrl}
            width="100%"
            height="100%"
            style={{ border: 'none', minHeight: '600px' }}
            allowFullScreen
          />
        </div>
      ) : (
        <div className="flex-1 bg-bg-panel border border-border-panel rounded-2xl flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="text-5xl mb-4">📊</div>
            <h3 className="font-display font-semibold text-base mb-2">Power BI Analytics</h3>
            <p className="text-text-secondary text-xs leading-relaxed">
              Colle le lien d'embed public ci-dessus pour afficher tes rapports Power BI.
              Tu peux créer des dashboards analytiques avancés avec DAX, 
              des mesures personnalisées, et des visuals Machine Learning.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 text-left text-xs">
              {[
                { icon: '📊', title: 'Bar & Column Charts', desc: 'Comparaisons de métriques' },
                { icon: '📈', title: 'Line & Area Charts', desc: 'Tendances temporelles' },
                { icon: '🥧', title: 'Pie & Donut Charts', desc: 'Distributions et parts' },
                { icon: '🧠', title: 'AI Visuals', desc: 'Détection d\'anomalies, prévisions' },
                { icon: '🗺️', title: 'Map & Filled Map', desc: 'Géolocalisation des menaces' },
                { icon: '📋', title: 'Tables & Matrices', desc: 'Données détaillées avec drill-down' },
              ].map((item) => (
                <div key={item.title} className="bg-bg-card border border-border-panel rounded-xl p-3">
                  <div className="font-semibold mb-1">{item.icon} {item.title}</div>
                  <div className="text-text-secondary">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
