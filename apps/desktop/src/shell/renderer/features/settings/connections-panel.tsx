import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Check, ChevronDown, Copy, Globe2, RefreshCw, X } from 'lucide-react';
import { Button, NimiText } from '@nimiplatform/kit/ui';
import { PageShell } from './settings-layout-components.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback.js';
import { HomePrimaryRuntime } from './home-primary-runtime.js';
import { useHomePrimaryRuntimeQuery, useHomeRemoteAccessQuery } from './home-remote-access-query.js';

function ConnectionsHeaderActions() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const bindings = useDesktopRendererBindings();
  const entry = bindings.app.projection.runtimeManagerEntry();
  const primaryQuery = useHomePrimaryRuntimeQuery();
  const remoteQuery = useHomeRemoteAccessQuery();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!popoverOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPopoverOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popoverOpen]);

  const isThisRuntime = primaryQuery.isSuccess && Boolean(primaryQuery.data?.thisRuntime);
  const otherPrimaryName =
    primaryQuery.isSuccess && primaryQuery.data?.bindingId && !primaryQuery.data?.thisRuntime
      ? primaryQuery.data.displayName || (zh ? '另一台电脑' : 'another PC')
      : '';
  const isUnbound = primaryQuery.isSuccess && !primaryQuery.data?.bindingId;
  const remoteEnabled = Boolean(
    isThisRuntime &&
      primaryQuery.data?.bindingId &&
      remoteQuery.data?.bindingId === primaryQuery.data.bindingId &&
      remoteQuery.data?.enabled,
  );

  const webHelperText = !entry
    ? zh
      ? '当前环境尚未配置可连接的 HTTPS 网页管理入口。'
      : 'No HTTPS web management entry is configured for this environment.'
    : entry.localOnly
      ? zh
        ? '仅限在本机浏览器访问的开发预览入口，其他设备无法通过此地址连接。'
        : 'Development preview entry available only on this PC. Other devices cannot connect through this address.'
      : otherPrimaryName
        ? zh
          ? `打开后将连接账号当前的主设备（${otherPrimaryName}），首次接入需在该设备的 Nimi Home 中确认。`
          : `Opens the web manager for your current primary PC (${otherPrimaryName}). Confirm the first request in Nimi Home on that PC.`
        : isUnbound
          ? zh
            ? '先将一台电脑绑定为主设备并开启远程直连，即可在浏览器中远程管理。'
            : 'Bind a primary PC and enable direct access to manage your Runtime from a browser.'
          : remoteEnabled
            ? zh
              ? '使用同一 Nimi 账号在浏览器登录即可管理本机，首次接入请求会显示在下方。'
              : 'Sign in with the same Nimi account to manage this PC. The first request will appear below.'
            : zh
              ? '开启下方「远程直连」后，即可从浏览器远程管理本机服务。'
              : 'Enable direct remote access below to manage this PC from a browser.';

  async function openManager() {
    if (!entry || opening) return;
    setOpening(true);
    setFailed(false);
    try {
      await bindings.app.commands.openAccountManagement('runtime');
      setPopoverOpen(false);
    } catch {
      setFailed(true);
      setPopoverOpen(true);
    } finally {
      setOpening(false);
    }
  }

  async function copyEntryUrl() {
    if (!entry?.url) return;
    try {
      await navigator.clipboard?.writeText(entry.url);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const refreshing = primaryQuery.isFetching || remoteQuery.isFetching;
  async function refreshAll() {
    await Promise.all([primaryQuery.refetch(), remoteQuery.refetch()]);
  }

  return (
    <div className="flex items-center gap-2">
      <div ref={popoverRef} className="relative">
        {entry ? (
          <div className="inline-flex h-9 items-stretch overflow-hidden rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <button
              type="button"
              disabled={opening}
              onClick={() => void openManager()}
              className="inline-flex items-center gap-1.5 pl-3.5 pr-2.5 text-[13px] font-medium text-[var(--nimi-text-primary)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:opacity-50"
            >
              <Globe2
                size={14}
                className={entry.localOnly ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-action-primary-bg)]'}
                aria-hidden="true"
              />
              <span>{opening ? (zh ? '正在打开…' : 'Opening…') : zh ? '网页管理端' : 'Web manager'}</span>
              {entry.localOnly ? (
                <span className="rounded-full bg-[var(--nimi-status-warning-soft-bg)] px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-[var(--nimi-status-warning-soft-text)]">
                  {zh ? '开发预览' : 'Dev preview'}
                </span>
              ) : null}
              <ArrowUpRight size={13} className="text-[var(--nimi-text-muted)]" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-expanded={popoverOpen}
              aria-haspopup="dialog"
              aria-label={zh ? '查看网页管理端地址与说明' : 'View web manager details and address'}
              onClick={() => {
                setPopoverOpen((prev) => !prev);
                setCopied(false);
              }}
              className="inline-flex items-center border-l border-[var(--nimi-border-subtle)] px-2.5 text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              <ChevronDown
                size={13}
                className={`transition-transform duration-150 ${popoverOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={popoverOpen}
            aria-haspopup="dialog"
            onClick={() => setPopoverOpen((prev) => !prev)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3.5 text-[13px] font-medium text-[var(--nimi-text-secondary)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          >
            <Globe2 size={14} className="text-[var(--nimi-text-muted)]" aria-hidden="true" />
            <span>{zh ? '网页管理端' : 'Web manager'}</span>
          </button>
        )}

        {popoverOpen ? (
          <div
            role="dialog"
            aria-label={zh ? '网页管理端' : 'Web manager'}
            className="absolute right-0 z-30 mt-2.5 w-[336px] space-y-3.5 rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[0_18px_44px_-8px_rgba(15,23,42,0.18)]"
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <NimiText as="h3" role="label" className="text-[14px]">
                    {zh ? '网页管理端' : 'Web manager'}
                  </NimiText>
                  {entry ? (
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium ${
                        entry.localOnly ? 'text-[var(--nimi-status-warning-soft-text)]' : 'text-[var(--nimi-action-primary-bg)]'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          entry.localOnly ? 'bg-[var(--nimi-status-warning)]' : 'bg-[var(--nimi-action-primary-bg)]'
                        }`}
                        aria-hidden="true"
                      />
                      {entry.localOnly
                        ? zh
                          ? '仅限本机 · 开发预览'
                          : 'Local only · Dev preview'
                        : zh
                          ? '官方远程入口'
                          : 'Remote web entry'}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setPopoverOpen(false)}
                  aria-label={zh ? '关闭' : 'Close'}
                  className="rounded-full p-1 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
              <NimiText role="helper" className="leading-relaxed">
                {webHelperText}
              </NimiText>
            </div>

            {entry ? (
              <>
                <div className="space-y-1 rounded-xl bg-[var(--nimi-surface-panel)] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-[var(--nimi-text-muted)]">
                      {zh ? '入口地址' : 'Entry address'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyEntryUrl()}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-card)] hover:text-[var(--nimi-text-primary)]"
                    >
                      {copied ? (
                        <Check size={12} className="text-[var(--nimi-status-success)]" aria-hidden="true" />
                      ) : (
                        <Copy size={12} aria-hidden="true" />
                      )}
                      <span>{copied ? (zh ? '已复制' : 'Copied') : zh ? '复制' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="font-mono text-[11.5px] leading-relaxed break-all select-all text-[var(--nimi-text-secondary)]">
                    {entry.url}
                  </div>
                </div>

                <Button
                  tone="primary"
                  className="w-full justify-center rounded-xl"
                  disabled={opening}
                  trailingIcon={<ArrowUpRight size={14} aria-hidden="true" />}
                  onClick={() => void openManager()}
                >
                  {opening
                    ? zh
                      ? '正在打开…'
                      : 'Opening…'
                    : entry.localOnly
                      ? zh
                        ? '打开本机预览'
                        : 'Open local preview'
                      : zh
                        ? '在浏览器中打开'
                        : 'Open in browser'}
                </Button>
              </>
            ) : null}

            {failed ? (
              <InlineFeedback
                feedback={{
                  kind: 'error',
                  message: zh
                    ? '暂时无法打开网页管理端，请检查当前环境配置。'
                    : 'Could not open the web manager. Check the current environment configuration.',
                }}
                onDismiss={() => setFailed(false)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        disabled={refreshing}
        onClick={() => void refreshAll()}
        title={zh ? '刷新状态' : 'Refresh status'}
        aria-label={zh ? '刷新状态' : 'Refresh status'}
        className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:opacity-50"
      >
        <RefreshCw size={15} className={refreshing ? 'animate-spin text-[var(--nimi-action-primary-bg)]' : ''} aria-hidden="true" />
      </button>
    </div>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.connections
export function ConnectionsPanel() {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');

  return (
    <PageShell
      title={t('Navigation.connections')}
      description={
        zh
          ? '管理本机远程直连，决定哪些外部应用可以访问你的服务。'
          : 'Manage direct remote access on this PC and decide which external applications can connect.'
      }
      status={<ConnectionsHeaderActions />}
      contentClassName="mx-auto max-w-[840px] gap-6 px-6 py-7 lg:px-8"
    >
      <HomePrimaryRuntime />
    </PageShell>
  );
}
