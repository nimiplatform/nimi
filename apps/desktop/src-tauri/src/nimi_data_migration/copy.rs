//! Integrity-checked recursive copy of a `nimi_data` data-root subtree.
//!
//! `P-MIG-007` requires the data move to verify integrity before the pointer
//! cutover. The migration is a copy-then-verify-then-cutover-then-reclaim
//! sequence, never an in-place rename, because the source and target may live
//! on different volumes and because keeping the source intact until the target
//! is verified is what makes a mid-move failure recoverable (`P-MIG-005`
//! no-orphaning: a failed copy leaves the source fully intact and authoritative).

use std::fs;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::layout::{measure_directory, DirectoryUsage};

/// The integrity signature of a copied subtree.
///
/// `file_count` / `total_bytes` are the structural measure; `content_digest`
/// is a path-ordered SHA-256 over every regular file's relative path and bytes.
/// The migration verifies the target's signature equals the source's before
/// the pointer cutover — a mismatch fails the migration closed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntegritySignature {
    pub file_count: u64,
    pub total_bytes: u64,
    pub content_digest: String,
}

/// Recursively copy `source` into `target`, preserving the directory shape.
///
/// `target` must not already exist — the caller stages the copy into a fresh
/// staging path so a partially-copied tree is never confused with a real data
/// root. Symlinks are NOT followed: a symlink in the source is skipped (it is
/// counted in the source measurement as one file, so a copy that skips it is
/// detected by the integrity check and fails closed rather than silently
/// dropping a link). This keeps the copy from escaping the `nimi_data` subtree.
///
/// A copy failure leaves the partially-written `target` for the caller to
/// reclaim; the `source` is never touched by this function.
pub fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("读取拷贝源元数据失败 ({}): {error}", source.display()))?;
    if !metadata.is_dir() {
        return Err(format!(
            "拷贝源不是目录 ({})",
            source.display()
        ));
    }
    fs::create_dir_all(target)
        .map_err(|error| format!("创建拷贝目标目录失败 ({}): {error}", target.display()))?;
    copy_dir_contents(source, target)
}

fn copy_dir_contents(source: &Path, target: &Path) -> Result<(), String> {
    let entries = fs::read_dir(source)
        .map_err(|error| format!("读取拷贝源目录失败 ({}): {error}", source.display()))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("遍历拷贝源目录失败 ({}): {error}", source.display()))?;
        let entry_path = entry.path();
        let entry_metadata = fs::symlink_metadata(&entry_path).map_err(|error| {
            format!(
                "读取拷贝源项元数据失败 ({}): {error}",
                entry_path.display()
            )
        })?;
        let file_type = entry_metadata.file_type();
        let dest = target.join(entry.file_name());
        if file_type.is_symlink() {
            // Skip symlinks. The source measurement counted the link as a
            // file, so a skipped link makes the target file count differ and
            // the integrity check fails the migration closed — never a silent
            // partial migration.
            continue;
        }
        if file_type.is_dir() {
            fs::create_dir_all(&dest).map_err(|error| {
                format!("创建拷贝子目录失败 ({}): {error}", dest.display())
            })?;
            copy_dir_contents(&entry_path, &dest)?;
        } else {
            fs::copy(&entry_path, &dest).map_err(|error| {
                format!(
                    "拷贝文件失败 ({} -> {}): {error}",
                    entry_path.display(),
                    dest.display()
                )
            })?;
        }
    }
    Ok(())
}

/// Compute the integrity signature of a directory subtree.
///
/// The content digest folds, in sorted relative-path order, each regular
/// file's relative path and its full byte content into one SHA-256. Sorting
/// makes the digest independent of filesystem enumeration order, so the source
/// and target digests are directly comparable.
pub fn compute_signature(root: &Path) -> Result<IntegritySignature, String> {
    let usage: DirectoryUsage = measure_directory(root)?;
    let mut hasher = Sha256::new();
    let mut relative_files = Vec::new();
    collect_files(root, root, &mut relative_files)?;
    relative_files.sort();
    for relative in &relative_files {
        let absolute = root.join(relative);
        let bytes = fs::read(&absolute).map_err(|error| {
            format!("读取文件计算校验和失败 ({}): {error}", absolute.display())
        })?;
        hasher.update(relative.as_bytes());
        hasher.update([0u8]);
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
    }
    let content_digest = format!("sha256:{:x}", hasher.finalize());
    Ok(IntegritySignature {
        file_count: usage.file_count,
        total_bytes: usage.total_bytes,
        content_digest,
    })
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|error| format!("读取目录失败 ({}): {error}", dir.display()))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("遍历目录失败 ({}): {error}", dir.display()))?;
        let entry_path = entry.path();
        let entry_metadata = fs::symlink_metadata(&entry_path).map_err(|error| {
            format!(
                "读取目录项元数据失败 ({}): {error}",
                entry_path.display()
            )
        })?;
        let file_type = entry_metadata.file_type();
        if file_type.is_symlink() {
            // A symlink contributes to the file count (via measure_directory)
            // but not to the content digest — both source and target treat it
            // identically, so the digest stays comparable while the count
            // difference still catches a dropped link.
            continue;
        }
        if file_type.is_dir() {
            collect_files(root, &entry_path, out)?;
        } else if let Ok(relative) = entry_path.strip_prefix(root) {
            if let Some(relative) = relative.to_str() {
                out.push(relative.replace('\\', "/"));
            } else {
                return Err(format!(
                    "文件路径不是有效 UTF-8 ({})",
                    entry_path.display()
                ));
            }
        }
    }
    Ok(())
}

/// Verify a copied target subtree matches the source's integrity signature.
///
/// Returns `Ok(signature)` when the target is byte-identical in structure and
/// content to the source; returns a typed `Err` describing the first mismatch
/// otherwise. `P-MIG-007`: a failed integrity check must abort the migration
/// before any pointer cutover.
pub fn verify_copy(
    source: &Path,
    target: &Path,
) -> Result<IntegritySignature, String> {
    let source_signature = compute_signature(source)?;
    let target_signature = compute_signature(target)?;
    if source_signature.file_count != target_signature.file_count {
        return Err(format!(
            "迁移完整性校验失败：文件数不一致（源 {} / 目标 {}）",
            source_signature.file_count, target_signature.file_count
        ));
    }
    if source_signature.total_bytes != target_signature.total_bytes {
        return Err(format!(
            "迁移完整性校验失败：字节数不一致（源 {} / 目标 {}）",
            source_signature.total_bytes, target_signature.total_bytes
        ));
    }
    if source_signature.content_digest != target_signature.content_digest {
        return Err(format!(
            "迁移完整性校验失败：内容摘要不一致（源 {} / 目标 {}）",
            source_signature.content_digest, target_signature.content_digest
        ));
    }
    Ok(target_signature)
}
