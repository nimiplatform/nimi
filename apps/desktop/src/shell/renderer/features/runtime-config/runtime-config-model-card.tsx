import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeSanitize from 'rehype-sanitize';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';

export function modelCardBody(markdown: string): string {
  const body = markdown.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
  const lines = body.split('\n');
  const result: string[] = [];
  let fence = '';
  // HF accepts an unindented table directly after a list. GFM needs a block
  // boundary there; keep the document text and fenced examples unchanged.
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1]!;
      else if (marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && line.slice(marker[0].length).trim() === '') fence = '';
    }
    if (!fence && line.startsWith('|') && /^\|? *:?-{3,}:? *(?:\| *:?-{3,}:? *)+\|?\s*$/.test(lines[index + 1] ?? '') && index > 0 && lines[index - 1]!.trim()) {
      result.push('');
    }
    result.push(line);
  }
  return result.join('\n');
}

export function modelCardUrl(value: string, baseUrl: string, image: boolean): string {
  if (!image && value.startsWith('#')) return '#user-content-' + value.slice(1);
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    // HF blob pages return HTML; embedded repository images need raw content.
    if (image && url.hostname === 'huggingface.co') url.pathname = url.pathname.replace('/blob/', '/resolve/');
    if (!image && !/^(?:https?:)?\/\//i.test(value)) url.pathname = url.pathname.replace('/resolve/', '/blob/');
    return url.href;
  } catch {
    return '';
  }
}

export function ModelCardMarkdown(props: { readonly markdown: string; readonly baseUrl: string }) {
  return (
    <div className="min-w-0 break-words text-sm leading-7 text-[var(--nimi-text-secondary)] [&_h1]:my-5 [&_h1]:text-xl [&_h2]:my-5 [&_h2]:text-lg [&_h3]:my-4 [&_h3]:text-base [&_h4]:my-3 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[var(--nimi-surface-active)] [&_pre]:p-4 [&_code]:font-mono [&_code]:text-xs [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--nimi-action-primary-bg)] [&_blockquote]:bg-[var(--nimi-surface-active)] [&_blockquote]:px-4 [&_blockquote]:py-1 [&_hr]:my-6 [&_hr]:border-[var(--nimi-border-subtle)] [&_summary]:cursor-pointer [&_summary]:font-medium [&_details]:my-4 [&_th]:border [&_th]:border-[var(--nimi-border-subtle)] [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:border-[var(--nimi-border-subtle)] [&_td]:px-3 [&_td]:py-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSlug, rehypeSanitize]}
        urlTransform={(url, key) => modelCardUrl(url, props.baseUrl, key === 'src')}
        components={{
          a: ({ node: _node, href, children, ...rest }) => (
            <a {...rest} href={href} className="text-[var(--nimi-action-primary-bg)] underline underline-offset-2" onClick={(event) => {
              if (!href || href.startsWith('#')) return;
              event.preventDefault();
              void openExternalUrl(href);
            }}>{children}</a>
          ),
          img: ({ node: _node, ...image }) => <img {...image} loading="lazy" className="my-3 inline-block h-auto max-w-full" />,
          table: ({ children }) => <div className="my-4 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
        }}
      >{modelCardBody(props.markdown)}</ReactMarkdown>
    </div>
  );
}

// @nimi-authority: rule.nimi.runtime.local-compute.r026
export function ModelAboutCard(props: { readonly modelLocator?: string; readonly offerRef?: string }) {
  const { t } = useTranslation();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const card = useQuery({
    queryKey: ['model-market', 'model-card', props.modelLocator ?? '', props.offerRef ?? ''],
    queryFn: () => client.getCatalogModelCard(props),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <Surface tone="card" className="min-w-0 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nimi-border-subtle)] pb-3">
        <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.modelCardTitle')}</h2>
        {card.data ? <Button size="sm" tone="ghost" onClick={() => { void openExternalUrl(card.data.sourceUrl); }}>{t('runtimeConfig.recommend.modelCardSource')}</Button> : null}
      </div>
      {card.isPending ? <p role="status" className="text-sm text-[var(--nimi-text-muted)]">{t('Common.loading')}</p> : null}
      {card.isError ? <InlineAlert tone="danger"><p>{t('runtimeConfig.recommend.modelCardFailed')}</p><p className="mt-1 break-words text-xs">{card.error.message}</p><Button size="sm" tone="ghost" onClick={() => { void card.refetch(); }}>{t('runtimeConfig.recommend.modelCardRetry')}</Button></InlineAlert> : null}
      {card.data ? modelCardBody(card.data.markdown) ? <ModelCardMarkdown markdown={card.data.markdown} baseUrl={card.data.baseUrl} /> : <p className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.modelCardEmpty')}</p> : null}
    </Surface>
  );
}
