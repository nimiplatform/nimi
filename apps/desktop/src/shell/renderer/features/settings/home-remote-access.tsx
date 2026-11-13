import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { NimiText } from '@nimiplatform/kit/ui';
import { RemoteAccessConnectionState, RemoteSourceAccessState, type GetRemoteAccessStateResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback.js';
import { Button, Card, Section } from './settings-layout-components.js';

const copy = {
  en: { title: 'Remote access', intro: 'Let approved applications connect directly to this PC. Keep Nimi Home running and prevent sleep. Some networks cannot connect directly.',
    enable: 'Enable remote access', disable: 'Disable remote access', disabled: 'Remote access is off.', connecting: 'Connecting to the account service…', listening: 'Recently online. Waiting for a direct connection.', activationPending: 'Remote access is waiting for this primary binding to activate.', unavailable: 'New connections are currently unavailable.',
    primary: 'Bind this PC as your primary Runtime before enabling access.', loading: 'Reading remote access status…', error: 'Could not read or change remote access. Check your account and connection.',
    empty: 'No sources have requested access yet.', allow: 'Allow this source', reject: 'Reject this request', pause: 'Pause access', resume: 'Resume access', pending: 'Waiting for your confirmation', allowed: 'Allowed', paused: 'Paused', changed: 'Source changed — confirm again',
    manager: 'Official management client', app: 'Ecosystem application', scope: 'Declared access', capability: 'Capability references', count: 'Connected clients',
    managerScope: 'This client can manage your Runtime configuration and service after verifying your ownership on each connection.',
    appScope: 'The application can use admitted capabilities and update its own AI configuration. Cloud calls use this PC’s connections and may incur costs.',
    scopedAppScope: 'The application can use services within the declared access below. Specific resources and operations still need their own permission.',
    once: 'Approval applies to this account, primary Runtime, and source version. You can switch browsers or devices without confirming again if those stay the same.',
    unsupported: 'Operations remain subject to current support and resource permissions.', working: 'Saving…', audit: 'The change took effect, but its audit record could not be completed.',
  },
  zh: { title: '远程接入', intro: '允许获准应用直接连接这台 PC。请保持 Nimi Home 运行并避免休眠；部分网络可能无法直连。',
    enable: '开启远程接入', disable: '关闭远程接入', disabled: '远程接入已关闭。', connecting: '正在连接账号服务…', listening: '最近在线，正在等待直连请求。', activationPending: '远程接入正在等待此主绑定生效。', unavailable: '当前无法建立新的连接。',
    primary: '请先将这台 PC 绑定为主 Runtime，再开启接入。', loading: '正在读取接入状态…', error: '无法读取或更改接入状态，请检查账号与网络。',
    empty: '还没有来源请求接入。', allow: '允许此来源', reject: '拒绝本次请求', pause: '暂停访问', resume: '恢复访问', pending: '等待你确认', allowed: '已允许', paused: '已暂停', changed: '来源已变化，需要重新确认',
    manager: '官方管理端', app: '生态应用', scope: '应用声明', capability: '能力引用', count: '已连接客户端',
    managerScope: '允许此管理端管理 Runtime 配置和服务；每次连接仍需验证你的所有者身份。',
    appScope: '应用按已开放能力使用服务，并可修改自己的 AI 配置。云调用使用这台 PC 的连接，可能产生费用。',
    scopedAppScope: '应用只能在下方声明范围内调用服务；具体资源和操作仍需单独授权。',
    once: '此许可与当前账号、主 Runtime 和来源版本绑定。这三项未变时，换浏览器或设备不必重新确认。', unsupported: '具体操作仍受当前支持范围和资源权限约束。', working: '正在保存…', audit: '修改已生效，但审计记录未能完成。',
  },
};

const accessLabels: Record<string, readonly [string, string]> = {
  'runtime.consume': ['AI use and this application’s AI settings', '使用 AI 和修改本应用的 AI 配置'],
  'realm.data': ['Permitted online data', '获准的线上数据'],
  'agent.local': ['Access your agents', '访问你的智能体'],
  'agent.configure': ['Agent configuration', '智能体配置'],
  'app.activity': ['Application activity', '应用动态'],
  'agent.work': ['Agent tasks', '智能体任务'],
  'integration.consume': ['Use permitted integration operations', '调用已获准的集成操作'],
  'integration.provide': ['Provide application functions', '提供应用功能'],
  'integration.manage': ['Manage application integrations', '管理应用集成'],
};

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
export function HomeRemoteAccess({ account, realm, primaryBindingId, thisRuntime, primaryStateKnown, validAfter }: {
  account: string; realm: string; primaryBindingId: string; thisRuntime: boolean; primaryStateKnown: boolean; validAfter: string;
}) {
  const sdk = useDesktopRendererSdk();
  const { i18n } = useTranslation();
  const c = copy[i18n.language.startsWith('zh') ? 'zh' : 'en'];
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'info' | 'error'; message: string; technicalDetail?: string } | null>(null);
  const submitting = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const query = useQuery({ queryKey: ['home-remote-access', realm, account], enabled: Boolean(account && realm), retry: false,
    queryFn: () => sdk.accountProduct().remoteAccess.getRemoteAccessState({}), refetchInterval: 2500 });
  const sameBinding = Boolean(thisRuntime && primaryBindingId && query.data?.bindingId === primaryBindingId);
  const enabled = Boolean(query.data?.enabled && (sameBinding || !thisRuntime));
  const binding = enabled ? query.data?.bindingId || '' : primaryBindingId;
  const sources = sameBinding ? query.data?.sources || [] : [];
  const api = sdk.accountProduct().remoteAccess;
  async function action(work: () => Promise<{ state?: GetRemoteAccessStateResponse; auditDiagnostic?: unknown }>) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setFeedback(null);
    try {
      const result = await work();
      if (!mounted.current) return;
      if (result.auditDiagnostic) setFeedback({ kind: 'info', message: c.audit });
      await query.refetch();
    } catch (reason) {
      if (mounted.current) setFeedback({ kind: 'error', message: c.error, technicalDetail: extractNimiErrorFields(reason).reasonCode || undefined });
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  const status = !enabled ? c.disabled : Date.parse(validAfter) > Date.now() ? c.activationPending : query.data?.connectionState === RemoteAccessConnectionState.LISTENING ? c.listening
    : query.data?.connectionState === RemoteAccessConnectionState.CONNECTING ? c.connecting : c.unavailable;
  return <Section title={c.title} description={c.intro}>
    <Card><div className="flex flex-col gap-4">
      {query.isError ? <InlineFeedback feedback={{ kind: 'error', message: c.error,
        technicalDetail: extractNimiErrorFields(query.error).reasonCode || (query.error instanceof Error ? query.error.message : undefined) }} />
        : <NimiText role="body">{query.isPending ? c.loading : status}</NimiText>}
      {primaryStateKnown && !thisRuntime && <NimiText role="helper">{c.primary}</NimiText>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={enabled ? 'secondary' : undefined} disabled={busy || !query.data || !binding || (!enabled && !thisRuntime)}
          onClick={() => void action(() => api.setRemoteAccessEnabled({ enabled: !enabled, expectedBindingId: binding }))}>{busy ? c.working : enabled ? c.disable : c.enable}</Button>
        {sameBinding && Boolean(query.data?.connectedPeers) && <NimiText role="helper">{c.count}: {query.data?.connectedPeers}</NimiText>}
      </div>
      {feedback && <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />}
    </div></Card>
    {sources.map(source => {
      const pending = source.state === RemoteSourceAccessState.PENDING || source.state === RemoteSourceAccessState.CHANGED;
      const paused = source.state === RemoteSourceAccessState.PAUSED;
      return <Card key={source.clientId}><div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><NimiText role="label">{source.displayName}</NimiText><NimiText role="helper">{source.origin}</NimiText></div>
          <NimiText role="helper">{source.state === RemoteSourceAccessState.CHANGED ? c.changed : pending ? c.pending : paused ? c.paused : c.allowed}</NimiText>
        </div>
        <NimiText role="helper">{source.officialManager ? c.manager : c.app}</NimiText>
        {pending && <>
          <NimiText role="body">{source.officialManager ? c.managerScope : source.appAccess.includes('runtime.consume') ? c.appScope : c.scopedAppScope}</NimiText>
          <NimiText role="helper">{c.once}</NimiText>
          {!source.officialManager && <div className="flex flex-col gap-2">
            <NimiText role="label">{c.scope}</NimiText>
            <NimiText role="body">{source.appAccess.map(domain => accessLabels[domain]?.[i18n.language.startsWith('zh') ? 1 : 0] || domain).join(' · ') || '—'}</NimiText>
            <NimiText role="helper">{c.unsupported}</NimiText>
            {source.capabilityContractRefs.length > 0 && <details><summary>{c.capability}</summary><NimiText role="helper">{source.capabilityContractRefs.join(', ')}</NimiText></details>}
          </div>}
        </>}
        <div className="flex flex-wrap gap-3">
          {pending ? <>
            <Button disabled={busy || !source.pendingRequestId} onClick={() => void action(() => api.confirmRemoteSource({ pendingRequestId: source.pendingRequestId, expectedBindingId: primaryBindingId }))}>{c.allow}</Button>
            <Button variant="secondary" disabled={busy || !source.pendingRequestId} onClick={() => void action(() => api.rejectRemoteSource({ pendingRequestId: source.pendingRequestId, expectedBindingId: primaryBindingId }))}>{c.reject}</Button>
          </> : <Button variant="secondary" disabled={busy} onClick={() => void action(() => api.setRemoteSourcePaused({ clientId: source.clientId, paused: !paused, expectedBindingId: primaryBindingId }))}>{paused ? c.resume : c.pause}</Button>}
        </div>
      </div></Card>;
    })}
    {sameBinding && !query.isError && !query.isPending && sources.length === 0 && <NimiText role="helper">{c.empty}</NimiText>}
  </Section>;
}
