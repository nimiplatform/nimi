import { useEffect, useRef, useState } from 'react';
import { Camera, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AVATAR_MESH_PALETTES,
  getAvatarMonogram,
  renderAvatarMeshPresetFile,
  type AvatarMeshPaletteId,
} from '@nimiplatform/kit/ui';
import { uploadNimiRealmResourceFile, type RealmModel } from '@nimiplatform/sdk/realm';
import { createWebBrowserRealm } from './browser-realm.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';
import {
  accountHandle,
  evaluateHandleDraft,
  normalizeHandleInput,
  profilePatch,
} from './account-center-model.js';
import { AccountAvatar, AccountFeedback, AccountHeading } from './account-center-layout.js';
import { accountReadProblem, useAccountCopy } from './account-center-copy.js';

const fields = (user: Record<string, unknown>) => ({
  displayName: String(user.displayName ?? ''),
  bio: String(user.bio ?? ''),
  city: String(user.city ?? ''),
  countryCode: String(user.countryCode ?? ''),
});
export function AccountProfile({
  user,
  onSaved,
  onDirty,
}: {
  user: Record<string, unknown>;
  onSaved: (user: Record<string, unknown>) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const c = useAccountCopy();
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh');
  const [baseline, setBaseline] = useState(user);
  const [draft, setDraft] = useState(() => fields(user));
  const [photo, setPhoto] = useState<{ url: string; resourceId: string } | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<AvatarMeshPaletteId | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [handleDirty, setHandleDirty] = useState(false);
  const active = useRef(true);
  const upload = useRef<AbortController | null>(null);
  const photoUrl = useRef<string | null>(null);
  const patch = profilePatch(baseline, draft);
  const dirty = Boolean(photo || Object.keys(patch).length);
  useEffect(() => {
    onDirty(dirty || handleDirty || uploading);
  }, [dirty, handleDirty, uploading, onDirty]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      upload.current?.abort();
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
      onDirty(false);
    };
  }, [onDirty]);
  function reset() {
    setDraft(fields(baseline));
    setPhoto(null);
    setSelectedPresetId(null);
    setError(null);
    setMessage(null);
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = null;
  }
  async function uploadPhoto(file: File): Promise<boolean> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(c('invalidImage'));
      return false;
    }
    const controller = new AbortController();
    upload.current?.abort();
    upload.current = controller;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      if ((await loadWebCurrentAccount())?.id !== user.id) throw new Error(c('changed'));
      if (!active.current) return false;
      const result = await uploadNimiRealmResourceFile(createWebBrowserRealm(), {
        kind: 'image',
        file,
        fileName: file.name,
        deliveryAccess: 'PUBLIC',
        options: { signal: controller.signal },
      });
      if (!active.current || controller.signal.aborted) return false;
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
      photoUrl.current = URL.createObjectURL(file);
      setPhoto({ url: photoUrl.current, resourceId: result.resourceId });
      setMessage(c('avatarPending'));
      return true;
    } catch (reason) {
      if (active.current && !controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : c('unavailable'));
      return false;
    } finally {
      if (active.current && upload.current === controller) setUploading(false);
    }
  }
  async function applyPreset(paletteId: AvatarMeshPaletteId) {
    if (busy || uploading) return;
    setError(null);
    try {
      const displayName = draft.displayName.trim() || String(baseline.displayName || baseline.handle || 'N');
      const file = await renderAvatarMeshPresetFile({ name: displayName, paletteId });
      const ok = await uploadPhoto(file);
      if (ok && active.current) {
        setSelectedPresetId(paletteId);
      }
    } catch (reason) {
      if (active.current)
        setError(reason instanceof Error ? reason.message : c('unavailable'));
    }
  }
  return (
    <>
      <AccountHeading title={c('profile')} description={c('profileIntro')} />
      <form
        className="ac-section ac-profile-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!dirty || busy || uploading || !draft.displayName.trim()) return;
          setBusy(true);
          setError(null);
          setMessage(null);
          try {
            if ((await loadWebCurrentAccount())?.id !== user.id) throw new Error(c('changed'));
            if (!active.current) return;
            const updated = await createWebBrowserRealm().account.updateMe({
              path: {},
              body: { ...patch, ...(photo ? { avatarResourceId: photo.resourceId } : {}) },
            });
            if (!active.current) return;
            const next = { ...updated };
            setBaseline(next);
            setDraft(fields(next));
            setPhoto(null);
            onSaved(next);
            setMessage(c('saved'));
          } catch (reason) {
            if (active.current)
              setError(reason instanceof Error ? reason.message : c('unavailable'));
          } finally {
            if (active.current) setBusy(false);
          }
        }}
      >
        <div className="ac-photo-row">
          <AccountAvatar
            user={{
              ...baseline,
              displayName: draft.displayName.trim() || baseline.displayName,
              avatarUrl: photo?.url || baseline.avatarUrl,
            }}
            size="large"
          />
          <div>
            <label className="ac-button ac-button--secondary ac-photo-input">
              <Camera size={17} />
              {uploading ? c('uploading') : c('avatar')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy || uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) {
                    setSelectedPresetId(null);
                    void uploadPhoto(file);
                  }
                }}
              />
            </label>
            <p className="ac-muted">{c('avatarHint')}</p>
          </div>
        </div>
        <div className="ac-avatar-presets">
          <span className="ac-avatar-presets-label">{c('avatarPresets')}</span>
          <div className="ac-avatar-preset-list" role="group" aria-label={c('avatarPresets')}>
            {AVATAR_MESH_PALETTES.map((palette) => {
              const colorLabel = isZh ? palette.labelZh : palette.labelEn;
              const monogram = getAvatarMonogram(
                draft.displayName.trim() || String(baseline.displayName || baseline.handle || 'N'),
              );
              const selected = selectedPresetId === palette.id;
              return (
                <button
                  key={palette.id}
                  type="button"
                  disabled={busy || uploading}
                  aria-label={`${c('avatarPresetApply')} ${colorLabel}`}
                  aria-pressed={selected}
                  title={colorLabel}
                  data-nimi-avatar-mesh={palette.id}
                  className={`ac-avatar-preset-btn${selected ? ' is-selected' : ''}`}
                  onClick={() => { void applyPreset(palette.id); }}
                >
                  <span aria-hidden="true">{monogram}</span>
                </button>
              );
            })}
          </div>
        </div>
        <label className="ac-field">
          <span>{c('name')}</span>
          <input
            required
            maxLength={500}
            value={draft.displayName}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
          />
        </label>
        <label className="ac-field">
          <span>{c('bio')}</span>
          <textarea
            rows={4}
            maxLength={2000}
            value={draft.bio}
            disabled={busy}
            placeholder={c('bioHint')}
            onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
          />
          <small className="ac-character-count">{draft.bio.length} / 2000</small>
        </label>
        <div className="ac-field-pair">
          <label className="ac-field">
            <span>{c('city')}</span>
            <input
              maxLength={100}
              value={draft.city}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, city: event.target.value })}
            />
          </label>
          <label className="ac-field">
            <span>{c('country')}</span>
            <input
              pattern="[A-Z]{2}|^$"
              maxLength={2}
              value={draft.countryCode}
              disabled={busy}
              onChange={(event) =>
                setDraft({ ...draft, countryCode: event.target.value.toUpperCase() })
              }
            />
            <small>{c('countryHint')}</small>
          </label>
        </div>
        <AccountFeedback error={error} message={message} />
        <div className="ac-form-footer">
          <p>{c('acrossHint')}</p>
          <div className="ac-actions">
            <button
              type="button"
              className="ac-button ac-button--secondary"
              disabled={!dirty || busy || uploading}
              onClick={reset}
            >
              {c('cancel')}
            </button>
            <button
              className="ac-button"
              disabled={!dirty || busy || uploading || !draft.displayName.trim()}
            >
              {busy ? c('saving') : c('save')}
            </button>
          </div>
        </div>
      </form>
      <UsernameEditor
        key={String(user.handle)}
        user={user}
        onSaved={(next) => {
          onSaved(next);
          setBaseline((old) => ({ ...old, handle: next.handle }));
        }}
        onDirty={setHandleDirty}
      />
    </>
  );
}

type AvailabilityState =
  | { status: 'idle' }
  | { status: 'checking'; handle: string }
  | { status: 'available'; handle: string }
  | { status: 'taken'; handle: string; detail?: string }
  | { status: 'error'; handle: string };

function RuleItem({ state, text }: { state: 'idle' | 'pass' | 'fail'; text: string }) {
  const icon = state === 'pass' ? '✓' : state === 'fail' ? '×' : '○';
  const modifier = state === 'pass' ? ' ac-handle-rule--pass' : state === 'fail' ? ' ac-handle-rule--fail' : '';
  return (
    <li className={`ac-handle-rule${modifier}`}>
      <span className="ac-handle-rule-icon" aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </li>
  );
}

function UsernameEditor({
  user,
  onSaved,
  onDirty,
}: {
  user: Record<string, unknown>;
  onSaved: (user: Record<string, unknown>) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const c = useAccountCopy();
  const [rule, setRule] = useState<RealmModel<'HandleChangeEligibilityDto'> | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [handle, setHandle] = useState('');
  const [normalizeNote, setNormalizeNote] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityState>({ status: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(true);

  const currentHandle = accountHandle(rule?.handle ?? user.handle);
  const candidate = handle.trim();
  const evaluation = rule
    ? evaluateHandleDraft(candidate, rule)
    : { touched: false, lengthOk: false, patternOk: false, differentOk: false, formatValid: false };

  useEffect(() => {
    onDirty(editing && candidate.length > 0 && candidate !== currentHandle);
    return () => onDirty(false);
  }, [editing, candidate, currentHandle, onDirty]);

  const load = () =>
    loadWebCurrentAccount()
      .then((current) => {
        if (current?.id !== user.id) throw new Error(c('changed'));
        return createWebBrowserRealm().account.getMyHandleChangeEligibility({ path: {} });
      })
      .then((value) => {
        if (active.current) {
          setRule(value);
          setError(null);
        }
      })
      .catch((reason) => {
        if (active.current) setError(accountReadProblem(reason, c));
      });

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editing || !rule || !evaluation.formatValid) {
      setAvailability({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setAvailability({ status: 'checking', handle: candidate });
    const timer = window.setTimeout(() => {
      void createWebBrowserRealm()
        .generated.checkHandle({ path: {}, query: { handle: candidate } }, { signal: controller.signal })
        .then((result) => {
          if (!active.current || controller.signal.aborted) return;
          if (result.available) {
            setAvailability({ status: 'available', handle: candidate });
          } else {
            setAvailability({ status: 'taken', handle: candidate, detail: result.message });
          }
        })
        .catch(() => {
          if (!active.current || controller.signal.aborted) return;
          setAvailability({ status: 'error', handle: candidate });
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editing, rule, evaluation.formatValid, candidate]);

  const canProceed = Boolean(
    rule
    && evaluation.formatValid
    && availability.status !== 'checking'
    && availability.status !== 'taken',
  );

  const lengthRuleText = rule
    ? isZh
      ? `长度为 ${rule.minLength}–${rule.maxLength} 个字符`
      : `Use ${rule.minLength}–${rule.maxLength} characters`
    : '';

  const availabilityRuleState: 'idle' | 'pass' | 'fail' =
    availability.status === 'available'
      ? 'pass'
      : availability.status === 'taken'
        ? 'fail'
        : 'idle';

  const availabilityRuleText =
    availability.status === 'checking'
      ? c('usernameChecking')
      : availability.status === 'available'
        ? isZh
          ? `@${availability.handle} 可以使用`
          : `@${availability.handle} is available`
        : availability.status === 'taken'
          ? availability.detail || (isZh ? `@${availability.handle} 已被其他用户使用` : `@${availability.handle} is already taken`)
          : availability.status === 'error'
            ? c('usernameCheckFailed')
            : c('usernameAvailabilityIdle');

  const statusBadgeText =
    availability.status === 'checking'
      ? c('usernameChecking')
      : availability.status === 'available'
        ? c('usernameAvailable')
        : availability.status === 'taken'
          ? c('usernameTaken')
          : '';

  const statusBadgeClass =
    availability.status === 'available'
      ? 'ac-handle-status ac-handle-status--ok'
      : availability.status === 'taken'
        ? 'ac-handle-status ac-handle-status--error'
        : 'ac-handle-status';

  const resetEdit = () => {
    setEditing(false);
    setConfirming(false);
    setHandle('');
    setNormalizeNote(null);
    setAvailability({ status: 'idle' });
    setError(null);
  };

  const commitChange = async () => {
    if (!canProceed || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if ((await loadWebCurrentAccount())?.id !== user.id) throw new Error(c('changed'));
      if (!active.current) return;
      const updated = await createWebBrowserRealm().account.updateMyHandle({
        path: {},
        body: { handle: candidate },
      });
      if (active.current) {
        resetEdit();
        onDirty(false);
        onSaved({ ...updated });
        setMessage(c('usernameSaved'));
        void load();
      }
    } catch (reason) {
      if (active.current) {
        setConfirming(false);
        setError(reason instanceof Error ? reason.message : c('unavailable'));
        void load();
      }
    } finally {
      if (active.current) setBusy(false);
    }
  };

  return (
    <section id="username" className="ac-section">
      <div className="ac-section-title">
        <h2>{c('username')}</h2>
        <button
          type="button"
          className="ac-text-button"
          onClick={() => {
            void navigator.clipboard
              .writeText(`@${currentHandle}`)
              .then(() => {
                if (active.current) setMessage(c('copied'));
              })
              .catch(() => {
                if (active.current) setError(c('copyFailed'));
              });
          }}
        >
          <Copy size={15} />
          {c('copy')}
        </button>
      </div>
      <p>{c('usernameHint')}</p>
      {!editing ? (
        <div className="ac-setting-row">
          <strong>@{currentHandle}</strong>
          {rule?.canChange ? (
            <button
              className="ac-button ac-button--secondary"
              type="button"
              onClick={() => {
                setEditing(true);
                setConfirming(false);
                setHandle('');
                setNormalizeNote(null);
                setError(null);
                setMessage(null);
              }}
            >
              {c('changeUsername')}
            </button>
          ) : rule?.nextEligibleAt ? (
            <span className="ac-muted">
              {c('usernameLater')} {new Date(rule.nextEligibleAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      ) : confirming ? (
        <div>
          <p className="ac-muted ac-handle-confirm-intro">{c('usernameConfirmIntro')}</p>
          <div className="ac-handle-diff" data-testid="web-handle-confirm-diff">
            <s>@{currentHandle}</s>
            <span aria-hidden="true">→</span>
            <strong>@{candidate}</strong>
          </div>
          <div className="ac-actions">
            <button
              type="button"
              className="ac-button"
              disabled={busy}
              onClick={() => { void commitChange(); }}
            >
              {busy ? c('saving') : `${c('usernameConfirmAction')} @${candidate}`}
            </button>
            <button
              type="button"
              className="ac-button ac-button--secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              {c('usernameBackToEdit')}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canProceed && !busy) setConfirming(true);
          }}
        >
          <div className="ac-handle-notice">
            <strong>{c('usernameBeforeChanging')}</strong>
            <ul>
              <li>{c('usernameNoticeSync')}</li>
              <li>{c('usernameNoticeFriends')}</li>
              <li>{c('usernameNoticeCooldown')}</li>
            </ul>
          </div>

          <div className="ac-field">
            <div className="ac-handle-label-row">
              <label htmlFor="ac-new-username-input">
                <span>{c('newUsername')}</span>
              </label>
              {rule ? (
                <span className="ac-handle-counter">
                  {candidate.length} / {rule.maxLength}
                </span>
              ) : null}
            </div>
            <div
              className={`ac-handle-input-shell${availability.status === 'taken' ? ' ac-handle-input-shell--error' : ''}`}
            >
              <span className="ac-handle-prefix" aria-hidden="true">@</span>
              <input
                id="ac-new-username-input"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={handle}
                maxLength={rule?.maxLength}
                disabled={busy}
                placeholder={c('usernameInputPlaceholder')}
                onChange={(event) => {
                  const allowUppercase = Boolean(rule && /A-Z/.test(rule.pattern));
                  const normalized = normalizeHandleInput(event.target.value, allowUppercase);
                  setHandle(normalized.value);
                  setError(null);
                  if (normalized.strippedAt && normalized.lowercased) {
                    setNormalizeNote(c('usernameStrippedAndLowercased'));
                  } else if (normalized.strippedAt) {
                    setNormalizeNote(c('usernameStrippedAt'));
                  } else if (normalized.lowercased) {
                    setNormalizeNote(c('usernameLowercased'));
                  } else if (!normalized.value) {
                    setNormalizeNote(null);
                  }
                }}
              />
              {statusBadgeText ? <span className={statusBadgeClass}>{statusBadgeText}</span> : null}
            </div>
            {normalizeNote ? <p className="ac-handle-note" role="status">{normalizeNote}</p> : null}
          </div>

          {rule ? (
            <ul className="ac-handle-rules" aria-live="polite">
              <RuleItem
                state={!evaluation.touched ? 'idle' : evaluation.lengthOk ? 'pass' : 'fail'}
                text={lengthRuleText}
              />
              <RuleItem
                state={!evaluation.touched ? 'idle' : evaluation.patternOk ? 'pass' : 'fail'}
                text={c('usernameRuleChars')}
              />
              <RuleItem
                state={!evaluation.touched ? 'idle' : evaluation.differentOk ? 'pass' : 'fail'}
                text={c('usernameRuleDifferent')}
              />
              <RuleItem state={availabilityRuleState} text={availabilityRuleText} />
            </ul>
          ) : null}

          <div className="ac-actions">
            <button className="ac-button" disabled={busy || !canProceed}>
              {c('usernameReviewChange')}
            </button>
            <button
              className="ac-button ac-button--secondary"
              type="button"
              disabled={busy}
              onClick={resetEdit}
            >
              {c('cancel')}
            </button>
          </div>
        </form>
      )}
      <AccountFeedback error={error} message={message} />
      {!rule && error ? (
        <button className="ac-text-button" onClick={() => void load()}>
          {c('retry')}
        </button>
      ) : null}
    </section>
  );
}
