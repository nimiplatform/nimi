use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};

const RECORD_SCHEMA_VERSION: u64 = 1;
const RUNTIME_EXECUTABLE_ROLE: &str = "nimi_runtime_service";
const RUNTIME_TRUST_SET_ID: &str = "nimi-runtime-production-v1";
const WINDOWS_OS_PROFILE: &str = "windows";
const PROTOCOL_VERSION: &str = "1";
const SIGNER_POLICY_ID: &str = "nimi-production-release-signing-policy";
const SERVICE_PRINCIPAL: &str = r"NT SERVICE\NimiRuntime";

#[derive(Clone, Debug)]
pub(super) struct WindowsReleaseTrustRequirements<'a> {
    pub release_id: &'a str,
    pub artifact_sha256: &'a str,
    pub root_key_id: &'a str,
    pub root_public_key: &'a [u8; 32],
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct VerifiedWindowsReleaseTrust {
    pub release_id: String,
    pub generation: u64,
    pub leaf_spki_sha256: String,
    pub chain_policy_ref: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WindowsReleaseTrustRecord {
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

pub(super) fn verify_windows_release_trust_record(
    encoded: &[u8],
    requirements: WindowsReleaseTrustRequirements<'_>,
) -> Result<VerifiedWindowsReleaseTrust, ProtectedCarrierError> {
    validate_requirements(&requirements)?;
    let mut value: Value = serde_json::from_slice(encoded).map_err(|_| untrusted())?;
    let canonical = serde_jcs::to_vec(&value).map_err(|_| untrusted())?;
    if canonical != encoded {
        return Err(untrusted());
    }
    let record: WindowsReleaseTrustRecord =
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
    let key = VerifyingKey::from_bytes(requirements.root_public_key).map_err(|_| untrusted())?;
    key.verify_strict(&payload, &signature)
        .map_err(|_| untrusted())?;
    validate_record(&record, &requirements)?;
    Ok(VerifiedWindowsReleaseTrust {
        release_id: record.release_id,
        generation: record.generation,
        leaf_spki_sha256: record.windows_leaf_spki_sha256,
        chain_policy_ref: record.windows_chain_policy_ref,
    })
}

fn validate_requirements(
    requirements: &WindowsReleaseTrustRequirements<'_>,
) -> Result<(), ProtectedCarrierError> {
    if !valid_text(requirements.release_id)
        || !valid_text(requirements.root_key_id)
        || !valid_sha256(requirements.artifact_sha256)
    {
        return Err(untrusted());
    }
    Ok(())
}

fn validate_record(
    record: &WindowsReleaseTrustRecord,
    requirements: &WindowsReleaseTrustRequirements<'_>,
) -> Result<(), ProtectedCarrierError> {
    if record.schema_version != RECORD_SCHEMA_VERSION
        || record.environment != "production"
        || record.executable_role != RUNTIME_EXECUTABLE_ROLE
        || record.trust_set_id != RUNTIME_TRUST_SET_ID
        || record.os_profile != WINDOWS_OS_PROFILE
        || record.protected_local_protocol_version != PROTOCOL_VERSION
        || record.release_id != requirements.release_id
        || record.artifact_sha256 != requirements.artifact_sha256
        || record.signer_policy_id != SIGNER_POLICY_ID
        || record.os_service_principal != SERVICE_PRINCIPAL
        || record.root_key_id != requirements.root_key_id
        || record.generation == 0
        || !valid_text(&record.build_id)
        || !valid_sha256(&record.windows_leaf_spki_sha256)
        || !valid_text(&record.windows_chain_policy_ref)
        || !record.macos_designated_requirement.is_empty()
        || !record.macos_team_id.is_empty()
        || !record.macos_cdhash.is_empty()
        || !record.linux_manifest_key_id.is_empty()
    {
        return Err(untrusted());
    }
    if record.compatible_peer_release_ids.is_empty()
        || record
            .compatible_peer_release_ids
            .iter()
            .any(|release| !valid_text(release))
    {
        return Err(untrusted());
    }
    let mut peers = record.compatible_peer_release_ids.clone();
    peers.sort();
    peers.dedup();
    if peers.len() != record.compatible_peer_release_ids.len() {
        return Err(untrusted());
    }
    let valid_from =
        OffsetDateTime::parse(&record.valid_from, &Rfc3339).map_err(|_| untrusted())?;
    let expires_at =
        OffsetDateTime::parse(&record.expires_at, &Rfc3339).map_err(|_| untrusted())?;
    if valid_from >= expires_at || requirements.now < valid_from || requirements.now >= expires_at {
        return Err(untrusted());
    }
    Ok(())
}

fn valid_text(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.chars().all(|character| !character.is_control())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
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
    use serde_json::{json, Map};

    fn signed_record(signing: &SigningKey) -> Vec<u8> {
        let mut value = json!({
            "schema_version": 1,
            "environment": "production",
            "executable_role": "nimi_runtime_service",
            "trust_set_id": "nimi-runtime-production-v1",
            "os_profile": "windows",
            "protected_local_protocol_version": "1",
            "compatible_peer_release_ids": ["desktop-2026.07"],
            "release_id": "runtime-2026.07",
            "build_id": "runtime-build-1",
            "artifact_sha256": "11".repeat(32),
            "signer_policy_id": "nimi-production-release-signing-policy",
            "windows_leaf_spki_sha256": "22".repeat(32),
            "windows_chain_policy_ref": "nimi-windows-production-chain-v1",
            "macos_designated_requirement": "",
            "macos_team_id": "",
            "macos_cdhash": "",
            "linux_manifest_key_id": "",
            "os_service_principal": "NT SERVICE\\NimiRuntime",
            "valid_from": "2026-07-01T00:00:00Z",
            "expires_at": "2026-08-01T00:00:00Z",
            "generation": 7,
            "root_key_id": "platform-release-root-production-v1"
        });
        let payload = serde_jcs::to_vec(&value).expect("canonical payload");
        let signature = signing.sign(&payload);
        value.as_object_mut().expect("object").insert(
            "signature".to_string(),
            Value::String(URL_SAFE_NO_PAD.encode(signature.to_bytes())),
        );
        serde_jcs::to_vec(&value).expect("canonical record")
    }

    fn requirements(key: &[u8; 32]) -> WindowsReleaseTrustRequirements<'_> {
        WindowsReleaseTrustRequirements {
            release_id: "runtime-2026.07",
            artifact_sha256: "1111111111111111111111111111111111111111111111111111111111111111",
            root_key_id: "platform-release-root-production-v1",
            root_public_key: key,
            now: OffsetDateTime::parse("2026-07-11T00:00:00Z", &Rfc3339).expect("now"),
        }
    }

    #[test]
    fn accepts_exact_canonical_signed_runtime_record() {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let verifying = signing.verifying_key().to_bytes();
        let verified =
            verify_windows_release_trust_record(&signed_record(&signing), requirements(&verifying))
                .expect("valid record");
        assert_eq!(verified.release_id, "runtime-2026.07");
        assert_eq!(verified.generation, 7);
    }

    #[test]
    fn rejects_tampering_unknown_fields_noncanonical_bytes_and_wrong_root() {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let verifying = signing.verifying_key().to_bytes();
        let encoded = signed_record(&signing);

        let mut tampered: Value = serde_json::from_slice(&encoded).expect("record");
        tampered["generation"] = Value::from(8);
        let tampered = serde_jcs::to_vec(&tampered).expect("tampered");
        assert!(verify_windows_release_trust_record(&tampered, requirements(&verifying)).is_err());

        let mut unknown: Value = serde_json::from_slice(&encoded).expect("record");
        unknown
            .as_object_mut()
            .unwrap_or(&mut Map::new())
            .insert("unexpected".to_string(), Value::Bool(true));
        let unknown = serde_jcs::to_vec(&unknown).expect("unknown");
        assert!(verify_windows_release_trust_record(&unknown, requirements(&verifying)).is_err());

        let pretty =
            serde_json::to_vec_pretty(&serde_json::from_slice::<Value>(&encoded).expect("record"))
                .expect("pretty");
        assert!(verify_windows_release_trust_record(&pretty, requirements(&verifying)).is_err());

        let wrong = SigningKey::from_bytes(&[9u8; 32])
            .verifying_key()
            .to_bytes();
        assert!(verify_windows_release_trust_record(&encoded, requirements(&wrong)).is_err());
    }
}
