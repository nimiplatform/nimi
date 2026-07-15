use std::net::IpAddr;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tonic::metadata::MetadataValue;
use url::Url;
use windows_sys::Win32::Security::Cryptography::{
    BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
};
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

use crate::{NimiHostError, NimiHostErrorReasonCode};

const METADATA_KEY: &str = "x-nimi-presence-browser-launcher";
const ENDPOINT_PREFIX: &str = "/v1/presence-browser/";
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const MAX_AUTHORIZATION_URL_BYTES: usize = 4096;
#[path = "windows_checkpoint_browser_capture.rs"]
mod windows_checkpoint_browser_capture;
use windows_checkpoint_browser_capture::capture_configured_checkpoint_authorization_url;

type BrowserOpener = Arc<dyn Fn(&str) -> Result<(), ()> + Send + Sync>;

pub(crate) struct PresenceBrowserBroker {
    endpoint: String,
    task: Option<JoinHandle<()>>,
}

impl PresenceBrowserBroker {
    pub(crate) async fn start() -> Result<Self, NimiHostError> {
        Self::start_with_opener(Arc::new(open_authorization_url)).await
    }

    async fn start_with_opener(opener: BrowserOpener) -> Result<Self, NimiHostError> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| presence_required())?;
        let address = listener.local_addr().map_err(|_| presence_required())?;
        let nonce = random_nonce()?;
        let path = format!("{ENDPOINT_PREFIX}{nonce}");
        let endpoint = format!("http://127.0.0.1:{}{path}", address.port());
        let expected_host = format!("127.0.0.1:{}", address.port());
        let task = tokio::spawn(async move {
            let Ok((mut stream, peer)) = listener.accept().await else {
                return;
            };
            if !peer.ip().is_loopback() {
                let _ = write_response(&mut stream, 400).await;
                return;
            }
            let status = match read_authorization_url(&mut stream, &path, &expected_host).await {
                Ok(raw_url) if opener(&raw_url).is_ok() => 204,
                _ => 400,
            };
            let _ = write_response(&mut stream, status).await;
        });
        Ok(Self {
            endpoint,
            task: Some(task),
        })
    }

    pub(crate) fn bind<T>(&self, request: &mut tonic::Request<T>) -> Result<(), NimiHostError> {
        let value =
            MetadataValue::try_from(self.endpoint.as_str()).map_err(|_| presence_required())?;
        request.metadata_mut().insert(METADATA_KEY, value);
        Ok(())
    }

    pub(crate) async fn finish(mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
            let _ = task.await;
        }
    }
}

impl Drop for PresenceBrowserBroker {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

fn presence_required() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::LocalAppPresenceRequired, false)
}

fn random_nonce() -> Result<String, NimiHostError> {
    let mut bytes = [0u8; 32];
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status != 0 {
        return Err(presence_required());
    }
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").map_err(|_| presence_required())?;
    }
    Ok(encoded)
}

async fn read_authorization_url(
    stream: &mut TcpStream,
    expected_path: &str,
    expected_host: &str,
) -> Result<String, ()> {
    let mut bytes = Vec::with_capacity(2048);
    let header_end = loop {
        if bytes.len() >= MAX_REQUEST_BYTES {
            return Err(());
        }
        let mut chunk = [0u8; 1024];
        let count = stream.read(&mut chunk).await.map_err(|_| ())?;
        if count == 0 {
            return Err(());
        }
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(index) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let header = std::str::from_utf8(&bytes[..header_end]).map_err(|_| ())?;
    let mut lines = header[..header.len() - 4].split("\r\n");
    if lines.next() != Some(format!("POST {expected_path} HTTP/1.1").as_str()) {
        return Err(());
    }
    let mut content_length = None;
    let mut content_type = None;
    let mut host = None;
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(())?;
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        match name.as_str() {
            "content-length" if content_length.is_none() => {
                content_length = Some(value.parse::<usize>().map_err(|_| ())?)
            }
            "content-type" if content_type.is_none() => {
                content_type = Some(value.to_ascii_lowercase())
            }
            "host" if host.is_none() => host = Some(value.to_string()),
            "origin" | "referer" => return Err(()),
            "content-length" | "content-type" | "host" => return Err(()),
            _ => {}
        }
    }
    let content_length = content_length.ok_or(())?;
    if content_length == 0
        || content_length > MAX_AUTHORIZATION_URL_BYTES + 128
        || content_type.as_deref() != Some("application/json")
        || host.as_deref() != Some(expected_host)
    {
        return Err(());
    }
    let total = header_end.checked_add(content_length).ok_or(())?;
    if total > MAX_REQUEST_BYTES {
        return Err(());
    }
    while bytes.len() < total {
        let mut chunk = [0u8; 1024];
        let count = stream.read(&mut chunk).await.map_err(|_| ())?;
        if count == 0 || bytes.len() + count > total {
            return Err(());
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    if bytes.len() != total {
        return Err(());
    }
    let mut payload = serde_json::from_slice::<serde_json::Map<String, serde_json::Value>>(
        &bytes[header_end..total],
    )
    .map_err(|_| ())?;
    if payload.len() != 1 {
        return Err(());
    }
    let raw_url = payload
        .remove("authorizationUrl")
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or(())?;
    validate_authorization_url(&raw_url)?;
    Ok(raw_url)
}

fn validate_authorization_url(raw_url: &str) -> Result<(), ()> {
    if raw_url.is_empty()
        || raw_url != raw_url.trim()
        || raw_url.len() > MAX_AUTHORIZATION_URL_BYTES
    {
        return Err(());
    }
    let parsed = Url::parse(raw_url).map_err(|_| ())?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err(());
    }
    match parsed.scheme() {
        "https" => {}
        "http" => {
            let host = parsed.host_str().ok_or(())?;
            let loopback = host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<IpAddr>()
                    .is_ok_and(|address| address.is_loopback());
            if !loopback {
                return Err(());
            }
        }
        _ => return Err(()),
    }
    Ok(())
}

fn open_authorization_url(raw_url: &str) -> Result<(), ()> {
    if let Some(captured) = capture_configured_checkpoint_authorization_url(raw_url) {
        return captured;
    }
    let mut child = Command::new(system_rundll32_path()?)
        .arg("url.dll,FileProtocolHandler")
        .arg(raw_url)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| ())?;
    let _ = child.try_wait();
    Ok(())
}

fn system_rundll32_path() -> Result<PathBuf, ()> {
    let mut buffer = vec![0u16; 32_768];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(());
    }
    buffer.truncate(length);
    let mut path = PathBuf::from(String::from_utf16(&buffer).map_err(|_| ())?);
    path.push("rundll32.exe");
    Ok(path)
}

async fn write_response(stream: &mut TcpStream, status: u16) -> Result<(), ()> {
    let status_text = if status == 204 {
        "204 No Content"
    } else {
        "400 Bad Request"
    };
    let response = format!(
        "HTTP/1.1 {status_text}\r\nContent-Length: 0\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).await.map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[tokio::test]
    async fn broker_accepts_one_exact_runtime_url_delivery() {
        let launched = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = Arc::clone(&launched);
        let broker = PresenceBrowserBroker::start_with_opener(Arc::new(move |raw_url| {
            seen.lock().map_err(|_| ())?.push(raw_url.to_string());
            Ok(())
        }))
        .await
        .expect("start broker");
        let endpoint = Url::parse(&broker.endpoint).expect("parse broker endpoint");
        let body = serde_json::to_string(&serde_json::json!({
            "authorizationUrl": "http://localhost:3002/api/auth/oauth/authorize?prompt=login"
        }))
        .expect("encode request body");
        let mut stream =
            TcpStream::connect(endpoint.socket_addrs(|| None).expect("broker address")[0])
                .await
                .expect("connect broker");
        let request = format!(
            "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            endpoint.path(),
            endpoint.host_str().expect("broker host").to_string() + ":" + &endpoint.port().expect("broker port").to_string(),
            body.len(),
            body,
        );
        stream
            .write_all(request.as_bytes())
            .await
            .expect("write broker request");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .expect("read broker response");
        assert!(String::from_utf8(response)
            .expect("utf8 response")
            .starts_with("HTTP/1.1 204 No Content"));
        assert_eq!(
            launched.lock().expect("launched URLs").as_slice(),
            ["http://localhost:3002/api/auth/oauth/authorize?prompt=login"]
        );
        broker.finish().await;
    }

    #[test]
    fn authorization_url_allows_https_and_loopback_http_only() {
        assert!(
            validate_authorization_url("https://realm.nimi.example/oauth?prompt=login").is_ok()
        );
        assert!(validate_authorization_url("http://localhost:3002/oauth?prompt=login").is_ok());
        assert!(validate_authorization_url("http://127.0.0.1:3002/oauth?prompt=login").is_ok());
        assert!(validate_authorization_url("http://realm.nimi.example/oauth").is_err());
        assert!(validate_authorization_url("file:///C:/oauth").is_err());
        assert!(validate_authorization_url("https://user@realm.nimi.example/oauth").is_err());
    }

    #[test]
    fn nonce_is_lower_hex_and_not_reused() {
        let first = random_nonce().expect("first nonce");
        let second = random_nonce().expect("second nonce");
        assert_eq!(first.len(), 64);
        assert!(first
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value)));
        assert_ne!(first, second);
    }
}
