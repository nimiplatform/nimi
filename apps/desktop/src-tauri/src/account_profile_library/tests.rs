use super::{
    account_default_profile_path, data_root_ref, ensure_account_default_profile,
    verify_account_default_profile_ref, AccountDefaultProfileRecord,
    PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
};
use crate::test_support::with_env;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos()
}

/// Isolated `~/.nimi` control-root home for one test. P-AIPS-013 fixes the
/// Account Default Profile under `~/.nimi/accounts/...`, so the test pins
/// `HOME` to a fresh temp directory before exercising the library.
fn temp_home(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nimi-account-profile-home-{prefix}-{}",
        unique_suffix()
    ));
    std::fs::create_dir_all(&dir).expect("create temp home");
    dir
}

/// Isolated user-selected `nimi_data` DATA root for one test. The data root
/// is only the binding assertion recorded as `dataRootRef`; the Account
/// Default Profile record no longer LIVES under it.
fn temp_data_root(prefix: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("nimi-account-profile-{prefix}-{}", unique_suffix()));
    std::fs::create_dir_all(&dir).expect("create temp data root");
    dir
}

/// Run `body` with `HOME` pinned to a fresh control-root home so
/// `account_default_profile_path` resolves `<home>/.nimi/accounts/...`.
fn with_isolated_home<R>(prefix: &str, body: impl FnOnce(&Path) -> R) -> R {
    let home = temp_home(prefix);
    with_env(&[("HOME", home.to_str())], || body(&home))
}

fn read_record(path: &std::path::Path) -> AccountDefaultProfileRecord {
    serde_json::from_str(&std::fs::read_to_string(path).expect("read account default profile"))
        .expect("parse account default profile")
}

fn write_record(path: &std::path::Path, record: &AccountDefaultProfileRecord) {
    std::fs::write(path, serde_json::to_string_pretty(record).expect("json")).expect("write");
}

fn write_json(path: &std::path::Path, value: serde_json::Value) {
    std::fs::write(path, serde_json::to_string_pretty(&value).expect("json")).expect("write json");
}

fn refresh_content_hash(record: &mut AccountDefaultProfileRecord) {
    record.content_hash = super::compute_record_hash(record).expect("content hash");
}

fn apply_local_payload_change(
    record: &mut AccountDefaultProfileRecord,
    revision_kind: &str,
    title: &str,
) {
    let previous_hash = record.content_hash.clone();
    record.profile.ai_profile_version += 1;
    record.updated_at = format!(
        "2026-05-20T00:00:0{}.000Z",
        record.profile.ai_profile_version
    );
    record.profile.payload.title = title.to_string();
    record
        .profile
        .payload
        .tags
        .push("locally-edited".to_string());
    record.profile.payload_hash = super::stable_json_hash(
        &record.profile.payload,
        "Account Default Profile AIProfile payload",
    )
    .expect("payload hash");
    record.profile_revision = super::AccountDefaultProfileRevisionProvenance {
        revision_kind: revision_kind.to_string(),
        source: super::ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE.to_string(),
        previous_content_hash: Some(previous_hash),
        changed_at: record.updated_at.clone(),
    };
    refresh_content_hash(record);
}

#[test]
fn creates_default_profile_under_nimi_control_root_accounts() {
    with_isolated_home("create", |home| {
        // P-AIPS-013: the Account Default Profile lives under the `~/.nimi`
        // CONTROL root, not under the user-selected `nimi_data` DATA root.
        let root = temp_data_root("create");
        let evidence = ensure_account_default_profile(
            &root,
            "account:abc.def+1",
            "local-speech-ready",
            "minimal",
        )
        .expect("ensure profile");
        assert_eq!(evidence.profile_id, "default");
        assert_eq!(evidence.account_id, "account:abc.def+1");
        assert_eq!(
            evidence.data_root_ref,
            data_root_ref(&root).expect("data root ref")
        );
        let profile_path = account_default_profile_path("account:abc.def+1").expect("profile path");
        // The record resolves under `~/.nimi/accounts/...`, never the data root.
        assert!(profile_path.starts_with(home.join(".nimi").join("accounts")));
        assert!(!profile_path.starts_with(&root));
        assert!(profile_path.exists());
        let record = read_record(&profile_path);
        // Manual-named conformant fields.
        assert_eq!(record.profile_id, "default");
        assert_eq!(record.display_name, "Default Profile");
        assert!(record.editable);
        assert!(!record.removable);
        assert_eq!(record.source.kind, "factory-policy");
        assert_eq!(
            record.source.policy_ref,
            super::PLATFORM_AI_PROFILE_SELECTION_POLICY_REF
        );
        assert_eq!(
            record.source.catalog_version,
            PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION
        );
        assert_eq!(record.profile.ai_profile_version, 1);
        assert_eq!(record.profile.payload.profile_id, "default");
        assert!(record
            .profile
            .payload
            .capabilities
            .contains_key("text.generate"));
        assert_eq!(record.profile.payload, record.factory_seed_profile_payload);
        assert_eq!(
            record.profile.payload_hash,
            record.factory_seed_profile_payload_hash
        );
        assert_eq!(record.profile_revision.revision_kind, "factory_seed");
        // dataRootRef stays recorded inside the record as the binding
        // assertion, even though the record no longer LIVES under it.
        assert_eq!(
            record.data_root_ref,
            data_root_ref(&root).expect("data root ref")
        );
        assert_eq!(
            record.factory_provenance.source_catalog_id,
            super::PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID
        );
        assert_eq!(
            record.factory_provenance.source_policy_ref,
            super::PLATFORM_AI_PROFILE_SELECTION_POLICY_REF
        );
        assert_eq!(
            record.factory_provenance.ai_profile_alias,
            "local-speech-ready"
        );
        assert!(!record
            .factory_provenance
            .host_capability_profile_refs
            .is_empty());
        assert!(!record.factory_provenance.local_compute_pack_refs.is_empty());
        assert!(!record.factory_provenance.dependency_family_refs.is_empty());
    });
}

#[test]
fn restores_existing_valid_profile_without_overwriting_for_new_selection() {
    with_isolated_home("restore", |_home| {
        let root = temp_data_root("restore");
        let first =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("first ensure");
        let path = account_default_profile_path("account_1").expect("profile path");
        let mut edited_record = read_record(&path);
        apply_local_payload_change(
            &mut edited_record,
            super::PROFILE_REVISION_LOCAL_EDIT,
            "Edited Before Catalog Selection Change",
        );
        write_record(&path, &edited_record);
        let edited_evidence =
            super::evidence_from_record(&path, &edited_record).expect("edited evidence");
        let raw_before = std::fs::read_to_string(&path).expect("read before");
        let restored =
            ensure_account_default_profile(&root, "account_1", "local-gpu", "recommended")
                .expect("restore existing");
        let raw_after = std::fs::read_to_string(&path).expect("read after");
        assert_eq!(
            restored.account_default_profile_ref,
            edited_evidence.account_default_profile_ref
        );
        assert_ne!(
            restored.account_default_profile_ref,
            first.account_default_profile_ref
        );
        assert_eq!(raw_after, raw_before);
    });
}

#[test]
fn verifier_rejects_missing_string_only_wrong_account_and_wrong_data_root_refs() {
    with_isolated_home("negative", |_home| {
        let root = temp_data_root("negative");
        let missing = verify_account_default_profile_ref(
            &root,
            "account_1",
            "account-default-profile:v1:string-only",
        )
        .expect_err("missing profile must fail");
        assert!(missing.contains("missing or unreadable"));

        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let string_only = verify_account_default_profile_ref(
            &root,
            "account_1",
            "account-default-profile:v1:string-only",
        )
        .expect_err("string-only ref must fail");
        assert!(string_only.contains("string-only"));

        // Wrong account resolves to a different `~/.nimi/accounts/<id>`
        // directory, so the record is missing for that account.
        let wrong_account = verify_account_default_profile_ref(
            &root,
            "account_2",
            &evidence.account_default_profile_ref,
        )
        .expect_err("wrong account must fail");
        assert!(wrong_account.contains("missing or unreadable"));

        // The record path is keyed off the `~/.nimi` control root, not the
        // data root, so a different selected data root reaches the same
        // record file — the recorded `dataRootRef` binding assertion must
        // still fail closed against the mismatched selected data root.
        let other_root = temp_data_root("other-root");
        let wrong_root = verify_account_default_profile_ref(
            &other_root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("wrong root must fail");
        assert!(wrong_root.contains("dataRootRef does not match"));
    });
}

#[test]
fn verifier_rejects_realm_token_shaped_refs_as_account_default_profile_truth() {
    // product-control-record-schema.yaml accountDefaultProfileRef
    // forbidden_as_truth: realm_oauth_token, realm_profile_projection,
    // subject_user_id, decoded_token_claims. None of these are a durable
    // local Account Default Profile library ref. With a valid library
    // record already seeded, each realm-token-shaped value must still be
    // rejected as caller-provided / not owner-minted — a realm session
    // artifact is never product readiness truth.
    with_isolated_home("realm-token-negative", |_home| {
        let root = temp_data_root("realm-token-negative");
        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        // sanity: the owner-minted ref still verifies.
        verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect("owner-minted ref verifies");

        let realm_token_shaped_refs = [
            // realm_oauth_token — a JWT-shaped bearer string.
            "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhY2NvdW50XzEifQ.c2lnbmF0dXJl",
            // realm_profile_projection — a realm-side profile projection blob.
            "realm-profile-projection:account_1:displayName=Nimi",
            // subject_user_id — the decoded token subject claim.
            "account_1",
            // decoded_token_claims — a serialized claims object.
            "{\"sub\":\"account_1\",\"scope\":\"realm.profile\"}",
        ];
        for realm_ref in realm_token_shaped_refs {
            let error = verify_account_default_profile_ref(&root, "account_1", realm_ref)
                .expect_err("realm-token-shaped ref must be rejected as truth");
            assert!(
                error.contains("caller-provided, stale, or string-only"),
                "realm-token-shaped ref {realm_ref} routed unexpected error: {error}"
            );
        }
    });
}

#[test]
fn verifier_rejects_source_and_hash_tampering() {
    with_isolated_home("tamper", |_home| {
        let root = temp_data_root("tamper");
        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let path = account_default_profile_path("account_1").expect("profile path");

        let mut record = read_record(&path);
        record.source.policy_ref.clear();
        write_record(&path, &record);
        let source_policy = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("source policy must fail");
        assert!(source_policy.contains("source policy"));

        ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
            .expect_err("invalid existing profile must fail closed instead of overwrite");
        let mut record = read_record(&path);
        record.source.policy_ref = super::PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string();
        record.source.catalog_version = PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION + 1;
        write_record(&path, &record);
        let source_catalog = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("source catalog must fail");
        assert!(source_catalog.contains("source catalog"));

        let mut record = read_record(&path);
        record.source.catalog_version = PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION;
        record.content_hash = "sha256:bad".to_string();
        write_record(&path, &record);
        let hash = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("hash must fail");
        assert!(hash.contains("content hash"));
    });
}

#[test]
fn verifier_rejects_missing_payload_payload_hash_mismatch_and_missing_provenance() {
    with_isolated_home("payload-negative", |_home| {
        let root = temp_data_root("payload-negative");
        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let path = account_default_profile_path("account_1").expect("profile path");
        let valid_record = read_record(&path);

        // The manual-conformant record nests the AIProfile payload inside
        // the `profile` object; removing it makes the named `profile`
        // object itself absent.
        let mut missing_payload = serde_json::to_value(&valid_record).expect("record json");
        missing_payload
            .as_object_mut()
            .expect("object")
            .remove("profile");
        write_json(&path, missing_payload);
        let missing_payload_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("missing profile payload must fail");
        assert!(
            missing_payload_error.contains("profile")
                || missing_payload_error.contains("cannot be parsed")
        );

        let mut payload_hash_mismatch = valid_record.clone();
        payload_hash_mismatch.profile.payload_hash = "sha256:bad".to_string();
        refresh_content_hash(&mut payload_hash_mismatch);
        write_record(&path, &payload_hash_mismatch);
        let payload_hash_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("payload hash mismatch must fail");
        assert!(payload_hash_error.contains("profile payload hash"));

        let mut missing_provenance = serde_json::to_value(&valid_record).expect("record json");
        missing_provenance
            .as_object_mut()
            .expect("object")
            .remove("factoryProvenance");
        write_json(&path, missing_provenance);
        let missing_provenance_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("missing provenance must fail");
        assert!(
            missing_provenance_error.contains("factoryProvenance")
                || missing_provenance_error.contains("cannot be parsed")
        );

        let mut provenance_hash_mismatch = valid_record.clone();
        provenance_hash_mismatch.factory_provenance_hash = "sha256:bad".to_string();
        refresh_content_hash(&mut provenance_hash_mismatch);
        write_record(&path, &provenance_hash_mismatch);
        let provenance_hash_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("provenance hash mismatch must fail");
        assert!(provenance_hash_error.contains("factory provenance hash"));

        let mut malformed_payload = valid_record.clone();
        malformed_payload.profile.payload.title.clear();
        malformed_payload.profile.payload_hash = super::stable_json_hash(
            &malformed_payload.profile.payload,
            "Account Default Profile AIProfile payload",
        )
        .expect("payload hash");
        refresh_content_hash(&mut malformed_payload);
        write_record(&path, &malformed_payload);
        let malformed_payload_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("malformed payload must fail");
        assert!(malformed_payload_error.contains("payload title"));
    });
}

#[test]
fn locally_edited_payload_verifies_with_revision_provenance_and_hashes() {
    with_isolated_home("payload-seed", |_home| {
        let root = temp_data_root("payload-seed");
        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let path = account_default_profile_path("account_1").expect("profile path");
        let mut record = read_record(&path);
        assert_eq!(record.profile.payload, record.factory_seed_profile_payload);
        apply_local_payload_change(
            &mut record,
            super::PROFILE_REVISION_LOCAL_EDIT,
            "Edited Local Default",
        );
        assert_ne!(record.profile.payload, record.factory_seed_profile_payload);
        assert_eq!(record.profile.ai_profile_version, 2);
        assert_eq!(record.profile_revision.revision_kind, "local_edit");
        write_record(&path, &record);
        let edited_evidence = super::evidence_from_record(&path, &record).expect("edited evidence");

        verify_account_default_profile_ref(
            &root,
            "account_1",
            &edited_evidence.account_default_profile_ref,
        )
        .expect("edited payload verifies");
        assert_ne!(
            edited_evidence.account_default_profile_ref,
            evidence.account_default_profile_ref
        );
    });
}

#[test]
fn replacing_account_default_profile_does_not_mutate_scope_bound_ai_config_fixture() {
    with_isolated_home("aiconfig-isolation", |_home| {
        let root = temp_data_root("aiconfig-isolation");
        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let ai_config = serde_json::json!({
            "schemaVersion": 1,
            "scopeRef": {
                "kind": "feature",
                "ownerId": "desktop.chat",
                "surfaceId": "nimi"
            },
            "aiProfileRef": "factory:local-speech-ready",
            "aiConfigVersion": 7,
            "routeIntent": {
                "text.generate": {
                    "binding": null
                }
            }
        });
        let ai_config_before = ai_config.clone();
        let ai_config_path = root.join("scope-bound-aiconfig.json");
        write_json(&ai_config_path, ai_config.clone());
        let ai_config_raw_before = std::fs::read_to_string(&ai_config_path).expect("ai config");

        let path = account_default_profile_path("account_1").expect("profile path");
        let mut replacement = read_record(&path);
        apply_local_payload_change(
            &mut replacement,
            super::PROFILE_REVISION_LOCAL_REPLACEMENT,
            "Replacement Local Default",
        );
        write_record(&path, &replacement);
        let replacement_evidence =
            super::evidence_from_record(&path, &replacement).expect("replacement evidence");
        verify_account_default_profile_ref(
            &root,
            "account_1",
            &replacement_evidence.account_default_profile_ref,
        )
        .expect("replacement verifies");
        assert_ne!(
            replacement_evidence.account_default_profile_ref,
            evidence.account_default_profile_ref
        );

        assert_eq!(ai_config, ai_config_before);
        assert_eq!(
            std::fs::read_to_string(&ai_config_path).expect("ai config after"),
            ai_config_raw_before
        );
    });
}
