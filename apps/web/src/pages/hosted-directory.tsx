import { useCallback, useEffect, useState } from 'react';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { PublicSiteLink } from './public-site-shell.js';

type Product = {
  app_id: string;
  slug: string;
  display_name: string;
  publisher: string;
  repository: string;
  license: string;
  summary: { zh: string; en: string };
  pc_targets: string[];
  capabilities: string[];
  blocked: boolean;
  web: { url: string; version: string } | null;
};
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const endpoint = '/.well-known/nimi-apps';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
function product(value: unknown): Product {
  if (
    !object(value) ||
    typeof value.slug !== 'string' ||
    !label.test(value.slug) ||
    typeof value.app_id !== 'string' ||
    typeof value.display_name !== 'string' ||
    typeof value.publisher !== 'string' ||
    typeof value.repository !== 'string' ||
    !/^https:\/\/github\.com\/[a-z\d-]+\/[\w.-]+$/i.test(value.repository) ||
    typeof value.license !== 'string' ||
    typeof value.blocked !== 'boolean' ||
    !strings(value.pc_targets) ||
    !strings(value.capabilities) ||
    !object(value.summary) ||
    typeof value.summary.en !== 'string' ||
    typeof value.summary.zh !== 'string' ||
    !(
      value.web === null ||
      (object(value.web) &&
        value.web.url === 'https://' + value.slug + '.nimi.xyz/' &&
        typeof value.web.version === 'string')
    )
  )
    throw Error('Invalid public product');
  return value as Product;
}

type State = {
  slug?: string;
  status: 'loading' | 'ok' | 'missing' | 'unavailable';
  products: Product[];
  next: string | null;
};
const empty = (slug?: string): State => ({ slug, status: 'loading', products: [], next: null });
export function useHostedDirectory(slug?: string) {
  const [state, setState] = useState<State>(() => empty(slug));
  const [after, setAfter] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    if (slug && !label.test(slug)) {
      setState({ ...empty(slug), status: 'missing' });
      return;
    }
    if (slug || !after) setState(empty(slug));
    const url = slug
      ? endpoint + '/' + slug
      : endpoint + (after ? '?after=' + encodeURIComponent(after) : '');
    void (async () => {
      const response = await fetch(url, { signal: abort.signal, credentials: 'omit' });
      if (response.status === 404 && slug) {
        setState({ ...empty(slug), status: 'missing' });
        return;
      }
      if (!response.ok) throw Error('Directory unavailable');
      const data: unknown = await response.json();
      if (slug) {
        const item = product(data);
        if (item.slug !== slug) throw Error('Mismatched slug');
        setState({ slug, status: 'ok', products: [item], next: null });
      } else {
        if (
          !object(data) ||
          !Array.isArray(data.products) ||
          !(data.next === null || (typeof data.next === 'string' && label.test(data.next)))
        )
          throw Error('Invalid directory page');
        const items = data.products.map(product),
          next = data.next;
        setState((prev) => ({
          slug,
          status: 'ok',
          products: after && !prev.slug ? [...prev.products, ...items] : items,
          next,
        }));
      }
    })().catch(() => {
      if (!abort.signal.aborted) setState((prev) => ({ ...prev, slug, status: 'unavailable', next: null }));
    });
    return () => abort.abort();
  }, [slug, after]);
  useEffect(() => setAfter(null), [slug]);
  const more = useCallback(() => {
    if (state.next) setAfter(state.next);
  }, [state.next]);
  return { state: state.slug === slug ? state : empty(slug), more };
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.hosted-web-publication
export function WebLaunch({ item, locale }: { item: Product; locale: LandingLocale }) {
  if (item.blocked)
    return <p role="status">{locale === 'zh' ? '此产品已停用。' : 'This product is suspended.'}</p>;
  if (!item.web) return null;
  return (
    <div className="public-app-posture-callout">
      <a className="story-button" href={item.web.url}>
        {locale === 'zh' ? '在浏览器打开' : 'Open in browser'}
      </a>
      <p>
        {locale === 'zh'
          ? '使用 Runtime 功能时，请保持主 PC 在线并可直连，首次接入需在 Nimi Home 确认。'
          : 'Runtime features require your primary PC to be online and reachable. Confirm first access in Nimi Home.'}
      </p>
    </div>
  );
}

const pcTargets: Record<string, string> = {
  'windows-x86_64': 'Windows x86_64',
  'macos-aarch64': 'macOS arm64',
};

export function pcTargetLabels(targets: string[]) {
  return targets.map((target) => pcTargets[target] ?? target);
}

export function PublicProduct({
  item,
  locale,
  detail,
}: {
  item: Product;
  locale: LandingLocale;
  detail?: boolean;
}) {
  const heading = detail ? (
    <h1>{item.display_name}</h1>
  ) : (
    <h3>
      <PublicSiteLink to={withLocaleQuery('/apps/' + item.slug, locale)}>{item.display_name}</PublicSiteLink>
    </h3>
  );
  return (
    <article className={detail ? 'story-container public-app-detail' : 'public-app-card-body'}>
      {heading}
      <p>{item.summary[locale]}</p>
      <p>
        {locale === 'zh' ? '发布者' : 'Publisher'} ·{' '}
        <a href={item.repository} rel="noreferrer">
          {item.publisher}
        </a>{' '}
        · {item.license}
      </p>
      {item.pc_targets.length > 0 && (
        <p>
          PC ·{' '}
          {pcTargetLabels(item.pc_targets).join(' · ')}
        </p>
      )}
      {detail && <WebLaunch item={item} locale={locale} />}
    </article>
  );
}
