use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentMemoryStandardFixtureStatusPayload {
    agent_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentMemoryStandardFixtureStatusResult {
    available: bool,
    already_bound: bool,
    bank: serde_json::Value,
}

#[tauri::command]
pub(crate) fn agent_memory_standard_fixture_status_get(
    payload: AgentMemoryStandardFixtureStatusPayload,
) -> Result<AgentMemoryStandardFixtureStatusResult, String> {
    let agent_id = payload.agent_id.trim();
    if agent_id.is_empty() {
        return Err("agentId is required".to_string());
    }
    let Some(override_payload) =
        crate::desktop_e2e_fixture::agent_memory_standard_fixture_override()
            .map_err(|error| error.to_string())?
    else {
        return Ok(AgentMemoryStandardFixtureStatusResult {
            available: false,
            already_bound: false,
            bank: json!({}),
        });
    };
    if let Some(message) = override_payload
        .error
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Err(message.to_string());
    }
    Ok(AgentMemoryStandardFixtureStatusResult {
        available: true,
        already_bound: override_payload.already_bound,
        bank: json!({
            "bankId": override_payload.bank_id,
            "embeddingProfile": {
                "modelId": override_payload.embedding_profile_model_id,
            },
        }),
    })
}

#[cfg(test)]
mod tests {
    use crate::test_support::test_guard;
    use std::{fs, path::PathBuf};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nimi-desktop-agent-memory-bind-{}-{}",
            prefix,
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn agent_memory_standard_fixture_status_get_reads_desktop_e2e_override() {
        let _guard = test_guard();
        let temp = make_temp_dir("fixture-status");
        let fixture_path = temp.join("fixture.json");
        fs::write(
            &fixture_path,
            r#"{
  "tauriFixture": {
    "agentMemoryStandardFixture": {
      "alreadyBound": false,
      "bankId": "bank-agent-1",
      "embeddingProfileModelId": "local/embed-alpha"
    }
  }
}"#,
        )
        .expect("write fixture");

        let previous = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
        std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());
        let result = super::agent_memory_standard_fixture_status_get(
            super::AgentMemoryStandardFixtureStatusPayload {
                agent_id: "agent-1".to_string(),
            },
        )
        .expect("fixture status result");
        match previous {
            Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
            None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
        }

        assert!(result.available);
        assert!(!result.already_bound);
        assert_eq!(
            result.bank.get("bankId").and_then(|value| value.as_str()),
            Some("bank-agent-1")
        );
        let _ = fs::remove_dir_all(temp);
    }
}
