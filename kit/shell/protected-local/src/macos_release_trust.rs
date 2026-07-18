use std::collections::BTreeSet;
use std::ffi::CString;
use std::fs;
use std::fs::OpenOptions;
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};

const RECORD_SCHEMA_VERSION: u64 = 1;
const RECORD_MAX_BYTES: u64 = 64 * 1024;
const RECORD_ROOT: &str = "/Library/Application Support/Nimi/Runtime/trust/protected-local/v1";
const ENVIRONMENT: &str = "production";
const OS_PROFILE: &str = "macos";
const PROTOCOL_VERSION: &str = "1";
const SIGNER_POLICY_ID: &str = "nimi-production-release-signing-policy";

const ROOT_KEY_ID: Option<&str> = option_env!("NIMI_PLATFORM_RELEASE_ROOT_KEY_ID");
const ROOT_PUBLIC_KEY_B64URL: Option<&str> =
    option_env!("NIMI_PLATFORM_RELEASE_ROOT_PUBLIC_KEY_B64URL");

#[derive(Clone, Copy)]
pub(super) struct MacOSRoleRequirements {
    pub role: &'static str,
    pub trust_set_id: &'static str,
    pub signing_identifier: &'static str,
    pub service_principal: &'static str,
    pub record_filename: &'static str,
}

pub(super) const RUNTIME_ROLE: MacOSRoleRequirements = MacOSRoleRequirements {
    role: "nimi_runtime_service",
    trust_set_id: "nimi-runtime-production-v1",
    signing_identifier: "ai.nimi.runtime",
    service_principal: "_nimiruntime",
    record_filename: "nimi_runtime_service.release-trust-record.json",
};

pub(super) const DESKTOP_ROLE: MacOSRoleRequirements = MacOSRoleRequirements {
    role: "nimi_desktop",
    trust_set_id: "nimi-desktop-production-v1",
    signing_identifier: "ai.nimi.apps.nimi.desktop",
    service_principal: "active_console_user",
    record_filename: "nimi_desktop.release-trust-record.json",
};

#[derive(Clone, Debug)]
pub(super) struct VerifiedMacOSReleaseTrust {
    pub release_id: String,
    pub compatible_peer_release_ids: Vec<String>,
    pub generation: u64,
    pub artifact_sha256: String,
    pub designated_requirement: String,
    pub team_id: String,
    pub cdhash: String,
    pub signing_identifier: &'static str,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReleaseTrustRecord {
    schema_version: u64,
    environment: String,
    executable_role: String,
    trust_set_id: String,
    os_profile: String,
    protected_local_protocol_version: String,
    compatible_peer_release_ids: Vec<String>,
    release_id: String,
    build_id: String,
    artifact_sha256: String,
    signer_policy_id: String,
    windows_leaf_spki_sha256: String,
    windows_chain_policy_ref: String,
    macos_designated_requirement: String,
    macos_team_id: String,
    macos_cdhash: String,
    linux_manifest_key_id: String,
    os_service_principal: String,
    valid_from: String,
    expires_at: String,
    generation: u64,
    root_key_id: String,
    signature: String,
}

unsafe extern "C" {
    fn nimi_macos_verify_outer_bundle(
        expected_requirement: *const std::ffi::c_char,
        expected_team: *const std::ffi::c_char,
        expected_identifier: *const std::ffi::c_char,
    ) -> i32;
}

pub(super) fn load_release_trust(
    requirements: MacOSRoleRequirements,
) -> Result<VerifiedMacOSReleaseTrust, ProtectedCarrierError> {
    let root_key_id = ROOT_KEY_ID
        .filter(|value| valid_release_text(value, 128))
        .ok_or_else(untrusted)?;
    let root_key = decode_root_key(ROOT_PUBLIC_KEY_B64URL.ok_or_else(untrusted)?)?;
    let record = load_verified_role_record(requirements, root_key_id, &root_key)?;
    let desktop_record = if requirements.role == DESKTOP_ROLE.role {
        record.clone()
    } else {
        load_verified_role_record(DESKTOP_ROLE, root_key_id, &root_key)?
    };
    verify_outer_bundle_seal(
        &desktop_record.designated_requirement,
        &desktop_record.team_id,
        desktop_record.signing_identifier,
    )?;
    Ok(record)
}

fn load_verified_role_record(
    requirements: MacOSRoleRequirements,
    root_key_id: &str,
    root_key: &[u8; 32],
) -> Result<VerifiedMacOSReleaseTrust, ProtectedCarrierError> {
    let path = Path::new(RECORD_ROOT).join(requirements.record_filename);
    let encoded = read_fixed_record(&path, requirements.record_filename)?;
    verify_release_trust_record(
        &encoded,
        requirements,
        root_key_id,
        root_key,
        OffsetDateTime::now_utc(),
    )
}

pub(super) fn require_mutual_compatibility(
    left: &VerifiedMacOSReleaseTrust,
    right: &VerifiedMacOSReleaseTrust,
) -> Result<(), ProtectedCarrierError> {
    if left.release_id.is_empty()
        || right.release_id.is_empty()
        || left
            .compatible_peer_release_ids
            .binary_search(&right.release_id)
            .is_err()
        || right
            .compatible_peer_release_ids
            .binary_search(&left.release_id)
            .is_err()
    {
        return Err(untrusted());
    }
    Ok(())
}

fn verify_outer_bundle_seal(
    designated_requirement: &str,
    team_id: &str,
    signing_identifier: &str,
) -> Result<(), ProtectedCarrierError> {
    let requirement = CString::new(designated_requirement).map_err(|_| untrusted())?;
    let team = CString::new(team_id).map_err(|_| untrusted())?;
    let identifier = CString::new(signing_identifier).map_err(|_| untrusted())?;
    // SAFETY: all pointers are valid NUL-terminated strings for this call. The
    // native function performs a read-only Security.framework validation of
    // the installer-fixed application path and does not retain them.
    if unsafe {
        nimi_macos_verify_outer_bundle(requirement.as_ptr(), team.as_ptr(), identifier.as_ptr())
    } != 0
    {
        return Err(untrusted());
    }
    Ok(())
}

fn read_fixed_record(
    path: &Path,
    expected_filename: &str,
) -> Result<Vec<u8>, ProtectedCarrierError> {
    let expected = Path::new(RECORD_ROOT).join(expected_filename);
    if path != expected
        || path.file_name().and_then(|value| value.to_str()) != Some(expected_filename)
    {
        return Err(untrusted());
    }
    let library = Path::new("/Library");
    let relative = path.strip_prefix(library).map_err(|_| untrusted())?;
    let components = relative.components().collect::<Vec<_>>();
    let mut current = PathBuf::from(library);
    for (index, component) in components.iter().enumerate() {
        current.push(component);
        let metadata = fs::symlink_metadata(&current).map_err(|_| untrusted())?;
        let last = index + 1 == components.len();
        if metadata.file_type().is_symlink()
            || metadata.uid() != 0
            || metadata.gid() != 0
            || (!last
                && (!metadata.is_dir() || metadata.mode() & 0o777 != 0o755 || metadata.nlink() < 2))
            || (last
                && (!metadata.is_file()
                    || metadata.mode() & 0o777 != 0o644
                    || metadata.nlink() != 1))
        {
            return Err(untrusted());
        }
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| untrusted())?;
    let metadata = file.metadata().map_err(|_| untrusted())?;
    let linked = fs::symlink_metadata(path).map_err(|_| untrusted())?;
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.gid() != 0
        || metadata.mode() & 0o777 != 0o644
        || metadata.nlink() != 1
        || metadata.len() == 0
        || metadata.len() > RECORD_MAX_BYTES
        || linked.file_type().is_symlink()
        || linked.dev() != metadata.dev()
        || linked.ino() != metadata.ino()
    {
        return Err(untrusted());
    }
    let mut encoded = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take(RECORD_MAX_BYTES + 1)
        .read_to_end(&mut encoded)
        .map_err(|_| untrusted())?;
    if encoded.is_empty() || encoded.len() as u64 > RECORD_MAX_BYTES {
        return Err(untrusted());
    }
    Ok(encoded)
}

fn verify_release_trust_record(
    encoded: &[u8],
    requirements: MacOSRoleRequirements,
    root_key_id: &str,
    root_key: &[u8; 32],
    now: OffsetDateTime,
) -> Result<VerifiedMacOSReleaseTrust, ProtectedCarrierError> {
    let mut value: Value = serde_json::from_slice(encoded).map_err(|_| untrusted())?;
    let canonical = serde_jcs::to_vec(&value).map_err(|_| untrusted())?;
    if canonical != encoded {
        return Err(untrusted());
    }
    let record: ReleaseTrustRecord =
        serde_json::from_value(value.clone()).map_err(|_| untrusted())?;
    let object = value.as_object_mut().ok_or_else(untrusted)?;
    let signature_value = object.remove("signature").ok_or_else(untrusted)?;
    if signature_value.as_str() != Some(record.signature.as_str()) {
        return Err(untrusted());
    }
    let payload = serde_jcs::to_vec(&value).map_err(|_| untrusted())?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(record.signature.as_bytes())
        .map_err(|_| untrusted())?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| untrusted())?;
    let key = VerifyingKey::from_bytes(root_key).map_err(|_| untrusted())?;
    key.verify_strict(&payload, &signature)
        .map_err(|_| untrusted())?;
    validate_record(&record, requirements, root_key_id, now)?;
    Ok(VerifiedMacOSReleaseTrust {
        release_id: record.release_id,
        compatible_peer_release_ids: record.compatible_peer_release_ids,
        generation: record.generation,
        artifact_sha256: record.artifact_sha256,
        designated_requirement: record.macos_designated_requirement,
        team_id: record.macos_team_id,
        cdhash: record.macos_cdhash,
        signing_identifier: requirements.signing_identifier,
    })
}

fn validate_record(
    record: &ReleaseTrustRecord,
    requirements: MacOSRoleRequirements,
    root_key_id: &str,
    now: OffsetDateTime,
) -> Result<(), ProtectedCarrierError> {
    if record.schema_version != RECORD_SCHEMA_VERSION
        || record.environment != ENVIRONMENT
        || record.executable_role != requirements.role
        || record.trust_set_id != requirements.trust_set_id
        || record.os_profile != OS_PROFILE
        || record.protected_local_protocol_version != PROTOCOL_VERSION
        || record.signer_policy_id != SIGNER_POLICY_ID
        || record.root_key_id != root_key_id
        || record.os_service_principal != requirements.service_principal
        || record.generation == 0
        || !record.windows_leaf_spki_sha256.is_empty()
        || !record.windows_chain_policy_ref.is_empty()
        || !record.linux_manifest_key_id.is_empty()
        || !valid_release_text(&record.release_id, 128)
        || !valid_release_text(&record.build_id, 128)
        || !valid_sha256(&record.artifact_sha256)
        || !valid_team_id(&record.macos_team_id)
        || !valid_requirement(&record.macos_designated_requirement)
        || !valid_cdhash(&record.macos_cdhash)
    {
        return Err(untrusted());
    }
    if record.compatible_peer_release_ids.is_empty()
        || record.compatible_peer_release_ids.len() > 16
        || record
            .compatible_peer_release_ids
            .iter()
            .any(|value| !valid_release_text(value, 128))
    {
        return Err(untrusted());
    }
    let peers = record
        .compatible_peer_release_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if peers.len() != record.compatible_peer_release_ids.len()
        || !record
            .compatible_peer_release_ids
            .windows(2)
            .all(|window| window[0] < window[1])
    {
        return Err(untrusted());
    }
    let valid_from =
        OffsetDateTime::parse(&record.valid_from, &Rfc3339).map_err(|_| untrusted())?;
    let expires_at =
        OffsetDateTime::parse(&record.expires_at, &Rfc3339).map_err(|_| untrusted())?;
    if valid_from >= expires_at || now < valid_from || now >= expires_at {
        return Err(untrusted());
    }
    Ok(())
}

fn decode_root_key(encoded: &str) -> Result<[u8; 32], ProtectedCarrierError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded.as_bytes())
        .map_err(|_| untrusted())?;
    bytes.try_into().map_err(|_| untrusted())
}

fn valid_release_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value.trim() == value
        && value
            .bytes()
            .all(|byte| (0x21..=0x7e).contains(&byte) && byte != b'/' && byte != b'\\')
}

fn valid_team_id(value: &str) -> bool {
    value.len() == 10
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn valid_requirement(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 2048
        && value.trim() == value
        && value
            .bytes()
            .all(|byte| byte == b' ' || (0x21..=0x7e).contains(&byte))
}

fn valid_cdhash(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && valid_lower_hex(value)
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && valid_lower_hex(value)
}

fn valid_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;

    fn signed_record(signing: &SigningKey) -> Vec<u8> {
        let mut value = json!({
            "schema_version": 1,
            "environment": "production",
            "executable_role": "nimi_runtime_service",
            "trust_set_id": "nimi-runtime-production-v1",
            "os_profile": "macos",
            "protected_local_protocol_version": "1",
            "compatible_peer_release_ids": ["desktop-2026.07"],
            "release_id": "runtime-2026.07",
            "build_id": "runtime-build-1",
            "artifact_sha256": "11".repeat(32),
            "signer_policy_id": "nimi-production-release-signing-policy",
            "windows_leaf_spki_sha256": "",
            "windows_chain_policy_ref": "",
            "macos_designated_requirement": r#"identifier "ai.nimi.runtime" and anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345""#,
            "macos_team_id": "ABCDE12345",
            "macos_cdhash": "22".repeat(20),
            "linux_manifest_key_id": "",
            "os_service_principal": "_nimiruntime",
            "valid_from": "2026-07-01T00:00:00Z",
            "expires_at": "2026-08-01T00:00:00Z",
            "generation": 7,
            "root_key_id": "platform-release-root-fixture-v1"
        });
        let payload = serde_jcs::to_vec(&value).expect("canonical payload");
        let signature = signing.sign(&payload);
        value.as_object_mut().expect("object").insert(
            "signature".to_string(),
            Value::String(URL_SAFE_NO_PAD.encode(signature.to_bytes())),
        );
        serde_jcs::to_vec(&value).expect("canonical record")
    }

    #[test]
    fn accepts_exact_canonical_signed_macos_role_record() {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let key = signing.verifying_key().to_bytes();
        let record = verify_release_trust_record(
            &signed_record(&signing),
            RUNTIME_ROLE,
            "platform-release-root-fixture-v1",
            &key,
            OffsetDateTime::parse("2026-07-19T00:00:00Z", &Rfc3339).expect("now"),
        )
        .expect("valid record");
        assert_eq!(record.release_id, "runtime-2026.07");
        assert_eq!(record.generation, 7);
    }

    #[test]
    fn rejects_tampering_and_noncanonical_bytes() {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let key = signing.verifying_key().to_bytes();
        let now = OffsetDateTime::parse("2026-07-19T00:00:00Z", &Rfc3339).expect("now");
        let encoded = signed_record(&signing);
        let mut value: Value = serde_json::from_slice(&encoded).expect("record");
        value["generation"] = Value::from(8);
        let tampered = serde_jcs::to_vec(&value).expect("tampered");
        assert!(verify_release_trust_record(
            &tampered,
            RUNTIME_ROLE,
            "platform-release-root-fixture-v1",
            &key,
            now,
        )
        .is_err());
        let pretty =
            serde_json::to_vec_pretty(&serde_json::from_slice::<Value>(&encoded).expect("record"))
                .expect("pretty");
        assert!(verify_release_trust_record(
            &pretty,
            RUNTIME_ROLE,
            "platform-release-root-fixture-v1",
            &key,
            now,
        )
        .is_err());
    }
}
