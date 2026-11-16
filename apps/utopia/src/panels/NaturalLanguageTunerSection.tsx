import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModelConfigAIConfigSurface } from '@nimiplatform/kit/features/model-config';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { Button, InlineAlert, OverlayShell, StatusBadge, TextareaField } from '@nimiplatform/kit/ui';
import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type { NimiAIConfigSnapshot, NimiPortableAppAIConfigIntent } from '@nimiplatform/sdk/ai';
import type { NimiUtopiaSnapshot, NimiUtopiaUpdateIntent } from '@nimiplatform/sdk/app';
import { SparkleStarIcon } from '../components/UtopiaIcons.js';
import {
  MAX_NL_TUNER_INPUT_CHARS,
  compileNaturalLanguageTuning,
  createTuningPreviewGate,
  tuningPreviewMatches,
  type BoundTuningDraft,
} from '../domain/nl-tuner-compiler.js';
import { SCENERY_KIND_LABELS } from '../domain/visit-journal.js';

export const UTOPIA_APP_ID = 'nimi.utopia';
const UTOPIA_CAPABILITY_CONTRACTS = ['text.generate'] as const;

function cloneCapabilitiesForSurface(
  capabilities: readonly NimiPortableAppAIConfigIntent[] | undefined,
): NimiPortableAppAIConfigIntent[] | null {
  if (!capabilities) return null;
  return capabilities.map((intent) => ({
    capabilityContract: intent.capabilityContract,
    requiredFeatures: [...intent.requiredFeatures],
    ...(intent.defaults ? { defaults: intent.defaults } : {}),
    route: intent.route.oneofKind === 'local'
      ? { oneofKind: 'local', local: {} }
      : intent.route.oneofKind === 'cloud'
        ? { oneofKind: 'cloud', cloud: { ...intent.route.cloud } }
        : { oneofKind: undefined },
  }));
}

function isTextGenerateConfigured(aiSnapshot: NimiAIConfigSnapshot | null): boolean {
  if (!aiSnapshot?.config) return false;
  const intent = aiSnapshot.config.capabilities.find((c) => c.capabilityContract === 'text.generate');
  if (!intent) return false;
  const effective = aiSnapshot.effectiveSelections.find((e) => e.capabilityContract === 'text.generate');
  if (effective && effective.state !== 'ready') {
    return false;
  }
  return true;
}

function buildTuningInspirationPrompts(snapshot: NimiUtopiaSnapshot): readonly { label: string; prompt: string }[] {
  const chips: { label: string; prompt: string }[] = [];
  const firstParam = snapshot.habitat.parameters[0];
  const currentVal = firstParam ? (snapshot.parameterValues[firstParam.key] ?? firstParam.defaultValue) : null;
  const altOpt = firstParam?.options.find((o) => o.value !== currentVal) ?? firstParam?.options[0];
  const firstPreset = snapshot.habitat.eventPresets[0];
  const secondPreset = snapshot.habitat.eventPresets[1];

  if (altOpt && firstPreset) {
    chips.push({
      label: `${altOpt.label} ＋ ${firstPreset.label}`,
      prompt: `把${firstParam!.label}调成「${altOpt.label}」，再点亮「${firstPreset.label}」持续两小时`,
    });
  } else if (altOpt) {
    chips.push({
      label: `切换为「${altOpt.label}」`,
      prompt: `让${snapshot.habitat.title}变为${altOpt.label}`,
    });
  }

  if (secondPreset) {
    chips.push({
      label: `${secondPreset.label}`,
      prompt: `添一处「${secondPreset.label}」风物景象，持续三小时`,
    });
  }

  const firstPlace = snapshot.habitat.places[0];
  if (firstPlace) {
    chips.push({
      label: `${firstPlace.name}夜空星雨`,
      prompt: `让${firstPlace.name}上空掠过一阵清亮流星雨，持续两小时`,
    });
  }

  return chips.slice(0, 3);
}

export function NaturalLanguageTunerSection(props: {
  readonly client: NimiLocalAppClient;
  readonly snapshot: NimiUtopiaSnapshot;
  readonly busy: boolean;
  readonly onCommitTuning: (intent: Extract<NimiUtopiaUpdateIntent, { readonly kind: 'apply-tuning' }>, expectedRevision: string) => Promise<boolean>;
}) {
  const { client, snapshot, busy, onCommitTuning } = props;

  const [aiSnapshot, setAiSnapshot] = useState<NimiAIConfigSnapshot | null>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiLoadError, setAiLoadError] = useState<string | null>(null);
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [previewDraft, setPreviewDraft] = useState<BoundTuningDraft | null>(null);
  const previewGate = useMemo(createTuningPreviewGate, []);
  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;

  const refreshAiConfig = useCallback(async () => {
    if (!client || typeof client.aiConfig?.get !== 'function') {
      setAiLoading(false);
      return;
    }
    setAiLoading(true);
    setAiLoadError(null);
    try {
      const next = await client.aiConfig.get();
      setAiSnapshot(next);
    } catch (err) {
      setAiLoadError(err instanceof Error ? err.message : '无法读取应用模型配置');
    } finally {
      setAiLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refreshAiConfig();
  }, [refreshAiConfig]);

  // Settings changes invalidate both displayed previews and in-flight generation.
  useEffect(() => {
    previewGate.invalidate();
    setPreviewDraft(null);
    setCompileError(null);
    setCompiling(false);
    return () => previewGate.invalidate();
  }, [previewGate, snapshot.revision, snapshot.habitatActivationId, snapshot.contentDigest]);

  const modelReady = isTextGenerateConfigured(aiSnapshot);
  const inspirationChips = useMemo(() => buildTuningInspirationPrompts(snapshot), [snapshot]);

  const handleGeneratePreview = async () => {
    if (compiling || busy || !prompt.trim()) return;
    setCompiling(true);
    setCompileError(null);
    // Clear any stale preview immediately so an older draft cannot be confirmed while compiling a new one.
    setPreviewDraft(null);
    const ticket = previewGate.begin(snapshot);
    try {
      const draft = await compileNaturalLanguageTuning({
        prompt,
        habitat: snapshot.habitat,
        currentParameterValues: snapshot.parameterValues,
        aiClient: client.ai,
        signal: ticket.signal,
      });
      if (previewGate.isCurrent(ticket, currentSnapshot.current)) {
        setPreviewDraft({ ...draft, basis: ticket.basis });
      }
    } catch (err) {
      if (previewGate.isCurrent(ticket, currentSnapshot.current)) {
        setCompileError(err instanceof Error ? err.message : '自然语言调音解析失败，请稍后重试。');
      }
    } finally {
      if (previewGate.isCurrent(ticket, currentSnapshot.current)) setCompiling(false);
    }
  };

  const handleConfirmApply = async () => {
    if (!previewDraft?.commitIntent || busy || compiling) return;
    if (!tuningPreviewMatches(previewDraft.basis, currentSnapshot.current)) {
      setPreviewDraft(null);
      setCompileError('洞天设置已改变，请重新生成并核对预览。');
      return;
    }
    const ok = await onCommitTuning(previewDraft.commitIntent, previewDraft.basis.revision);
    if (ok) {
      setPreviewDraft(null);
      setPrompt('');
    }
  };

  const formatDurationLabel = (mins: number): string => {
    if (mins % 60 === 0) return `${mins / 60} 小时`;
    if (mins > 60) return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分钟`;
    return `${mins} 分钟`;
  };

  return (
    <section className="utopia-card-section" aria-labelledby="nl-tuner-heading">
      <div className="utopia-section-header">
        <div className="utopia-section-title-pair">
          <SparkleStarIcon size={14} />
          <h3 id="nl-tuner-heading">一句话营造风物</h3>
          <StatusBadge tone={modelReady ? 'success' : 'neutral'}>
            {modelReady ? '模型已就绪' : '待配置模型'}
          </StatusBadge>
        </div>
        <Button tone="ghost" size="sm" onClick={() => setConfigDrawerOpen(true)}>
          模型路由
        </Button>
      </div>

      {!modelReady ? (
        <div className="utopia-nl-degraded-card">
          <p className="utopia-causal-note">
            配置本应用文本生成模型后，可用一句话组合调拨当前洞天的天气参数与即时风物景象（上方手动参数与预设风物签无需配置模型即可直接使用）。
          </p>
          <Button tone="secondary" size="sm" onClick={() => setConfigDrawerOpen(true)}>
            配置模型路由
          </Button>
        </div>
      ) : (
        <div className="utopia-nl-active-box">
          {inspirationChips.length > 0 && (
            <div className="utopia-icebreaker-row" role="group" aria-label="风物营造灵感示例">
              {inspirationChips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  disabled={compiling || busy}
                  className="utopia-icebreaker-chip"
                  onClick={() => setPrompt(chip.prompt)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          <TextareaField
            aria-label="自然语言洞天风物描述"
            rows={2}
            maxLength={MAX_NL_TUNER_INPUT_CHARS}
            value={prompt}
            disabled={compiling || busy}
            placeholder={`试试输入：让${snapshot.habitat.title}起一阵薄雾，或是添一处持续两小时的风物景象…`}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && prompt.trim()) {
                e.preventDefault();
                void handleGeneratePreview();
              }
            }}
            onChange={(e) => setPrompt(e.currentTarget.value)}
          />
          <div className="utopia-draft-actions">
            <span className="utopia-muted-caption">
              {Array.from(prompt).length}/{MAX_NL_TUNER_INPUT_CHARS} · 预览确认后才写入
            </span>
            <Button
              type="button"
              tone="secondary"
              size="sm"
              disabled={compiling || busy || !prompt.trim()}
              onClick={() => void handleGeneratePreview()}
            >
              {compiling ? '正在推演预览…' : '生成变更预览'}
            </Button>
          </div>
        </div>
      )}

      {compileError && (
        <InlineAlert tone="warning">
          {compileError}
        </InlineAlert>
      )}

      {previewDraft && (
        <div className="utopia-nl-preview-card" role="region" aria-label="自然语言变更预览确认卡">
          <div className="utopia-section-header">
            <strong>变更预览确认</strong>
            <span className="utopia-muted-caption">基于「{snapshot.habitat.title}」契约校验</span>
          </div>

          <ul className="utopia-preview-bullet-list">
            {previewDraft.parameterChanges.map((change) => (
              <li key={change.key}>
                <span className="utopia-preview-tag">参数调整</span>
                <span>
                  {change.parameterLabel}：{change.fromLabel} → <strong>{change.toLabel}</strong>
                </span>
              </li>
            ))}

            {previewDraft.newlyOpenedPlaces.length > 0 && (
              <li>
                <span className="utopia-preview-tag is-open">场所开放</span>
                <span>将开放：{previewDraft.newlyOpenedPlaces.map((p) => p.name).join('、')}</span>
              </li>
            )}

            {previewDraft.newlyClosedPlaces.length > 0 && (
              <li>
                <span className="utopia-preview-tag is-warn">场所暂闭</span>
                <span>将暂停开放：{previewDraft.newlyClosedPlaces.map((p) => p.name).join('、')}</span>
              </li>
            )}

            {previewDraft.eventPreview && (
              <li>
                <span className="utopia-preview-tag is-event">即时风物</span>
                <span>
                  确认后立即开启「<strong>{previewDraft.eventPreview.label}</strong>」
                  （{SCENERY_KIND_LABELS[previewDraft.eventPreview.sceneryKind]} · 作用范围：
                  <strong>
                    {previewDraft.eventPreview.placeName
                      ? `指定场所「${previewDraft.eventPreview.placeName}」`
                      : '全洞天范围'}
                  </strong>
                  ，持续 {formatDurationLabel(previewDraft.eventPreview.durationMinutes)} 后自动消散）
                </span>
              </li>
            )}

            {previewDraft.unsupportedNote && (
              <li>
                <span className="utopia-preview-tag is-note">边界说明</span>
                <span>{previewDraft.unsupportedNote}</span>
              </li>
            )}
          </ul>

          <div className="utopia-draft-actions">
            <Button
              type="button"
              tone="ghost"
              size="sm"
              disabled={busy || compiling}
              onClick={() => setPreviewDraft(null)}
            >
              取消
            </Button>
            {previewDraft.commitIntent && (
              <Button
                type="button"
                tone="primary"
                size="sm"
                disabled={busy || compiling}
                onClick={() => void handleConfirmApply()}
              >
                {busy ? '提交中…' : '确认生效'}
              </Button>
            )}
          </div>
        </div>
      )}

      <OverlayShell
        open={configDrawerOpen}
        onClose={() => setConfigDrawerOpen(false)}
        kind="dialog"
        size="lg"
        title="配置 NimiUtopia 生成模型"
        description="供「一句话营造风物」将自然语言编译为受控洞天参数与风物草案。"
      >
        <div className="py-2">
          <ModelConfigAIConfigSurface
            context={{ owner: 'app-ai-config', appId: UTOPIA_APP_ID }}
            capabilityContracts={UTOPIA_CAPABILITY_CONTRACTS}
            initialCapabilityContract="text.generate"
            capabilities={
              aiSnapshot?.config
                ? cloneCapabilitiesForSurface(aiSnapshot.config.capabilities)
                : aiSnapshot
                  ? null
                  : undefined
            }
            revision={aiSnapshot?.revision}
            effectiveSelections={aiSnapshot?.effectiveSelections}
            listOptions={(query) => client.aiConfig.listOptions(query)}
            loading={aiLoading && !aiSnapshot}
            loadError={aiLoadError}
            onRetry={() => { void refreshAiConfig(); }}
            onOverwrite={async (input) => {
              const res = await client.aiConfig.overwrite(input);
              await refreshAiConfig();
              return res;
            }}
            onOpenOwnerConfiguration={() => {
              void openDesktopIntent({
                intent: { kind: 'open-apps', appId: UTOPIA_APP_ID, section: 'ai-models' },
              });
            }}
            language="zh"
            showTitle={false}
          />
        </div>
      </OverlayShell>
    </section>
  );
}
