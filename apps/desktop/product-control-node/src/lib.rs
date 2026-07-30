use napi_derive::napi;
use nimi_desktop_product_control_core::{
    account_profile_library, account_profile_library::LibraryAIProfilePayload,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryInput {
    data_root: String,
    account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryEntryInput {
    data_root: String,
    account_id: String,
    profile: LibraryAIProfilePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryImportInput {
    data_root: String,
    account_id: String,
    profiles: Vec<LibraryAIProfilePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryExportInput {
    data_root: String,
    account_id: String,
    #[serde(default)]
    profile_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryDeleteInput {
    data_root: String,
    account_id: String,
    profile_id: String,
}

#[napi(js_name = "listAccountProfileLibrary")]
pub fn list_account_profile_library(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryInput = parse(input)?;
        account_profile_library::list_account_profile_library(
            Path::new(&input.data_root),
            &input.account_id,
        )
    })
}

#[napi(js_name = "createAccountProfileLibraryProfile")]
pub fn create_account_profile_library_profile(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryEntryInput = parse(input)?;
        account_profile_library::create_account_profile_library_entry(
            Path::new(&input.data_root),
            &input.account_id,
            input.profile,
        )
    })
}

#[napi(js_name = "editAccountProfileLibraryProfile")]
pub fn edit_account_profile_library_profile(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryEntryInput = parse(input)?;
        account_profile_library::edit_account_profile_library_entry(
            Path::new(&input.data_root),
            &input.account_id,
            input.profile,
        )
    })
}

#[napi(js_name = "importAccountProfileLibraryProfiles")]
pub fn import_account_profile_library_profiles(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryImportInput = parse(input)?;
        account_profile_library::import_account_profile_library_entries(
            Path::new(&input.data_root),
            &input.account_id,
            input.profiles,
        )
    })
}

#[napi(js_name = "exportAccountProfileLibraryProfiles")]
pub fn export_account_profile_library_profiles(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryExportInput = parse(input)?;
        account_profile_library::export_account_profile_library_entries(
            Path::new(&input.data_root),
            &input.account_id,
            input.profile_ids,
        )
    })
}

#[napi(js_name = "deleteAccountProfileLibraryProfile")]
pub fn delete_account_profile_library_profile(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryDeleteInput = parse(input)?;
        account_profile_library::delete_account_profile_library_entry(
            Path::new(&input.data_root),
            &input.account_id,
            &input.profile_id,
        )
    })
}

fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("desktop-account-profile-library-input-invalid: {error}"))
}

fn library_outcome<T: serde::Serialize>(operation: impl FnOnce() -> Result<T, String>) -> Value {
    match operation() {
        Ok(value) => json!({ "status": "ok", "value": value }),
        Err(error) => json!({
            "status": "error",
            "reasonCode": if error.contains("desktop-account-profile-library-input-invalid") {
                "desktop-account-profile-library-input-invalid"
            } else {
                "desktop-account-profile-library-invalid"
            },
            "retryable": false,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn data_root(label: &str) -> String {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nimi-product-control-node-{label}-{suffix}"));
        std::fs::create_dir_all(&path).expect("create data root");
        path.to_string_lossy().into_owned()
    }

    fn profile(profile_id: &str, title: &str) -> Value {
        json!({
            "profileId": profile_id,
            "version": "v1",
            "title": title,
            "description": "native binding profile",
            "tags": ["test"],
            "capabilities": {
                "text.generate": {
                    "readinessPolicy": "required",
                    "contractState": "proposed"
                }
            }
        })
    }

    fn ok_value(outcome: Value) -> Value {
        assert_eq!(outcome["status"], "ok");
        outcome["value"].clone()
    }

    #[test]
    fn account_profile_library_native_binding_runs_complete_lifecycle() {
        let root = data_root("lifecycle");
        let base = || json!({ "dataRoot": root, "accountId": "account-a" });

        let listed = ok_value(list_account_profile_library(base()));
        assert_eq!(listed["profiles"].as_array().expect("profiles").len(), 0);
        assert_eq!(listed["libraryRef"], "account-profile-library:account-a");

        let created = ok_value(create_account_profile_library_profile(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profile": profile("created", "Created")
        })));
        assert_eq!(created["profiles"][0]["profile"]["title"], "Created");

        let edited = ok_value(edit_account_profile_library_profile(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profile": profile("created", "Edited")
        })));
        assert_eq!(edited["profiles"][0]["profile"]["title"], "Edited");

        let imported = ok_value(import_account_profile_library_profiles(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profiles": [profile("imported", "Imported")]
        })));
        assert_eq!(imported["profiles"].as_array().expect("profiles").len(), 2);

        let exported = ok_value(export_account_profile_library_profiles(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profileIds": ["created", "imported"]
        })));
        assert_eq!(exported.as_array().expect("exported profiles").len(), 2);

        let deleted = ok_value(delete_account_profile_library_profile(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profileId": "created"
        })));
        assert_eq!(deleted["profiles"].as_array().expect("profiles").len(), 1);
    }

    #[test]
    fn account_profile_library_native_binding_rejects_unknown_fields() {
        let root = data_root("strict");
        let outcome = create_account_profile_library_profile(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profile": {
                "profileId": "bad",
                "title": "Bad",
                "description": "bad",
                "tags": [],
                "capabilities": {},
                "rendererOwnedState": true
            }
        }));
        assert_eq!(outcome["status"], "error");
        assert_eq!(
            outcome["reasonCode"],
            "desktop-account-profile-library-input-invalid"
        );
    }
}
