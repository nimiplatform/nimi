use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    signature: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Component {
    pub version: String,
    pub sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Components {
    pub desktop: Component,
    pub runtime: Component,
    pub avatar: Component,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Identity {
    pub schema: String,
    pub release_id: String,
    pub version: String,
    pub channel: String,
    pub target: String,
    pub source_revision: String,
    pub components: Components,
    pub files: BTreeMap<String, String>,
}

// @nimi-authority: rule.nimi.runtime.service-operations.r054
pub(crate) fn verify(raw: &[u8], key: &str) -> Result<Identity, ()> {
    if raw.len() > 128 * 1024 {
        return Err(());
    }
    let key_bytes: [u8; 32] = STANDARD
        .decode(key)
        .map_err(|_| ())?
        .try_into()
        .map_err(|_| ())?;
    let envelope: Envelope = serde_json::from_slice(raw).map_err(|_| ())?;
    let payload = STANDARD.decode(envelope.payload).map_err(|_| ())?;
    if payload.len() > 64 * 1024 {
        return Err(());
    }
    let signature = Signature::from_slice(&STANDARD.decode(envelope.signature).map_err(|_| ())?)
        .map_err(|_| ())?;
    VerifyingKey::from_bytes(&key_bytes)
        .map_err(|_| ())?
        .verify(&payload, &signature)
        .map_err(|_| ())?;
    let identity: Identity = serde_json::from_slice(&payload).map_err(|_| ())?;
    identity.validate()?;
    Ok(identity)
}

fn version(value: &str) -> bool {
    let (base, pre) = value
        .split_once('-')
        .map_or((value, None), |(a, b)| (a, Some(b)));
    let number = |v: &str| {
        !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()) && (v == "0" || !v.starts_with('0'))
    };
    let parts: Vec<_> = base.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|v| number(v))
        && pre.is_none_or(|v| {
            v.split_once('.')
                .is_some_and(|(kind, n)| (kind == "beta" || kind == "rc") && n != "0" && number(n))
        })
}
fn sha(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Identity {
    fn validate(&self) -> Result<(), ()> {
        if self.schema != "nimi-windows-product-identity/v1"
            || self.target != "windows-amd64"
            || self.channel != "beta"
            || !version(&self.version)
            || self.release_id != format!("nimi/v{}", self.version)
            || !sha(&self.source_revision, 40)
            || self.files.len() > 8192
        {
            return Err(());
        }
        for c in [
            &self.components.desktop,
            &self.components.runtime,
            &self.components.avatar,
        ] {
            if !version(&c.version) || !sha(&c.sha256, 64) {
                return Err(());
            }
        }
        let mut seen = std::collections::HashSet::new();
        for (name, digest) in &self.files {
            if !relative_file(name) || !sha(digest, 64) || !seen.insert(name.to_lowercase()) {
                return Err(());
            }
        }
        for name in [
            "Nimi.exe",
            "runtime/nimi.exe",
            "NimiProductUpdater.exe",
            "resources/app.asar",
        ] {
            if !self.files.get(name).is_some_and(|v| sha(v, 64)) {
                return Err(());
            }
        }
        if self.files.get("resources/app.asar") != Some(&self.components.desktop.sha256)
            || self.files.get("runtime/nimi.exe") != Some(&self.components.runtime.sha256)
        {
            return Err(());
        }
        Ok(())
    }
}
pub(crate) fn relative_file(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 240
        && !name.contains(['\\', ':', '<', '>', '"', '|', '?', '*'])
        && !name.starts_with('/')
        && name.split('/').all(|part| {
            let device = part.split('.').next().unwrap_or("").to_ascii_lowercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with(['.', ' '])
                && !part.chars().any(|c| c < ' ')
                && !["con", "prn", "aux", "nul"].contains(&device.as_str())
                && !(device.len() == 4
                    && (device.starts_with("com") || device.starts_with("lpt"))
                    && matches!(device.as_bytes()[3], b'1'..=b'9'))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    #[test]
    fn publisher_signature_role_and_closed_inventory_required() {
        let key = SigningKey::from_bytes(&[17; 32]);
        let digest = "ab".repeat(32);
        let mut identity = serde_json::json!({"schema":"nimi-windows-product-identity/v1","releaseId":"nimi/v0.2.1","version":"0.2.1","channel":"beta","target":"windows-amd64","sourceRevision":"ab".repeat(20),"components":{"desktop":{"version":"0.2.1","sha256":digest},"runtime":{"version":"0.2.1","sha256":digest},"avatar":{"version":"0.2.1","sha256":digest}},"files":{"Nimi.exe":digest,"runtime/nimi.exe":digest,"NimiProductUpdater.exe":digest,"resources/app.asar":digest}});
        let envelope = |v: &serde_json::Value| {
            let payload = serde_json::to_vec(v).unwrap();
            serde_json::to_vec(&serde_json::json!({"payload":STANDARD.encode(&payload),"signature":STANDARD.encode(key.sign(&payload).to_bytes())})).unwrap()
        };
        let public = STANDARD.encode(key.verifying_key().to_bytes());
        assert!(verify(&envelope(&identity), &public).is_ok());
        assert!(verify(&envelope(&identity), "").is_err());
        identity["files"]["../Nimi.exe"] = serde_json::json!(digest);
        assert!(verify(&envelope(&identity), &public).is_err());
        identity["files"]
            .as_object_mut()
            .unwrap()
            .remove("../Nimi.exe");
        identity["unknown"] = serde_json::json!(true);
        assert!(verify(&envelope(&identity), &public).is_err());
        for name in [
            "C:/Nimi.exe",
            "Nimi.exe:evil",
            "Nimi.exe.",
            "nul.txt",
            "a\\b",
        ] {
            assert!(!relative_file(name));
        }
    }
}
