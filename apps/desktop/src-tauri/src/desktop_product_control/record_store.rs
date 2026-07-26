//! Product-control record helpers shared by the Runtime projection adapters.

use crate::desktop_paths::normalize_desktop_absolute_path;
use std::path::PathBuf;

use super::record::{
    ProductControlRecord, ProductControlRecordProjection, ProductControlState,
    ProductDataRootStatus,
};

pub(crate) fn usable_product_control_record_for(
    projection: ProductControlRecordProjection,
    action: &str,
) -> Result<ProductControlRecord, String> {
    if !projection.exists
        || projection.error.is_some()
        || matches!(
            projection.state,
            ProductControlState::ConfigMissing
                | ProductControlState::DataRootMissing
                | ProductControlState::RepairRequired
                | ProductControlState::Blocked
        )
    {
        return Err(format!(
            "Product Control projection is unusable before {action}"
        ));
    }
    let record = projection
        .record
        .ok_or_else(|| format!("product-control record is required before {action}"))?;
    if record.repair.required
        || matches!(
            &record.state,
            ProductControlState::RepairRequired | ProductControlState::Blocked
        )
    {
        return Err(format!(
            "Product Control projection is unusable before {action}"
        ));
    }
    Ok(record)
}

pub(crate) fn selected_data_root_path(record: &ProductControlRecord) -> Option<PathBuf> {
    if record.repair.required
        || matches!(
            &record.state,
            ProductControlState::RepairRequired | ProductControlState::Blocked
        )
    {
        return None;
    }
    let data_root = record.data_root.as_ref()?;
    if !matches!(
        &data_root.status,
        ProductDataRootStatus::Selected | ProductDataRootStatus::Ready
    ) {
        return None;
    }
    let value = data_root.path.trim();
    if value.is_empty() {
        return None;
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return None;
    }
    Some(normalize_desktop_absolute_path(&path))
}

#[cfg(test)]
mod tests {
    use super::{selected_data_root_path, usable_product_control_record_for};
    use crate::desktop_product_control::{
        ProductControlRecord, ProductControlRecordProjection, ProductControlState,
    };

    fn repair_record(must_not_use: &std::path::Path) -> ProductControlRecord {
        serde_json::from_value::<ProductControlRecord>(serde_json::json!({
            "schemaVersion": 1,
            "installId": "install-repair",
            "productVersion": "1",
            "state": "repair_required",
            "dataRoot": {
                "path": must_not_use,
                "status": "repair_required",
                "selectedAt": "2026-07-26T00:00:00.000Z",
                "verifiedAt": "2026-07-26T00:00:00.000Z",
                "selectedAtUnixMs": 1,
                "verifiedAtUnixMs": 1
            },
            "firstRun": {
                "installLevel": "minimal",
                "aiProfileAlias": "local-speech-ready",
                "completed": false,
                "builtInAiConfigRefs": []
            },
            "pointers": {},
            "repair": {
                "required": true,
                "reason": "derived state requires repair"
            }
        }))
        .expect("repair fixture")
    }

    #[test]
    fn repair_required_record_does_not_expose_data_root_path() {
        let must_not_use = std::env::temp_dir().join("MustNotUse");
        let record = repair_record(&must_not_use);

        assert!(
            selected_data_root_path(&record).is_none(),
            "repair-required record exposed {}",
            must_not_use.display()
        );
    }

    #[test]
    fn repair_projection_is_rejected_before_record_use() {
        let must_not_use = std::env::temp_dir().join("MustNotUse");
        let projection = ProductControlRecordProjection {
            path: std::env::temp_dir()
                .join(".nimi")
                .join("nimi.json")
                .display()
                .to_string(),
            exists: true,
            state: ProductControlState::RepairRequired,
            record: Some(repair_record(&must_not_use)),
            error: Some("Product Control requires repair".to_string()),
        };

        let error = usable_product_control_record_for(projection, "ready admission")
            .expect_err("repair projection must fail closed");
        assert!(error.contains("projection is unusable"));
    }
}
