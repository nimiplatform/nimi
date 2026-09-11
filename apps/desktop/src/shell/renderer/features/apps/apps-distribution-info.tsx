import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineAlert } from '@nimiplatform/kit/ui';
import type { AppPackageInfo } from '@nimiplatform/sdk/runtime/wire-types';
import { AppsReadmeMarkdown } from './apps-readme-markdown.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042c
export function AppsDistributionInfo({ info, error }: {
  readonly info?: AppPackageInfo | null;
  readonly error?: string | null;
}): ReactElement {
  const { t } = useTranslation();
  if (error) return <InlineAlert tone="warning" data-testid="apps-info-unavailable">{t('Apps.info.unavailable')}</InlineAlert>;
  if (!info) return <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('Apps.info.loading')}</p>;
  const documents = [
    ['readme', info.readmeMarkdown], ['releaseNotes', info.releaseNotesMarkdown], ['license', info.licenseText],
  ] as const;
  return <section data-testid="apps-distribution-info" className="space-y-4">
    <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{info.summary}</p>
    <dl className="grid gap-2 text-sm">
      {info.author ? <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.info.authorClaim')}</dt><dd>{info.author}</dd></div> : null}
      <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.catalog.appAccess')}</dt><dd>{info.appAccess.join(', ') || t('Apps.catalog.none')}</dd></div>
      <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.catalog.capabilities')}</dt><dd>{info.capabilityContractRefs.join(', ') || t('Apps.catalog.none')}</dd></div>
      <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.catalog.requiredFeatures')}</dt><dd>{info.requiredStandardizedFeatureRefs.join(', ') || t('Apps.catalog.none')}</dd></div>
      <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.catalog.storage')}</dt><dd>{t(info.storagePolicyKind === 'app-owned-os-storage' ? 'Apps.info.osStorage' : 'Apps.info.nimiStorage')}</dd></div>
      {info.osStorageDisclosure.map((item) => <div key={item.pathPattern}><dt className="break-all font-mono text-xs">{item.pathPattern}</dt><dd>{item.purpose} · {item.expectedSizeBand}</dd></div>)}
      {info.homepageUrl ? <div><dt>{t('Apps.info.homepage')}</dt><dd><AppsReadmeMarkdown content={`[${t('Apps.info.homepage')}](${info.homepageUrl})`} /></dd></div> : null}
      {info.supportUrl ? <div><dt>{t('Apps.info.support')}</dt><dd><AppsReadmeMarkdown content={`[${t('Apps.info.support')}](${info.supportUrl})`} /></dd></div> : null}
    </dl>
    {documents.map(([kind, content]) => <details key={kind} className="rounded-xl border border-[var(--nimi-border-subtle)] p-4">
      <summary className="cursor-pointer text-sm font-medium">{t(`Apps.info.${kind}`)}{kind === 'license' ? ` · ${info.licenseIdentifier}` : ''}</summary>
      <div className="mt-3">{!content ? <p className="text-sm text-[var(--nimi-text-muted)]">{t('Apps.info.notProvided')}</p>
        : kind === 'license' ? <pre className="whitespace-pre-wrap break-words text-xs">{content}</pre> : <AppsReadmeMarkdown content={content} />}</div>
    </details>)}
  </section>;
}
