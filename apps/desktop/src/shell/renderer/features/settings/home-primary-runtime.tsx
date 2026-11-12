import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { NimiText } from '@nimiplatform/kit/ui';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { openExternalUrl } from '../../bridge/runtime-bridge.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback.js';
import { Button, Card, Section } from './settings-layout-components.js';
import { HomeRemoteAccess } from './home-remote-access.js';

const copy = {
  en: { title: 'Primary Runtime', loading: 'Reading your primary binding…', none: 'No primary Runtime is bound.', here: 'This PC is your primary Runtime.', other: 'Another Runtime is bound to your account.', name: 'PC name', bind: 'Bind this PC', replace: 'Reinitialize on this PC', refresh: 'Refresh', opening: 'Opening confirmation…', warning: 'Reinitialization ends the previous binding. Old configuration and data are not migrated. You must configure this PC again.', waiting: 'Confirm the request in the official Nimi account page, then refresh here. Binding does not by itself establish remote AI access.', failed: 'Could not read or prepare the primary binding. Check your login and Realm connection.' },
  zh: { title: '主 Runtime', loading: '正在读取主 Runtime 绑定状态…', none: '此账号尚未绑定主 Runtime。', here: '这台 PC 是你的主 Runtime。', other: '此账号已绑定另一台 Runtime。', name: '主机名称', bind: '绑定这台 PC', replace: '在这台 PC 上重新初始化', refresh: '刷新', opening: '正在打开确认页面…', warning: '重新初始化会使原有绑定失效。旧配置和数据不会迁移，需要在这台 PC 上重新配置。', waiting: '请在 Nimi 官方账号页确认，然后返回刷新。绑定本身不代表远程 AI 已经可用。', failed: '无法读取或准备主 Runtime 绑定，请检查登录状态与 Realm 连接。' },
};

export function HomePrimaryRuntime() {
  const user = useAppStore(state => state.auth.user);
  const account = String(user?.id || '');
  const realm = String(user?.realmEnvironmentId || '');
  return <OwnedPrimaryRuntime key={`${realm}:${account}`} account={account} realm={realm} />;
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-host-control
function OwnedPrimaryRuntime({ account, realm }: { account: string; realm: string }) {
  const sdk = useDesktopRendererSdk();
  const { i18n } = useTranslation();
  const c = copy[i18n.language.startsWith('zh') ? 'zh' : 'en'];
  const [name, setName] = useState('My PC');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{kind: 'info' | 'error'; message: string; technicalDetail?: string} | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = useQuery({
    queryKey: ['primary-runtime-binding', realm, account], enabled: Boolean(account && realm), retry: false,
    queryFn: () => sdk.accountProduct().primaryRuntime.getPrimaryRuntimeState({}),
  });
  const primaryStateKnown = state.isSuccess;
  async function prepare() {
    if (busy || !state.data || !name.trim()) return;
    setBusy(true); setFeedback(null);
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
      if (mounted.current) setFeedback({ kind: 'error', message: c.failed, technicalDetail: extractNimiErrorFields(reason).reasonCode || undefined });
    }
    finally { if (mounted.current) setBusy(false); }
  }
  return <><Section title={c.title}>
    <Card>
      <div className="flex flex-col gap-4">
        <NimiText role="body">{state.isPending ? c.loading : state.isError ? c.failed : state.data?.thisRuntime ? c.here : state.data?.bindingId ? `${c.other} ${state.data.displayName}` : c.none}</NimiText>
        {primaryStateKnown && state.data?.validAfter && <NimiText role="helper">
          {i18n.language.startsWith('zh') ? '远程接入最早生效时间' : 'Remote access becomes eligible from'}{' '}
          <time dateTime={state.data.validAfter}>{new Date(state.data.validAfter).toLocaleString(i18n.language)}</time>
        </NimiText>}
        {primaryStateKnown && state.data && !state.data.thisRuntime && <>
          <label className="flex flex-col gap-2">
            <NimiText role="label">{c.name}</NimiText>
            <input className="rounded-lg border border-[var(--nimi-border)] bg-[var(--nimi-bg-primary)] px-3 py-2 text-[var(--nimi-text-primary)]" value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} />
          </label>
          {state.data.bindingId && <>
            <NimiText role="helper">{c.warning}</NimiText>
            <NimiText role="helper">{i18n.language.startsWith('zh') ? '确认后，新主机的远程接入最多约一分钟后生效。' : 'Remote access on the new PC may take up to one minute to activate after confirmation.'}</NimiText>
          </>}
        </>}
        <div className="flex flex-wrap gap-3">
          {primaryStateKnown && state.data && !state.data.thisRuntime && <Button disabled={busy || !name.trim()} onClick={() => void prepare()}>{busy ? c.opening : state.data.bindingId ? c.replace : c.bind}</Button>}
          <Button variant="secondary" disabled={busy || state.isFetching} onClick={() => void state.refetch()}>{c.refresh}</Button>
        </div>
        {feedback && !state.data?.thisRuntime && <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />}
      </div>
    </Card>
  </Section><HomeRemoteAccess validAfter={state.data?.validAfter ?? ""} account={account} realm={realm} primaryStateKnown={primaryStateKnown} primaryBindingId={primaryStateKnown ? state.data?.bindingId || '' : ''} thisRuntime={primaryStateKnown && Boolean(state.data?.thisRuntime)} /></>;
}
