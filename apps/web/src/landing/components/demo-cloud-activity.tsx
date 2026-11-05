import { useState } from 'react';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import { cloudCalls, type CloudText, type DemoConnection } from '../content/demo-cloud-data.js';

function Period({ days, select, t }: { days: number; select: (days: number) => void; t: CloudText }) {
  return <div className="cloud-period" role="group" aria-label={t('查看时间范围', 'Time range')}>
    {[1, 7].map(n => <button type="button" key={n} aria-pressed={days === n} onClick={() => select(n)}>
      {n === 1 ? t('最近 24 小时', 'Last 24 hours') : t('最近 7 天', 'Last 7 days')}
    </button>)}
  </div>;
}
export function DemoCloudUsage({ connection, t, openHistory }: {
  connection: DemoConnection; t: CloudText; openHistory: (days: number) => void;
}) {
  const [days, setDays] = useState(1);
  const rows = cloudCalls.filter(call => call.connectionId === connection.id && call.ageHours < days * 24);
  const input = rows.reduce((n, row) => n + (row.input ?? 0), 0);
  const output = rows.reduce((n, row) => n + (row.output ?? 0), 0);
  return <div className="cloud-pane">
    <div className="cloud-title-row"><h3>{t('使用情况', 'Usage')}</h3><Period days={days} select={setDays} t={t} /></div>
    <p className="cloud-muted">{t("当前账户在本机记录的用量。实际费用以服务商账单为准。", "Usage recorded for the current account on this device. Actual charges come from the provider.")}</p>
    {rows.length > 0 ? <><h4>{t(`已记录 ${rows.length} 次请求`, `${rows.length} recorded requests`)}</h4>
      <dl className="cloud-metrics"><div><dt>{t('Token 用量', 'Token usage')}</dt><dd>{t(`输入 ${input} · 输出 ${output}`, `Input ${input} · Output ${output}`)}</dd></div>
        <div><dt>{t('参考费用', 'Estimated cost')}</dt><dd>{t('暂时无法估算', 'No estimate available')}</dd></div></dl></> :
      <p className="cloud-empty">{t('这段时间还没有使用记录。', 'No recorded usage in this period.')}</p>}
    <Button size="sm" tone="secondary" onClick={() => openHistory(days)}>{t('查看记录', 'View history')}</Button>
    <details className="cloud-explanation"><summary>{t('用量说明', 'About usage')}</summary>
      <p>{t('请求次数包含失败或取消的请求。Token 只统计已收到的数据，费用以服务商账单为准。', 'Request counts include failed or cancelled calls. Token totals include reported data only. Refer to the provider’s bill for charges.')}</p></details>
  </div>;
}

export function DemoCloudHistory({ connection, initialDays, t, onClose }: {
  connection?: DemoConnection; initialDays: number; t: CloudText; onClose: () => void;
}) {
  const [days, setDays] = useState(initialDays);
  const [filter, setFilter] = useState(connection?.id ?? '');
  const rows = cloudCalls.filter(call => (!filter || call.connectionId === filter) && call.ageHours < days * 24);
  return <OverlayShell open kind="drawer" size="lg" onClose={onClose} title={t('调用记录', 'Call history')} dataTestId="demo-cloud-history">
    <div className="cloud-form"><p>{t('当前账户在本机记录的云端调用，最多保留 7 天。这里展示样例记录。', 'Cloud calls recorded for this account on this device, for up to seven days. The records shown here are examples.')}</p>
      <Period days={days} select={setDays} t={t} />
      {filter && <p>{connection?.name ?? filter} <Button size="sm" tone="ghost" onClick={() => setFilter('')}>{t('清除筛选', 'Clear filter')}</Button></p>}
      {rows.length ? <ul className="cloud-rows">{rows.map(row => <li key={row.id}><div><strong>{row.source}</strong>
        <small>{t('文字生成', 'Text generation')} · {row.model} · {t(`${row.ageHours} 小时前`, `${row.ageHours} hours ago`)}</small>
        <small>{row.failed ? t('服务商限制了此次请求；暂无用量数据。', 'Provider rate limit reached. No usage data reported.') : t(`输入 ${row.input} · 输出 ${row.output}`, `Input ${row.input} · Output ${row.output}`)}</small>
        <small>{t('连接', 'Connection')} · {row.connectionId} {!filter && <Button size="sm" tone="ghost" onClick={() => setFilter(row.connectionId)}>{t('仅此连接', 'Only this connection')}</Button>}</small></div>
        <span>{row.failed ? t('失败', 'Failed') : t('成功', 'Succeeded')}</span></li>)}</ul> : <p className="cloud-empty">{t('这段时间没有云端调用记录。', 'No cloud calls in this period.')}</p>}
    </div>
  </OverlayShell>;
}
