import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { MapContainer, TileLayer, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { Search } from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Fix Leaflet marker icon issue
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

interface Attack {
  id: number;
  lat: number;
  lng: number;
  city: string;
  country: string;
  type: string;
  severity: number;
  count: number;
}

const MOCK_ATTACKS: Attack[] = [
  { id: 1, lat: 48.8566, lng: 2.3522, city: 'Paris', country: 'France', type: 'Brute Force', severity: 7, count: 1250 },
  { id: 2, lat: 40.7128, lng: -74.006, city: 'New York', country: 'USA', type: 'Scan', severity: 5, count: 3400 },
  { id: 3, lat: 55.7558, lng: 37.6173, city: 'Moscow', country: 'Russia', type: 'DDoS', severity: 10, count: 8900 },
  { id: 4, lat: 39.9042, lng: 116.4074, city: 'Beijing', country: 'China', type: 'Scan', severity: 5, count: 5600 },
  { id: 5, lat: 35.6762, lng: 139.6503, city: 'Tokyo', country: 'Japan', type: 'Malware', severity: 8, count: 2100 },
  { id: 6, lat: 51.5074, lng: -0.1278, city: 'London', country: 'UK', type: 'Phishing', severity: 6, count: 1800 },
  { id: 7, lat: 52.52, lng: 13.405, city: 'Berlin', country: 'Germany', type: 'Brute Force', severity: 7, count: 2900 },
  { id: 8, lat: 37.7749, lng: -122.4194, city: 'San Francisco', country: 'USA', type: 'Ransomware', severity: 14, count: 450 },
  { id: 9, lat: -23.5505, lng: -46.6333, city: 'Sao Paulo', country: 'Brazil', type: 'DDoS', severity: 8, count: 3200 },
  { id: 10, lat: 28.6139, lng: 77.209, city: 'New Delhi', country: 'India', type: 'Brute Force', severity: 6, count: 4100 },
];

function getSeverityColor(severity: number): string {
  if (severity >= 10) return '#EF4444';
  if (severity >= 7) return '#F97316';
  if (severity >= 5) return '#F59E0B';
  return '#22C55E';
}

function getSeverityRadius(count: number): number {
  return Math.min(Math.max(Math.sqrt(count) * 1.5, 6), 30);
}

const threatTypeData = Object.entries(MOCK_ATTACKS.reduce((acc, a) => { const k = a.type; (acc[k] ??= []).push(a); return acc; }, {} as Record<string, Attack[]>)).map(([type, attacks]) => ({
  type, count: attacks.reduce((s, a) => s + a.count, 0),
}));

export default function ThreatsPage() {
  const [search, setSearch] = useState('');
  const [selectedAttack, setSelectedAttack] = useState<Attack | null>(null);

  const totalAttacks = useMemo(() => MOCK_ATTACKS.reduce((s, a) => s + a.count, 0), []);
  const avgSeverity = useMemo(() => Math.round(MOCK_ATTACKS.reduce((s, a) => s + a.severity, 0) / MOCK_ATTACKS.length), []);
  const topThreat = useMemo(() => [...threatTypeData].sort((a, b) => b.count - a.count)[0], []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Attaques Détectées', value: totalAttacks.toLocaleString(), color: 'var(--accent-danger)' },
          { label: 'Sévérité Moyenne', value: `${avgSeverity}/14`, color: 'var(--accent-warning)' },
          { label: 'Menace Principale', value: topThreat?.type || '—', color: 'var(--accent-primary)' },
        ].map((s) => (
          <div key={s.label} className="bg-bg-panel border border-border-panel rounded-2xl p-5">
            <div className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-2">{s.label}</div>
            <div className="font-display text-3xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Map + Chart Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 mb-6">
        {/* Map */}
        <div className="bg-bg-panel border border-border-panel rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-sm">Carte des Attaques en Temps Réel</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
              <input type="text" placeholder="Rechercher une ville..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="bg-bg-card border border-border-panel text-text-primary pl-8 pr-3 py-2 rounded-lg text-xs outline-none w-48" />
            </div>
          </div>
          <div className="h-[400px] rounded-xl overflow-hidden">
            <MapContainer center={[30, 0]} zoom={2} scrollWheelZoom={true} className="h-full w-full" style={{ background: 'var(--bg-base)' }}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              />
              {MOCK_ATTACKS.filter((a) => !search.trim() || a.city.toLowerCase().includes(search.toLowerCase())).map((attack) => (
                <CircleMarker
                  key={attack.id}
                  center={[attack.lat, attack.lng]}
                  radius={getSeverityRadius(attack.count)}
                  pathOptions={{
                    color: getSeverityColor(attack.severity),
                    fillColor: getSeverityColor(attack.severity),
                    fillOpacity: 0.35,
                    weight: 2,
                  }}
                  eventHandlers={{ click: () => setSelectedAttack(attack) }}
                >
                  <Popup>
                    <div className="text-xs">
                      <div className="font-bold text-sm mb-1">{attack.city}, {attack.country}</div>
                      <div>Type: <span className="font-semibold">{attack.type}</span></div>
                      <div>Sévérité: <span className="font-semibold" style={{ color: getSeverityColor(attack.severity) }}>{attack.severity}/14</span></div>
                      <div>Attaques: <span className="font-semibold">{attack.count.toLocaleString()}</span></div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>

        {/* Threat Types Chart */}
        <div className="bg-bg-panel border border-border-panel rounded-2xl p-5">
          <h3 className="font-display font-semibold text-sm mb-4">Types de Menaces</h3>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={threatTypeData} layout="vertical">
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" stroke="var(--text-secondary)" tick={{ fontSize: 10 }} />
                <YAxis dataKey="type" type="category" stroke="var(--text-secondary)" tick={{ fontSize: 10 }} width={80} />
                <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8 }} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {threatTypeData.map((entry) => (
                    <Cell key={entry.type} fill={entry.type === 'Ransomware' ? 'var(--accent-danger)' : entry.type === 'DDoS' ? 'var(--accent-warning)' : 'var(--accent-primary)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Attack Details */}
      {selectedAttack && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="bg-bg-panel border border-border-panel rounded-2xl p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm">{selectedAttack.city}, {selectedAttack.country}</h3>
            <button onClick={() => setSelectedAttack(null)} className="text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>Fermer ✕</button>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Type', value: selectedAttack.type, color: 'var(--accent-primary)' },
              { label: 'Sévérité', value: `${selectedAttack.severity}/14`, color: getSeverityColor(selectedAttack.severity) },
              { label: 'Nombre d\'attaques', value: selectedAttack.count.toLocaleString(), color: 'var(--accent-warning)' },
              { label: 'Niveau de menace', value: selectedAttack.severity >= 10 ? 'CRITIQUE' : selectedAttack.severity >= 7 ? 'ÉLEVÉ' : 'MOYEN', color: getSeverityColor(selectedAttack.severity) },
            ].map((s) => (
              <div key={s.label} className="bg-bg-card rounded-xl p-4 border" style={{ borderColor: 'var(--border)' }}>
                <div className="text-text-secondary text-[10px] font-bold uppercase tracking-wider mb-1">{s.label}</div>
                <div className="font-display font-bold text-lg" style={{ color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
