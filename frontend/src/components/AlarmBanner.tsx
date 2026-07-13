import { useEffect, useState, useRef } from 'react';

interface Alarm {
  id: number;
  time: string;
  message: string;
  level: 'info' | 'warning' | 'critical';
}

const LEVEL_STYLES = {
  info: { color: '#22C55E', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)' },
  warning: { color: '#F97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.3)' },
  critical: { color: '#EF4444', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)' },
};

export default function AlarmBanner({ alarms: initialAlarms }: { alarms: Alarm[] }) {
  const [alarms, setAlarms] = useState(initialAlarms);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAlarms(initialAlarms);
  }, [initialAlarms]);

  useEffect(() => {
    const interval = setInterval(() => {
      const newAlarm: Alarm = {
        id: Date.now(),
        time: new Date().toLocaleTimeString('fr-FR'),
        message: `Attaque ${['injection', 'recon', 'mitm', 'ddos'][Math.floor(Math.random() * 4)]} détectée — Score: ${(Math.random() * 0.5 + 0.5).toFixed(2)}`,
        level: Math.random() > 0.7 ? 'critical' : Math.random() > 0.4 ? 'warning' : 'info',
      };
      setAlarms(prev => [newAlarm, ...prev].slice(0, 50));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(255,255,255,0.5)' }}>
            Journal d'alarmes
          </span>
          <span style={{
            fontSize: 9, padding: '1px 7px', borderRadius: 4,
            background: 'rgba(239,68,68,0.2)', color: '#EF4444',
          }}>
            TEMPS RÉEL
          </span>
        </div>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{alarms.length} entrées</span>
      </div>
      <div ref={containerRef} style={{
        maxHeight: 280, overflowY: 'auto', padding: '6px',
        display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        {alarms.slice(0, 30).map((a) => {
          const s = LEVEL_STYLES[a.level];
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
              borderRadius: 6, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              background: s.bg, border: `1px solid ${s.border}`,
            }}>
              <span style={{ color: 'rgba(255,255,255,0.25)', minWidth: 65, fontSize: 10 }}>{a.time}</span>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: s.color, boxShadow: `0 0 6px ${s.color}`,
                flexShrink: 0,
              }} />
              <span style={{ color: s.color, flex: 1 }}>{a.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
