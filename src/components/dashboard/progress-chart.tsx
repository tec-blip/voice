'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface ProgressChartProps {
  data: { date: string; score: number }[]
}

export function ProgressChart({ data }: ProgressChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-600 text-sm">
        Sin datos suficientes para mostrar el gráfico
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="date" stroke="#71717a" fontSize={12} tickLine={false} />
        <YAxis domain={[0, 100]} stroke="#71717a" fontSize={12} tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#18181b',
            border: '1px solid #3f3f46',
            borderRadius: '0.75rem',
            color: '#fff',
            fontSize: '0.875rem',
          }}
          labelStyle={{ color: '#a1a1aa' }}
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="#ef4444"
          strokeWidth={2}
          fill="url(#scoreGradient)"
          dot={{ fill: '#ef4444', strokeWidth: 0, r: 4 }}
          activeDot={{ r: 6, fill: '#60a5fa' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
