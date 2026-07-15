use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::IpAddr;
use std::path::{Component, Path};
use std::sync::{Mutex, OnceLock};

use url::Url;

const CHECKPOINT_FLAG: &str = "NIMI_DEV_KERNEL_CHECKPOINT";
const CAPTURE_FILE_ENV: &str = "NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE";
const TRIAL_ROOT_ENV: &str = "NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT";
const AUTHORIZATION_ORIGIN: &str = "http://localhost:3002";
const AUTHORIZATION_PATH: &str = "/api/auth/oauth/authorize";
const AUTHORIZATION_CLIENT_ID: &str = "nimi-desktop";
const REQUIRED_QUERY_KEYS: [&str; 6] = [
    "response_type",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
];

static CAPTURED_URLS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub(super) fn capture_configured_checkpoint_authorization_url(
    raw_url: &str,
) -> Option<Result<(), ()>> {
    let capture_path = std::env::var_os(CAPTURE_FILE_ENV)?;
    if std::env::var_os(CHECKPOINT_FLAG).as_deref() != Some(std::ffi::OsStr::new("1")) {
        return Some(Err(()));
    }
    let Some(trial_root) = std::env::var_os(TRIAL_ROOT_ENV) else {
        return Some(Err(()));
    };
    Some(capture_checkpoint_authorization_url(
        raw_url,
        Path::new(&trial_root),
        Path::new(&capture_path),
    ))
}

fn capture_checkpoint_authorization_url(
    raw_url: &str,
    trial_root: &Path,
    capture_path: &Path,
) -> Result<(), ()> {
    let parsed = Url::parse(raw_url).map_err(|_| ())?;
    if parsed.origin().ascii_serialization() != AUTHORIZATION_ORIGIN
        || parsed.scheme() != "http"
        || parsed.host_str() != Some("localhost")
        || parsed.port() != Some(3002)
        || parsed.path() != AUTHORIZATION_PATH
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err(());
    }
    validate_authorization_query(&parsed)?;
    if !trial_root.is_absolute() || !capture_path.is_absolute() {
        return Err(());
    }
    let canonical_trial_root = fs::canonicalize(trial_root).map_err(|_| ())?;
    let capture_parent = capture_path.parent().ok_or(())?;
    fs::create_dir_all(capture_parent).map_err(|_| ())?;
    let canonical_parent = fs::canonicalize(capture_parent).map_err(|_| ())?;
    if canonical_parent != canonical_trial_root
        && !canonical_parent.starts_with(&canonical_trial_root)
    {
        return Err(());
    }
    let relative_capture = capture_path.strip_prefix(trial_root).map_err(|_| ())?;
    if relative_capture.as_os_str().is_empty()
        || relative_capture.components().any(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::ParentDir
            )
        })
    {
        return Err(());
    }
    let urls = CAPTURED_URLS.get_or_init(|| Mutex::new(HashSet::new()));
    let mut urls = urls.lock().map_err(|_| ())?;
    if !urls.insert(parsed.to_string()) {
        return Err(());
    }
    let mut capture = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(capture_path)
        .map_err(|_| ())?;
    capture
        .write_all(format!("{}\n", parsed).as_bytes())
        .map_err(|_| ())?;
    capture.flush().map_err(|_| ())?;
    Ok(())
}

fn validate_authorization_query(parsed: &Url) -> Result<(), ()> {
    let allowed = HashSet::from([
        "response_type",
        "client_id",
        "redirect_uri",
        "code_challenge",
        "code_challenge_method",
        "state",
        "audience",
        "prompt",
        "presence_purpose",
        "presence_nonce",
    ]);
    let mut query = HashMap::<String, String>::new();
    for (key, value) in parsed.query_pairs() {
        if !allowed.contains(key.as_ref())
            || query.insert(key.into_owned(), value.into_owned()).is_some()
        {
            return Err(());
        }
    }
    if REQUIRED_QUERY_KEYS
        .iter()
        .any(|key| !query.contains_key(*key))
        || query.get("response_type").map(String::as_str) != Some("code")
        || query.get("client_id").map(String::as_str) != Some(AUTHORIZATION_CLIENT_ID)
        || query.get("code_challenge_method").map(String::as_str) != Some("S256")
        || !query
            .get("code_challenge")
            .is_some_and(|value| bounded_ascii_identifier(value, 43, 128))
        || !query
            .get("state")
            .is_some_and(|value| bounded_ascii_identifier(value, 16, 256))
    {
        return Err(());
    }
    let callback = Url::parse(query.get("redirect_uri").ok_or(())?).map_err(|_| ())?;
    if callback.scheme() != "http"
        || !callback.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        })
        || callback
            .port()
            .is_none_or(|port| !(1024..=49_151).contains(&port))
        || callback.path() != "/oauth/callback"
        || callback.query().is_some()
        || callback.fragment().is_some()
        || !callback.username().is_empty()
        || callback.password().is_some()
    {
        return Err(());
    }
    let prompt = query.get("prompt");
    let purpose = query.get("presence_purpose");
    let nonce = query.get("presence_nonce");
    if prompt.is_some() || purpose.is_some() || nonce.is_some() {
        if prompt.map(String::as_str) != Some("login")
            || !purpose.is_some_and(|value| bounded_presence_purpose(value))
            || !nonce.is_some_and(|value| bounded_ascii_identifier(value, 16, 128))
        {
            return Err(());
        }
    }
    if query
        .get("audience")
        .is_some_and(|value| !bounded_audience(value))
    {
        return Err(());
    }
    Ok(())
}

fn bounded_ascii_identifier(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn bounded_presence_purpose(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'-')
        })
}

fn bounded_audience(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windows_presence_browser_broker::random_nonce;

    #[test]
    fn captures_only_exact_trial_owned_realm_urls() {
        let suffix = random_nonce().expect("capture test nonce");
        let root = std::env::temp_dir().join(format!("nimi-browser-capture-{suffix}"));
        fs::create_dir_all(&root).expect("create capture test root");
        let capture = root.join("authorization.capture");
        let url = checkpoint_authorization_url(&suffix);
        capture_checkpoint_authorization_url(&url, &root, &capture)
            .expect("capture exact authorization URL");
        assert_eq!(
            fs::read_to_string(&capture).expect("read capture"),
            format!("{url}\n")
        );
        assert!(capture_checkpoint_authorization_url(
            "http://127.0.0.1:3002/api/auth/oauth/authorize?state=wrong-origin",
            &root,
            &root.join("wrong-origin.capture"),
        )
        .is_err());
        assert!(capture_checkpoint_authorization_url(
            &checkpoint_authorization_url(&format!("{suffix}xy")).replace("49151", "49152"),
            &root,
            &root.join("dynamic-port.capture"),
        )
        .is_err());
        assert!(capture_checkpoint_authorization_url(
            "http://localhost:3002/api/auth/token?state=wrong-path",
            &root,
            &root.join("wrong-path.capture"),
        )
        .is_err());
        assert!(capture_checkpoint_authorization_url(
            &checkpoint_authorization_url(&format!("{suffix}ab")),
            &root,
            &root.join("..").join("outside.capture"),
        )
        .is_err());
        assert!(capture_checkpoint_authorization_url(
            &format!(
                "{}&untrusted=value",
                checkpoint_authorization_url(&format!("{suffix}cd"))
            ),
            &root,
            &root.join("extended-query.capture"),
        )
        .is_err());
        fs::remove_dir_all(root).expect("remove capture test root");
    }

    fn checkpoint_authorization_url(state: &str) -> String {
        let mut url = Url::parse("http://localhost:3002/api/auth/oauth/authorize")
            .expect("checkpoint authorization base URL");
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", "nimi-desktop")
            .append_pair("redirect_uri", "http://127.0.0.1:49151/oauth/callback")
            .append_pair("code_challenge", &"a".repeat(43))
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", state)
            .append_pair("prompt", "login")
            .append_pair(
                "presence_purpose",
                "local_app_grant/runtime_agent.conversation.open/lacrf_v1_Aa0-_",
            )
            .append_pair("presence_nonce", &"b".repeat(64));
        url.to_string()
    }
}
