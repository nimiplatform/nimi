use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde_json::Value as JsonValue;

#[napi(object)]
pub struct NativeJsonOutcome {
    pub status: String,
    pub value: Option<JsonValue>,
    pub reason_code: Option<String>,
    pub retryable: Option<bool>,
    pub reason_metadata: Option<JsonValue>,
}

#[napi(object)]
pub struct NativeBytesOutcome {
    pub status: String,
    pub value: Option<Buffer>,
    pub reason_code: Option<String>,
    pub retryable: Option<bool>,
    pub reason_metadata: Option<JsonValue>,
}

#[napi(object)]
pub struct NativeFirstPartyProductInput {
    pub method_id: String,
    pub request_bytes: Buffer,
    pub timeout_ms: Option<u32>,
}

#[napi(object)]
pub struct NativeFirstPartyProductUnaryInput {
    pub method_id: String,
    pub request_bytes: Buffer,
    pub timeout_ms: Option<u32>,
    pub request_id: String,
}

#[napi(object)]
pub struct NativeFirstPartyProductClientStreamInput {
    pub method_id: String,
    pub request_frames: Vec<Buffer>,
    pub timeout_ms: Option<u32>,
}

#[napi(object)]
pub struct NativeFirstPartyProductUnaryCancelInput {
    pub request_id: String,
}

#[napi(object)]
pub struct NativeFirstPartyProductStreamInput {
    pub stream_id: String,
}

#[napi(object)]
pub struct NativeBundledAvatarRuntimeInput {
    pub method_id: String,
    pub request_bytes: Buffer,
    pub timeout_ms: Option<u32>,
}

#[napi(object)]
pub struct NativeBundledAvatarStreamInput {
    pub stream_id: String,
}

#[napi(object)]
pub struct NativeBundledAvatarStreamNextOutcome {
    pub status: String,
    pub value: Option<Buffer>,
    pub completed: Option<bool>,
    pub reason_code: Option<String>,
    pub retryable: Option<bool>,
    pub reason_metadata: Option<JsonValue>,
}

#[napi(object)]
pub struct NativeDesktopAccountBeginLoginInput {
    pub redirect_uri: String,
    pub callback_origin: String,
    pub requested_scopes: Vec<String>,
    pub ttl_seconds: i32,
}

#[napi(object)]
pub struct NativeDesktopAccountCompleteLoginInput {
    pub login_attempt_id: String,
    pub code: String,
    pub state: String,
    pub nonce: String,
    pub redirect_uri: String,
    pub callback_origin: String,
}

#[napi(object)]
pub struct NativeDesktopAccountRealmUnaryInput {
    pub method_id: String,
    pub request_json: String,
    pub timeout_ms: i32,
    pub idempotency_key: Option<String>,
}

#[napi(object)]
pub struct NativeDesktopAccountActionInput {
    pub reason: String,
}

#[napi(object)]
pub struct NativeDesktopAccountSessionEventsOpenInput {
    pub after_sequence: String,
}

#[napi(object)]
pub struct NativeDesktopAccountSessionEventsStreamInput {
    pub stream_id: String,
}

#[napi(object)]
pub struct NativeDeveloperModeSetInput {
    pub enabled: bool,
}

#[napi(object)]
pub struct NativeLocalDevelopmentRegisterInput {
    pub expected_app_id: String,
    pub project_root: String,
    pub shell: String,
    pub supervisor_run_id: String,
}

#[napi(object)]
pub struct NativeLocalDevelopmentRegistrationInput {
    pub registration_handle: String,
}

#[napi(object)]
pub struct NativeLocalDevelopmentLaunchInput {
    pub registration_handle: String,
    pub supervisor_run_id: String,
    pub shell: String,
    pub host_executable_path: String,
    pub renderer_origin: String,
    pub host_arguments: Vec<String>,
    pub working_directory: String,
}

#[napi(object)]
pub struct NativeLocalDevelopmentRunInput {
    pub supervisor_run_id: String,
}

#[napi(object)]
pub struct NativeLocalDevelopmentEndRunInput {
    pub registration_handle: String,
    pub supervisor_run_id: String,
}

#[napi(object)]
pub struct NativeAppAIConfigOverwriteInput {
    pub expected_revision: String,
    pub capabilities: JsonValue,
}

#[napi(object)]
pub struct NativeAIConfigLocalOptionsInput {
    pub kind: String,
    pub capability_contract: String,
    pub connector_ref: Option<String>,
    pub search: Option<String>,
}

#[napi(object)]
pub struct NativeTextCandidateMessage {
    pub role: String,
    pub text: String,
}

#[napi(object)]
pub struct NativeTextCandidateInput {
    pub messages: Vec<NativeTextCandidateMessage>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: Option<f64>,
}

#[napi(object)]
pub struct NativeTextTurnInput {
    pub messages: Vec<NativeTextCandidateMessage>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: Option<f64>,
    pub top_k: Option<f64>,
    pub presence_penalty: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub stop: Option<Vec<String>>,
    pub seed: Option<f64>,
}

#[napi(object)]
pub struct NativeScenarioSpecInput {
    pub spec: JsonValue,
}

#[napi(object)]
pub struct NativeScenarioJobSubmitInput {
    pub spec: JsonValue,
    pub timeout_ms: f64,
}

#[napi(object)]
pub struct NativeScenarioJobInput {
    pub job_id: String,
}

#[napi(object)]
pub struct NativeScenarioJobCancelInput {
    pub job_id: String,
    pub reason: String,
}

#[napi(object)]
pub struct NativeScenarioArtifactInput {
    pub artifact_id: String,
}

#[napi(object)]
pub struct NativeScenarioArtifactUploadInput {
    pub bytes: Buffer,
    pub mime_type: String,
}

#[napi(object)]
pub struct NativeScenarioVoiceAssetsInput {
    pub page_size: i32,
    pub page_token: String,
}

#[napi(object)]
pub struct NativeScenarioStreamInput {
    pub stream_id: String,
}

#[napi(object)]
pub struct NativeWorldCoreListInput {
    pub take: Option<u32>,
    pub visibility: Option<String>,
}

#[napi(object)]
pub struct NativeWorldCoreCreateInput {
    pub body: JsonValue,
}

#[napi(object)]
pub struct NativePersonaCharacterListOwnedInput {
    pub world_id: Option<String>,
    pub visibility: Option<String>,
    pub after_id: Option<String>,
    pub take: Option<u32>,
}

#[napi(object)]
pub struct NativePersonaCharacterGetOwnedInput {
    pub persona_character_id: String,
}

#[napi(object)]
pub struct NativePersonaCharacterCreateInput {
    pub body: JsonValue,
}

#[napi(object)]
pub struct NativePersonaCharacterReplaceInput {
    pub persona_character_id: String,
    pub body: JsonValue,
}

#[napi(object)]
pub struct NativePersonaCharacterDeleteInput {
    pub persona_character_id: String,
}

#[napi(object)]
pub struct NativeStorageReadInput {
    pub relative_path: String,
}

#[napi(object)]
pub struct NativeStorageWriteInput {
    pub relative_path: String,
    pub value: JsonValue,
}

#[napi(object)]
pub struct NativeStorageRemoveInput {
    pub relative_path: String,
}

#[napi(object)]
pub struct NativeAssetListInput {
    pub prefix: String,
    pub cursor: String,
    pub page_size: i32,
}

#[napi(object)]
pub struct NativeAssetWriteOpenInput {
    pub relative_path: String,
    pub media_type: String,
    pub overwrite: bool,
}

#[napi(object)]
pub struct NativeAssetWriteChunkInput {
    pub stream_id: String,
    pub body_chunk: Buffer,
}

#[napi(object)]
pub struct NativeAssetReadInput {
    pub relative_path: String,
    pub offset: Option<f64>,
    pub length: Option<f64>,
}

#[napi(object)]
pub struct NativeAssetMoveInput {
    pub from_relative_path: String,
    pub to_relative_path: String,
    pub overwrite: bool,
}

#[napi(object)]
pub struct NativeAssetAdoptInput {
    pub artifact_id: String,
    pub relative_path: String,
    pub overwrite: bool,
}

#[napi(object)]
pub struct NativeAssetReadNextOutcome {
    pub status: String,
    pub value: Option<Buffer>,
    pub completed: Option<bool>,
    pub reason_code: Option<String>,
    pub retryable: Option<bool>,
    pub reason_metadata: Option<JsonValue>,
}

#[napi(object)]
pub struct NativeConversationOpenInput {
    pub agent_handle: String,
}

#[napi(object)]
pub struct NativeConversationSendInput {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub request_id: String,
    pub parts: JsonValue,
}

#[napi(object)]
pub struct NativeConversationAttachmentUploadInput {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub mime_type: String,
    pub display_name: Option<String>,
    pub bytes: Buffer,
}

#[napi(object)]
pub struct NativeConversationArtifactReadInput {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub artifact_id: String,
}

#[napi(object)]
pub struct NativeConversationVoiceTranscriptionInput {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub request_id: String,
    pub mime_type: String,
    pub audio_bytes: Buffer,
}

#[napi(object)]
pub struct NativeConversationVoiceTranscriptionCancelInput {
    pub request_id: String,
}

#[napi(object)]
pub struct NativeConversationVoiceRenderInput {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub message_id: String,
    pub request_id: String,
}

#[napi(object)]
pub struct NativeConversationScopeInput {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
}

#[napi(object)]
pub struct NativeEmbodimentSubscribeInput {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub after_sequence: String,
}

#[napi(object)]
pub struct NativeConversationStreamInput {
    pub stream_id: String,
}

#[napi(object)]
pub struct NativeAiRealtimeOpenInput {
    pub input_audio: JsonValue,
    pub audio_output_enabled: bool,
    pub turn_detection: String,
    pub initial_instruction: String,
}

#[napi(object)]
pub struct NativeAiRealtimeAppendInput {
    pub realtime_session_id: String,
    pub generation: String,
    pub input: JsonValue,
}

#[napi(object)]
pub struct NativeAiRealtimeOwnerControlInput {
    pub realtime_session_id: String,
    pub generation: String,
    pub request_id: String,
    pub control: String,
}

#[napi(object)]
pub struct NativeAiRealtimeSessionInput {
    pub realtime_session_id: String,
    pub generation: String,
}

#[napi(object)]
pub struct NativeAiRealtimeOutputInterruptInput {
    pub realtime_session_id: String,
    pub generation: String,
    pub output_track_id: String,
}

#[napi(object)]
pub struct NativeAgentRealtimeOpenInput {
    pub agent_handle: String,
    pub conversation_anchor_id: Option<String>,
    pub input_audio: JsonValue,
    pub turn_detection: String,
}

#[napi(object)]
pub struct NativeAgentRealtimeAppendInput {
    pub agent_handle: String,
    pub realtime_session_id: String,
    pub generation: String,
    pub input: JsonValue,
}

#[napi(object)]
pub struct NativeAgentRealtimeSessionInput {
    pub agent_handle: String,
    pub realtime_session_id: String,
    pub generation: String,
}

#[napi(object)]
pub struct NativeAgentRealtimeOutputInterruptInput {
    pub agent_handle: String,
    pub realtime_session_id: String,
    pub generation: String,
    pub output_track_id: String,
    pub interrupt_agent_turn: bool,
}

#[napi(object)]
pub struct NativeRealtimeStreamInput {
    pub stream_id: String,
}

#[napi(object)]
pub struct NativeRealmChatListInput {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[napi(object)]
pub struct NativeRealmRealtimeSubscribeInput {
    pub channel_id: String,
    pub target: JsonValue,
}

#[napi(object)]
pub struct NativeRealmRealtimeAckInput {
    pub channel_id: String,
    pub subscription_id: String,
    pub cursor: String,
}

#[napi(object)]
pub struct NativeRealmRealtimeSubscriptionInput {
    pub channel_id: String,
    pub subscription_id: String,
}

#[napi(object)]
pub struct NativeRealmRealtimeChannelInput {
    pub channel_id: String,
}

#[napi(object)]
pub struct NativeAgentHandleInput {
    pub agent_handle: String,
}

#[napi(object)]
pub struct NativeAgentPresentationAssetReadInput {
    pub agent_handle: String,
    pub asset_ref: String,
}

#[napi(object)]
pub struct NativeAgentMemoryInspectInput {
    pub agent_handle: String,
    pub limit: u32,
    pub page_token: String,
}

#[napi(object)]
pub struct NativeAgentManagerSnapshotInput {
    pub agent_handle: String,
    pub conversation_anchor_id: Option<String>,
}

#[napi(object)]
pub struct NativeAgentUpdateAutonomyInput {
    pub agent_handle: String,
    pub expected_autonomy_revision: String,
    pub intent: JsonValue,
}

#[napi(object)]
pub struct NativeAgentCommitPresentationInput {
    pub agent_handle: String,
    pub expected_presentation_revision: String,
    pub intent: JsonValue,
    pub imported_assets: JsonValue,
}

#[napi(object)]
pub struct NativeAgentMemoryCorrectInput {
    pub agent_handle: String,
    pub memory_id: String,
    pub corrected_content: String,
}

#[napi(object)]
pub struct NativeAgentMemoryForgetInput {
    pub agent_handle: String,
    pub memory_ids: Vec<String>,
    pub confirmed: bool,
}

#[napi(object)]
pub struct NativeAgentMemorySwitchInput {
    pub agent_handle: String,
    pub enabled: bool,
}

#[napi(object)]
pub struct NativeAgentMemoryDeleteInput {
    pub agent_handle: String,
    pub confirmed: bool,
}
