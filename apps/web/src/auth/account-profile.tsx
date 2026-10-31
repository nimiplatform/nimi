import { useEffect, useRef, useState } from 'react';
import { Camera, Copy } from 'lucide-react';
import { uploadNimiRealmResourceFile, type RealmModel } from '@nimiplatform/sdk/realm';
import { createWebBrowserRealm } from './browser-realm.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';
import { accountHandle, profilePatch } from './account-center-model.js';
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
  const [baseline, setBaseline] = useState(user);
  const [draft, setDraft] = useState(() => fields(user));
  const [photo, setPhoto] = useState<{ url: string; resourceId: string } | null>(null);
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
    setError(null);
    setMessage(null);
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = null;
  }
  async function uploadPhoto(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(c('invalidImage'));
      return;
    }
    const controller = new AbortController();
    upload.current?.abort();
    upload.current = controller;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      if ((await loadWebCurrentAccount())?.id !== user.id) throw new Error(c('changed'));
      if (!active.current) return;
      const result = await uploadNimiRealmResourceFile(createWebBrowserRealm(), {
        kind: 'image',
        file,
        fileName: file.name,
        deliveryAccess: 'PUBLIC',
        options: { signal: controller.signal },
      });
      if (!active.current || controller.signal.aborted) return;
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
      photoUrl.current = URL.createObjectURL(file);
      setPhoto({ url: photoUrl.current, resourceId: result.resourceId });
      setMessage(c('avatarPending'));
    } catch (reason) {
      if (active.current && !controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : c('unavailable'));
    } finally {
      if (active.current && upload.current === controller) setUploading(false);
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
            user={{ ...baseline, avatarUrl: photo?.url || baseline.avatarUrl }}
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
                  if (file) void uploadPhoto(file);
                }}
              />
            </label>
            <p className="ac-muted">{c('avatarHint')}</p>
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

function UsernameEditor({
  user,
  onSaved,
  onDirty,
}: {
  user: Record<string, unknown>;
  onSaved: (user: Record<string, unknown>) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const c = useAccountCopy();
  const [rule, setRule] = useState<RealmModel<'HandleChangeEligibilityDto'> | null>(null);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState(String(user.handle));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(true);
  const normalized = handle.trim().replace(/^@/, '');
  useEffect(() => {
    onDirty(editing && normalized !== accountHandle(user.handle));
    return () => onDirty(false);
  }, [editing, normalized, user.handle, onDirty]);
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
  const valid = Boolean(
    rule &&
    normalized !== accountHandle(rule.handle) &&
    normalized.length >= rule.minLength &&
    normalized.length <= rule.maxLength &&
    new RegExp(rule.pattern).test(normalized),
  );
  return (
    <section className="ac-section">
      <div className="ac-section-title">
        <h2>{c('username')}</h2>
        <button
          type="button"
          className="ac-text-button"
          onClick={() => {
            void navigator.clipboard
              .writeText(`@${accountHandle(user.handle)}`)
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
          <strong>@{accountHandle(user.handle)}</strong>
          {rule?.canChange ? (
            <button
              className="ac-button ac-button--secondary"
              type="button"
              onClick={() => setEditing(true)}
            >
              {c('changeUsername')}
            </button>
          ) : rule?.nextEligibleAt ? (
            <span className="ac-muted">
              {c('usernameLater')} {new Date(rule.nextEligibleAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid || busy) return;
            setBusy(true);
            setError(null);
            try {
              if ((await loadWebCurrentAccount())?.id !== user.id) throw new Error(c('changed'));
              if (!active.current) return;
              const updated = await createWebBrowserRealm().account.updateMyHandle({
                path: {},
                body: { handle: normalized },
              });
              if (active.current) {
                setEditing(false);
                onDirty(false);
                onSaved({ ...updated });
              }
            } catch (reason) {
              if (active.current) {
                setError(reason instanceof Error ? reason.message : c('unavailable'));
                void load();
              }
            } finally {
              if (active.current) setBusy(false);
            }
          }}
        >
          <label className="ac-field">
            <span>{c('username')}</span>
            <input
              value={handle}
              maxLength={rule?.maxLength}
              disabled={busy}
              onChange={(event) => setHandle(event.target.value)}
            />
          </label>
          <p className="ac-muted">{c('usernameChangeHint')}</p>
          <div className="ac-actions">
            <button className="ac-button" disabled={busy || !valid}>
              {c('changeUsername')}
            </button>
            <button
              className="ac-button ac-button--secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setHandle(String(user.handle));
              }}
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
