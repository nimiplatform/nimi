import { getAppSetting, setAppSetting } from '../bridge/sqlite-bridge.js';
import { isoNow } from '../bridge/ulid.js';

export interface FreqOverride {
  intervalMonths: number;
  disabled: boolean;
  modifiedAt: string;
}

export type FreqOverrideMap = Map<string, FreqOverride>;

function settingKey(childId: string, ruleId: string): string {
  return `reminder-freq:${childId}:${ruleId}`;
}

export async function loadFreqOverrides(childId: string, ruleIds: string[]): Promise<FreqOverrideMap> {
  const map = new Map<string, FreqOverride>();
  for (const ruleId of ruleIds) {
    try {
      const raw = await getAppSetting(settingKey(childId, ruleId));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FreqOverride>;
        if (typeof parsed.intervalMonths === 'number' || parsed.disabled === true) {
          map.set(ruleId, {
            intervalMonths: parsed.intervalMonths ?? 0,
            disabled: parsed.disabled ?? false,
            modifiedAt: typeof parsed.modifiedAt === 'string' ? parsed.modifiedAt : '',
          });
        }
      }
    } catch { /* ignore */ }
  }
  return map;
}

export async function saveFreqOverride(childId: string, ruleId: string, override: Omit<FreqOverride, 'modifiedAt'>): Promise<void> {
  const data: FreqOverride = { ...override, modifiedAt: isoNow() };
  await setAppSetting(settingKey(childId, ruleId), JSON.stringify(data), isoNow());
}

export async function clearFreqOverride(childId: string, ruleId: string): Promise<void> {
  // Set to empty string to effectively clear (app_settings uses upsert)
  await setAppSetting(settingKey(childId, ruleId), '', isoNow());
}

/**
 * Load all overrides for a child by scanning known rule IDs.
 * Used by the settings page to show customized reminders.
 */
export async function loadAllFreqOverrides(childId: string, allRuleIds: string[]): Promise<FreqOverrideMap> {
  return loadFreqOverrides(childId, allRuleIds);
}
