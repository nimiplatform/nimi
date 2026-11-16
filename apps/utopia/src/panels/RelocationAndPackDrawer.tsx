import { useRef, useState, type DragEvent } from 'react';
import { Button, InlineAlert, OverlayShell, StatusBadge } from '@nimiplatform/kit/ui';
import type { NimiUtopiaSnapshot, NimiUtopiaUpdateIntent } from '@nimiplatform/sdk/app';
import { UploadArchiveIcon } from '../components/UtopiaIcons.js';
import type { InstalledUtopiaPack, UtopiaStoragePort } from '../domain/bundle-registry.js';
import {
  importValidatedUtopiaBundle,
  relocateWithImportedPackGuard,
  removeImportedPack,
} from '../domain/bundle-registry.js';
import {
  UtopiaBundleValidationError,
  inspectUtopiaArchiveFile,
  type ValidatedUtopiaBundle,
} from '../domain/bundle-validator.js';
import {
  SHARED_STATE_LABELS,
  THEME_TAG_LABELS,
  detectSystemIanaTimezone,
  findRelocationAffectedActivities,
} from '../domain/visit-journal.js';

const SAMPLE_CREATOR_BUNDLE_ID = 'creator.autumn-farm';
const SAMPLE_CREATOR_URL = './samples/creator.autumn-farm.utopia';

export function RelocationAndPackDrawer(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly snapshot: NimiUtopiaSnapshot | null;
  readonly frozen?: boolean;
  readonly packs: readonly InstalledUtopiaPack[];
  readonly packIndexError?: string | null;
  readonly previewUrls: Readonly<Record<string, string>>;
  readonly storagePort: UtopiaStoragePort;
  readonly busy: boolean;
  readonly resolveActiveContentDigest?: () => Promise<string | null>;
  readonly onPacksChanged: () => Promise<void>;
  readonly onExecuteRelocation: (intent: NimiUtopiaUpdateIntent) => Promise<boolean>;
}) {
  const {
    open,
    onClose,
    snapshot,
    frozen = false,
    packs,
    packIndexError = null,
    previewUrls,
    storagePort,
    busy,
    resolveActiveContentDigest,
    onPacksChanged,
    onExecuteRelocation,
  } = props;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [relocating, setRelocating] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [inspectedCandidate, setInspectedCandidate] = useState<ValidatedUtopiaBundle | null>(null);
  const [confirmTargetPack, setConfirmTargetPack] = useState<InstalledUtopiaPack | null>(null);
  const [syncLocalTimezone, setSyncLocalTimezone] = useState(true);
  const drawerBusy = busy || inspecting || relocating || removingKey !== null;

  const detectedLocalTz = snapshot?.timezone === 'UTC' ? detectSystemIanaTimezone() : null;
  const canSyncLocalTz = Boolean(detectedLocalTz && detectedLocalTz !== 'UTC');

  const affectedActivities = snapshot ? findRelocationAffectedActivities(snapshot) : [];
  const sampleAlreadyInstalled = packs.some((p) => p.manifest.bundleId === SAMPLE_CREATOR_BUNDLE_ID);

  const nameOf = (handle: string) =>
    snapshot?.residents.find((r) => r.agentHandle === handle)?.displayName ?? '伙伴';

  const handleInspectFile = async (file: Pick<File, 'size' | 'arrayBuffer'>) => {
    setInspecting(true);
    setImportError(null);
    setImportSuccess(null);
    setInspectedCandidate(null);
    try {
      const validated = await inspectUtopiaArchiveFile(file);
      setInspectedCandidate(validated);
    } catch (err) {
      if (err instanceof UtopiaBundleValidationError) {
        setImportError(err.message);
      } else {
        setImportError(err instanceof Error ? err.message : '导入未通过：无法读取该 .utopia 文件。');
      }
    } finally {
      setInspecting(false);
    }
  };

  const handleLoadCreatorSample = async () => {
    if (drawerBusy) return;
    setInspecting(true);
    setImportError(null);
    setImportSuccess(null);
    setInspectedCandidate(null);
    try {
      const res = await globalThis.fetch(SAMPLE_CREATOR_URL);
      if (!res.ok) throw new Error('未能读取内置创作示例包。');
      const buf = await res.arrayBuffer();
      await handleInspectFile({
        size: buf.byteLength,
        arrayBuffer: async () => buf,
      });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '读取创作示例包失败。');
      setInspecting(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (drawerBusy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleInspectFile(file);
    }
  };

  const handleCommitImport = async (relocateImmediately: boolean) => {
    if (!inspectedCandidate || drawerBusy) return;
    setInspecting(true);
    setImportError(null);
    try {
      const committed = await importValidatedUtopiaBundle(inspectedCandidate, storagePort, {
        activeContentDigest: snapshot?.contentDigest ?? null,
      });
      await onPacksChanged();
      setInspectedCandidate(null);
      setImportSuccess(`洞天包「${committed.manifest.title}」已验证并存入本机库。`);
      if (relocateImmediately) {
        setConfirmTargetPack(committed);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '写入应用受管资产库失败。');
    } finally {
      setInspecting(false);
    }
  };

  const handleConfirmRelocate = async () => {
    if (!confirmTargetPack || drawerBusy) return;
    const targetPack = confirmTargetPack;
    const preferredTimezone = canSyncLocalTz && syncLocalTimezone
      ? (detectedLocalTz ?? undefined)
      : undefined;

    const intent: NimiUtopiaUpdateIntent = targetPack.habitat.habitatId === 'nimi.builtin.seaside-island'
      && targetPack.source === 'builtin'
      ? {
          kind: 'restore-default',
          ...(preferredTimezone ? { timezone: preferredTimezone } : {}),
        }
      : {
          kind: 'activate-habitat',
          habitat: targetPack.habitat,
          ...(preferredTimezone ? { timezone: preferredTimezone } : {}),
        };

    setRelocating(true);
    setImportError(null);
    try {
      const ok = await relocateWithImportedPackGuard(storagePort, targetPack, () =>
        onExecuteRelocation(intent),
      );
      if (ok) {
        setConfirmTargetPack(null);
        onClose();
      }
    } catch (err) {
      setConfirmTargetPack(null);
      await onPacksChanged().catch(() => undefined);
      setImportError(err instanceof Error ? err.message : '迁居操作未能完成，请重试。');
    } finally {
      setRelocating(false);
    }
  };

  const handleRemovePack = async (pack: InstalledUtopiaPack) => {
    if (pack.source !== 'imported' || drawerBusy || !snapshot || frozen) return;
    const key = `${pack.manifest.bundleId}@${pack.contentDigest}`;
    setRemovingKey(key);
    setImportError(null);
    setImportSuccess(null);
    try {
      await removeImportedPack(pack.manifest.bundleId, storagePort, {
        contentDigest: pack.contentDigest,
        ...(resolveActiveContentDigest
          ? { resolveActiveContentDigest }
          : { activeContentDigest: snapshot.contentDigest }),
      });
      await onPacksChanged();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '移除洞天包失败。');
    } finally {
      setRemovingKey(null);
    }
  };

  const confirmCoverUrl = confirmTargetPack
    ? (previewUrls[confirmTargetPack.contentDigest] ?? previewUrls[confirmTargetPack.manifest.bundleId] ?? null)
    : null;
  const ongoingAffected = affectedActivities.filter((act) => act.state === 'active');
  const unstartedAffected = affectedActivities.filter((act) => act.state !== 'active');

  return (
    <OverlayShell
      open={open}
      onClose={() => {
        setConfirmTargetPack(null);
        onClose();
      }}
      kind="dialog"
      size="lg"
      title={confirmTargetPack ? `展卷迁居至「${confirmTargetPack.manifest.title}」` : '洞天画卷库与 .utopia 包导入'}
      description={
        confirmTargetPack
          ? '账户同一时刻生效唯一洞天，全体自治伙伴将共同迁入新居所。'
          : '选择官方手绘样板或导入纯声明式 .utopia 洞天包，更换伙伴日常栖居的洞天画卷。'
      }
    >
      {confirmTargetPack ? (
        <div className="utopia-relocate-confirm-body">
          <div className="utopia-relocate-summary-card">
            {confirmCoverUrl && (
              <img
                src={confirmCoverUrl}
                alt=""
                aria-hidden="true"
                className="utopia-relocate-hero-cover"
              />
            )}
            <div className="utopia-section-header">
              <strong>{confirmTargetPack.manifest.title}</strong>
              <StatusBadge tone="neutral">
                {THEME_TAG_LABELS[confirmTargetPack.habitat.themeTag] ?? confirmTargetPack.habitat.themeTag}
              </StatusBadge>
            </div>
            <p className="utopia-causal-note">{confirmTargetPack.habitat.backdropSummary}</p>
            <div className="utopia-pack-places-preview">
              <span className="utopia-pack-place-chip is-quarter">{confirmTargetPack.habitat.personalQuarter.name}</span>
              {confirmTargetPack.habitat.places.map((pl) => (
                <span key={pl.id} className="utopia-pack-place-chip">{pl.name}</span>
              ))}
            </div>
            <small className="utopia-muted-caption">
              创作者：{confirmTargetPack.manifest.author} · 公共场所 {confirmTargetPack.habitat.places.length} 处 · 环境旋钮 {confirmTargetPack.habitat.parameters.length} 组
            </small>
          </div>

          <div className="utopia-relocate-impact-box">
            <strong>搬家前的小事叮嘱</strong>
            {affectedActivities.length === 0 ? (
              <p className="utopia-causal-note">
                眼下没有正在进行的小聚或待开始的约定，大家忙完手头的事就会自然安顿进新居。
              </p>
            ) : (
              <>
                <p className="utopia-causal-note">
                  搬入新居时，正在进行的小聚会保留已共处片段并收进旧居回忆；尚未开始的邀约与约定会随搬家取消，不会在新居自动生效：
                </p>
                <ul className="utopia-preview-bullet-list">
                  {ongoingAffected.map((act) => (
                    <li key={act.activityRef}>
                      <span className="utopia-preview-tag is-open">
                        进行中小聚 · 收进旧居回忆
                      </span>
                      <span>
                        {nameOf(act.initiatorHandle)} 与 {nameOf(act.recipientHandle)} 在 {act.placeLabel} 的「{act.activityLabel}」（保留已共处时光）
                      </span>
                    </li>
                  ))}
                  {unstartedAffected.map((act) => (
                    <li key={act.activityRef}>
                      <span className="utopia-preview-tag is-warn">
                        待开始约定 · 随搬家取消
                      </span>
                      <span>
                        {nameOf(act.initiatorHandle)} 与 {nameOf(act.recipientHandle)} 在 {act.placeLabel} 的「{act.activityLabel}」（{SHARED_STATE_LABELS[act.state]}，不会迁入新居）
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {canSyncLocalTz && detectedLocalTz && (
              <label className="utopia-relocate-tz-option">
                <input
                  type="checkbox"
                  checked={syncLocalTimezone}
                  disabled={drawerBusy}
                  onChange={(e) => setSyncLocalTimezone(e.currentTarget.checked)}
                />
                <span>
                  同步将账户住地时区从 <strong>UTC</strong> 更新为本机时区（<strong>{detectedLocalTz}</strong>），让画卷昼夜光影与本地时间一致
                </span>
              </label>
            )}
          </div>

          <div className="utopia-draft-actions">
            <Button
              type="button"
              tone="ghost"
              disabled={drawerBusy}
              onClick={() => setConfirmTargetPack(null)}
            >
              返回画卷库
            </Button>
            <Button
              type="button"
              tone="primary"
              disabled={drawerBusy}
              onClick={() => void handleConfirmRelocate()}
            >
              {busy || relocating ? '正在展卷迁居…' : '确认迁入此洞天'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="utopia-pack-library-body">
          <div
            className={`utopia-dropzone ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!drawerBusy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <div className="utopia-dropzone-copy">
              <div className="utopia-dropzone-title-row">
                <UploadArchiveIcon size={16} />
                <strong>导入纯声明式 .utopia 洞天包</strong>
              </div>
              <p className="utopia-causal-note">
                拖入 .utopia 归档或选择本地文件（本地安全校验：≤12 MiB、光栅尺寸 ≤4096px、零可执行脚本与场所锚点完整性）。
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".utopia,.zip,application/zip"
              className="sr-only"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f && !drawerBusy) void handleInspectFile(f);
                e.currentTarget.value = '';
              }}
            />
            <div className="utopia-dropzone-actions">
              {!sampleAlreadyInstalled && (
                <Button
                  type="button"
                  tone="ghost"
                  size="sm"
                  disabled={drawerBusy}
                  onClick={() => void handleLoadCreatorSample()}
                >
                  试用示例包（秋日农庄）
                </Button>
              )}
              <Button
                type="button"
                tone="secondary"
                size="sm"
                disabled={drawerBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {inspecting ? '校验中…' : '选择 .utopia 文件'}
              </Button>
            </div>
          </div>

          {packIndexError && (
            <InlineAlert tone="warning">
              本地已导入洞天索引读取异常：{packIndexError}。官方内置样板仍可正常使用；请检查受管存储后重新加载。
            </InlineAlert>
          )}

          {importError && (
            <InlineAlert tone="danger">
              {importError}
            </InlineAlert>
          )}

          {importSuccess && (
            <InlineAlert tone="success">
              {importSuccess}
            </InlineAlert>
          )}

          {inspectedCandidate && (
            <div className="utopia-nl-preview-card" role="region" aria-label="待导入洞天包检视结果">
              <div className="utopia-section-header">
                <strong>通过安全检视：{inspectedCandidate.manifest.title}</strong>
                <StatusBadge tone="success">v{inspectedCandidate.manifest.version}</StatusBadge>
              </div>
              <p className="utopia-causal-note">
                {inspectedCandidate.manifest.subtitle} · 作者：{inspectedCandidate.manifest.author} · 含 {inspectedCandidate.habitat.places.length} 处公共场所与 {inspectedCandidate.assets.size} 份校验资源。
              </p>
              <div className="utopia-pack-places-preview">
                <span className="utopia-pack-place-chip is-quarter">{inspectedCandidate.habitat.personalQuarter.name}</span>
                {inspectedCandidate.habitat.places.map((pl) => (
                  <span key={pl.id} className="utopia-pack-place-chip">{pl.name}</span>
                ))}
              </div>
              <div className="utopia-draft-actions">
                <Button
                  type="button"
                  tone="ghost"
                  size="sm"
                  disabled={drawerBusy}
                  onClick={() => setInspectedCandidate(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  tone="secondary"
                  size="sm"
                  disabled={drawerBusy}
                  onClick={() => void handleCommitImport(false)}
                >
                  仅存入洞天库
                </Button>
                <Button
                  type="button"
                  tone="primary"
                  size="sm"
                  disabled={drawerBusy || !snapshot}
                  onClick={() => void handleCommitImport(true)}
                >
                  存入并准备迁居
                </Button>
              </div>
            </div>
          )}

          <div className="utopia-pack-grid">
            {packs.map((pack) => {
              const isActive = snapshot?.contentDigest === pack.contentDigest
                && snapshot?.habitat.habitatId === pack.habitat.habitatId;
              const isSameHabitatDifferentDigest = !isActive
                && snapshot?.habitat.habitatId === pack.habitat.habitatId;
              const coverUrl = previewUrls[pack.contentDigest] ?? previewUrls[pack.manifest.bundleId];
              return (
                <article
                  key={`${pack.manifest.bundleId}@${pack.contentDigest}`}
                  className={`utopia-pack-card ${isActive ? 'is-active' : ''}`}
                >
                  <div className="utopia-pack-cover-wrap">
                    {coverUrl && (
                      <img
                        src={coverUrl}
                        alt=""
                        aria-hidden="true"
                        className="utopia-pack-cover"
                      />
                    )}
                    <span className="utopia-pack-theme-pill">
                      {THEME_TAG_LABELS[pack.habitat.themeTag] ?? pack.habitat.themeTag}
                    </span>
                  </div>
                  <div className="utopia-pack-card-body">
                    <div className="utopia-section-header">
                      <strong>{pack.manifest.title} · v{pack.manifest.version}</strong>
                      <StatusBadge tone={isActive ? 'success' : (isSameHabitatDifferentDigest ? 'warning' : 'neutral')}>
                        {isActive
                          ? '正在居住'
                          : isSameHabitatDifferentDigest
                            ? '另一版本'
                            : (pack.source === 'builtin' ? '官方样板' : '本地导入')}
                      </StatusBadge>
                    </div>
                    <p className="utopia-causal-note">{pack.manifest.subtitle}</p>
                    <div className="utopia-pack-places-preview">
                      {pack.habitat.places.slice(0, 4).map((pl) => (
                        <span key={pl.id} className="utopia-pack-place-chip">{pl.name}</span>
                      ))}
                    </div>
                    <small className="utopia-muted-caption">
                      私舍「{pack.habitat.personalQuarter.name}」 · {pack.habitat.parameters.length} 组旋钮 · {pack.manifest.author}
                    </small>
                    <div className="utopia-pack-card-actions">
                      {pack.source === 'imported' && !isActive && (
                        <Button
                          type="button"
                          tone="ghost"
                          size="sm"
                          disabled={drawerBusy || !snapshot || frozen}
                          title={!snapshot || frozen ? '连接住地并确认使用状态后方可移除本地包' : undefined}
                          onClick={() => void handleRemovePack(pack)}
                        >
                          {removingKey === `${pack.manifest.bundleId}@${pack.contentDigest}` ? '移除中…' : '移除'}
                        </Button>
                      )}
                      <Button
                        type="button"
                        tone={isActive ? 'secondary' : 'primary'}
                        size="sm"
                        disabled={drawerBusy || isActive || !snapshot}
                        onClick={() => setConfirmTargetPack(pack)}
                      >
                        {isActive ? '当前居所' : (isSameHabitatDifferentDigest ? '迁入此版本' : '展卷迁居')}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </OverlayShell>
  );
}
