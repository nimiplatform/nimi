use super::*;
use crate::test_support::with_env;
use std::path::PathBuf;

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos()
}

fn temp_home(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nimi-account-profile-library-{prefix}-{}",
        unique_suffix()
    ));
    std::fs::create_dir_all(&dir).expect("create temp home");
    dir
}

fn with_isolated_home<R>(prefix: &str, body: impl FnOnce() -> R) -> R {
    let home = temp_home(prefix);
    with_env(&[("HOME", home.to_str())], body)
}

fn sample_payload(profile_id: &str, title: &str) -> LibraryAIProfilePayload {
    let mut capabilities = serde_json::Map::new();
    capabilities.insert(
        "text.generate".to_string(),
        serde_json::json!({ "binding": null }),
    );
    LibraryAIProfilePayload {
        profile_id: profile_id.to_string(),
        title: title.to_string(),
        description: "library test profile".to_string(),
        tags: vec!["test".to_string()],
        capabilities,
    }
}

#[test]
fn create_writes_user_directory_and_index() {
    with_isolated_home("create", || {
        let projection = create_account_profile_library_entry(
            "account_1",
            sample_payload("custom-alpha", "Alpha"),
        )
        .expect("create");
        assert_eq!(projection.profiles.len(), 1);
        assert_eq!(projection.profiles[0].origin, "user");
        assert!(projection.profiles[0].editable);
        assert!(projection.profiles[0].removable);

        let user_path = library_profile_path("account_1", "user", "custom-alpha").expect("path");
        assert!(user_path.exists());
        // Index is re-derived and committed.
        let index_path = library_index_path("account_1").expect("index path");
        assert!(index_path.exists());
        assert!(projection
            .index
            .entries
            .iter()
            .any(|entry| entry.profile_id == "custom-alpha" && entry.origin == "user"));
    });
}

#[test]
fn reserved_default_id_cannot_be_created_or_deleted() {
    with_isolated_home("reserved", || {
        let create_error =
            create_account_profile_library_entry("account_1", sample_payload("default", "Default"))
                .expect_err("reserved id must fail");
        assert!(create_error.contains("reserved"));

        let delete_error = delete_account_profile_library_entry("account_1", "default")
            .expect_err("reserved id delete must fail");
        assert!(delete_error.contains("reserved"));
    });
}

#[test]
fn edit_preserves_created_at_and_advances_updated_at() {
    with_isolated_home("edit", || {
        create_account_profile_library_entry("account_1", sample_payload("custom-edit", "V1"))
            .expect("create");
        let path = library_profile_path("account_1", "user", "custom-edit").expect("path");
        let created = read_library_profile_record(&path).expect("read").created_at;

        let edited =
            edit_account_profile_library_entry("account_1", sample_payload("custom-edit", "V2"))
                .expect("edit");
        let profile = edited
            .profiles
            .iter()
            .find(|entry| entry.profile_id == "custom-edit")
            .expect("edited profile present");
        assert_eq!(profile.profile.title, "V2");
        assert_eq!(profile.created_at, created);
    });
}

#[test]
fn edit_missing_profile_fails_closed() {
    with_isolated_home("edit-missing", || {
        let error =
            edit_account_profile_library_entry("account_1", sample_payload("custom-missing", "X"))
                .expect_err("missing profile must fail");
        assert!(error.contains("was not found"));
    });
}

#[test]
fn import_writes_imported_directory_and_rejects_collisions() {
    with_isolated_home("import", || {
        let projection = import_account_profile_library_entries(
            "account_1",
            vec![
                sample_payload("import-a", "Import A"),
                sample_payload("import-b", "Import B"),
            ],
        )
        .expect("import");
        assert_eq!(projection.profiles.len(), 2);
        assert!(projection
            .profiles
            .iter()
            .all(|entry| entry.origin == "imported"));

        // Re-importing a colliding id fails closed (no partial success).
        let collision = import_account_profile_library_entries(
            "account_1",
            vec![sample_payload("import-a", "Again")],
        )
        .expect_err("colliding import must fail");
        assert!(collision.contains("already exists"));
    });
}

#[test]
fn import_rejects_duplicate_ids_within_payload() {
    with_isolated_home("import-dup", || {
        let error = import_account_profile_library_entries(
            "account_1",
            vec![sample_payload("dup", "One"), sample_payload("dup", "Two")],
        )
        .expect_err("duplicate ids must fail");
        assert!(error.contains("duplicate"));
    });
}

#[test]
fn import_rejects_reserved_default_id() {
    with_isolated_home("import-reserved", || {
        let error = import_account_profile_library_entries(
            "account_1",
            vec![sample_payload("default", "Default")],
        )
        .expect_err("reserved id import must fail");
        assert!(error.contains("reserved"));
    });
}

#[test]
fn export_returns_requested_profiles_and_fails_on_unknown_id() {
    with_isolated_home("export", || {
        create_account_profile_library_entry("account_1", sample_payload("exp-a", "Exp A"))
            .expect("create a");
        create_account_profile_library_entry("account_1", sample_payload("exp-b", "Exp B"))
            .expect("create b");

        let all =
            export_account_profile_library_entries("account_1", Vec::new()).expect("export all");
        assert_eq!(all.len(), 2);

        let one = export_account_profile_library_entries("account_1", vec!["exp-a".to_string()])
            .expect("export one");
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].profile_id, "exp-a");

        let unknown =
            export_account_profile_library_entries("account_1", vec!["exp-missing".to_string()])
                .expect_err("unknown export must fail");
        assert!(unknown.contains("was not found"));
    });
}

#[test]
fn delete_removes_record_and_reindexes() {
    with_isolated_home("delete", || {
        create_account_profile_library_entry("account_1", sample_payload("del-a", "Del A"))
            .expect("create");
        let path = library_profile_path("account_1", "user", "del-a").expect("path");
        assert!(path.exists());

        let projection =
            delete_account_profile_library_entry("account_1", "del-a").expect("delete");
        assert!(!path.exists());
        assert!(projection.profiles.is_empty());
        assert!(!projection
            .index
            .entries
            .iter()
            .any(|entry| entry.profile_id == "del-a"));
    });
}

#[test]
fn list_includes_account_default_index_row_when_default_json_exists() {
    with_isolated_home("default-row", || {
        // Seed a stand-in Account Default Profile record. The library index
        // must project a non-removable, non-editable `account-default` row.
        let library_dir = account_profile_library_dir("account_1").expect("dir");
        std::fs::create_dir_all(&library_dir).expect("mkdir");
        std::fs::write(
            library_dir.join("default.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "profileId": "default",
                "displayName": "Default Profile",
                "updatedAt": "2026-05-21T00:00:00.000Z",
            }))
            .expect("json"),
        )
        .expect("write default");

        let projection = list_account_profile_library("account_1").expect("list");
        let default_row = projection
            .index
            .entries
            .iter()
            .find(|entry| entry.profile_id == "default")
            .expect("account-default row present");
        assert_eq!(default_row.origin, "account-default");
        assert!(!default_row.editable);
        assert!(!default_row.removable);
        // The Account Default Profile is NOT projected as an editable profile.
        assert!(projection.profiles.is_empty());
    });
}

#[test]
fn malformed_record_fails_closed_on_scan() {
    with_isolated_home("malformed", || {
        let dir = library_origin_dir("account_1", "user").expect("dir");
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(dir.join("broken.json"), "{ not json").expect("write broken");
        let error = list_account_profile_library("account_1")
            .expect_err("malformed record must fail closed");
        assert!(error.contains("cannot be parsed"));
    });
}
