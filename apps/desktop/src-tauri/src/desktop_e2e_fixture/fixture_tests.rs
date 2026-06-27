use super::*;
use crate::runtime_bridge::{
    generated as runtime_bridge_generated, RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
};
use base64::Engine;
use prost::Message;

fn manifest_for_scenario(scenario_id: &str) -> DesktopE2EFixtureManifest {
    DesktopE2EFixtureManifest {
        tauri_fixture: Some(DesktopE2ETauriFixture {
            bootstrap_error: None,
            runtime_defaults: None,
            runtime_bridge_status: None,
            desktop_release_info: None,
            product_control_record: None,
            confirm_dialog: None,
            macos_smoke: Some(DesktopE2EMacosSmokeOverride {
                enabled: true,
                scenario_id: Some(scenario_id.to_string()),
                report_path: None,
                artifacts_dir: None,
                disable_runtime_bootstrap: None,
                bootstrap_timeout_ms: None,
                avatar_product_local_asset_fault: None,
            }),
        }),
        realm_fixture: None,
    }
}

#[test]
fn real_runtime_account_projection_covers_avatar_product_smoke_matrix() {
    assert!(uses_real_runtime_account_projection(
        &manifest_for_scenario("chat.live2d-avatar-product-smoke",)
    ));
    assert!(uses_real_runtime_account_projection(
        &manifest_for_scenario("chat.live2d-avatar-local-asset-missing-smoke",)
    ));
    assert!(!uses_real_runtime_account_projection(
        &manifest_for_scenario("chat.live2d-render-smoke",)
    ));
}

#[test]
fn runtime_register_app_fixture_accepts_local_first_party_registration() {
    let request = runtime_bridge_generated::RegisterAppRequest {
        app_id: "nimi.desktop".to_string(),
        app_instance_id: "nimi.desktop.local-first-party".to_string(),
        device_id: "desktop-shell".to_string(),
        app_version: "1".to_string(),
        capabilities: Vec::new(),
        mode_manifest: None,
        developer_registration: false,
    };
    let payload = RuntimeBridgeUnaryPayload {
        method_id: nimi_shell_tauri::capabilities::runtime::RUNTIME_AUTH_REGISTER_APP_METHOD_ID
            .to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(request.encode_to_vec()),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms: None,
    };

    let result = runtime_register_app_response(&payload).expect("register app response");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64)
        .expect("decode response");
    let response = runtime_bridge_generated::RegisterAppResponse::decode(bytes.as_slice())
        .expect("decode register response");
    assert!(response.accepted);
    assert_eq!(response.app_instance_id, "nimi.desktop.local-first-party");
    assert_eq!(
        response.reason_code,
        runtime_bridge_generated::ReasonCode::ActionExecuted as i32
    );
}

fn fixture_payload<Request>(method_id: &str, request: Request) -> RuntimeBridgeUnaryPayload
where
    Request: Message,
{
    RuntimeBridgeUnaryPayload {
        method_id: method_id.to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(request.encode_to_vec()),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms: None,
    }
}

fn decode_fixture_response<Response>(result: RuntimeBridgeUnaryResult) -> Response
where
    Response: Message + Default,
{
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64)
        .expect("decode response");
    Response::decode(bytes.as_slice()).expect("decode fixture response")
}

#[test]
fn runtime_agent_fixture_projects_cbdb_chat_open_chain() {
    let local_agent_ref =
        "local-agent:user-e2e-primary:cbdb-song-slice-real-20260614-agent-8af2c5ca8a".to_string();
    let owner_user_id = "user-e2e-primary".to_string();
    let runtime_source_ref = "cbdb-song-slice-real-20260614-agent-8af2c5ca8a".to_string();
    let context = runtime_bridge_generated::AgentRequestContext {
        app_id: "nimi.desktop".to_string(),
        subject_user_id: owner_user_id.clone(),
        scoped_binding: None,
        owner_user_id: owner_user_id.clone(),
        runtime_source_ref: runtime_source_ref.clone(),
        local_agent_ref: local_agent_ref.clone(),
    };

    let get_agent = runtime_agent_get_response(&fixture_payload(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_GET_AGENT_METHOD_ID,
        runtime_bridge_generated::GetAgentRequest {
            context: Some(context.clone()),
            agent_id: local_agent_ref.clone(),
        },
    ))
    .expect("get agent fixture");
    let get_agent_response: runtime_bridge_generated::GetAgentResponse =
        decode_fixture_response(get_agent);
    let agent = get_agent_response.agent.expect("agent projection");
    assert_eq!(agent.local_agent_ref, local_agent_ref);
    assert_eq!(agent.owner_user_id, owner_user_id);
    assert_eq!(agent.runtime_source_ref, runtime_source_ref);
    assert_eq!(
        agent.lifecycle_status,
        runtime_bridge_generated::AgentLifecycleStatus::Active as i32
    );

    let open_anchor = runtime_agent_open_anchor_response(&fixture_payload(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_OPEN_CONVERSATION_ANCHOR_METHOD_ID,
        runtime_bridge_generated::OpenConversationAnchorRequest {
            context: Some(context.clone()),
            agent_id: String::new(),
            subject_user_id: owner_user_id.clone(),
            metadata: None,
            local_agent_ref: local_agent_ref.clone(),
            owner_user_id: owner_user_id.clone(),
            runtime_source_ref: runtime_source_ref.clone(),
        },
    ))
    .expect("open anchor fixture");
    let open_anchor_response: runtime_bridge_generated::OpenConversationAnchorResponse =
        decode_fixture_response(open_anchor);
    let anchor = open_anchor_response
        .snapshot
        .and_then(|snapshot| snapshot.anchor)
        .expect("conversation anchor");
    assert_eq!(
        anchor.conversation_anchor_id,
        format!("e2e-anchor:{local_agent_ref}")
    );
    assert_eq!(
        anchor.status,
        runtime_bridge_generated::ConversationAnchorStatus::Active as i32
    );
    assert_eq!(anchor.local_agent_ref, local_agent_ref);

    let summaries = runtime_agent_list_conversation_summaries_response(&fixture_payload(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_LIST_AGENT_CONVERSATION_SUMMARIES_METHOD_ID,
        runtime_bridge_generated::ListAgentConversationSummariesRequest {
            context: Some(context),
            agent_id: local_agent_ref.clone(),
            status_filter: vec![runtime_bridge_generated::ConversationAnchorStatus::Active as i32],
            page_size: 1,
            page_token: String::new(),
        },
    ))
    .expect("conversation summaries fixture");
    let summaries_response: runtime_bridge_generated::ListAgentConversationSummariesResponse =
        decode_fixture_response(summaries);
    assert_eq!(summaries_response.summaries.len(), 1);
    assert_eq!(summaries_response.summaries[0].title, "CBDB Su Zhe");
    assert_eq!(
        summaries_response.summaries[0]
            .anchor
            .as_ref()
            .map(|anchor| anchor.local_agent_ref.as_str()),
        Some(local_agent_ref.as_str())
    );
}
