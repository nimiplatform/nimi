import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { S } from '../../app-shell/page-style.js';
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
    <div className={`${S.radius} p-4 mb-4`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-medium" style={{ color: S.text }}>睡眠趋势</span>
        <span className="text-[11px]" style={{ color: S.sub }}>参考 {refLo}-{refHi}h/天</span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={S.accent} stopOpacity={0.3} />
              <stop offset="95%" stopColor={S.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: S.sub }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: S.sub }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
          <ReferenceArea y1={refLo} y2={refHi} fill="#1e293b" fillOpacity={0.08} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${S.border}`, boxShadow: S.shadow }}
            formatter={(value: number) => [`${value}h`, '睡眠时长']}
          />
          <Area type="monotone" dataKey="hours" stroke={S.accent} strokeWidth={2} fill="url(#sleepGrad)" dot={{ r: 3, fill: S.accent }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
