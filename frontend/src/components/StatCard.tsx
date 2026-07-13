import { type ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  description: string;
  accentColor?: string;
  icon?: ReactNode;
}

export default function StatCard({ title, value, description, accentColor = 'var(--color-accent-success)', icon }: StatCardProps) {
  return (
    <div className="rounded-2xl p-4 relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5 group"
      style={{
        background: 'var(--color-bg-panel)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${accentColor} 5%, transparent) 0%, transparent 50%)`,
        }}
      />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{
            background: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
            color: accentColor,
          }}>
            {icon}
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider opacity-60" style={{ color: 'var(--color-text-secondary)' }}>
            {title}
          </span>
        </div>
          <div className="font-display text-xl font-bold tracking-tight" style={{ color: accentColor }}>
          {value}
        </div>
        <div className="text-xs mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
          {description}
        </div>
      </div>
    </div>
  );
}
