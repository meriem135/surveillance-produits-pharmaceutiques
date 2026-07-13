import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { Telemetry } from '../types';

interface TimelineChartProps {
  data: Telemetry[];
}

export default function TimelineChart({ data }: TimelineChartProps) {
  const chartData = data.map((d) => ({
    time: d.timestamp.split(' ')[1]?.slice(0, 5) ?? d.timestamp,
    score: d.metric_value.normality_score,
  }));

  return (
    <div className="bg-bg-panel border border-border-panel rounded-2xl p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-5">
        <h3 className="font-display font-semibold text-lg flex items-center gap-2">
          <span>📈</span> Évolution de la Stabilité de l'Usine
        </h3>
        <span className="text-xs text-text-secondary">Score de normalité comportementale</span>
      </div>
      <div className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00F5FF" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#00F5FF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#9ca3af"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={60}
            />
            <YAxis
              domain={[0, 100]}
              stroke="#9ca3af"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                background: '#111827',
                border: '1px solid rgba(55,65,81,0.35)',
                borderRadius: 8,
                fontSize: 13,
              }}
              labelStyle={{ color: '#9ca3af' }}
               formatter={(value: unknown) => { const v = Number(value); return [`${v.toFixed(1)}%`, 'Normalité']; }}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke="#00F5FF"
              strokeWidth={2.5}
              fill="url(#scoreGrad)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
