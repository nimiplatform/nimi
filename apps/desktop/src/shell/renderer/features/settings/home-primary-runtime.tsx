import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, NimiText, TextField } from '@nimiplatform/kit/ui';
import { AlertTriangle, ArrowUpRight, Clock } from 'lucide-react';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { openExternalUrl } from '../../bridge/runtime-bridge.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback.js';
import { useHomePrimaryRuntimeQuery } from './home-remote-access-query.js';
import { HomeRemoteAccess } from './home-remote-access.js';

const copy = {
  en: {
    name: 'Name for this PC',
    bind: 'Bind this PC',
    switchHere: 'Use this PC instead',
    replace: 'Reinitialize on this PC',
    cancel: 'Cancel',
    opening: 'Opening confirmation…',
    bindHint: 'Confirm in the official Nimi account page, then refresh here. Binding alone does not enable remote access.',
    warning:
      'Reinitialization ends the previous binding. Old configuration and data are not migrated, so you will need to configure this PC again.',
    activationDelay: 'After confirmation, remote access on the new PC may take up to one minute to activate.',
    waiting:
      'Confirm the request in the official Nimi account page, then refresh here. Binding does not by itself establish remote AI access.',
    failed: 'Could not read or prepare the primary binding. Check your login and Realm connection.',
  },
  zh: {
    name: '给这台电脑起个名字',
    bind: '前往官方账号页确认绑定',
    switchHere: '改用这台电脑',
    replace: '前往账号页确认替换',
    cancel: '取消',
    opening: '正在打开确认页面…',
    bindHint: '确认完成后返回此处刷新即可；绑定本身不会自动开启远程直连。',
    warning: '切换后原有设备的绑定会失效，旧配置与数据不会迁移，需在这台电脑上重新配置。',
    activationDelay: '确认后最多约 1 分钟生效。',
    waiting: '请在浏览器中的 Nimi 官方账号页完成确认，然后返回此处刷新。绑定本身不代表远程 AI 已经可用。',
    failed: '无法读取或准备主设备绑定，请检查登录状态与 Realm 连接。',
  },
};

export function HomePrimaryRuntime() {
  const user = useAppStore((state) => state.auth.user);
  const account = String(user?.id || '');
  const realm = String(user?.realmEnvironmentId || '');
  return <OwnedPrimaryRuntime key={`${realm}:${account}`} account={account} realm={realm} />;
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-host-control
function OwnedPrimaryRuntime({
  account,
  realm,
}: {
  account: string;
  realm: string;
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

  const primaryAction =
    hasOtherBinding && !showSetupForm ? (
      <Button tone="primary" disabled={busy} onClick={() => setShowReplaceForm(true)}>
        {c.switchHere}
      </Button>
    ) : null;

  const validAfterNotice =
    primaryStateKnown && state.data?.validAfter && Date.parse(state.data.validAfter) > Date.now() ? (
      <InlineAlert tone="info" icon={<Clock size={15} aria-hidden="true" />}>
        {zh ? '远程接入最早生效时间：' : 'Remote access becomes eligible from '}
        <time dateTime={state.data.validAfter} className="font-medium tabular-nums">
          {new Date(state.data.validAfter).toLocaleString(i18n.language)}
        </time>
      </InlineAlert>
    ) : null;

  const setupDrawer =
    showSetupForm && state.data ? (
      <div className="space-y-3 border-t border-[var(--nimi-border-subtle)] pt-4">
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
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              tone="primary"
              className="min-h-[var(--nimi-sizing-field-md-height)]"
              trailingIcon={<ArrowUpRight size={14} aria-hidden="true" />}
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
          <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--nimi-status-warning-soft-text)]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {c.warning} {c.activationDelay}
            </span>
          </p>
        ) : (
          <NimiText role="helper" className="text-xs">
            {c.bindHint}
          </NimiText>
        )}

        {feedback ? <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} /> : null}
      </div>
    ) : feedback && !state.data?.thisRuntime ? (
      <div className="border-t border-[var(--nimi-border-subtle)] pt-4">
        <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
      </div>
    ) : null;

  const primaryDrawer =
    validAfterNotice || setupDrawer ? (
      <>
        {validAfterNotice}
        {setupDrawer}
      </>
    ) : null;

  return (
    <HomeRemoteAccess
      account={account}
      realm={realm}
      primaryBindingId={primaryStateKnown ? state.data?.bindingId || '' : ''}
      primaryDisplayName={primaryStateKnown ? state.data?.displayName || '' : ''}
      hasOtherBinding={hasOtherBinding}
      primarySetupOpen={showSetupForm}
      primaryAction={primaryAction}
      primaryDrawer={primaryDrawer}
      primaryError={state.isError ? c.failed : undefined}
      validAfter={state.data?.validAfter ?? ''}
      primaryStatus={state.status}
      thisRuntime={isThisRuntime}
    />
  );
}
