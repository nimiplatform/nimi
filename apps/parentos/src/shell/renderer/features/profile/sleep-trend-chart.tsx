import { Surface } from '@nimiplatform/kit/ui';
import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { referenceSleepRange } from './sleep-page-shared.js';

export function SleepTrendChart({
  records,
  ageMonths,
}: {
  records: SleepRecordRow[];
  ageMonths: number;
}) {
  const [refLo, refHi] = referenceSleepRange(ageMonths);

  const data = useMemo(() => {
    const last7 = [...records]
      .sort((left, right) => left.sleepDate.localeCompare(right.sleepDate))
      .slice(-7);
    return last7.map((record) => ({
      date: record.sleepDate.slice(5),
      hours: Math.round((((record.durationMinutes ?? 0) + (record.napMinutes ?? 0)) / 60) * 10) / 10,
    }));
  }, [records]);

  if (data.length < 2) return null;

  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="mb-4 rounded-3xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">睡眠趋势</span>
        <span className="text-[13px] text-[var(--nimi-text-muted)]">参考 {refLo}-{refHi}h/天</span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={'var(--nimi-action-primary-bg)'} stopOpacity={0.3} />
              <stop offset="95%" stopColor={'var(--nimi-action-primary-bg)'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--nimi-border-subtle)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--nimi-text-muted)' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--nimi-text-muted)' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
          <ReferenceArea y1={refLo} y2={refHi} fill="var(--nimi-text-primary)" fillOpacity={0.08} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${'var(--nimi-border-subtle)'}`, boxShadow: 'var(--nimi-elevation-raised)' }}
            formatter={(value: number) => [`${value}h`, '睡眠时长']}
          />
          <Area type="monotone" dataKey="hours" stroke={'var(--nimi-action-primary-bg)'} strokeWidth={2} fill="url(#sleepGrad)" dot={{ r: 3, fill: 'var(--nimi-action-primary-bg)' }} />
        </AreaChart>
      </ResponsiveContainer>
    </Surface>
  );
}
