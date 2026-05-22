//! Read-for-entry owner re-verification for a `ready_for_use` record.
//!
//! `ready_for_use` is never trusted from disk: the locally-owned evidence refs
//! must resolve through their filesystem owner/verifier. The Runtime baseline /
//! execution refs require a cross-process resolve and are re-verified by the
//! async backend `AdmitProductReadyForUse` operation instead.

use crate::desktop_paths::resolve_nimi_dir;
use std::fs;
use std::path::Path;

use super::record::{ProductControlRecord, ProductControlState};
use super::record_store::selected_data_root_path;

/// Re-verify a `ready_for_use` record's locally-owned evidence refs at
/// read-for-entry.
///
/// `ready_for_use` is never trusted from disk: a record claiming it must still
/// resolve `accountDefaultProfileRef` and every `builtInAiConfigRefs` entry
/// through their local filesystem owner/verifier. Any rejection (a fabricated
/// ref, a string-only ref, a stale ref, a direct file edit) fails closed.
///
/// Local owners only — the Runtime baseline / execution refs require a
/// cross-process resolve and are re-verified by the async backend
/// `AdmitProductReadyForUse` operation. The `LocalAiReady` route here is the
/// earliest non-ready state for an account/AIConfig owner failure
/// (`failure_projection` routes to `LocalAiReady` or `Blocked`); `not_logged_in` is
/// routed when the account is no longer authenticated.
pub(crate) fn ready_for_use_local_owner_verification_state(
    record: &ProductControlRecord,
) -> Option<(ProductControlState, String)> {
    if !matches!(record.state, ProductControlState::ReadyForUse) {
        return None;
    }
    let data_root = match selected_data_root_path(record) {
        Some(path) => path,
        None => {
            return Some((
                ProductControlState::DataRootMissing,
                "ready_for_use record has no selected dataRoot".to_string(),
            ));
        }
    };
    verify_ready_for_use_local_owners(record, &data_root).err()
}

/// Enumerate every account id that has a local Account Default Profile record
/// under `~/.nimi/accounts/*/profiles/default.json`.
///
/// P-AIPS-013 fixes the Account Default Profile library under the `~/.nimi`
/// CONTROL root, not the user-selected `nimi_data` DATA root. This is a
/// read-only directory scan used to discover candidate authenticated account
/// ids for the sync read-for-entry re-verification. It never trusts the
/// product-control record for the account binding. The percent-encoded path
/// segment is decoded back to the canonical account id.
fn account_ids_with_default_profile() -> Vec<String> {
    let Ok(nimi_dir) = resolve_nimi_dir() else {
        return Vec::new();
    };
    let accounts_dir = nimi_dir.join("accounts");
    let Ok(entries) = fs::read_dir(&accounts_dir) else {
        return Vec::new();
    };
    let mut account_ids = Vec::new();
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        if !entry.path().join("profiles").join("default.json").is_file() {
            continue;
        }
        let segment = entry.file_name();
        let Some(segment) = segment.to_str() else {
            continue;
        };
        if let Some(account_id) = decode_account_path_segment(segment) {
            account_ids.push(account_id);
        }
    }
    account_ids
}

/// Decode a percent-encoded `accounts/<segment>` directory name back to the
/// canonical account id. Mirrors the encoding the account profile library uses
/// for its account path segment. Returns `None` for a malformed segment.
fn decode_account_path_segment(segment: &str) -> Option<String> {
    let mut out = Vec::new();
    let bytes = segment.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let hex = bytes.get(index + 1..index + 3)?;
                let hex = std::str::from_utf8(hex).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            other => {
                out.push(other);
                index += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Re-resolve every locally-owned `ready_for_use` evidence ref through its
/// owner. Returns the routed non-ready `(state, error)` on the first failure.
///
/// The authenticated account binding is not trusted from the product-control
/// record: candidate account ids are discovered by scanning the local account
/// profile library directory, and the recorded `accountDefaultProfileRef` /
/// `builtInAiConfigRefs` must resolve through their owner/verifier for one of
/// those accounts. A fabricated ref, a string-only ref, or a direct file edit
/// resolves through no owner and fails closed to `LocalAiReady` — the
/// earliest affected non-ready state for an account / AIConfig owner failure.
fn verify_ready_for_use_local_owners(
    record: &ProductControlRecord,
    data_root: &Path,
) -> Result<(), (ProductControlState, String)> {
    let account_ref = record
        .first_run
        .account_default_profile_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            (
                ProductControlState::LocalAiReady,
                "ready_for_use record is missing accountDefaultProfileRef".to_string(),
            )
        })?;
    let candidate_account_ids = account_ids_with_default_profile();
    if candidate_account_ids.is_empty() {
        return Err((
            ProductControlState::LocalAiReady,
            "no local Account Default Profile evidence backs the recorded accountDefaultProfileRef"
                .to_string(),
        ));
    }
    for account_id in candidate_account_ids {
        if crate::account_profile_library::verify_account_default_profile_ref(
            data_root,
            &account_id,
            account_ref,
        )
        .is_err()
        {
            continue;
        }
        // The account ref resolved for this account; the built-in AIConfig
        // refs must resolve for the same bound account.
        return crate::desktop_ai_config_library::verify_built_in_ai_config_evidence_set(
            data_root,
            &account_id,
            &record.first_run.built_in_ai_config_refs,
            None,
        )
        .map(|_| ())
        .map_err(|error| (ProductControlState::LocalAiReady, error));
    }
    Err((
        ProductControlState::LocalAiReady,
        "recorded accountDefaultProfileRef resolves through no local account owner".to_string(),
    ))
}
