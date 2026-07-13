import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import type { Telemetry } from '../types';

interface SensorsChartProps {
  data: Telemetry[];
}

export default function SensorsChart({ data }: SensorsChartProps) {
  const chartData = data.map((d) => ({
    time: d.timestamp.split(' ')[1]?.slice(0, 5) ?? d.timestamp,
    Weather: d.metric_value.sensors.weather_temperature,
    Fridge: d.metric_value.sensors.fridge_temperature,
    Thermostat: d.metric_value.sensors.thermostat_temperature,
  }));

  return (
    <div className="bg-bg-panel border border-border-panel rounded-2xl p-5 backdrop-blur-sm h-full">
      <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-3">
        <h3 className="font-display font-semibold text-sm flex items-center gap-2">
          <span>🌡️</span> Températures Capteurs IoT
        </h3>
        <span className="text-[10px] text-text-secondary">Weather · Fridge · Thermostat</span>
      </div>
      <div className="h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
              stroke="#9ca3af"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              contentStyle={{
                background: '#111827',
                border: '1px solid rgba(55,65,81,0.35)',
                borderRadius: 8,
                fontSize: 13,
              }}
              labelStyle={{ color: '#9ca3af' }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
              iconType="plainline"
            />
            <Line type="monotone" dataKey="Weather" stroke="#38BDF8" strokeWidth={1.8} dot={false} name="Weather" />
            <Line type="monotone" dataKey="Fridge" stroke="#00E676" strokeWidth={1.8} dot={false} name="Fridge" />
            <Line type="monotone" dataKey="Thermostat" stroke="#FF9100" strokeWidth={1.8} dot={false} name="Thermostat" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
