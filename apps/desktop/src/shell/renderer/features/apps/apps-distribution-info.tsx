import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineAlert } from '@nimiplatform/kit/ui';
import type { AppPackageInfo } from '@nimiplatform/sdk/runtime/wire-types';
import { AppsReadmeMarkdown } from './apps-readme-markdown.js';
import { AppsSafetyDeclarationSection, type AppsSafetyDeclarationSource } from './apps-safety-declaration.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042c
export function AppsDistributionInfo({ info, error, showDocuments = true, showTechnicalDetails = true, declarationSource = 'local' }: {
  readonly info?: AppPackageInfo | null;
  readonly error?: string | null;
  readonly showDocuments?: boolean;
  /** Raw declaration refs and storage disclosures; pre-install surfaces keep them, the installed overview leaves them to the properties dialog. */
  readonly showTechnicalDetails?: boolean;
  /** Where the safety declaration came from; a local package was never reviewed by the Registry. */
  readonly declarationSource?: AppsSafetyDeclarationSource;
}): ReactElement {
  const { t } = useTranslation();
  if (error) return <InlineAlert tone="warning" data-testid="apps-info-unavailable">{t('Apps.info.unavailable')}</InlineAlert>;
  if (!info) return <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('Apps.info.loading')}</p>;
  return <section data-testid="apps-distribution-info" className="space-y-4">
    <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{info.summary}</p>
    <dl className="grid gap-2 text-sm">
      {info.author ? <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.info.authorClaim')}</dt><dd>{info.author}</dd></div> : null}
      <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.catalog.appAccess')}</dt><dd>{info.appAccess.join(', ') || t('Apps.catalog.none')}</dd></div>
      {showTechnicalDetails ? <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.catalog.capabilities')}</dt><dd>{info.capabilityContractRefs.join(', ') || t('Apps.catalog.none')}</dd></div> : null}
      {showTechnicalDetails ? <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.catalog.requiredFeatures')}</dt><dd>{info.requiredStandardizedFeatureRefs.join(', ') || t('Apps.catalog.none')}</dd></div> : null}
      <div><dt className="text-[var(--nimi-text-muted)]">{t('Apps.catalog.storage')}</dt><dd>{t(info.storagePolicyKind === 'app-owned-os-storage' ? 'Apps.info.osStorage' : 'Apps.info.nimiStorage')}</dd></div>
      {showTechnicalDetails ? info.osStorageDisclosure.map((item) => <div key={item.pathPattern}><dt className="break-all font-mono text-xs">{item.pathPattern}</dt><dd>{item.purpose} · {item.expectedSizeBand}</dd></div>) : null}
      {info.homepageUrl ? <div><dt>{t('Apps.info.homepage')}</dt><dd><AppsReadmeMarkdown content={`[${t('Apps.info.homepage')}](${info.homepageUrl})`} /></dd></div> : null}
      {info.supportUrl ? <div><dt>{t('Apps.info.support')}</dt><dd><AppsReadmeMarkdown content={`[${t('Apps.info.support')}](${info.supportUrl})`} /></dd></div> : null}
    </dl>
    <AppsSafetyDeclarationSection declaration={info.safetyDeclaration ?? null} source={declarationSource} version={info.version} compact />
    {showDocuments ? <AppsDistributionDocuments info={info} /> : null}
  </section>;
}

export type AppsDistributionDocumentKind = 'readme' | 'releaseNotes' | 'license';

const ALL_DOCUMENT_KINDS: readonly AppsDistributionDocumentKind[] = ['readme', 'releaseNotes', 'license'];

export function AppsDistributionDocuments({ info, error, kinds = ALL_DOCUMENT_KINDS }: {
  readonly info?: AppPackageInfo | null;
  readonly error?: string | null;
  /** Which documents to show; each surface picks its subset so a document lives in exactly one place. */
  readonly kinds?: readonly AppsDistributionDocumentKind[];
}): ReactElement {
  const { t } = useTranslation();
  if (error) return <InlineAlert tone="warning" data-testid="apps-documents-unavailable">{t('Apps.info.unavailable')}</InlineAlert>;
  if (!info) return <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('Apps.info.loading')}</p>;
  const documents = ([
    ['readme', info.readmeMarkdown], ['releaseNotes', info.releaseNotesMarkdown], ['license', info.licenseText],
  ] as const).filter(([kind]) => kinds.includes(kind));
  return <div data-testid="apps-distribution-documents" className="space-y-4">
    {documents.map(([kind, content]) => <details key={kind} className="rounded-xl border border-[var(--nimi-border-subtle)] p-4">
      <summary className="cursor-pointer text-sm font-medium">{t(`Apps.info.${kind}`)}{kind === 'license' ? ` · ${info.licenseIdentifier}` : ''}</summary>
      <div className="mt-3">{!content ? <p className="text-sm text-[var(--nimi-text-muted)]">{t('Apps.info.notProvided')}</p>
        : kind === 'license' ? <pre className="whitespace-pre-wrap break-words text-xs">{content}</pre> : <AppsReadmeMarkdown content={content} />}</div>
    </details>)}
  </div>;
}
