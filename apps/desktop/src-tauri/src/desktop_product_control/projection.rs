//! Read-for-entry projection of `~/.nimi/nimi.json` and resolution of the
//! selected `nimi_data` data root.

use std::path::PathBuf;

use super::paths::product_control_record_path;
use super::ready_verification::ready_for_use_local_owner_verification_state;
use super::record::{
    ProductControlRecordProjection, ProductControlSelectedDataRootProjection, ProductControlState,
};
use super::record_store::{read_existing_record, selected_data_root_path};

pub fn read_product_control_projection() -> Result<ProductControlRecordProjection, String> {
    let path = product_control_record_path()?;
    if let Some(record) = crate::desktop_e2e_fixture::product_control_record_override()? {
        return Ok(ProductControlRecordProjection {
            path: path.display().to_string(),
            exists: true,
            state: record.state.clone(),
            record: Some(record),
            error: None,
        });
    }
    match read_existing_record(&path) {
        Ok(Some(record)) => {
            if let Some((routed_state, error)) =
                ready_for_use_local_owner_verification_state(&record)
            {
                return Ok(ProductControlRecordProjection {
                    path: path.display().to_string(),
                    exists: true,
                    state: routed_state,
                    record: None,
                    error: Some(format!(
                        "~/.nimi/nimi.json ready_for_use failed owner admission verification: {error}"
                    )),
                });
            }
            Ok(ProductControlRecordProjection {
                path: path.display().to_string(),
                exists: true,
                state: record.state.clone(),
                record: Some(record),
                error: None,
            })
        }
        Ok(None) => {
            Ok(ProductControlRecordProjection {
                path: path.display().to_string(),
                exists: false,
                state: ProductControlState::ConfigMissing,
                record: None,
                error: Some("~/.nimi/nimi.json is missing; first-run data-root selection has not initialized product control".to_string()),
            })
        }
        Err(error) => Ok(ProductControlRecordProjection {
            path: path.display().to_string(),
            exists: true,
            state: ProductControlState::RepairRequired,
            record: None,
            error: Some(error),
        }),
    }
}

pub fn read_selected_product_data_root_projection(
) -> Result<ProductControlSelectedDataRootProjection, String> {
    let path = product_control_record_path()?;
    if let Some(record) = crate::desktop_e2e_fixture::product_control_record_override()? {
        let data_root = selected_data_root_path(&record)
            .map(|_| record.data_root.clone())
            .unwrap_or(None);
        return Ok(ProductControlSelectedDataRootProjection {
            path: path.display().to_string(),
            exists: true,
            state: record.state,
            data_root,
            error: None,
        });
    }
    match read_existing_record(&path) {
        Ok(Some(record)) => {
            let data_root = selected_data_root_path(&record)
                .map(|_| record.data_root.clone())
                .unwrap_or(None);
            let error = if data_root.is_some() {
                None
            } else {
                Some("~/.nimi/nimi.json has no selected absolute dataRoot.path".to_string())
            };
            Ok(ProductControlSelectedDataRootProjection {
                path: path.display().to_string(),
                exists: true,
                state: record.state,
                data_root,
                error,
            })
        }
        Ok(None) => Ok(ProductControlSelectedDataRootProjection {
            path: path.display().to_string(),
            exists: false,
            state: ProductControlState::ConfigMissing,
            data_root: None,
            error: Some(
                "~/.nimi/nimi.json is missing; selected nimi_data is not ready".to_string(),
            ),
        }),
        Err(error) => Ok(ProductControlSelectedDataRootProjection {
            path: path.display().to_string(),
            exists: true,
            state: ProductControlState::RepairRequired,
            data_root: None,
            error: Some(error),
        }),
    }
}

pub fn selected_product_data_root() -> Result<PathBuf, String> {
    if let Some(record) = crate::desktop_e2e_fixture::product_control_record_override()? {
        return selected_data_root_path(&record).ok_or_else(|| {
            "E2E product control override has no selected absolute dataRoot.path".to_string()
        });
    }
    let path = product_control_record_path()?;
    let record = read_existing_record(&path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; selected nimi_data is not ready".to_string()
    })?;
    selected_data_root_path(&record)
        .ok_or_else(|| "~/.nimi/nimi.json has no selected absolute dataRoot.path".to_string())
}
