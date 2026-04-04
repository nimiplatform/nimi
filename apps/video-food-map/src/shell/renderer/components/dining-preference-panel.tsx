import { Button, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { DINING_PREFERENCE_GROUPS, type DiningPreferenceCategoryId } from '@renderer/data/preferences.js';
import type { VideoFoodMapDiningProfile } from '@renderer/data/types.js';

export type DiningPreferencePanelProps = {
  profile: VideoFoodMapDiningProfile;
  disabled?: boolean;
  onToggle: (category: DiningPreferenceCategoryId, value: string) => void;
};

function countSelections(profile: VideoFoodMapDiningProfile): number {
  return (
    profile.dietaryRestrictions.length
    + profile.tabooIngredients.length
    + profile.flavorPreferences.length
    + profile.cuisinePreferences.length
  );
}

export function DiningPreferencePanel({ profile, disabled = false, onToggle }: DiningPreferencePanelProps) {
  const totalSelections = countSelections(profile);

  return (
    <Surface tone="panel" elevation="base" className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">吃饭偏好</div>
          <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
            这里先把你的忌口和常吃方向记住。现在还不会自动点菜，但后面的推荐会直接用这份设置。
          </p>
        </div>
        <StatusBadge tone={totalSelections > 0 ? 'success' : 'neutral'}>
          {totalSelections > 0 ? `已记住 ${totalSelections} 项` : '还没设置'}
        </StatusBadge>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {DINING_PREFERENCE_GROUPS.map((group) => {
          const selectedValues = profile[group.id];
          return (
            <Surface key={group.id} tone="card" elevation="base" className="space-y-3 p-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-base font-semibold text-[var(--nimi-text-primary)]">{group.title}</div>
                  <StatusBadge tone={selectedValues.length > 0 ? 'info' : 'neutral'}>
                    {selectedValues.length > 0 ? `${selectedValues.length} 项` : '未设置'}
                  </StatusBadge>
                </div>
                <div className="text-sm text-[var(--nimi-text-secondary)]">{group.description}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.options.map((option) => {
                  const selected = selectedValues.includes(option.value);
                  return (
                    <Button
                      key={option.value}
                      tone={selected ? 'primary' : 'secondary'}
                      size="sm"
                      disabled={disabled}
                      onClick={() => onToggle(group.id as DiningPreferenceCategoryId, option.value)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </Surface>
          );
        })}
      </div>
    </Surface>
  );
}
