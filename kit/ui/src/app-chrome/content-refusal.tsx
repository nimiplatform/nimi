import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { dismissNimiContentRefusalNotice, getNimiContentRefusalNotice, subscribeNimiContentRefusalNotice, retireNimiContentRefusalPresentation } from '@nimiplatform/kit/shell/renderer/bridge';
import { Button, IconButton } from '../components/button.js';

// @nimi-authority: rule.nimi.runtime.ai-provider.content-refusal-presentation
export function NimiContentRefusalNotice({ locale, scopeKey }: { readonly locale: 'en' | 'zh'; readonly scopeKey?: object }) {
  const notice = useSyncExternalStore(subscribeNimiContentRefusalNotice, getNimiContentRefusalNotice, () => null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const activeNotice = useRef<string | null>(null);
  activeNotice.current = notice?.correlation ?? null;
  useEffect(() => () => { activeNotice.current = null; retireNimiContentRefusalPresentation(); }, [scopeKey]);
  useEffect(() => { setCopied(false); setCopyFailed(false); }, [notice?.correlation]);
  if (!notice) return null;
  const zh = locale === 'zh';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ reasonCode: notice.reasonCode, ruleId: notice.ruleId, stage: notice.stage }, null, 2));
      if (activeNotice.current !== notice.correlation) return;
      setCopied(true); setCopyFailed(false);
    } catch { if (activeNotice.current === notice.correlation) setCopyFailed(true); }
  };
  return <section className="shrink-0 border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3 text-sm text-[var(--nimi-text-primary)]" aria-label={zh ? '内容检查提醒' : 'Content check notice'}>
    <div className="flex items-start justify-between gap-3">
      <p role="status" className="min-w-0 leading-relaxed">{zh
        ? '内容检查阻止了一次操作。应用仍可继续使用，请检查该次输入或所选上下文。'
        : 'Content checks blocked an operation. You can keep using the app. Review that input or its selected context.'}</p>
      <IconButton size="sm" icon={<X size={16} />} aria-label={zh ? '关闭内容检查提醒' : 'Dismiss content check notice'} onClick={() => dismissNimiContentRefusalNotice(notice.correlation)} />
    </div>
    <details className="mt-2 text-[var(--nimi-text-secondary)]">
      <summary className="cursor-pointer">{zh ? '查看原因与安全诊断' : 'Reason and safe diagnostics'}</summary>
      <p className="mt-2">{notice.ruleId === 'pem-private-key'
        ? zh ? '检测到可能属于完整私钥的格式。' : 'A format consistent with a complete private key was detected.'
        : notice.ruleId === 'github-classic-pat'
          ? zh ? '检测到可能属于访问令牌的格式。' : 'A format consistent with an access token was detected.'
          : zh ? '目前只确认内容检查未通过，没有更多可公开的定位信息。' : 'Content checks did not pass. No more specific public detail is available.'}</p>
      {notice.ruleId ? <p className="mt-1">{zh ? '格式命中不代表凭据真实有效，也不证明已发生泄露。' : 'A format match does not establish credential validity or a confirmed leak.'}</p> : null}
      <p className="mt-1">{zh ? '可以修改内容后重新提交，或继续其他请求。' : 'You can edit and resubmit, or continue with other requests.'}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="text-xs">AI_CONTENT_FILTER_BLOCKED</code>
        <Button size="sm" tone="ghost" onClick={() => { void copy(); }}>{copied ? zh ? '已复制' : 'Copied' : zh ? '复制安全诊断' : 'Copy safe diagnostics'}</Button>
        {copyFailed ? <span>{zh ? '复制未完成。' : 'Could not copy.'}</span> : null}
      </div>
    </details>
  </section>;
}
