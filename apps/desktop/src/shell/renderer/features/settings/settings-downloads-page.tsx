import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FormFeedback,
  PageShell,
  SectionTitle,
} from './settings-layout-components.js';
import { SettingRow } from './settings-preferences-panel-parts.js';
import {
  DevicePreferenceProjectionError,
  downloadEqual,
  loadDownloadPreferences,
  persistDownloadPreferences,
  type DownloadPreferences,
} from './settings-device-preferences.js';

type FeedbackState = {
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
} | null;

type DownloadLoad =
  | { status: 'ok'; preferences: DownloadPreferences }
  | { status: 'failClosed'; reason: string };

function resolveDownloadLoad(): DownloadLoad {
  try {
    return { status: 'ok', preferences: loadDownloadPreferences() };
  } catch (error) {
    if (error instanceof DevicePreferenceProjectionError) {
      return { status: 'failClosed', reason: error.message };
    }
    throw error;
  }
}

function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function PromptIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function OpenIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function DownloadsPage() {
  const { t } = useTranslation();
  const [load] = useState<DownloadLoad>(() => resolveDownloadLoad());
  const initialPreferences = load.status === 'ok' ? load.preferences : null;
  const [preferences, setPreferences] = useState<DownloadPreferences | null>(initialPreferences);
  const [baseline, setBaseline] = useState<DownloadPreferences | null>(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasChanges = useMemo(
    () => preferences !== null && baseline !== null && !downloadEqual(preferences, baseline),
    [preferences, baseline],
  );

  useEffect(() => () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
  }, []);

  const handleSave = ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || !hasChanges || preferences === null) {
      return;
    }
    setSaving(true);
    try {
      const normalized: DownloadPreferences = {
        ...preferences,
        downloadLocation: preferences.downloadLocation.trim(),
      };
      persistDownloadPreferences(normalized);
      setPreferences(normalized);
      setBaseline(normalized);
      if (!silentSuccess) {
        setFeedback({ kind: 'success', message: t('Downloads.saveSuccess') });
      }
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof DevicePreferenceProjectionError
          ? t('Downloads.saveFailClosed')
          : (error instanceof Error ? error.message : t('Downloads.saveFailClosed')),
      });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (saving || !hasChanges) {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return;
    }
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      handleSave({ silentSuccess: true });
    }, 700);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [hasChanges, preferences, saving]);

  if (load.status === 'failClosed' || preferences === null) {
    return (
      <PageShell title={t('Downloads.pageTitle')} description={t('Downloads.pageDescription')}>
        <div
          data-testid="settings:downloads-fail-closed"
          className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"
        >
          <p className="font-semibold">{t('Downloads.failClosedTitle')}</p>
          <p className="mt-1 text-xs text-red-600">{t('Downloads.failClosedBody')}</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={t('Downloads.pageTitle')}
      description={t('Downloads.pageDescription')}
    >
      <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} title={t('Downloads.pageTitle')} />

      <section className="mt-8">
        <SectionTitle description={t('Downloads.sectionLocationDescription')}>
          {t('Downloads.sectionLocation')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
              <FolderIcon className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">{t('Downloads.locationLabel')}</p>
              <p className="text-xs text-gray-500">{t('Downloads.locationHelper')}</p>
            </div>
          </div>
          <input
            type="text"
            value={preferences.downloadLocation}
            data-testid="settings:downloads-location-input"
            onChange={(event) => {
              setPreferences((previous) => (previous ? { ...previous, downloadLocation: event.target.value } : previous));
            }}
            placeholder={t('Downloads.locationPlaceholder')}
            className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-all focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('Downloads.sectionBehaviorDescription')}>
          {t('Downloads.sectionBehavior')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<PromptIcon className="h-5 w-5" />}
            title={t('Downloads.askEachTime')}
            description={t('Downloads.askEachTimeDescription')}
            checked={preferences.askEachTime}
            onChange={(value) => setPreferences((previous) => (previous ? { ...previous, askEachTime: value } : previous))}
          />
          <div className="h-px bg-gray-100 mx-5" />
          <SettingRow
            icon={<OpenIcon className="h-5 w-5" />}
            title={t('Downloads.autoOpenOnComplete')}
            description={t('Downloads.autoOpenOnCompleteDescription')}
            checked={preferences.autoOpenOnComplete}
            onChange={(value) => setPreferences((previous) => (previous ? { ...previous, autoOpenOnComplete: value } : previous))}
          />
        </div>
      </section>
    </PageShell>
  );
}
