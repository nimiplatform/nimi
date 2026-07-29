import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '@nimiplatform/kit/ui';
import { loadNimiRealmCreatorEligibility } from '@nimiplatform/sdk/realm';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import {
  FormFeedback,
  PageShell,
  SectionTitle,
} from './settings-layout-components.js';
import type { PerformancePreferences } from '../../renderer/settings-port.js';
import { DeveloperModeToggle } from '../developer/developer-mode-toggle.js';
import {
  AnimationIcon,
  AwardIcon,
  GpuIcon,
  performanceEqual,
  SettingRow,
} from './settings-preferences-panel-parts.js';

export function PerformancePage() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const settings = bindings.app.commands.settings;
  const [preferences, setPreferences] = useState<PerformancePreferences>(() =>
    settings.loadPerformancePreferences());
  const [baseline, setBaseline] = useState<PerformancePreferences>(() =>
    settings.loadPerformancePreferences());
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'info' | 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const autosaveTimerRef = useRef<(() => void) | null>(null);

  const eligibilityQuery = useQuery({
    queryKey: ['settings-creator-eligibility'],
    queryFn: async () => loadNimiRealmCreatorEligibility(bindings.sdk.realm()),
  });

  const hasChanges = useMemo(() => !performanceEqual(preferences, baseline), [preferences, baseline]);

  useEffect(() => () => {
    autosaveTimerRef.current?.();
    autosaveTimerRef.current = null;
  }, []);

  const handleSave = async ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || !hasChanges) {
      if (!hasChanges) {
        setFeedback({
          kind: 'info',
          message: t('Performance.noChanges'),
        });
      }
      return;
    }
    setSaving(true);
    try {
      settings.persistPerformancePreferences(preferences);
      setBaseline(preferences);
      if (!silentSuccess) {
        setFeedback({
          kind: 'success',
          message: t('Performance.saveSuccess'),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (saving || !hasChanges) {
      autosaveTimerRef.current?.();
      autosaveTimerRef.current = null;
      return;
    }

    autosaveTimerRef.current?.();
    autosaveTimerRef.current = bindings.clock.schedule(700, (result) => {
      autosaveTimerRef.current = null;
      if (!result.ok) {
        setFeedback({ kind: 'error', message: result.error });
        return;
      }
      void handleSave({ silentSuccess: true });
    });

    return () => {
      autosaveTimerRef.current?.();
      autosaveTimerRef.current = null;
    };
  }, [bindings.clock, hasChanges, preferences, saving]);

  const eligibility = eligibilityQuery.data;
  const eligibilityState = eligibilityQuery.isPending
    ? 'loading'
    : eligibilityQuery.isError || !eligibility
      ? 'unavailable'
      : eligibility.isEligible
        ? 'eligible'
        : 'not-eligible';
  const eligibilityText = eligibilityQuery.isPending
    ? t('Performance.loadingEligibility')
    : eligibilityQuery.isError
      ? t('Performance.eligibilityLoadError')
      : eligibility
        ? `${eligibility.tier} · ${eligibility.status}`
        : t('Performance.eligibilityLoadError');
  const eligibilityBadgeText = eligibilityState === 'loading'
    ? t('Performance.eligibilityLoadingStatus')
    : eligibilityState === 'unavailable'
      ? t('Performance.eligibilityUnavailable')
      : eligibilityState === 'eligible'
        ? t('Performance.eligible')
        : t('Performance.notEligible');
  const eligibilityBadgeTone = eligibilityState === 'eligible'
    ? 'success'
    : eligibilityState === 'not-eligible'
      ? 'warning'
      : 'neutral';
  const isEligible = eligibilityState === 'eligible';
  return (
    <PageShell
      title={t('Performance.pageTitle')}
      description={t('Performance.pageDescription')}
      contentClassName="max-w-4xl"
    >
      <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} title={t('Performance.pageTitle')} />
      <section className="mt-8">
        <SectionTitle>
          {t('Performance.sectionRendering')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<GpuIcon className="h-5 w-5" />}
            title={t('Performance.hardwareAcceleration')}
            description={t('Performance.hardwareAccelerationDescription')}
            checked={preferences.hardwareAcceleration}
            onChange={(value) => setPreferences((previous) => ({ ...previous, hardwareAcceleration: value }))}
          />
          <div className="h-px bg-gray-100 mx-5" />
          <SettingRow
            icon={<AnimationIcon className="h-5 w-5" />}
            title={t('Performance.reduceAnimations')}
            description={t('Performance.reduceAnimationsDescription')}
            checked={preferences.reduceAnimations}
            onChange={(value) => setPreferences((previous) => ({ ...previous, reduceAnimations: value }))}
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>
          {t('Performance.sectionDeveloper')}
        </SectionTitle>
        {/* D-DEV-002: the discoverable Developer Mode toggle. This is the
            canonical in-app entry — Settings — for enabling / disabling
            Developer Mode and showing its current state. Developer Mode is
            never reachable only through launch params or env vars. */}
        <div className="mt-3">
          <DeveloperModeToggle />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>{t('Performance.sectionCreatorEligibility')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${isEligible ? 'bg-mint-100 text-mint-600' : 'bg-gray-100 text-gray-500'}`}>
                <AwardIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{t('Performance.eligibility')}</p>
                <p className="text-xs text-gray-500">{eligibilityText}</p>
              </div>
            </div>
            <StatusBadge tone={eligibilityBadgeTone} role="status" aria-live="polite">
              {eligibilityBadgeText}
            </StatusBadge>
          </div>
          {eligibility?.message ? (
            <p className="mt-4 text-xs text-gray-500">{eligibility.message}</p>
          ) : null}
        </div>
      </section>
    </PageShell>
  );
}
