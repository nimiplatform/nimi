import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import { ArrowLeft } from 'lucide-react';
import { WorldCharactersSection } from './world-detail-discovery.js';
import type { WorldCharacter, WorldPeopleCatalogState } from './world-detail-types.js';

export function WorldPeopleArchivePage({ characters, catalog, onBack, onSelect, onViewCharacter }: {
  characters: readonly WorldCharacter[];
  catalog: WorldPeopleCatalogState;
  onBack: () => void;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="@container mx-auto w-full max-w-[1440px] space-y-6 p-4 sm:p-6" data-nimi-density="regular" data-testid="world-detail-people-archive-page">
      <Button tone="ghost" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={onBack}>{t('WorldDetail.paper.gallery.backToWorld')}</Button>
      <WorldCharactersSection characters={characters} catalog={catalog} onView={(character) => onViewCharacter ? onViewCharacter(character) : onSelect(character.id)} />
    </div>
  );
}
