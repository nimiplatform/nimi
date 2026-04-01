use tauri::AppHandle;

use super::store::{load_state, save_state};
use super::types::{
    normalize_local_inventory_id, now_iso_timestamp, LocalAiAssetRecord, LocalAiAssetStatus,
    LocalAiRuntimeState,
};

fn find_asset_index(state: &LocalAiRuntimeState, local_asset_id: &str) -> Option<usize> {
    let normalized = local_asset_id.trim().to_ascii_lowercase();
    state
        .artifacts
        .iter()
        .position(|item| item.local_asset_id.trim().to_ascii_lowercase() == normalized)
}

fn find_asset_identity_index(
    state: &LocalAiRuntimeState,
    asset_id: &str,
    kind: &super::types::LocalAiAssetKind,
    engine: &str,
    include_removed: bool,
) -> Option<usize> {
    let asset_id = normalize_local_inventory_id(asset_id);
    let engine = engine.trim();
    state.artifacts.iter().position(|item| {
        (include_removed || item.status != LocalAiAssetStatus::Removed)
            && normalize_local_inventory_id(item.asset_id.as_str()) == asset_id
            && &item.kind == kind
            && item.engine.trim().eq_ignore_ascii_case(engine)
    })
}

pub fn find_installed_asset_by_identity(
    app: &AppHandle,
    asset_id: &str,
    kind: &super::types::LocalAiAssetKind,
    engine: &str,
) -> Result<Option<LocalAiAssetRecord>, String> {
    let state = load_state(app)?;
    Ok(
        find_asset_identity_index(&state, asset_id, kind, engine, false)
            .map(|index| state.artifacts[index].clone()),
    )
}

pub fn upsert_asset(
    app: &AppHandle,
    mut record: LocalAiAssetRecord,
) -> Result<LocalAiAssetRecord, String> {
    let mut state = load_state(app)?;
    let now = now_iso_timestamp();
    record.asset_id = normalize_local_inventory_id(record.asset_id.as_str());
    record.updated_at = now;

    if let Some(index) = find_asset_index(&state, &record.local_asset_id) {
        state.artifacts[index] = record.clone();
    } else if let Some(index) =
        find_asset_identity_index(&state, &record.asset_id, &record.kind, &record.engine, true)
    {
        record.local_asset_id = state.artifacts[index].local_asset_id.clone();
        state.artifacts[index] = record.clone();
    } else {
        state.artifacts.push(record.clone());
    }
    save_state(app, &state)?;
    Ok(record)
}
