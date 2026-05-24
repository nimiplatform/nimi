import { useTranslation } from 'react-i18next';
import { NimiText } from '@nimiplatform/kit/ui';

/**
 * Centralized empty state for profile detail pages when no child is active.
 * Uses kit's helper-role typography so the muted body text resolves through
 * governed type tokens instead of an app-local className literal.
 */
export function NoActiveChildPlaceholder() {
  const { t } = useTranslation();
  return (
    <NimiText role="helper" className="p-8">
      {t('Profile.rich.common.addChildFirst')}
    </NimiText>
  );
}
