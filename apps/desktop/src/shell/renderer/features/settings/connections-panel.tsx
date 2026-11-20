import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, Globe2, Smartphone } from 'lucide-react';
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

  return (
    <aside
      className="min-w-0 space-y-4 lg:order-last"
      aria-label={zh ? '网页管理与连接说明' : 'Web management and connection help'}
    >
      <Button
        tone="secondary"
        className="w-full justify-between lg:hidden"
        aria-expanded={expanded}
        aria-controls="connections-web-manager"
        trailingIcon={<ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />}
        onClick={() => setExpanded(!expanded)}
      >
        {zh ? '网页管理与跨端说明' : 'Web manager & client info'}
      </Button>
      <div id="connections-web-manager" className={`${expanded ? 'block' : 'hidden'} space-y-4 lg:block`}>
        <Surface
          tone="card"
          padding="none"
          className="space-y-4 overflow-hidden rounded-2xl border-[var(--nimi-border-subtle)] p-5 shadow-[var(--nimi-home-card-elevation)]"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
              <Globe2 size={19} aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-0.5">
              <NimiText as="h3" role="section-title">
                {zh ? '网页管理端' : 'Web manager'}
              </NimiText>
              <NimiText role="helper">
                {zh ? '在浏览器中查看和管理你的主 Runtime。' : 'View and manage your primary Runtime in a browser.'}
              </NimiText>
            </div>
          </div>

          {entry ? (
            <>
              <div className="space-y-1.5 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                {entry.localOnly ? (
                  <StatusBadge tone="warning">{zh ? '仅限本机 · 开发预览' : 'Local only · Development preview'}</StatusBadge>
                ) : (
                  <StatusBadge tone="info">{zh ? '远程网页入口' : 'Remote web entry'}</StatusBadge>
                )}
                <NimiText role="helper">
                  {entry.localOnly
                    ? (zh ? '此入口仅限在这台电脑上访问，其他设备无法通过此地址连接。' : 'This entry works only on this PC. Other devices cannot connect through this address.')
                    : (zh ? '使用同一个 Nimi 账号登录，并在 Nimi Home 确认首次接入请求。' : 'Sign in with the same Nimi account and confirm the first access request in Nimi Home.')}
                </NimiText>
              </div>
              <Button
                tone="secondary"
                className="w-full justify-center"
                disabled={opening}
                trailingIcon={<ArrowUpRight size={15} aria-hidden="true" />}
                onClick={() => void openManager()}
              >
                {opening
                  ? (zh ? '正在打开…' : 'Opening…')
                  : entry.localOnly
                    ? (zh ? '打开本机开发预览' : 'Open local development preview')
                    : (zh ? '打开网页管理端' : 'Open web manager')}
              </Button>
              <details className="group text-xs text-[var(--nimi-text-secondary)]">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 font-medium text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={13} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                  <span>{zh ? '查看入口地址' : 'View entry address'}</span>
                </summary>
                <div className="mt-2 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 font-mono text-[11px] leading-relaxed break-all select-text text-[var(--nimi-text-secondary)]">
                  {entry.url}
                </div>
              </details>
            </>
          ) : (
            <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
              <NimiText role="helper">
                {zh ? '当前环境尚未配置可连接的 HTTPS 网页管理入口。' : 'No HTTPS web management entry is configured for this environment.'}
              </NimiText>
            </div>
          )}

          {failed ? (
            <InlineFeedback
              feedback={{
                kind: 'error',
                message: zh ? '暂时无法打开网页管理端，请检查当前环境配置。' : 'Could not open the web manager. Check the current environment configuration.',
              }}
              onDismiss={() => setFailed(false)}
            />
          ) : null}
        </Surface>

        <div className="space-y-1.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,transparent)] p-4">
          <div className="flex items-center gap-2 text-[var(--nimi-text-secondary)]">
            <Smartphone size={15} className="shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold text-[var(--nimi-text-primary)]">
              {zh ? '跨端客户端' : 'Client availability'}
            </span>
          </div>
          <NimiText role="helper">
            {zh
              ? '织羽的网页与 Android 客户端尚未公开发布，开发预览不作为公开下载入口。'
              : 'Zhiyu web and Android clients are not publicly released. Development previews are not public downloads.'}
          </NimiText>
        </div>
      </div>
    </aside>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.connections
export function ConnectionsPanel() {
  const { t, i18n } = useTranslation();
  return (
    <PageShell
      title={t('Navigation.connections')}
      description={
        i18n.language.startsWith('zh')
          ? '管理这台电脑的远程接入服务，控制哪些网页与外部应用可以访问。'
          : 'Manage remote access to this PC and control which web or external applications can connect.'
      }
      contentClassName="mx-auto max-w-[1120px] gap-6 px-6 py-6 lg:px-8"
    >
      <HomePrimaryRuntime managementEntry={<RuntimeManagerEntry />} />
    </PageShell>
  );
}
