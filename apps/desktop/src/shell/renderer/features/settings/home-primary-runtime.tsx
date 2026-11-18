import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useHomePrimaryRuntimeQuery } from './home-remote-access-query.js';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, NimiText, StatusBadge, TextField } from '@nimiplatform/kit/ui';
import { AlertTriangle, Clock, Monitor, RefreshCw } from 'lucide-react';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { openExternalUrl } from '../../bridge/runtime-bridge.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback.js';
import { HomeRemoteAccess } from './home-remote-access.js';

const copy = {
  en: {
    title: 'Primary Runtime',
    loading: 'Reading your primary binding…',
    none: 'No primary Runtime is bound yet. Bind this PC to enable remote access.',
    here: 'Approved remote applications connect to and use services on this PC.',
    other: 'Another Runtime is bound to your account. Remote applications do not connect to this PC.',
    name: 'This PC name',
    bind: 'Bind this PC',
    switchHere: 'Use this PC instead',
    replace: 'Reinitialize on this PC',
    cancel: 'Cancel',
    refresh: 'Refresh',
    opening: 'Opening confirmation…',
    warning: 'Reinitialization ends the previous binding. Old configuration and data are not migrated, so you will need to configure this PC again.',
    activationDelay: 'After confirmation, remote access on the new PC may take up to one minute to activate.',
    waiting: 'Confirm the request in the official Nimi account page, then refresh here. Binding does not by itself establish remote AI access.',
    failed: 'Could not read or prepare the primary binding. Check your login and Realm connection.',
  },
  zh: {
    title: '主 Runtime',
    loading: '正在读取主设备绑定状态…',
    none: '此账号尚未绑定主 Runtime。绑定这台电脑后即可开启远程接入。',
    here: '获准的远程应用将连接并使用这台电脑上的服务。',
    other: '此账号已绑定另一台主 Runtime，远程应用当前不会连接到这台电脑。',
    name: '这台电脑的名称',
    bind: '绑定这台 PC',
    switchHere: '改用这台电脑',
    replace: '在这台 PC 上重新初始化',
    cancel: '取消',
    refresh: '刷新',
    opening: '正在打开确认页面…',
    warning: '重新初始化会使原有绑定失效。旧配置和数据不会迁移，需要在这台电脑上重新配置。',
    activationDelay: '确认后，新主机的远程接入最多约一分钟后生效。',
    waiting: '请在 Nimi 官方账号页确认，然后返回此处刷新。绑定本身不代表远程 AI 已经可用。',
    failed: '无法读取或准备主 Runtime 绑定，请检查登录状态与 Realm 连接。',
  },
};

export function HomePrimaryRuntime({ managementEntry }: { managementEntry?: ReactNode }) {
  const user = useAppStore((state) => state.auth.user);
  const account = String(user?.id || '');
  const realm = String(user?.realmEnvironmentId || '');
  return <OwnedPrimaryRuntime key={`${realm}:${account}`} account={account} realm={realm} managementEntry={managementEntry} />;
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-host-control
function OwnedPrimaryRuntime({
  account,
  realm,
  managementEntry,
}: {
  account: string;
  realm: string;
  managementEntry?: ReactNode;
}) {
  const sdk = useDesktopRendererSdk();
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const c = copy[zh ? 'zh' : 'en'];
  const [name, setName] = useState('My PC');
  const [busy, setBusy] = useState(false);
  const [showReplaceForm, setShowReplaceForm] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'info' | 'error'; message: string; technicalDetail?: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const state = useHomePrimaryRuntimeQuery();
  const primaryStateKnown = state.isSuccess;
  const isThisRuntime = primaryStateKnown && Boolean(state.data?.thisRuntime);
  const hasOtherBinding = primaryStateKnown && Boolean(state.data?.bindingId && !state.data?.thisRuntime);
  const showSetupForm =
    primaryStateKnown &&
    Boolean(state.data && !state.data.thisRuntime) &&
    (!hasOtherBinding || showReplaceForm || busy || Boolean(feedback));

  async function prepare() {
    if (busy || !state.data || !name.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const intent = await sdk.accountProduct().primaryRuntime.preparePrimaryRuntime({
        action: state.data.bindingId ? 'reinitialize' : 'bind',
        expectedBindingId: state.data.bindingId,
        displayName: name.trim(),
      });
      if (!mounted.current) return;
      const opened = await openExternalUrl(intent.confirmationUrl);
      if (!opened.opened) throw new Error('browser unavailable');
      if (mounted.current) setFeedback({ kind: 'info', message: c.waiting });
    } catch (reason) {
      if (mounted.current) {
        setFeedback({
          kind: 'error',
          message: c.failed,
          technicalDetail: extractNimiErrorFields(reason).reasonCode || undefined,
        });
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const heading = isThisRuntime && state.data?.displayName
    ? state.data.displayName
    : hasOtherBinding && state.data?.displayName
      ? (zh ? `当前主设备：${state.data.displayName}` : `Current primary PC: ${state.data.displayName}`)
      : c.title;

  const primaryRuntime = (
    <div className="space-y-4 border-b border-[var(--nimi-border-subtle)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <div
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
              isThisRuntime
                ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]'
                : 'border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]'
            }`}
          >
            <Monitor size={21} aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <NimiText as="h3" role="section-title" className="break-words">
                {heading}
              </NimiText>
              {isThisRuntime ? (
                <StatusBadge tone="info">{zh ? '此电脑 · 主 Runtime' : 'This PC · Primary Runtime'}</StatusBadge>
              ) : hasOtherBinding ? (
                <StatusBadge tone="neutral">{zh ? '其他电脑' : 'Another PC'}</StatusBadge>
              ) : primaryStateKnown ? (
                <StatusBadge tone="neutral">{zh ? '未绑定' : 'Unbound'}</StatusBadge>
              ) : null}
            </div>
            <NimiText role="helper">
              {state.isPending
                ? c.loading
                : state.isError
                  ? c.failed
                  : isThisRuntime
                    ? c.here
                    : hasOtherBinding
                      ? c.other
                      : c.none}
            </NimiText>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {hasOtherBinding && !showSetupForm ? (
            <Button tone="secondary" size="sm" disabled={busy} onClick={() => setShowReplaceForm(true)}>
              {c.switchHere}
            </Button>
          ) : null}
          <Button
            tone="ghost"
            size="sm"
            leadingIcon={<RefreshCw size={14} aria-hidden="true" />}
            disabled={busy || state.isFetching}
            onClick={() => void state.refetch()}
          >
            {state.isFetching ? (zh ? '正在刷新…' : 'Refreshing…') : c.refresh}
          </Button>
        </div>
      </div>

      {primaryStateKnown && state.data?.validAfter && Date.parse(state.data.validAfter) > Date.now() ? (
        <InlineAlert tone="info" icon={<Clock size={15} aria-hidden="true" />}>
          {zh ? '远程接入最早生效时间：' : 'Remote access becomes eligible from '}
          <time dateTime={state.data.validAfter} className="font-medium tabular-nums">
            {new Date(state.data.validAfter).toLocaleString(i18n.language)}
          </time>
        </InlineAlert>
      ) : null}

      {showSetupForm && state.data ? (
        <div className="space-y-3.5 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <NimiText as="label" htmlFor="primary-runtime-name" role="caption" className="block text-[var(--nimi-text-secondary)]">
                {c.name}
              </NimiText>
              <TextField
                id="primary-runtime-name"
                value={name}
                maxLength={80}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                tone="primary"
                className="min-h-[var(--nimi-sizing-field-md-height)]"
                disabled={busy || !name.trim()}
                onClick={() => void prepare()}
              >
                {busy ? c.opening : state.data.bindingId ? c.replace : c.bind}
              </Button>
              {hasOtherBinding ? (
                <Button
                  tone="ghost"
                  className="min-h-[var(--nimi-sizing-field-md-height)]"
                  disabled={busy}
                  onClick={() => {
                    setShowReplaceForm(false);
                    setFeedback(null);
                  }}
                >
                  {c.cancel}
                </Button>
              ) : null}
            </div>
          </div>

          {state.data.bindingId ? (
            <InlineAlert tone="warning" icon={<AlertTriangle size={15} aria-hidden="true" />}>
              <span className="leading-relaxed">
                {c.warning} {c.activationDelay}
              </span>
            </InlineAlert>
          ) : null}

          {feedback ? <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} /> : null}
        </div>
      ) : feedback && !state.data?.thisRuntime ? (
        <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
      ) : null}
    </div>
  );

  return (
    <HomeRemoteAccess
      primaryRuntime={primaryRuntime}
      managementEntry={managementEntry}
      validAfter={state.data?.validAfter ?? ''}
      account={account}
      realm={realm}
      primaryStatus={state.status}
      primaryBindingId={primaryStateKnown ? state.data?.bindingId || '' : ''}
      thisRuntime={isThisRuntime}
    />
  );
}
