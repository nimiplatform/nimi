import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import type { ResolvedStorefrontHighlight } from './apps-storefront.js';

export function AppsHighlightsGrid({
  highlights,
  tags = [],
}: {
  readonly highlights: readonly ResolvedStorefrontHighlight[];
  readonly tags?: readonly string[];
}): ReactElement | null {
  const { t } = useTranslation();
  if (highlights.length === 0 && tags.length === 0) return null;

  return (
    <section data-testid="apps-highlights-section" className="mb-6 space-y-4">
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-testid="apps-storefront-tags">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-active)_55%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[color:var(--nimi-text-secondary)]"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {highlights.length > 0 ? (
        <div>
          <h2 className="desktop-module-section-title mb-3">
            {t('Apps.storefront.highlightsTitle')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {highlights.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,transparent)] p-4"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
                  <h3 className="text-sm font-semibold leading-5 text-[color:var(--nimi-text-primary)]">
                    {item.title}
                  </h3>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-[color:var(--nimi-text-secondary)]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
