import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { changeLocale, getCurrentLocale, SUPPORTED_LOCALES, getLocaleLabel, type SupportedLocale } from '@renderer/i18n';
import {
  BIO_MAX,
  ICON_CAMERA,
  ICON_MAIL,
  ICON_USER,
} from '../settings-assets';
import {
  PageShell,
  SaveFooter,
  SectionTitle,
} from '../settings-layout-components';
// SelectField component removed - using native select for consistent styling

// Icons
function LanguageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 8l6 6" />
      <path d="M4 14l6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="M22 22l-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.auth.user);
  const authToken = useAppStore((s) => s.auth.token);
  const setAuthSession = useAppStore((s) => s.setAuthSession);
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);
  const displayName = String(user?.displayName || user?.handle || 'User');
  const userHandle = String(user?.handle || 'me');
  const userAvatarUrl = typeof user?.avatarUrl === 'string' ? user.avatarUrl : null;

  const [name, setName] = useState(displayName);
  const email = String(user?.email || '');
  const [bio, setBio] = useState(String(user?.bio || t('Profile.bioPlaceholder')));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        displayName: name.trim() || displayName,
        bio: bio.trim(),
      };
      const updated = await dataSync.updateUserProfile(payload);
      const updatedUser = (updated && typeof updated === 'object')
        ? (updated as Record<string, unknown>)
        : null;
      if (updatedUser) {
        setAuthSession(updatedUser, authToken);
        setName(String(updatedUser.displayName || updatedUser.handle || name || 'User'));
        setBio(typeof updatedUser.bio === 'string' ? updatedUser.bio : '');
      }
      setStatusBanner({
        kind: 'success',
        message: t('Profile.updateSuccess'),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('Profile.updateError'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={t('Profile.pageTitle')}
      description={t('Profile.pageDescription')}
      footer={<SaveFooter onSave={() => { void handleSave(); }} saving={saving} />}
    >
      {/* Profile Header Card */}
      <section>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-mint-400 to-mint-600 p-6 text-white shadow-lg">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute bottom-0 left-0 -mb-4 -ml-4 h-20 w-20 rounded-full bg-white/10 blur-xl" />
          <div className="relative flex items-center gap-5">
            <div className="relative">
              {userAvatarUrl ? (
                <img 
                  src={userAvatarUrl} 
                  alt={displayName} 
                  className="h-24 w-24 rounded-2xl object-cover ring-4 ring-white/20" 
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-white/20 text-3xl font-bold ring-4 ring-white/20 backdrop-blur-sm">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <button
                type="button"
                className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-mint-600 shadow-lg transition-transform hover:scale-110"
              >
                {ICON_CAMERA}
              </button>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold">{displayName}</h3>
              <p className="text-sm text-white/80">@{userHandle.replace(/^@/, '')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Basic Information */}
      <section className="mt-8">
        <SectionTitle>{t('Profile.sectionBasicInfo')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            {/* Display Name */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('Profile.displayName')}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  {ICON_USER}
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('Profile.displayNamePlaceholder')}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-4 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
                />
              </div>
            </div>

            {/* Username - Read Only */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('Profile.username')}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  {ICON_USER}
                </div>
                <input
                  type="text"
                  value={userHandle}
                  readOnly
                  className="w-full rounded-xl border border-gray-100 bg-gray-100 py-3 pl-11 pr-4 text-sm text-gray-500 cursor-not-allowed"
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-400">{t('Profile.usernameHelper')}</p>
            </div>

            {/* Email - Read Only */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('Profile.email')}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  {ICON_MAIL}
                </div>
                <input
                  type="email"
                  value={email}
                  readOnly
                  className="w-full rounded-xl border border-gray-100 bg-gray-100 py-3 pl-11 pr-4 text-sm text-gray-500 cursor-not-allowed"
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-400">{t('Profile.emailHelper')}</p>
            </div>

            {/* Bio */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('Profile.bio')}
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder={t('Profile.bioPlaceholder')}
                maxLength={BIO_MAX}
                rows={3}
                className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
              />
              <div className="mt-1.5 flex justify-end">
                <span className="text-xs text-gray-400">
                  {bio.length}/{BIO_MAX} characters
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Connected Accounts */}
      <section className="mt-8">
        <SectionTitle description={t('Profile.connectedAccountsDescription')}>
          {t('Profile.sectionConnectedAccounts')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          {/* Email */}
          <div className="flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
                {ICON_MAIL}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{t('Profile.email')}</p>
                <p className="text-xs text-gray-500">{email || t('Common.notConnected')}</p>
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              {t('Common.connected')}
            </span>
          </div>

          {/* Divider */}
          <div className="h-px bg-gray-50 mx-5" />

          {/* GitHub */}
          <div className="flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-700">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{t('Profile.github')}</p>
                <p className="text-xs text-gray-500">{t('Common.notConnected')}</p>
              </div>
            </div>
            <button
              type="button"
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-mint-400 hover:text-mint-600"
            >
              {t('Common.connect')}
            </button>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

export function LanguageRegionPage() {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [language, setLanguage] = useState<SupportedLocale>(getCurrentLocale());
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [saving, setSaving] = useState(false);

  const handleLanguageChange = async (locale: SupportedLocale) => {
    if (saving) {
      return;
    }
    setLanguage(locale);
    setSaving(true);
    try {
      await changeLocale(locale);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('LanguageRegion.changeLanguageError'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={t('LanguageRegion.pageTitle')}
      description={t('LanguageRegion.pageDescription')}
    >
      {/* Language Card */}
      <section>
        <SectionTitle>{t('LanguageRegion.sectionDisplayLanguage')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('LanguageRegion.language')}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  <LanguageIcon className="h-5 w-5" />
                </div>
                <select
                  value={language}
                  onChange={(e) => { void handleLanguageChange(e.target.value as SupportedLocale); }}
                  className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-10 text-sm text-gray-900 outline-none transition-all focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
                >
                  {SUPPORTED_LOCALES.map((l) => (
                    <option key={l} value={l}>{getLocaleLabel(l)}</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-gray-400">{t('LanguageRegion.languageHelper')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Region Settings Card */}
      <section className="mt-8">
        <SectionTitle>{t('LanguageRegion.sectionRegionSettings')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            {/* Timezone */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('LanguageRegion.timezone')}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  <ClockIcon className="h-5 w-5" />
                </div>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-10 text-sm text-gray-900 outline-none transition-all focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
                >
                  <option value="Asia/Shanghai">{t('LanguageRegion.timezoneCst')}</option>
                  <option value="Asia/Tokyo">{t('LanguageRegion.timezoneJst')}</option>
                  <option value="America/New_York">{t('LanguageRegion.timezoneEt')}</option>
                  <option value="America/Los_Angeles">{t('LanguageRegion.timezonePt')}</option>
                  <option value="Europe/London">{t('LanguageRegion.timezoneGmt')}</option>
                  <option value="Europe/Berlin">{t('LanguageRegion.timezoneCet')}</option>
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Date Format */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('LanguageRegion.dateFormat')}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  <CalendarIcon className="h-5 w-5" />
                </div>
                <select
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-10 text-sm text-gray-900 outline-none transition-all focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
                >
                  <option value="YYYY-MM-DD">{t('LanguageRegion.dateFormatIso')}</option>
                  <option value="MM/DD/YYYY">{t('LanguageRegion.dateFormatUs')}</option>
                  <option value="DD/MM/YYYY">{t('LanguageRegion.dateFormatEu')}</option>
                  <option value="DD.MM.YYYY">{t('LanguageRegion.dateFormatDe')}</option>
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
