import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
// Keep the independent overview's development graph limited to its ten icons.
// The package barrel prebundles the entire icon catalog into this renderer.
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.mjs';
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right.mjs';
import Bell from 'lucide-react/dist/esm/icons/bell.mjs';
import BellOff from 'lucide-react/dist/esm/icons/bell-off.mjs';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.mjs';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.mjs';
import Download from 'lucide-react/dist/esm/icons/download.mjs';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.mjs';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs';
import X from 'lucide-react/dist/esm/icons/x.mjs';
import type {
  SystemEntryAction,
  SystemEntryBridge,
  SystemEntryItem,
  SystemEntryLocale,
  SystemEntrySection,
  SystemEntrySnapshot,
  SystemEntryUsage,
} from '../../shared/system-entry-types.js';
import { isSystemEntryLocalOnlyUsage } from '../../shared/system-entry-types.js';

declare global { interface Window { nimiSystemEntry?: SystemEntryBridge } }
const logo = new URL('../assets/logo.png', import.meta.url).href;

const COPY = {
  zh: {
    more: '更多操作', close: '关闭速览', openHome: '打开 Home', refresh: '刷新',
    attention: '需要处理', work: '正在进行', recent: '继续聊天', apps: '已打开的 App', downloads: '下载',
    loading: '正在读取…', unavailable: '暂时无法确认', partial: '部分数据', noWork: '当前没有进行中的 AI 执行',
    noRecent: '还没有最近聊天', noApps: '当前没有已打开的 App', noAttention: '没有需要处理的事项',
    login: '登录后查看你的活动', recovery: 'Nimi 需要完成设置或修复', unknown: '暂时无法确认使用条件', locked: '电脑已锁定',
    gateDetail: '打开 Home，继续当前的登录、设置或恢复步骤。',
    disconnected: '活动状态暂时无法更新', disconnectedDetail: '连接中断不代表工作已停止。打开 Home 或刷新后查看当前状态。',
    loadingDetail: '正在获取当前账户的活动。',
    failed: '操作未完成，请打开 Home 查看或重试。', stale: '这条信息已更新，请刷新后重试。',
    ready: '本地 AI 服务已启动', degraded: '本地 AI 服务需要处理', starting: '本地 AI 服务正在启动', stopped: '本地 AI 服务已停止', serviceUnavailable: '本地 AI 服务暂时不可用',
    usage: '今日 AI 执行', usageDetails: '查看用量详情', attempt: '次', attempts: '次', local: '本地', cloud: '云端', estimate: '费用估算',
    noPrice: '暂无可用的费用估算', paused: '提醒已暂停', pause: '暂停提醒 1 小时', resume: '结束暂停', notificationSettings: '通知设置',
    observed: '最后观察', all: '查看全部', nativeOnly: '请从 Nimi 的系统图标打开速览。',
  },
  en: {
    more: 'More actions', close: 'Close overview', openHome: 'Open Home', refresh: 'Refresh',
    attention: 'Needs attention', work: 'In progress', recent: 'Continue a chat', apps: 'Open Apps', downloads: 'Downloads',
    loading: 'Loading…', unavailable: 'Unable to confirm', partial: 'Partial data', noWork: 'No AI execution in progress',
    noRecent: 'No recent chats', noApps: 'No Apps are open', noAttention: 'Nothing needs your attention',
    login: 'Sign in to see your activity', recovery: 'Nimi needs setup or repair', unknown: 'Unable to confirm access', locked: 'Your device is locked',
    gateDetail: 'Open Home to continue the current sign-in, setup or recovery step.',
    disconnected: 'Activity is not updating', disconnectedDetail: 'A disconnected view does not mean work stopped. Open Home or refresh to see the current state.',
    loadingDetail: 'Getting activity for the current account.',
    failed: 'The action did not finish. Open Home to review or retry.', stale: 'This information changed. Refresh and try again.',
    ready: 'Local AI service is running', degraded: 'Local AI service needs attention', starting: 'Local AI service is starting', stopped: 'Local AI service is stopped', serviceUnavailable: 'Local AI service is unavailable',
    usage: 'AI executions today', usageDetails: 'View usage details', attempt: 'execution', attempts: 'executions', local: 'Local', cloud: 'Cloud', estimate: 'Estimated cost',
    noPrice: 'Cost estimate unavailable', paused: 'Notifications paused', pause: 'Pause notifications for 1 hour', resume: 'End pause', notificationSettings: 'Notification settings',
    observed: 'Last observed', all: 'View all', nativeOnly: 'Open this overview from the Nimi system icon.',
  },
} as const;

export function formatSystemEntryCount(value: string | null, locale: SystemEntryLocale): string {
  if (value === null) return '—';
  try { return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(BigInt(value)); }
  catch { return '—'; }
}

function SourceStatus({ section, empty, locale }: { section: SystemEntrySection; empty: string; locale: SystemEntryLocale }) {
  const copy = COPY[locale];
  const message = section.status === 'loading' ? copy.loading : section.status === 'unavailable' ? copy.unavailable : section.status === 'partial' ? copy.partial : empty;
  return <p className="se-source-status">{message}</p>;
}

function Item({ item, act, busy, attention }: { item: SystemEntryItem; act: (action: SystemEntryAction) => void; busy: boolean; attention?: boolean }) {
  const content = <><span className="se-item-icon">{attention ? <AlertCircle size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}</span><span className="se-item-body"><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>{item.action ? <ArrowUpRight size={15} aria-hidden="true" /> : null}</>;
  return item.action
    ? <button className="se-item" disabled={busy} onClick={() => item.action && act(item.action)}>{content}</button>
    : <div className="se-item">{content}</div>;
}

function Section({ label, section, limit, empty, locale, act, busy, action, attention }: { label: string; section: SystemEntrySection; limit: number; empty: string; locale: SystemEntryLocale; act: (action: SystemEntryAction) => void; busy: boolean; action?: SystemEntryAction; attention?: boolean }) {
  const copy = COPY[locale];
  return <section className={`se-section${attention ? ' se-attention' : ''}`} aria-label={label}>
    <div className="se-section-heading"><h2>{label}</h2>{section.total !== null ? <span className="se-count">{section.total}</span> : null}{action ? <button className="se-text-action" aria-label={`${copy.all} · ${label}`} disabled={busy} onClick={() => act(action)}>{copy.all}</button> : null}</div>
    {section.items.length > 0 && section.status !== 'unavailable'
      ? section.items.slice(0, limit).map(item => <Item key={item.id} item={item} act={act} busy={busy} attention={attention} />)
      : <SourceStatus section={section} empty={empty} locale={locale} />}
    {section.items.length > 0 && section.status === 'partial' ? <p className="se-source-status">{copy.partial}</p> : null}
  </section>;
}

export function SystemEntryUsageView({ usage, locale, onOpen, busy = false }: { usage: SystemEntryUsage; locale: SystemEntryLocale; onOpen?: () => void; busy?: boolean }) {
  const copy = COPY[locale];
  const available = usage.status === 'available' || usage.status === 'partial';
  return <section className="se-usage" aria-label={copy.usage}>
    <div className="se-section-heading"><h2>{usage.periodLabel || copy.usage}</h2>{onOpen ? <button className="se-text-action" onClick={onOpen} disabled={busy}>{copy.usageDetails}</button> : null}</div>
    <div className="se-usage-count">{available ? `${formatSystemEntryCount(usage.attempts, locale)} ${usage.attempts === '1' ? copy.attempt : copy.attempts}` : usage.status === 'loading' ? copy.loading : copy.unavailable}</div>
    {available ? <>
      <div className="se-usage-breakdown">{copy.local} {formatSystemEntryCount(usage.localAttempts, locale)}<span aria-hidden="true">·</span>{copy.cloud} {formatSystemEntryCount(usage.cloudAttempts, locale)}</div>
      {usage.costs.length > 0 || isSystemEntryLocalOnlyUsage(usage) ? <div className="se-usage-cost">{copy.estimate} {usage.costs.length ? usage.costs.map(cost => `${cost.currency} ${cost.estimate}`).join(' · ') : '0'}</div> : <div className="se-usage-cost">{copy.noPrice}</div>}
    </> : null}
    {usage.note && <p className="se-source-status">{usage.note}</p>}
    {usage.partial && available && <p className="se-source-status">{copy.partial}</p>}
  </section>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.home-system-activity
// @nimi-authority: rule.nimi.desktop.bridge-ipc.system-entry-isolation
export function SystemEntryApp() {
  const bridge = window.nimiSystemEntry;
  const [snapshot, setSnapshot] = useState<SystemEntrySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = snapshot?.locale ?? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
  const copy = COPY[locale];

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    let pushed = false;
    const off = bridge.onSnapshot(next => { pushed = true; if (alive) setSnapshot(next); });
    // An owner invalidation delivered while the initial read is in flight
    // must never be overwritten by that read's former-account projection.
    void bridge.getSnapshot().then(next => { if (alive && !pushed) setSnapshot(next); }, () => { if (alive && !pushed) setError('unavailable'); });
    return () => { alive = false; off(); };
  }, [bridge]);
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'; }, [locale]);
  useEffect(() => {
    // Home resolves both its explicit preference and system changes. The
    // isolated overview receives only that display value, never its store.
    document.documentElement.style.colorScheme = snapshot?.colorScheme ?? 'light dark';
  }, [snapshot?.colorScheme]);

  const act = useCallback((action: SystemEntryAction) => {
    if (!bridge || busy) return;
    setBusy(true);
    setError(null);
    void bridge.act({ action, generation: snapshot?.admission.generation ?? 'unavailable', revision: snapshot?.revision ?? 0 })
      .catch(failure => setError(String(failure).includes('stale') ? 'stale' : 'unavailable'))
      .finally(() => setBusy(false));
  }, [bridge, busy, snapshot]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([hidden])')];
    const first = buttons[0], last = buttons.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const data = snapshot?.admission.state === 'ready' && snapshot.observation === 'current' ? snapshot.projection : null;
  const gateTitle = snapshot?.admission.state === 'login-required' ? copy.login : snapshot?.admission.state === 'recovery-required' ? copy.recovery : snapshot?.admission.state === 'locked' ? copy.locked : copy.unknown;
  const service = data?.service === 'running' ? copy.ready : data?.service === 'degraded' ? copy.degraded : data?.service === 'starting' ? copy.starting : data?.service === 'stopped' ? copy.stopped : copy.serviceUnavailable;
  const paused = Boolean(data && data.notificationsPausedUntil > Date.now());
  const notificationLabel = !data?.notificationsEnabled ? copy.notificationSettings : paused ? copy.resume : copy.pause;
  const notificationAction: SystemEntryAction = { kind: !data?.notificationsEnabled ? 'notification-settings' : paused ? 'resume-notifications' : 'pause-notifications' };

  return <div className="se-root" onKeyDown={keyDown}>
    <header className="se-header"><img src={logo} alt="" /><h1>Nimi</h1><button className="se-icon-button" aria-label={copy.more} onClick={() => void bridge?.openMenu().catch(() => setError('unavailable'))}><MoreHorizontal size={20} /></button><button className="se-icon-button" aria-label={copy.close} onClick={() => void bridge?.close().catch(() => setError('unavailable'))}><X size={18} /></button></header>
    <main className="se-body">
      {!bridge && <p className="se-empty">{copy.nativeOnly}</p>}
      {bridge && data && <>
        <div className="se-service">{data.service === 'running' ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertCircle size={15} aria-hidden="true" />}<span>{service}</span></div>
        {(data.attention.items.length > 0 || data.attention.status === 'unavailable' || data.attention.status === 'partial') && <Section label={copy.attention} section={data.attention} limit={2} empty={copy.noAttention} locale={locale} act={act} busy={busy} action={{ kind: 'messages' }} attention />}
        <Section label={copy.work} section={data.work} limit={3} empty={copy.noWork} locale={locale} act={act} busy={busy} action={{ kind: 'activity' }} />
        <Section label={copy.recent} section={data.recent} limit={2} empty={copy.noRecent} locale={locale} act={act} busy={busy} action={{ kind: 'chat' }} />
        <Section label={copy.apps} section={data.apps} limit={2} empty={copy.noApps} locale={locale} act={act} busy={busy} action={{ kind: 'apps' }} />
        {(data.downloads.items.length > 0 || data.downloads.status === 'unavailable') && <Section label={copy.downloads} section={data.downloads} limit={1} empty={copy.unavailable} locale={locale} act={act} busy={busy} action={{ kind: 'downloads' }} />}
        <SystemEntryUsageView usage={data.usage} locale={locale} busy={busy} onOpen={() => act({ kind: 'usage' })} />
      </>}
      {bridge && !data && <div className="se-empty" role="status"><AlertCircle size={25} aria-hidden="true" /><h2>{snapshot?.admission.state === 'ready' ? copy.disconnected : gateTitle}</h2><p>{snapshot?.admission.state === 'ready' ? snapshot.observation === 'waiting' ? copy.loadingDetail : copy.disconnectedDetail : copy.gateDetail}</p><button className="se-secondary" disabled={busy} onClick={() => act({ kind: 'refresh' })}><RefreshCw size={15} aria-hidden="true" />{copy.refresh}</button></div>}
      {error || snapshot?.actionError ? <p className="se-error" role="alert">{error === 'stale' ? copy.stale : copy.failed}</p> : null}
    </main>
    <footer className="se-footer"><button className="se-primary" disabled={!bridge || busy} onClick={() => act({ kind: 'home' })}>{copy.openHome}</button>{data ? <button className="se-icon-button" disabled={busy} aria-label={notificationLabel} title={notificationLabel} onClick={() => act(notificationAction)}>{paused || !data.notificationsEnabled ? <BellOff size={18} /> : <Bell size={18} />}</button> : null}<button className="se-icon-button" disabled={!bridge || busy} aria-label={copy.downloads} title={copy.downloads} onClick={() => act({ kind: 'downloads' })} hidden={!data}><Download size={18} /></button></footer>
  </div>;
}
