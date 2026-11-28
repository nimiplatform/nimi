import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import { OverlayShell } from '@nimiplatform/kit/ui';
import {
  CHINESE_MODEL_CONFIG_COPY,
  DEFAULT_MODEL_CONFIG_COPY,
  resolveModelConfigCopy,
  resolveModelConfigOwnerConfigurationLabel,
} from '../src/copy.js';
import { ModelConfigAIConfigSurface } from '../src/components/model-config-ai-config-surface.js';
import type { ModelConfigListOptions, ModelConfigOverwrite } from '../src/types.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const emptyListOptions: ModelConfigListOptions = async (query) => ({
  kind: query.kind,
  options: [],
  truncated: false,
}) as never;

const noopOverwrite: ModelConfigOverwrite = async (input) => ({
  outcome: 'committed',
  config: { capabilities: [...input.capabilities] },
  revision: '2',
});

describe('Model Config localization, plain capability descriptions, owner CTA, and nested picker', () => {
  it('ships complete EN and ZH copy catalogs covering every canonical capability without internal taxonomy slugs', () => {
    expect(Object.keys(CHINESE_MODEL_CONFIG_COPY).sort()).toEqual(
      Object.keys(DEFAULT_MODEL_CONFIG_COPY).sort(),
    );
    expect(resolveModelConfigCopy(undefined, 'zh').notConfiguredLabel).toBe('未配置');
    expect(resolveModelConfigCopy(undefined, 'zh-CN').saveLocalLabel).toBe('保存设置');
    expect(resolveModelConfigCopy(undefined, 'en-US').notConfiguredLabel).toBe('Not configured');
    expect(resolveModelConfigCopy({ notConfiguredLabel: undefined }, 'zh').notConfiguredLabel).toBe('未配置');
    expect(resolveModelConfigCopy({ notConfiguredLabel: '自定义' }, 'zh').notConfiguredLabel).toBe('自定义');
    expect(resolveModelConfigOwnerConfigurationLabel('zh')).toBe('前往 Nimi Home 配置模型');
    expect(resolveModelConfigOwnerConfigurationLabel('en')).toBe('Open Home AI settings');

    const enCopy = resolveModelConfigCopy(undefined, 'en');
    const zhCopy = resolveModelConfigCopy(undefined, 'zh');
    for (const contract of CANONICAL_CAPABILITY_IDS) {
      const enDescription = enCopy.capabilityDescription(contract, enCopy.description);
      const zhLabel = zhCopy.capabilityLabel(contract, contract);
      const zhDescription = zhCopy.capabilityDescription(contract, zhCopy.description);
      expect(enDescription).toBeTruthy();
      expect(enDescription).not.toMatch(/turn capability|local-or-cloud-by-selected-route|job capability/u);
      expect(zhLabel).not.toBe(contract);
      expect(zhDescription).toBeTruthy();
      expect(zhDescription).not.toMatch(/turn capability|local-or-cloud-by-selected-route|job capability/u);
    }
  });

  it('renders Chinese UI, plain capability descriptions, and clickable Home CTA on empty config and no-selection apply', async () => {
    const onOpenOwnerConfiguration = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ModelConfigAIConfigSurface
          context={{ owner: 'app-ai-config', appId: 'nimi.utopia' }}
          capabilityContracts={['text.generate']}
          initialCapabilityContract="text.generate"
          capabilities={null}
          revision="0"
          effectiveSelections={[]}
          listOptions={emptyListOptions}
          onOverwrite={noopOverwrite}
          onOpenOwnerConfiguration={onOpenOwnerConfiguration}
          language="zh"
          showTitle={false}
        />,
      );
      await Promise.resolve();
    });
    await flush();

    // Detail view renders in Chinese (not English) and surfaces clickable Home CTA when unconfigured.
    expect(container.textContent).toContain('返回');
    expect(container.textContent).toContain('文本生成设置');
    expect(container.textContent).toContain('当前模型');
    expect(container.textContent).toContain('未配置');
    expect(container.textContent).toContain('默认参数');
    expect(container.textContent).toContain('保存设置');
    expect(container.textContent).not.toContain('Text Generate settings');
    expect(container.textContent).not.toContain('Save settings');

    const detailOwnerCta = container.querySelector<HTMLButtonElement>('[data-testid="model-config-open-owner:text.generate"]')!;
    expect(detailOwnerCta).toBeTruthy();
    expect(detailOwnerCta.textContent).toContain('前往 Nimi Home 配置模型');
    act(() => { detailOwnerCta.click(); });
    expect(onOpenOwnerConfiguration).toHaveBeenCalledTimes(1);

    // Clicking "一键应用" with 0 local models displays warning + clickable Home CTA.
    const applyBtn = container.querySelector<HTMLButtonElement>('[data-testid="model-config-current-machine-local-action"]')!;
    await act(async () => { applyBtn.click(); await Promise.resolve(); });
    await flush();
    expect(container.textContent).toContain('本机尚未为这些能力选择模型。');
    const localActionOwnerCta = container.querySelector<HTMLButtonElement>('[data-testid="model-config-current-machine-open-owner"]')!;
    expect(localActionOwnerCta).toBeTruthy();
    expect(localActionOwnerCta.textContent).toContain('前往 Nimi Home 配置模型');
    act(() => { localActionOwnerCta.click(); });
    expect(onOpenOwnerConfiguration).toHaveBeenCalledTimes(2);

    // Clicking "< 返回" exposes plain localized capability copy, never raw runtimeEvidenceClass / dataMovement slugs.
    const backBtn = container.querySelector<HTMLButtonElement>('button[aria-label="返回"]')!;
    act(() => { backBtn.click(); });
    await flush();
    expect(container.textContent).toContain('文本生成');
    expect(container.textContent).toContain('选择用于文本生成的本机或云端模型。');
    expect(container.textContent).not.toContain('turn capability');
    expect(container.textContent).not.toContain('local-or-cloud-by-selected-route');
  });

  it('opens nested ModelPickerDialog above a parent OverlayShell, exposes Home CTAs, and dismisses cleanly on Escape', async () => {
    const onOpenOwnerConfiguration = vi.fn();

    function NestedUtopiaModalHarness() {
      const [open, setOpen] = useState(true);
      return (
        <OverlayShell
          open={open}
          onClose={() => setOpen(false)}
          kind="dialog"
          size="lg"
          closeLabel="关闭"
          title="配置 NimiUtopia 生成模型"
          data-testid="utopia-model-modal"
        >
          <ModelConfigAIConfigSurface
            context={{ owner: 'app-ai-config', appId: 'nimi.utopia' }}
            capabilityContracts={['text.generate']}
            initialCapabilityContract="text.generate"
            capabilities={null}
            revision="0"
            effectiveSelections={[]}
            listOptions={emptyListOptions}
            onOverwrite={noopOverwrite}
            onOpenOwnerConfiguration={onOpenOwnerConfiguration}
            language="zh"
            showTitle={false}
          />
        </OverlayShell>
      );
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<NestedUtopiaModalHarness />);
      await Promise.resolve();
    });
    await flush();

    // Parent modal renders visible close button and unconfigured model trigger.
    const parentModal = document.querySelector<HTMLElement>('[data-testid="utopia-model-modal"]')!;
    expect(parentModal).toBeTruthy();
    expect(parentModal.querySelector('[data-testid="nimi-overlay-close"]')).toBeTruthy();

    // Clicking "未配置 >" opens the nested ModelPickerDialog (not a silent no-op).
    const trigger = parentModal.querySelector<HTMLButtonElement>('[data-testid="model-config-model-trigger:text.generate"]')!;
    expect(trigger.disabled).toBe(false);
    expect(trigger.textContent).toContain('未配置');
    await act(async () => { trigger.click(); await Promise.resolve(); });
    await flush();

    const pickerDialog = document.querySelector<HTMLElement>('[data-testid="nimi-model-picker-dialog"]')!;
    expect(pickerDialog).toBeTruthy();
    expect(pickerDialog.className).toContain('z-[calc(var(--nimi-z-dialog)+1)]');
    expect(pickerDialog.textContent).toContain('选择模型');
    expect(pickerDialog.textContent).toContain('本机');
    expect(pickerDialog.textContent).toContain('云端');
    expect(pickerDialog.textContent).toContain('取消');
    expect(pickerDialog.textContent).toContain('使用此选择');

    // Empty local option inside picker exposes clickable Home CTA.
    const localPickerOwnerCta = pickerDialog.querySelector<HTMLButtonElement>('[data-nimi-model-config-owner-handoff="true"]')!;
    expect(localPickerOwnerCta).toBeTruthy();
    expect(localPickerOwnerCta.textContent).toContain('前往 Nimi Home 配置模型');
    act(() => { localPickerOwnerCta.click(); });
    expect(onOpenOwnerConfiguration).toHaveBeenCalledTimes(1);

    // Switching to Cloud tab with 0 connectors also exposes clickable Home CTA.
    const cloudTab = Array.from(pickerDialog.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '云端',
    )!;
    act(() => { cloudTab.click(); });
    await flush();
    expect(pickerDialog.textContent).toContain('暂无已配置的云端连接器。');
    const cloudPickerOwnerCta = pickerDialog.querySelector<HTMLButtonElement>('[data-nimi-model-config-owner-handoff="true"]')!;
    expect(cloudPickerOwnerCta).toBeTruthy();
    act(() => { cloudPickerOwnerCta.click(); });
    expect(onOpenOwnerConfiguration).toHaveBeenCalledTimes(2);

    // First Escape closes only the nested picker, keeping parent modal open.
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(document.querySelector('[data-testid="nimi-model-picker-dialog"]')).toBeNull();
    });
    expect(document.querySelector('[data-testid="utopia-model-modal"]')).toBeTruthy();

    // Second Escape closes the parent modal cleanly.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(document.querySelector('[data-testid="utopia-model-modal"]')).toBeNull();
    });
  });
});
