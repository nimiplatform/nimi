import { useEffect, useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { extractNimiErrorFields, isJsonObject } from '@nimiplatform/sdk/types';
import { BookmarkPlus, Check, Play, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n.js';

const legacyReusableKey = 'reusable-session-instructions.json';
const presetsKey = 'instruction-presets-v1.json';

type InstructionPreset = { id: string; name: string; text: string };

function isNotFound(error: unknown): boolean {
  const code = extractNimiErrorFields(error).reasonCode;
  return code === 'APP_STORAGE_ENTRY_NOT_FOUND' || code === 'not-found';
}

export function SessionSettings({
  scope,
  id,
  instructions,
  running,
  usage,
  contextWindowTokens,
  sessionAllowlist,
  report,
}: {
  scope: NimiAppScope;
  id: string;
  instructions: string;
  running: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  contextWindowTokens?: number;
  sessionAllowlist: string[];
  report(message: string): void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState(instructions);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [presets, setPresets] = useState<InstructionPreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [presetName, setPresetName] = useState('');

  useEffect(() => setNote(instructions), [instructions]);

  useEffect(() => {
    let active = true;
    async function loadPresets() {
      try {
        const { value } = await scope.client.storage.readJson(presetsKey);
        if (!Array.isArray(value)) throw new Error('Invalid instruction presets.');
        const loaded = value.filter((item): item is InstructionPreset =>
          isJsonObject(item)
          && typeof item.id === 'string'
          && typeof item.name === 'string'
          && typeof item.text === 'string'
          && item.text.length <= 4000,
        );
        if (active && !scope.signal.aborted) {
          setPresets(loaded);
          setPresetsLoaded(true);
        }
        return;
      } catch (error) {
        if (!active || scope.signal.aborted) return;
        if (!isNotFound(error)) {
          report(error instanceof Error ? error.message : String(error));
          setPresetsLoaded(true);
          return;
        }
      }
      // Migrate legacy single reusable-session-instructions.json transparently if present.
      try {
        const { value } = await scope.client.storage.readJson(legacyReusableKey);
        if (active && !scope.signal.aborted) {
          if (typeof value === 'string' && value.trim() && value.length <= 4000) {
            setPresets([{ id: 'legacy-default', name: 'Saved instructions', text: value }]);
          } else {
            setPresets([]);
          }
          setPresetsLoaded(true);
        }
      } catch (error) {
        if (!active || scope.signal.aborted) return;
        if (!isNotFound(error)) report(error instanceof Error ? error.message : String(error));
        setPresets([]);
        setPresetsLoaded(true);
      }
    }
    void loadPresets();
    return () => { active = false; };
  }, [scope, report]);

  async function save(action: () => Promise<void>, message: string) {
    setSaving(true);
    setStatus('');
    report('');
    try {
      await action();
      setStatus(message);
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function persistPresets(next: InstructionPreset[]) {
    await scope.client.storage.writeJson(presetsKey, next);
    // Keep legacy key mirrored with first preset for backward compatibility across versions.
    if (next.length > 0) {
      await scope.client.storage.writeJson(legacyReusableKey, next[0].text).catch(() => {});
    } else {
      await scope.client.storage.removeJson(legacyReusableKey).catch(() => {});
    }
    scope.signal.throwIfAborted();
    setPresets(next);
  }

  const usedTokens = usage ? usage.inputTokens + usage.outputTokens : 0;
  const pct = contextWindowTokens && contextWindowTokens > 0
    ? Math.min(100, Math.round((usage?.inputTokens ?? 0) / contextWindowTokens * 100))
    : undefined;

  return (
    <div className="harness-inspector-section">
      {/* Token usage & context window meter */}
      <section className="harness-inspector-card">
        <h3 className="harness-inspector-heading">{t('settings.usageTitle')}</h3>
        {usage ? (
          <div className="harness-usage-meter">
            <div className="harness-usage-meter__row">
              <span>{t('settings.usageStats', { input: usage.inputTokens.toLocaleString(), output: usage.outputTokens.toLocaleString() })}</span>
              {pct !== undefined && <span>{pct}%</span>}
            </div>
            {contextWindowTokens && contextWindowTokens > 0 && (
              <>
                <div className="harness-progress-track" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className={`harness-progress-bar ${(pct ?? 0) > 80 ? 'harness-progress-bar--warn' : ''}`}
                    style={{ width: `${Math.max(2, pct ?? 0)}%` }}
                  />
                </div>
                <p className="harness-muted harness-muted--xs">
                  {t('settings.usageWindow', { used: usedTokens.toLocaleString(), total: contextWindowTokens.toLocaleString() })}
                </p>
              </>
            )}
          </div>
        ) : (
          <p className="harness-muted harness-muted--sm">{t('settings.usageNone')}</p>
        )}
      </section>

      {/* Session instructions */}
      <section className="harness-inspector-card">
        <h3 className="harness-inspector-heading">{t('settings.instructionsTitle')}</h3>
        <textarea
          className="harness-textarea"
          rows={4}
          maxLength={4000}
          value={note}
          disabled={running}
          placeholder={t('settings.instructionsPlaceholder')}
          onChange={e => setNote(e.target.value)}
        />
        <p className="harness-muted harness-muted--xs">
          {running ? t('settings.instructionsRunning') : t('settings.instructionsHint')}
        </p>
        <div className="harness-inline-actions">
          <Button
            size="sm"
            tone="secondary"
            disabled={saving || running || note.trim() === instructions}
            leadingIcon={<Check size={13} />}
            onClick={() => void save(() => window.nimiHarness.setInstructions(id, note), t('settings.saved'))}
          >
            {t('settings.saveInstructions')}
          </Button>
          {status && <span className="harness-status-note" role="status">{status}</span>}
        </div>
      </section>

      {/* Multi-preset instruction manager */}
      <section className="harness-inspector-card">
        <h3 className="harness-inspector-heading">{t('settings.presetsTitle')}</h3>
        <div className="harness-preset-create">
          <input
            type="text"
            className="harness-input"
            maxLength={60}
            value={presetName}
            placeholder={t('settings.presetNamePlaceholder')}
            onChange={e => setPresetName(e.target.value)}
          />
          <Button
            size="sm"
            tone="secondary"
            disabled={saving || !presetsLoaded || !note.trim() || !presetName.trim()}
            leadingIcon={<BookmarkPlus size={13} />}
            onClick={() => void save(async () => {
              const entry: InstructionPreset = {
                id: crypto.randomUUID(),
                name: presetName.trim(),
                text: note.trim(),
              };
              await persistPresets([entry, ...presets]);
              setPresetName('');
            }, t('settings.saved'))}
          >
            {t('settings.saveAsPreset')}
          </Button>
        </div>

        {presets.length === 0 ? (
          <p className="harness-muted harness-muted--xs">{t('settings.presetsEmpty')}</p>
        ) : (
          <ul className="harness-preset-list">
            {presets.map(preset => (
              <li key={preset.id} className="harness-preset-item">
                <div className="harness-preset-item__head">
                  <strong>{preset.name}</strong>
                  <div className="harness-preset-item__actions">
                    <Button
                      size="sm"
                      tone="ghost"
                      disabled={saving || running || instructions === preset.text}
                      leadingIcon={<Play size={12} />}
                      onClick={() => void save(async () => {
                        await window.nimiHarness.setInstructions(id, preset.text);
                        setNote(preset.text);
                      }, t('settings.saved'))}
                    >
                      {t('settings.applyPreset')}
                    </Button>
                    <Button
                      size="sm"
                      tone="ghost"
                      disabled={saving}
                      leadingIcon={<Trash2 size={12} />}
                      aria-label={t('settings.deletePreset')}
                      onClick={() => void save(() => persistPresets(presets.filter(item => item.id !== preset.id)), t('settings.saved'))}
                    />
                  </div>
                </div>
                <p className="harness-preset-item__body">{preset.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Active session allowlist */}
      {sessionAllowlist.length > 0 && (
        <section className="harness-inspector-card">
          <h3 className="harness-inspector-heading">{t('settings.allowlistTitle')}</h3>
          <p className="harness-muted harness-muted--xs">{t('settings.allowlistHint')}</p>
          <div className="harness-allowlist-chips">
            {sessionAllowlist.map(tool => (
              <code key={tool} className="harness-pill harness-pill--info">{tool}</code>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
