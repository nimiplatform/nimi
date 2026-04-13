import { Button, SelectField, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import type { DiningPreferenceCategoryId } from '@renderer/data/preferences.js';
import type {
  VideoFoodMapRouteSetting,
  VideoFoodMapRuntimeOptionsCatalog,
  VideoFoodMapSettings,
} from '@renderer/data/types.js';
import { DiningPreferencePanel } from '@renderer/components/dining-preference-panel.js';

import {
  buildNextRouteSetting,
  listConnectorOptions,
  listModelOptions,
  listOptionsBySource,
  type RuntimeSettingsCapability,
} from './app-helpers.js';
import { formatSelectedModelLabel } from './app-surface-shared.js';

function RuntimeRouteSettingsPanel(props: {
  settings: VideoFoodMapSettings;
  runtimeOptions: { stt: VideoFoodMapRuntimeOptionsCatalog; text: VideoFoodMapRuntimeOptionsCatalog } | undefined;
  runtimeOptionsPending: boolean;
  saveSettingsPending: boolean;
  settingsPending: boolean;
  settingsErrorText: string | null;
  runtimeOptionsErrorText: string | null;
  saveSettingsErrorText: string | null;
  onUpdateCapabilitySetting: (capability: RuntimeSettingsCapability, nextSetting: VideoFoodMapRouteSetting) => void;
  onRefreshRuntimeOptions: () => void;
}) {
  const currentSettings = props.settings;
  const runtimeOptions = props.runtimeOptions;
  const sttCatalog = runtimeOptions?.stt;
  const textCatalog = runtimeOptions?.text;
  const sttSetting = currentSettings.stt;
  const textSetting = currentSettings.text;
  const runtimeSettingsBusy = props.settingsPending || props.runtimeOptionsPending || props.saveSettingsPending;

  const sttSourceOptions = [
    {
      value: 'cloud',
      label: `云端${listConnectorOptions(sttCatalog).length > 0 ? '' : '（暂无）'}`,
      disabled: listOptionsBySource(sttCatalog, 'cloud').length === 0,
    },
    {
      value: 'local',
      label: `本地${listOptionsBySource(sttCatalog, 'local').length > 0 ? '' : '（暂无）'}`,
      disabled: listOptionsBySource(sttCatalog, 'local').length === 0,
    },
  ];
  const textSourceOptions = [
    {
      value: 'cloud',
      label: `云端${listConnectorOptions(textCatalog).length > 0 ? '' : '（暂无）'}`,
      disabled: listOptionsBySource(textCatalog, 'cloud').length === 0,
    },
    {
      value: 'local',
      label: `本地${listOptionsBySource(textCatalog, 'local').length > 0 ? '' : '（暂无）'}`,
      disabled: listOptionsBySource(textCatalog, 'local').length === 0,
    },
  ];
  const sttConnectorOptions = listConnectorOptions(sttCatalog);
  const textConnectorOptions = listConnectorOptions(textCatalog);
  const sttModelOptions = listModelOptions(sttCatalog, sttSetting);
  const textModelOptions = listModelOptions(textCatalog, textSetting);

  return (
    <Surface tone="panel" elevation="base" className="vfm-radius-panel space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold text-[var(--nimi-text-primary)]">模型设置</div>
          <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
            这里继续沿用现有能力，只是从顶部移到设置页。视频导入时会按这里的选择走。
          </p>
        </div>
        <Button tone="secondary" size="sm" onClick={props.onRefreshRuntimeOptions} disabled={props.runtimeOptionsPending}>
          {props.runtimeOptionsPending ? '刷新中...' : '刷新模型清单'}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Surface tone="card" elevation="base" className="vfm-radius-card w-full min-w-0 space-y-4 overflow-hidden p-5">
          <div>
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">语音转写</div>
            <div className="mt-1 text-sm text-[var(--nimi-text-secondary)]">决定视频音频先走哪一路。</div>
          </div>
          <div className="grid gap-3">
            <SelectField
              value={sttSetting.routeSource}
              disabled={runtimeSettingsBusy}
              options={sttSourceOptions}
              onValueChange={(value) => props.onUpdateCapabilitySetting('stt', buildNextRouteSetting({
                catalog: sttCatalog,
                current: sttSetting,
                nextSource: value as VideoFoodMapRouteSetting['routeSource'],
              }))}
            />
            <SelectField
              value={sttConnectorOptions.some((option) => option.value === sttSetting.connectorId) ? sttSetting.connectorId : undefined}
              disabled={runtimeSettingsBusy || sttSetting.routeSource !== 'cloud'}
              options={sttConnectorOptions}
              placeholder="先选云端连接"
              onValueChange={(value) => props.onUpdateCapabilitySetting('stt', buildNextRouteSetting({
                catalog: sttCatalog,
                current: sttSetting,
                nextSource: 'cloud',
                nextConnectorId: value,
              }))}
            />
            <SelectField
              value={sttModelOptions.some((option) => option.value === sttSetting.model) ? sttSetting.model : undefined}
              disabled={runtimeSettingsBusy || sttModelOptions.length === 0}
              options={sttModelOptions}
              placeholder={sttSetting.routeSource === 'local' ? '先选本地模型' : '先选转写模型'}
              onValueChange={(value) => props.onUpdateCapabilitySetting('stt', buildNextRouteSetting({
                catalog: sttCatalog,
                current: sttSetting,
                nextModel: value,
              }))}
            />
          </div>
        </Surface>

        <Surface tone="card" elevation="base" className="vfm-radius-card w-full min-w-0 space-y-4 overflow-hidden p-5">
          <div>
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">文字提取</div>
            <div className="mt-1 text-sm text-[var(--nimi-text-secondary)]">整理店名、地址和菜品时用哪一路。</div>
          </div>
          <div className="grid gap-3">
            <SelectField
              value={textSetting.routeSource}
              disabled={runtimeSettingsBusy}
              options={textSourceOptions}
              onValueChange={(value) => props.onUpdateCapabilitySetting('text', buildNextRouteSetting({
                catalog: textCatalog,
                current: textSetting,
                nextSource: value as VideoFoodMapRouteSetting['routeSource'],
              }))}
            />
            <SelectField
              value={textConnectorOptions.some((option) => option.value === textSetting.connectorId) ? textSetting.connectorId : undefined}
              disabled={runtimeSettingsBusy || textSetting.routeSource !== 'cloud'}
              options={textConnectorOptions}
              placeholder="先选云端连接"
              onValueChange={(value) => props.onUpdateCapabilitySetting('text', buildNextRouteSetting({
                catalog: textCatalog,
                current: textSetting,
                nextSource: 'cloud',
                nextConnectorId: value,
              }))}
            />
            <SelectField
              value={textModelOptions.some((option) => option.value === textSetting.model) ? textSetting.model : undefined}
              disabled={runtimeSettingsBusy || textModelOptions.length === 0}
              options={textModelOptions}
              placeholder={textSetting.routeSource === 'local' ? '先选本地模型' : '先选文字模型'}
              onValueChange={(value) => props.onUpdateCapabilitySetting('text', buildNextRouteSetting({
                catalog: textCatalog,
                current: textSetting,
                nextModel: value,
              }))}
            />
          </div>
        </Surface>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Surface tone="card" elevation="base" className="vfm-radius-tight w-full min-w-0 overflow-hidden p-4">
          <div className="text-xs text-[var(--nimi-text-muted)]">当前语音模型</div>
          <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatSelectedModelLabel(sttSetting.model)}</div>
        </Surface>
        <Surface tone="card" elevation="base" className="vfm-radius-tight w-full min-w-0 overflow-hidden p-4">
          <div className="text-xs text-[var(--nimi-text-muted)]">当前文字模型</div>
          <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatSelectedModelLabel(textSetting.model)}</div>
        </Surface>
        <Surface tone="card" elevation="base" className="vfm-radius-tight w-full min-w-0 overflow-hidden p-4">
          <div className="text-xs text-[var(--nimi-text-muted)]">模型来源</div>
          <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">
            {props.runtimeOptionsPending ? '读取中' : '直接来自当前 runtime'}
          </div>
        </Surface>
      </div>

      {props.settingsErrorText ? <div className="text-sm text-[var(--nimi-status-danger)]">{props.settingsErrorText}</div> : null}
      {props.runtimeOptionsErrorText ? <div className="text-sm text-[var(--nimi-status-danger)]">{props.runtimeOptionsErrorText}</div> : null}
      {props.saveSettingsErrorText ? <div className="text-sm text-[var(--nimi-status-danger)]">{props.saveSettingsErrorText}</div> : null}
    </Surface>
  );
}

export function SettingsSurface(props: {
  diningProfile: VideoFoodMapSettings['diningProfile'];
  saveSettingsPending: boolean;
  onToggleDiningPreference: (category: DiningPreferenceCategoryId, value: string) => void;
  currentSettings: VideoFoodMapSettings;
  runtimeOptions: { stt: VideoFoodMapRuntimeOptionsCatalog; text: VideoFoodMapRuntimeOptionsCatalog } | undefined;
  runtimeOptionsPending: boolean;
  settingsPending: boolean;
  settingsErrorText: string | null;
  runtimeOptionsErrorText: string | null;
  saveSettingsErrorText: string | null;
  onUpdateCapabilitySetting: (capability: RuntimeSettingsCapability, nextSetting: VideoFoodMapRouteSetting) => void;
  onRefreshRuntimeOptions: () => void;
}) {
  const totalSelections = props.diningProfile.cuisinePreferences.length
    + props.diningProfile.dietaryRestrictions.length
    + props.diningProfile.flavorPreferences.length
    + props.diningProfile.tabooIngredients.length;

  return (
    <div className="space-y-6">
      <Surface tone="panel" elevation="base" className="vfm-radius-shell p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">偏好与设置</div>
            <div className="mt-2 max-w-3xl text-sm leading-7 text-[var(--nimi-text-secondary)]">
              用餐偏好继续单独保存，后面的点菜建议会直接复用。模型设置也统一收进这里，不再挤占首页顶部。
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={totalSelections > 0 ? 'success' : 'neutral'}>
              {totalSelections > 0 ? `已记住 ${totalSelections} 项` : '还没设置偏好'}
            </StatusBadge>
            <StatusBadge tone={props.saveSettingsPending ? 'warning' : 'info'}>
              {props.saveSettingsPending ? '保存中' : '本地保存'}
            </StatusBadge>
          </div>
        </div>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <DiningPreferencePanel
          profile={props.diningProfile}
          disabled={props.saveSettingsPending}
          onToggle={props.onToggleDiningPreference}
        />

        <div className="space-y-6">
          <Surface tone="panel" elevation="base" className="vfm-radius-panel p-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">Stage 3</StatusBadge>
              <StatusBadge tone="neutral">预留入口</StatusBadge>
            </div>
            <div className="mt-4 text-2xl font-semibold text-[var(--nimi-text-primary)]">点菜建议会在后面接上</div>
            <div className="mt-3 text-sm leading-7 text-[var(--nimi-text-secondary)]">
              这一版先把偏好记好。后面接菜单拍照和点菜建议时，会优先避开你的忌口，再结合你喜欢的口味和常吃菜系给建议。
            </div>
          </Surface>

          <Surface tone="panel" elevation="base" className="vfm-radius-panel p-6">
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">当前生效模型</div>
            <div className="mt-4 grid gap-3">
              <Surface tone="card" elevation="base" className="vfm-radius-tight p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">语音转写</div>
                <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatSelectedModelLabel(props.currentSettings.stt.model)}</div>
              </Surface>
              <Surface tone="card" elevation="base" className="vfm-radius-tight p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">文字提取</div>
                <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatSelectedModelLabel(props.currentSettings.text.model)}</div>
              </Surface>
            </div>
          </Surface>
        </div>
      </div>

      <RuntimeRouteSettingsPanel
        settings={props.currentSettings}
        runtimeOptions={props.runtimeOptions}
        runtimeOptionsPending={props.runtimeOptionsPending}
        saveSettingsPending={props.saveSettingsPending}
        settingsPending={props.settingsPending}
        settingsErrorText={props.settingsErrorText}
        runtimeOptionsErrorText={props.runtimeOptionsErrorText}
        saveSettingsErrorText={props.saveSettingsErrorText}
        onUpdateCapabilitySetting={props.onUpdateCapabilitySetting}
        onRefreshRuntimeOptions={props.onRefreshRuntimeOptions}
      />
    </div>
  );
}
