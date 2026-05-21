/**
 * Developer Tools — embedded Tester sub-area (`D-DEV-005`, `D-DEV-006`).
 *
 * `D-DEV-005`: the Desktop-embedded Tester (`features/tester/**`) is reachable
 * ONLY inside `Developer Tools`, and `Developer Tools` itself is reachable only
 * behind admitted Developer Mode. The embedded Tester stays a frozen internal
 * source / validation surface — this section gates it, it does not extract it
 * into a standalone app.
 *
 * `D-DEV-006`: the reference to `nimi.tester` consumes the admitted
 * `nimi.tester` row from the Platform App admission registry (`P-NAPP-016`) as
 * the single admission truth. The registry row — `admission_status: admitted`,
 * `ordinary_visibility: developer-only` — is resolved through
 * `nimi-tester-registry.ts`. If the row is absent or not admitted, this
 * section fails closed: the embedded Tester is NOT surfaced.
 */

import { Suspense, lazy, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  resolveNimiTesterRegistryReference,
  isNimiTesterDeveloperVisible,
} from './nimi-tester-registry.js';

const TesterPage = lazy(async () => {
  const mod = await import('@renderer/features/tester/tester-page');
  return { default: mod.TesterPage };
});

export function DeveloperTesterSection() {
  const { t } = useTranslation();

  // D-DEV-006: the embedded Tester is surfaced only when the admitted
  // `nimi.tester` registry row resolves as a developer-only Nimi App.
  const testerReference = useMemo(() => resolveNimiTesterRegistryReference(), []);
  const developerVisible = isNimiTesterDeveloperVisible(testerReference);

  if (!developerVisible || !testerReference) {
    // Fail-closed: no admitted developer-only `nimi.tester` row — never
    // synthesize a fallback Tester entry or treat the embedded source folder
    // as admission truth.
    return (
      <div
        data-testid="developer-tools:tester-unavailable"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('DeveloperTools.testerUnavailableTitle')}
        </p>
        <p className="max-w-md text-xs text-[var(--nimi-text-secondary)]">
          {t('DeveloperTools.testerUnavailableBody')}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="developer-tools:tester" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--nimi-border-subtle)] px-5 py-2.5">
        <span className="text-xs font-semibold text-[var(--nimi-text-primary)]">
          {testerReference.displayName}
        </span>
        <span className="rounded-full bg-[var(--nimi-surface-active)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-text-secondary)]">
          {testerReference.appId}
        </span>
        <span className="rounded-full bg-[var(--nimi-surface-active)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-text-secondary)]">
          {t('DeveloperTools.testerRegistryBadge', {
            defaultValue: 'developer-only · {{rule}}',
            rule: testerReference.sourceRule,
          })}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Suspense fallback={<div className="flex min-h-0 flex-1" />}>
          <TesterPage />
        </Suspense>
      </div>
    </div>
  );
}
