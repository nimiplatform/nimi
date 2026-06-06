import { useTranslation } from 'react-i18next';
import type { NimiAIProfile } from '@nimiplatform/sdk/ai';
import type { NimiAccountProfileLibraryProjection, LibraryProfile } from './runtime-config-profile-library.js';

function countConfiguredCapabilities(profile: NimiAIProfile): number {
  return Object.values(profile.capabilities).filter((intent) => {
    return intent !== null && intent !== undefined;
  }).length;
}

export function AccountProfileLibraryPanel(props: {
  projection: NimiAccountProfileLibraryProjection | null;
  accountDefaultProfile: NimiAIProfile | null;
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onEdit: (entry: LibraryProfile) => void;
  onDelete: (entry: LibraryProfile) => void;
}) {
  const { t } = useTranslation();
  const defaultCapabilityCount = props.accountDefaultProfile
    ? countConfiguredCapabilities(props.accountDefaultProfile)
    : 0;
  const entries = props.projection?.profiles ?? [];
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="runtime-profiles-account-library"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            {t('runtimeConfig.profiles.accountLibraryTitle', { defaultValue: 'AI Profiles' })}
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {t('runtimeConfig.profiles.accountLibrarySubtitle', {
              defaultValue: 'Create, edit, import, and export portable account AIProfile templates. Apply/use flows live in explicit app or module scope surfaces.',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="runtime-profiles-refresh"
            onClick={props.onRefresh}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {props.loading
              ? t('runtimeConfig.profiles.loading', { defaultValue: 'Loading profiles...' })
              : t('runtimeConfig.profiles.reload', { defaultValue: 'Reload' })}
          </button>
          <button
            type="button"
            data-testid="runtime-profiles-create"
            onClick={props.onCreate}
            className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600"
          >
            {t('runtimeConfig.profiles.create', { defaultValue: '+ Create Profile' })}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <article
          className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3"
          data-testid="runtime-profiles-account-default-row"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-slate-950">
                  {props.accountDefaultProfile?.title
                    || t('runtimeConfig.profiles.accountDefaultTitle', { defaultValue: 'Default Profile' })}
                </h4>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                  {t('runtimeConfig.profiles.accountDefaultBadge', { defaultValue: 'Account default' })}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {props.accountDefaultProfile?.description
                  || t('runtimeConfig.profiles.accountDefaultDescription', {
                    defaultValue: 'Created during onboarding and used as the account default template for new scope initialization.',
                  })}
              </p>
              <p className="mt-2 text-[11px] text-slate-500">
                {t('runtimeConfig.profiles.capabilityCount', {
                  defaultValue: '{{count}} profile slices',
                  count: defaultCapabilityCount,
                })}
              </p>
            </div>
          </div>
        </article>

        {entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            {t('runtimeConfig.profiles.noCustom', { defaultValue: 'No custom profiles yet. Create one or import from a file.' })}
          </div>
        ) : entries.map((entry) => {
          const profile = entry.profile;
          return (
            <article
              key={profile.profileId}
              className="rounded-xl border border-slate-200 bg-white p-3"
              data-testid="runtime-profiles-library-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-950">{profile.title}</h4>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {entry.origin}
                    </span>
                  </div>
                  {profile.description ? (
                    <p className="mt-1 text-xs text-slate-600">{profile.description}</p>
                  ) : null}
                  <p className="mt-2 text-[11px] text-slate-500">
                    {t('runtimeConfig.profiles.capabilityCount', {
                      defaultValue: '{{count}} profile slices',
                      count: countConfiguredCapabilities(profile),
                    })}
                    {' · '}
                    {t('runtimeConfig.profiles.updatedAt', {
                      defaultValue: 'Updated {{time}}',
                      time: entry.updatedAt || '-',
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => props.onEdit(entry)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t('runtimeConfig.profiles.edit', { defaultValue: 'Edit' })}
                  </button>
                  <button
                    type="button"
                    disabled={!entry.removable}
                    onClick={() => props.onDelete(entry)}
                    className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {t('runtimeConfig.profiles.delete', { defaultValue: 'Delete' })}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
