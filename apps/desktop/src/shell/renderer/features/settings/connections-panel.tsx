import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { ArrowUpRight, ChevronDown, Globe2 } from 'lucide-react';
import { Button, NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { PageShell } from './settings-layout-components.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback.js';
import { HomePrimaryRuntime } from './home-primary-runtime.js';

function RuntimeManagerEntry() {
  const { i18n } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const entry = bindings.app.projection.runtimeManagerEntry();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const zh = i18n.language.startsWith('zh');

  async function openManager() {
    setOpening(true);
    setFailed(false);
    try {
      await bindings.app.commands.openAccountManagement('runtime');
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  }

  return <aside className="order-first min-w-0 space-y-3 lg:order-last" aria-label={zh ? '网页管理与连接说明' : 'Web management and connection help'}>
    <Button tone="secondary" className="lg:hidden" aria-expanded={expanded} aria-controls="connections-web-manager" trailingIcon={<ChevronDown size={14} className={expanded ? 'rotate-180' : ''} aria-hidden="true" />} onClick={() => setExpanded(!expanded)}>{zh ? '网页管理与连接说明' : 'Web management and connection help'}</Button>
    <div id="connections-web-manager" className={`${expanded ? 'block' : 'hidden'} space-y-3 lg:block`}>
    <Surface tone="card" className="space-y-3 shadow-none">
      <div className="flex items-center gap-2 text-[var(--nimi-text-primary)]">
        <Globe2 size={18} aria-hidden="true" />
        <NimiText as="h3" role="section-title">{zh ? '网页管理端' : 'Web manager'}</NimiText>
      </div>
      <NimiText role="body">{zh ? '在浏览器中查看和管理你的主 Runtime。' : 'View and manage your primary Runtime in a browser.'}</NimiText>
      {entry ? <>
        {entry.localOnly && <StatusBadge tone="neutral">{zh ? '仅限本机 · 开发预览' : 'Local only · Development preview'}</StatusBadge>}
        <NimiText role="helper">{entry.localOnly
          ? (zh ? '此入口只能在这台 PC 上使用，其他设备无法通过此地址连接。' : 'This entry works only on this PC. Other devices cannot connect through this address.')
          : (zh ? '使用同一个 Nimi 账号登录，并在 Home 确认首次接入请求。' : 'Sign in with the same Nimi account and confirm the first access request in Home.')}</NimiText>
        <Button tone="secondary" className="w-full" disabled={opening} trailingIcon={<ArrowUpRight size={16} aria-hidden="true" />} onClick={() => void openManager()}>
          {opening ? (zh ? '正在打开…' : 'Opening…') : entry.localOnly ? (zh ? '打开本机开发预览' : 'Open local development preview') : (zh ? '打开网页管理端' : 'Open web manager')}
        </Button>
        <details className="text-xs text-[var(--nimi-text-secondary)]">
          <summary className="cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">{zh ? '查看入口地址' : 'View entry address'}</summary>
          <p className="mt-2 break-all select-text">{entry.url}</p>
        </details>
      </> : <NimiText role="helper">{zh ? '当前环境尚未配置可连接的 HTTPS 网页管理入口。' : 'This environment has no configured HTTPS web management entry.'}</NimiText>}
      {failed && <InlineFeedback feedback={{ kind: 'error', message: zh ? '暂时无法打开网页管理端，请检查当前环境配置。' : 'Could not open the web manager. Check the current environment configuration.' }} onDismiss={() => setFailed(false)} />}
    </Surface>
    <div className="space-y-2 px-1">
      <NimiText role="helper">{zh ? '织羽的网页与 Android 客户端尚未公开发布，开发预览不作为公开下载入口。' : 'Zhiyu web and Android clients are not publicly released. Development previews are not public downloads.'}</NimiText>
    </div>
    </div>
  </aside>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.connections
export function ConnectionsPanel() {
  const { t, i18n } = useTranslation();
  return <PageShell title={t('Navigation.connections')}
    description={i18n.language.startsWith('zh') ? '管理这台 PC 的远程接入，决定哪些应用可以访问。' : 'Manage remote access to this PC and choose which applications can connect.'}
    contentClassName="max-w-6xl gap-5">
    <HomePrimaryRuntime managementEntry={<RuntimeManagerEntry />} />
  </PageShell>;
}
