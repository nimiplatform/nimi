import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AIConfig, RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import {
  ModelConfigPanel,
  type ModelConfigSection,
} from '@nimiplatform/nimi-kit/features/model-config';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import { useAppStore } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import {
  PARENTOS_CAPABILITIES,
  bindingFromConfig,
  createEmptyParentosAIConfig,
  savePersistedParentosAIConfig,
  type ParentosCapabilityId,
} from './parentos-ai-config.js';
import { getParentosRouteModelPickerProvider } from './parentos-route-model-picker-provider.js';

function useCapabilityProviders(): Record<string, RouteModelPickerDataProvider | null> {
  return useMemo(() => {
    const providers: Record<string, RouteModelPickerDataProvider | null> = {};
    for (const cap of PARENTOS_CAPABILITIES) {
      if (providers[cap.routeCapability] === undefined) {
        providers[cap.routeCapability] = getParentosRouteModelPickerProvider(cap.routeCapability);
      }
    }
    return providers;
  }, []);
}

export default function AiSettingsPage() {
  const storeConfig = useAppStore((s) => s.aiConfig);
  const setStoreConfig = useAppStore((s) => s.setAIConfig);
  const config = storeConfig ?? createEmptyParentosAIConfig();

  const providers = useCapabilityProviders();
  const [runtimeReady, setRuntimeReady] = useState(false);

  // Probe runtime readiness on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getPlatformClient } = await import('@nimiplatform/sdk');
        const client = getPlatformClient();
        if (!cancelled && client.runtime?.appId) {
          setRuntimeReady(true);
        }
      } catch {
        // runtime not available
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleBindingChange = useCallback((capabilityId: ParentosCapabilityId, binding: RuntimeRouteBinding | null) => {
    const next: AIConfig = {
      ...config,
      capabilities: {
        ...config.capabilities,
        selectedBindings: {
          ...config.capabilities.selectedBindings,
          [capabilityId]: binding,
        },
      },
    };
    setStoreConfig(next);
    void savePersistedParentosAIConfig(next).catch(() => {});
  }, [config, setStoreConfig]);

  const sections = useMemo<ModelConfigSection[]>(() => [
    {
      id: 'chat',
      title: 'AI 对话',
      items: [
        {
          capabilityId: 'text.generate',
          routeCapability: 'text.generate',
          label: 'AI 对话模型',
          detail: '用于成长顾问、日志标签、报告生成、体检 OCR 等',
          binding: bindingFromConfig(config, 'text.generate'),
          provider: providers['text.generate'] || null,
          onBindingChange: (binding) => handleBindingChange('text.generate', binding as RuntimeRouteBinding | null),
          placeholder: '选择模型',
          runtimeNotReadyLabel: '运行时未就绪',
        },
      ],
    },
    {
      id: 'voice',
      title: '语音',
      items: [
        {
          capabilityId: 'audio.transcribe',
          routeCapability: 'audio.transcribe',
          label: '语音转写模型',
          detail: '用于语音观察记录转文字',
          binding: bindingFromConfig(config, 'audio.transcribe'),
          provider: providers['audio.transcribe'] || null,
          onBindingChange: (binding) => handleBindingChange('audio.transcribe', binding as RuntimeRouteBinding | null),
          placeholder: '选择模型',
          runtimeNotReadyLabel: '运行时未就绪',
        },
      ],
    },
  ], [config, providers, handleBindingChange]);

  return (
    <div className="h-full overflow-y-auto" style={{ background: S.bg }}>
      <div className={S.container} style={{ paddingTop: S.topPad }}>

        {/* ── Back + Header ─────────────────────────────── */}
        <div className="flex items-center gap-3 mb-6">
          <Link to="/settings"
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={S.text} strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>
          <h1 className="text-xl font-bold" style={{ color: S.text }}>AI 模型设置</h1>
        </div>

        {/* ── Runtime status ────────────────────────────── */}
        {!runtimeReady && (
          <div
            className={`${S.radiusSm} px-4 py-3 mb-4 text-[12px]`}
            style={{ background: '#fef9e7', color: '#92400e', border: '1px solid #fde68a' }}
          >
            运行时未连接，模型选择不可用。请确认 nimi runtime 已启动。
          </div>
        )}

        {/* ── Model config panel ────────────────────────── */}
        <div className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
          <ModelConfigPanel sections={sections} />
        </div>
      </div>
    </div>
  );
}
