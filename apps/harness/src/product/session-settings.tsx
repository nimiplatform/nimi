import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, nimiToast } from '@nimiplatform/kit/ui';
import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { BookmarkPlus, Check, Play, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n.js';
import {
  deleteInstructionPresetOptimistically,
  presetsForScope,
  type InstructionPreset,
} from './session-presets.js';

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
  const presetStore = presetsForScope(scope);
  const presets = useSyncExternalStore(presetStore.subscribe, presetStore.getSnapshot, presetStore.getSnapshot);
  const [presetName, setPresetName] = useState('');
  const mountedRef = useRef(true);
  const undoToastIdsRef = useRef(new Set<string>());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => () => {
    for (const toastId of undoToastIdsRef.current) nimiToast.dismiss(toastId);
    undoToastIdsRef.current.clear();
  }, [scope]);

  useEffect(() => setNote(instructions), [instructions]);

  useEffect(() => {
    let active = true;
    void presetStore.load().catch(error => {
      if (active && !scope.signal.aborted) {
        report(error instanceof Error ? error.message : String(error));
      }
    });
    return () => { active = false; };
  }, [presetStore, scope, report]);

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

  function deletePresetOptimistically(preset: InstructionPreset) {
    setStatus('');
    report('');
    deleteInstructionPresetOptimistically({
      preset,
      scope,
      onError: (message) => {
        if (mountedRef.current) report(message);
      },
      message: t('settings.presetDeleted', { name: preset.name }),
      undoLabel: t('settings.undo'),
      trackToastId: (toastId) => { undoToastIdsRef.current.add(toastId); },
      untrackToastId: (toastId) => { undoToastIdsRef.current.delete(toastId); },
    });
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
                    style={{ transform: `scaleX(${Math.max(0.02, (pct ?? 0) / 100)})` }}
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
            disabled={saving || presets === null || !note.trim() || !presetName.trim()}
            leadingIcon={<BookmarkPlus size={13} />}
            onClick={() => void save(async () => {
              const entry: InstructionPreset = {
                id: crypto.randomUUID(),
                name: presetName.trim(),
                text: note.trim(),
              };
              await presetStore.add(entry);
              setPresetName('');
            }, t('settings.saved'))}
          >
            {t('settings.saveAsPreset')}
          </Button>
        </div>

        {presets === null ? null : presets.length === 0 ? (
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
                      onClick={() => deletePresetOptimistically(preset)}
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
