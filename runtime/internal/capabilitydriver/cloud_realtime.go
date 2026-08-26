package capabilitydriver

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	RealtimeInteractCapabilityContract = "realtime.interact"
	dashScopeRealtimeEndpoint          = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
)

type CloudRealtimeTarget struct {
	provider             string
	providerModelID      string
	remoteModelCatalogID string
	region               string
}

func (t CloudRealtimeTarget) Provider() string             { return t.provider }
func (t CloudRealtimeTarget) ProviderModelID() string      { return t.providerModelID }
func (t CloudRealtimeTarget) RemoteModelCatalogID() string { return t.remoteModelCatalogID }
func (t CloudRealtimeTarget) Region() string               { return t.region }

type CloudRealtimeOpen struct {
	InputAudio         *runtimev1.AiRealtimeAudioFormat
	AudioOutput        bool
	TurnDetection      runtimev1.AiRealtimeTurnDetectionMode
	InitialInstruction string
}

type CloudRealtimeEventKind uint8

const (
	CloudRealtimeEventReady CloudRealtimeEventKind = iota + 1
	CloudRealtimeEventSpeechStarted
	CloudRealtimeEventSpeechStopped
	CloudRealtimeEventInputCommitted
	CloudRealtimeEventTranscriptPartial
	CloudRealtimeEventTranscriptFinal
	CloudRealtimeEventInputTranscriptionFailed
	CloudRealtimeEventOutputStarted
	CloudRealtimeEventTextDelta
	CloudRealtimeEventTextFinal
	CloudRealtimeEventAudioDelta
	CloudRealtimeEventAudioDone
	CloudRealtimeEventResponseDone
	CloudRealtimeEventFailed
)

type CloudRealtimeResponseStatus uint8

const (
	CloudRealtimeResponseStatusCompleted CloudRealtimeResponseStatus = iota + 1
	CloudRealtimeResponseStatusCancelled
	CloudRealtimeResponseStatusFailed
)

type CloudRealtimeEvent struct {
	Kind               CloudRealtimeEventKind
	ProviderResponseID string
	ProviderItemID     string
	Text               string
	Audio              []byte
	Usage              *runtimev1.UsageStats
	ErrorCode          string
	ResponseStatus     CloudRealtimeResponseStatus
}

type CloudRealtimeDriver interface {
	ValidateTarget(Identity, *structpb.Struct) (CloudRealtimeTarget, error)
	Endpoint(CloudRealtimeTarget) string
	MapOpen(string, CloudRealtimeTarget, CloudRealtimeOpen) ([]byte, error)
	MapInput(string, *runtimev1.AppendRealtimeInputRequest) ([]byte, error)
	MapOwnerControl(string, *runtimev1.SubmitRealtimeOwnerControlRequest) ([]byte, error)
	MapInterrupt(string, string) ([]byte, error)
	NormalizeEvent([]byte) ([]CloudRealtimeEvent, error)
	NormalizeReason(error) error
}

type CloudRealtimeRegistry struct {
	drivers map[string]CloudRealtimeDriver
}

func NewProductionCloudRealtimeRegistry() *CloudRealtimeRegistry {
	drivers := make(map[string]CloudRealtimeDriver)
	if record, ok := providerregistry.Lookup("dashscope"); ok && record.RuntimePlane == "remote" && record.SupportsRealtime {
		drivers["dashscope"] = dashScopeRealtimeDriver{}
	}
	return &CloudRealtimeRegistry{drivers: drivers}
}

func (r *CloudRealtimeRegistry) Resolve(identity Identity, raw *structpb.Struct) (CloudRealtimeDriver, CloudRealtimeTarget, error) {
	provider, ok := exactCloudTargetText(raw, "provider")
	if !ok || r == nil {
		return nil, CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud Realtime provider target is required"))
	}
	driver := r.drivers[provider]
	if driver == nil {
		return nil, CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud Realtime provider %q has no admitted Driver", provider))
	}
	target, err := driver.ValidateTarget(identity, raw)
	return driver, target, err
}

type dashScopeRealtimeDriver struct{}

func (dashScopeRealtimeDriver) ValidateTarget(identity Identity, raw *structpb.Struct) (CloudRealtimeTarget, error) {
	if identity.ImplementationID != "cloud.realtime.interact.dashscope" ||
		identity.DriverID != "nimi.runtime.driver.dashscope" || identity.DriverDialect != "dashscope/realtime/v1" {
		return CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("DashScope Realtime implementation identity is invalid"))
	}
	if raw == nil || len(raw.GetFields()) == 0 {
		return CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("DashScope Realtime target is required"))
	}
	for key := range raw.GetFields() {
		switch key {
		case "provider", "providerModelId", "remoteModelCatalogId", "region":
		default:
			return CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("DashScope Realtime target field %q is unsupported", key))
		}
	}
	provider, providerOK := exactCloudTargetText(raw, "provider")
	model, modelOK := exactCloudTargetText(raw, "providerModelId")
	catalogID, catalogOK := exactCloudTargetText(raw, "remoteModelCatalogId")
	if !providerOK || provider != "dashscope" || !modelOK || model != "qwen3.5-omni-flash-realtime" || !catalogOK {
		return CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("DashScope Realtime target is not admitted"))
	}
	region := ""
	if _, present := raw.GetFields()["region"]; present {
		var ok bool
		region, ok = exactCloudTargetText(raw, "region")
		if !ok {
			return CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("DashScope Realtime region is invalid"))
		}
	}
	return CloudRealtimeTarget{provider: provider, providerModelID: model, remoteModelCatalogID: catalogID, region: region}, nil
}

func (dashScopeRealtimeDriver) Endpoint(CloudRealtimeTarget) string { return dashScopeRealtimeEndpoint }

func (dashScopeRealtimeDriver) MapOpen(eventID string, target CloudRealtimeTarget, input CloudRealtimeOpen) ([]byte, error) {
	if target.provider != "dashscope" || target.providerModelID != "qwen3.5-omni-flash-realtime" ||
		input.InputAudio == nil || input.InputAudio.GetCodec() != runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE ||
		input.InputAudio.GetSampleRateHz() != 16000 || input.InputAudio.GetChannelCount() != 1 {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("DashScope Realtime Open format is unsupported"))
	}
	turnDetection := any(nil)
	if input.TurnDetection == runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD {
		turnDetection = map[string]any{
			"type": "server_vad", "threshold": 0.5, "silence_duration_ms": 800, "create_response": false,
		}
	} else if input.TurnDetection != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("DashScope Realtime turn detection mode is unsupported"))
	}
	modalities := []string{"text"}
	if input.AudioOutput {
		modalities = []string{"text", "audio"}
	}
	session := map[string]any{
		"modalities":                modalities,
		"input_audio_format":        "pcm",
		"output_audio_format":       "pcm",
		"input_audio_transcription": map[string]any{"model": "qwen3-asr-flash-realtime"},
		"turn_detection":            turnDetection,
	}
	if instruction := strings.TrimSpace(input.InitialInstruction); instruction != "" {
		session["instructions"] = instruction
	}
	return json.Marshal(map[string]any{"event_id": eventID, "type": "session.update", "session": session})
}

func (dashScopeRealtimeDriver) MapInput(eventID string, req *runtimev1.AppendRealtimeInputRequest) ([]byte, error) {
	if req == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime input is required"))
	}
	switch input := req.GetInput().(type) {
	case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
		if input.AudioFrame == nil || len(input.AudioFrame.GetFrame()) == 0 {
			return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime audio frame is required"))
		}
		return json.Marshal(map[string]any{
			"event_id": eventID, "type": "input_audio_buffer.append",
			"audio": base64.StdEncoding.EncodeToString(input.AudioFrame.GetFrame()),
		})
	case *runtimev1.AppendRealtimeInputRequest_Text:
		if input.Text == nil || strings.TrimSpace(input.Text.GetText()) == "" {
			return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime text input is required"))
		}
		return dashScopeConversationText(eventID, "user", input.Text.GetText())
	case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
		if input.OwnerContext == nil || strings.TrimSpace(input.OwnerContext.GetText()) == "" ||
			input.OwnerContext.GetKind() == runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_UNSPECIFIED {
			return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime owner context is required"))
		}
		return dashScopeConversationText(eventID, "system", input.OwnerContext.GetText())
	default:
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime input variant is unsupported"))
	}
}

func dashScopeConversationText(eventID string, role string, text string) ([]byte, error) {
	return json.Marshal(map[string]any{
		"event_id": eventID, "type": "conversation.item.create",
		"item": map[string]any{
			"type": "message", "role": role,
			"content": []map[string]any{{"type": "input_text", "text": text}},
		},
	})
}

func (dashScopeRealtimeDriver) MapOwnerControl(eventID string, req *runtimev1.SubmitRealtimeOwnerControlRequest) ([]byte, error) {
	if req == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime owner control is required"))
	}
	var eventType string
	switch req.GetControl() {
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT:
		eventType = "input_audio_buffer.commit"
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE,
		runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE:
		eventType = "response.create"
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_PAUSE_RESPONSE,
		runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CANCEL_RESPONSE:
		eventType = "response.cancel"
	default:
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime owner control is unsupported"))
	}
	return json.Marshal(map[string]any{"event_id": eventID, "type": eventType})
}

func (dashScopeRealtimeDriver) MapInterrupt(eventID string, providerResponseID string) ([]byte, error) {
	if strings.TrimSpace(providerResponseID) == "" {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime output track is required"))
	}
	return json.Marshal(map[string]any{
		"event_id":    eventID,
		"type":        "response.cancel",
		"response_id": providerResponseID,
	})
}

type dashScopeRealtimeServerEvent struct {
	Type       string `json:"type"`
	ResponseID string `json:"response_id"`
	ItemID     string `json:"item_id"`
	Delta      string `json:"delta"`
	Text       string `json:"text"`
	Stash      string `json:"stash"`
	Transcript string `json:"transcript"`
	Response   struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Usage  struct {
			InputTokens  int64 `json:"input_tokens"`
			OutputTokens int64 `json:"output_tokens"`
		} `json:"usage"`
	} `json:"response"`
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
}

func (dashScopeRealtimeDriver) NormalizeEvent(raw []byte) ([]CloudRealtimeEvent, error) {
	var event dashScopeRealtimeServerEvent
	if len(raw) == 0 || json.Unmarshal(raw, &event) != nil || strings.TrimSpace(event.Type) == "" {
		return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("DashScope Realtime event is invalid"))
	}
	normalized := CloudRealtimeEvent{ProviderResponseID: firstExact(event.ResponseID, event.Response.ID), ProviderItemID: event.ItemID}
	switch event.Type {
	case "session.created":
		return nil, nil
	case "session.updated":
		normalized.Kind = CloudRealtimeEventReady
	case "input_audio_buffer.speech_started":
		normalized.Kind = CloudRealtimeEventSpeechStarted
	case "input_audio_buffer.speech_stopped":
		normalized.Kind = CloudRealtimeEventSpeechStopped
	case "input_audio_buffer.committed":
		if strings.TrimSpace(event.ItemID) == "" {
			return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("DashScope Realtime committed input identity is missing"))
		}
		normalized.Kind = CloudRealtimeEventInputCommitted
	case "conversation.item.input_audio_transcription.text", "conversation.item.input_audio_transcription.delta":
		normalized.Kind, normalized.Text = CloudRealtimeEventTranscriptPartial, event.Text+event.Stash
	case "conversation.item.input_audio_transcription.completed":
		normalized.Kind, normalized.Text = CloudRealtimeEventTranscriptFinal, event.Transcript
	case "conversation.item.input_audio_transcription.failed":
		normalized.Kind, normalized.ErrorCode = CloudRealtimeEventInputTranscriptionFailed, strings.TrimSpace(event.Error.Code)
	case "response.created":
		normalized.Kind = CloudRealtimeEventOutputStarted
	case "response.audio_transcript.delta", "response.text.delta":
		normalized.Kind, normalized.Text = CloudRealtimeEventTextDelta, event.Delta
	case "response.audio_transcript.done":
		normalized.Kind, normalized.Text = CloudRealtimeEventTextFinal, event.Transcript
	case "response.text.done":
		normalized.Kind, normalized.Text = CloudRealtimeEventTextFinal, event.Text
	case "response.audio.delta":
		audio, err := base64.StdEncoding.DecodeString(event.Delta)
		if err != nil || len(audio) == 0 {
			return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("DashScope Realtime audio frame is invalid"))
		}
		normalized.Kind, normalized.Audio = CloudRealtimeEventAudioDelta, audio
	case "response.audio.done":
		normalized.Kind = CloudRealtimeEventAudioDone
	case "response.done":
		normalized.Kind = CloudRealtimeEventResponseDone
		switch strings.TrimSpace(event.Response.Status) {
		case "completed":
			normalized.ResponseStatus = CloudRealtimeResponseStatusCompleted
		case "cancelled", "canceled":
			normalized.ResponseStatus = CloudRealtimeResponseStatusCancelled
		case "failed", "incomplete":
			normalized.ResponseStatus = CloudRealtimeResponseStatusFailed
		default:
			return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("DashScope Realtime response terminal status is invalid"))
		}
		normalized.Usage = &runtimev1.UsageStats{InputTokens: event.Response.Usage.InputTokens, OutputTokens: event.Response.Usage.OutputTokens}
	case "error":
		normalized.Kind, normalized.ErrorCode = CloudRealtimeEventFailed, strings.TrimSpace(event.Error.Code)
	default:
		return nil, nil
	}
	return []CloudRealtimeEvent{normalized}, nil
}

func (dashScopeRealtimeDriver) NormalizeReason(err error) error { return err }

func firstExact(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) == value && value != "" {
			return value
		}
	}
	return ""
}
