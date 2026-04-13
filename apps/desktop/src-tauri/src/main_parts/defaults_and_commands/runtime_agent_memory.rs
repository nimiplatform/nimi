use super::*;
use crate::runtime_bridge::http_addr;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentMemoryBindStandardPayload {
    agent_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentMemoryBindStandardResult {
    already_bound: bool,
    bank: serde_json::Value,
}

#[tauri::command]
pub(crate) async fn agent_memory_bind_standard(
    payload: AgentMemoryBindStandardPayload,
) -> Result<AgentMemoryBindStandardResult, String> {
    let agent_id = payload.agent_id.trim();
    if agent_id.is_empty() {
        return Err("agentId is required".to_string());
    }
    if let Some(override_payload) =
        crate::desktop_e2e_fixture::agent_memory_bind_standard_override()
            .map_err(|error| error.to_string())?
    {
        if let Some(message) = override_payload
            .error
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Err(message.to_string());
        }
        return Ok(AgentMemoryBindStandardResult {
            already_bound: override_payload.already_bound,
            bank: json!({
                "bankId": override_payload.bank_id,
                "embeddingProfile": {
                    "modelId": override_payload.embedding_profile_model_id,
                },
            }),
        });
    }
    let addr = http_addr();
    let normalized_addr = if addr.starts_with("http://") || addr.starts_with("https://") {
        addr
    } else {
        format!("http://{}", addr)
    };
    let url = format!(
        "{}/v1/runtime/private/memory/canonical-bind",
        normalized_addr.trim_end_matches('/')
    );
    execute_agent_memory_bind_standard(url.as_str(), agent_id).await
}

async fn execute_agent_memory_bind_standard(
    url: &str,
    agent_id: &str,
) -> Result<AgentMemoryBindStandardResult, String> {
    let client = shared_http_client()?;
    let response = client
        .post(url)
        .json(&json!({ "agentId": agent_id }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(body.as_str()) {
            if let Some(message) = value.get("error").and_then(|item| item.as_str()) {
                return Err(message.trim().to_string());
            }
        }
        let normalized = body.trim();
        if normalized.is_empty() {
            return Err(format!(
                "canonical standard bind failed with status {}",
                status.as_u16()
            ));
        }
        return Err(normalized.to_string());
    }
    serde_json::from_str::<AgentMemoryBindStandardResult>(body.as_str()).map_err(|error| {
        format!(
            "canonical standard bind returned invalid payload: {}",
            error
        )
    })
}

#[cfg(test)]
mod tests {
    use super::execute_agent_memory_bind_standard;
    use crate::test_support::test_guard;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;
    use std::{fs, path::PathBuf};

    fn spawn_single_response_server(
        status_line: &str,
        body: &str,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let addr = listener.local_addr().expect("local addr");
        let body = body.to_string();
        let status_line = status_line.to_string();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut request = Vec::new();
            loop {
                let mut buffer = [0_u8; 4096];
                match stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        request.extend_from_slice(&buffer[..read]);
                        if read < buffer.len() {
                            break;
                        }
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                    {
                        break;
                    }
                    Err(error) => panic!("read request: {error}"),
                }
            }
            let request = String::from_utf8_lossy(&request).to_string();
            let response = format!(
                "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status_line,
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
            request
        });
        (format!("http://{}", addr), handle)
    }

    #[tokio::test]
    async fn execute_agent_memory_bind_standard_posts_expected_payload() {
        let (base_url, handle) = spawn_single_response_server(
            "200 OK",
            r#"{"alreadyBound":false,"bank":{"bankId":"bank-agent-1"}}"#,
        );
        let url = format!("{}/v1/runtime/private/memory/canonical-bind", base_url);

        let result = execute_agent_memory_bind_standard(url.as_str(), "agent-1")
            .await
            .expect("bind standard");
        let request = handle.join().expect("join server");

        assert!(!result.already_bound);
        assert_eq!(
            result
                .bank
                .get("bankId")
                .and_then(|value| value.as_str())
                .unwrap_or_default(),
            "bank-agent-1"
        );
        assert!(request.starts_with("POST /v1/runtime/private/memory/canonical-bind HTTP/1.1"));
    }

    #[tokio::test]
    async fn execute_agent_memory_bind_standard_surfaces_error_payload() {
        let (base_url, handle) = spawn_single_response_server(
            "503 Service Unavailable",
            r#"{"error":"memory embedding profile is unavailable"}"#,
        );
        let url = format!("{}/v1/runtime/private/memory/canonical-bind", base_url);

        let err = execute_agent_memory_bind_standard(url.as_str(), "agent-1")
            .await
            .expect_err("bind standard should fail");
        let _ = handle.join().expect("join server");

        assert_eq!(err, "memory embedding profile is unavailable");
    }

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nimi-desktop-agent-memory-bind-{}-{}",
            prefix,
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[tokio::test]
    async fn agent_memory_bind_standard_uses_desktop_e2e_override() {
        let _guard = test_guard();
        let temp = make_temp_dir("fixture");
        let fixture_path = temp.join("fixture.json");
        fs::write(
            &fixture_path,
            r#"{
  "tauriFixture": {
    "agentMemoryBindStandard": {
      "alreadyBound": true,
      "bankId": "bank-agent-1",
      "embeddingProfileModelId": "local/embed-alpha"
    }
  }
}"#,
        )
        .expect("write fixture");

        let previous = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
        std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());
        let result = super::agent_memory_bind_standard(super::AgentMemoryBindStandardPayload {
            agent_id: "agent-1".to_string(),
        })
        .await
        .expect("bind override result");
        match previous {
            Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
            None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
        }

        assert!(result.already_bound);
        assert_eq!(
            result
                .bank
                .get("embeddingProfile")
                .and_then(|value| value.get("modelId"))
                .and_then(|value| value.as_str()),
            Some("local/embed-alpha")
        );
        let _ = fs::remove_dir_all(temp);
    }
}
