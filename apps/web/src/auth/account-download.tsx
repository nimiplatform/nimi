import { useTranslation } from 'react-i18next';
import { DownloadPageContent } from '../pages/release-pages.js';
import type { DetectedPlatform } from '../pages/download-assets.js';

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-positioning
export function AccountDownloadView({
  platform,
  locale = 'zh',
}: {
  platform?: DetectedPlatform;
  locale?: 'zh' | 'en';
}) {
  return (
    <div className="ac-download-page" data-account-download="true">
      <DownloadPageContent locale={locale} initialPlatform={platform} />
    </div>
  );
}

export function AccountDownload() {
  const { i18n } = useTranslation();
  const locale: 'zh' | 'en' = i18n.language.startsWith('zh') ? 'zh' : 'en';
  return <AccountDownloadView locale={locale} />;
}
