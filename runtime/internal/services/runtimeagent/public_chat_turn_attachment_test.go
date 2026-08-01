package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func publicChatAttachmentTestPayload(t *testing.T, mutate func(map[string]any)) *structpb.Struct {
	t.Helper()
	base := map[string]any{
		"local_agent_ref":        "local-agent:runtime-0123456789abcdef0123456789abcdef",
		"owner_user_id":          "user-1",
		"runtime_source_ref":     "runtime-source:realm",
		"conversation_anchor_id": "agent_anchor_test",
		"messages":               []any{map[string]any{"role": "user", "content": "hello"}},
	}
	if mutate != nil {
		mutate(base)
	}
	payload, err := structpb.NewStruct(base)
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	return payload
}

func TestPublicChatTurnRequestAttachmentDecodeAdmission(t *testing.T) {
	t.Run("text with one attachment", func(t *testing.T) {
		decoded, err := decodePublicChatTurnRequestPayload(publicChatAttachmentTestPayload(t, func(value map[string]any) {
			value["messages"] = []any{map[string]any{
				"role":        "user",
				"content":     "look at this",
				"attachments": []any{map[string]any{"artifact_id": "artifact_01J", "display_name": "photo.png"}},
			}}
		}))
		if err != nil {
			t.Fatalf("attachment payload must decode: %v", err)
		}
		if len(decoded.Messages) != 1 || len(decoded.Messages[0].Attachments) != 1 ||
			decoded.Messages[0].Attachments[0].ArtifactID != "artifact_01J" ||
			decoded.Messages[0].Attachments[0].DisplayName != "photo.png" {
			t.Fatalf("attachment decode mismatch: %#v", decoded.Messages)
		}
	})
	t.Run("attachment only without text", func(t *testing.T) {
		if _, err := decodePublicChatTurnRequestPayload(publicChatAttachmentTestPayload(t, func(value map[string]any) {
			value["messages"] = []any{map[string]any{
				"role":        "user",
				"content":     "",
				"attachments": []any{map[string]any{"artifact_id": "artifact_01J"}},
			}}
		})); err != nil {
			t.Fatalf("attachment-only payload must decode: %v", err)
		}
	})
	t.Run("no text and no attachment", func(t *testing.T) {
		if _, err := decodePublicChatTurnRequestPayload(publicChatAttachmentTestPayload(t, func(value map[string]any) {
			value["messages"] = []any{map[string]any{"role": "user", "content": ""}}
		})); err == nil {
			t.Fatal("empty content without attachment must fail closed")
		}
	})
	t.Run("two attachments", func(t *testing.T) {
		if _, err := decodePublicChatTurnRequestPayload(publicChatAttachmentTestPayload(t, func(value map[string]any) {
			value["messages"] = []any{map[string]any{
				"role":    "user",
				"content": "look",
				"attachments": []any{
					map[string]any{"artifact_id": "artifact_01J"},
					map[string]any{"artifact_id": "artifact_02K"},
				},
			}}
		})); err == nil {
			t.Fatal("more than one attachment must fail closed")
		}
	})
	t.Run("blank artifact id", func(t *testing.T) {
		if _, err := decodePublicChatTurnRequestPayload(publicChatAttachmentTestPayload(t, func(value map[string]any) {
			value["messages"] = []any{map[string]any{
				"role":        "user",
				"content":     "look",
				"attachments": []any{map[string]any{"artifact_id": "  "}},
			}}
		})); err == nil {
			t.Fatal("blank attachment artifact_id must fail closed")
		}
	})
}

func publicChatAttachmentTestRecord(owner *runtimeartifact.ArtifactOwner, mimeType string) runtimeartifact.ArtifactRecord {
	return runtimeartifact.ArtifactRecord{
		Bytes:    []byte("image-bytes"),
		MimeType: mimeType,
		Owner:    owner,
	}
}

func TestResolvePublicChatTurnAttachments(t *testing.T) {
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-1", AppID: "desktop.app"}
	messages := func(artifactID string) []publicChatMessagePayload {
		return []publicChatMessagePayload{{
			Role:        "user",
			Content:     "look",
			Attachments: []publicChatAttachmentPayload{{ArtifactID: artifactID, DisplayName: "photo.png"}},
		}}
	}
	t.Run("missing artifact", func(t *testing.T) {
		svc := &Service{runtimeArtifacts: runtimeartifact.NewMemoryStore()}
		_, err := svc.resolvePublicChatTurnAttachments("user-1", "desktop.app", messages("artifact_missing"))
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_NOT_FOUND {
			t.Fatalf("reason = %v, err=%v", reason, err)
		}
	})
	t.Run("ownerless record never authorizes", func(t *testing.T) {
		store := runtimeartifact.NewMemoryStore()
		if err := store.Put("artifact_ownerless", publicChatAttachmentTestRecord(nil, "image/png")); err != nil {
			t.Fatal(err)
		}
		svc := &Service{runtimeArtifacts: store}
		_, err := svc.resolvePublicChatTurnAttachments("user-1", "desktop.app", messages("artifact_ownerless"))
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
			t.Fatalf("reason = %v, err=%v", reason, err)
		}
	})
	t.Run("cross owner reference forbidden", func(t *testing.T) {
		store := runtimeartifact.NewMemoryStore()
		if err := store.Put("artifact_cross", publicChatAttachmentTestRecord(&runtimeartifact.ArtifactOwner{SubjectUserID: "user-2", AppID: "desktop.app"}, "image/png")); err != nil {
			t.Fatal(err)
		}
		svc := &Service{runtimeArtifacts: store}
		_, err := svc.resolvePublicChatTurnAttachments("user-1", "desktop.app", messages("artifact_cross"))
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
			t.Fatalf("reason = %v, err=%v", reason, err)
		}
	})
	t.Run("non image record rejected", func(t *testing.T) {
		store := runtimeartifact.NewMemoryStore()
		if err := store.Put("artifact_audio", publicChatAttachmentTestRecord(owner, "audio/wav")); err != nil {
			t.Fatal(err)
		}
		svc := &Service{runtimeArtifacts: store}
		_, err := svc.resolvePublicChatTurnAttachments("user-1", "desktop.app", messages("artifact_audio"))
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_UPLOAD_MIME_UNSUPPORTED {
			t.Fatalf("reason = %v, err=%v", reason, err)
		}
	})
	t.Run("happy path carries store trusted mime", func(t *testing.T) {
		store := runtimeartifact.NewMemoryStore()
		if err := store.Put("artifact_ok", publicChatAttachmentTestRecord(owner, "IMAGE/PNG")); err != nil {
			t.Fatal(err)
		}
		svc := &Service{runtimeArtifacts: store}
		resolved, err := svc.resolvePublicChatTurnAttachments("user-1", "desktop.app", messages("artifact_ok"))
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		if len(resolved) != 1 || resolved[0].ArtifactID != "artifact_ok" || resolved[0].MimeType != "image/png" || resolved[0].DisplayName != "photo.png" {
			t.Fatalf("resolved mismatch: %#v", resolved)
		}
	})
}

func TestValidRuntimeOwnedCurrentUserMessageWithAttachment(t *testing.T) {
	artifactPart := func() *runtimev1.ChatContentPart {
		return &runtimev1.ChatContentPart{
			Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF,
			Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{
				LocalArtifactId: "artifact_01J",
				MimeType:        "image/png",
			}},
		}
	}
	tests := []struct {
		name    string
		message *runtimev1.ChatMessage
		want    bool
	}{
		{name: "text only", message: &runtimev1.ChatMessage{Role: "user", Content: "hello"}, want: true},
		{name: "text with artifact image", message: &runtimev1.ChatMessage{Role: "user", Content: "look", Parts: []*runtimev1.ChatContentPart{artifactPart()}}, want: true},
		{name: "artifact image only", message: &runtimev1.ChatMessage{Role: "user", Parts: []*runtimev1.ChatContentPart{artifactPart()}}, want: true},
		{name: "empty without parts", message: &runtimev1.ChatMessage{Role: "user"}, want: false},
		{name: "two parts", message: &runtimev1.ChatMessage{Role: "user", Content: "look", Parts: []*runtimev1.ChatContentPart{artifactPart(), artifactPart()}}, want: false},
		{name: "non artifact part", message: &runtimev1.ChatMessage{Role: "user", Parts: []*runtimev1.ChatContentPart{{
			Type:    runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT,
			Content: &runtimev1.ChatContentPart_Text{Text: "hi"},
		}}}, want: false},
		{name: "non image artifact mime", message: &runtimev1.ChatMessage{Role: "user", Parts: []*runtimev1.ChatContentPart{{
			Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF,
			Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{
				LocalArtifactId: "artifact_01J",
				MimeType:        "audio/wav",
			}},
		}}}, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := validRuntimeOwnedCurrentUserMessage(test.message); got != test.want {
				t.Fatalf("validRuntimeOwnedCurrentUserMessage = %v, want %v", got, test.want)
			}
		})
	}
}

func TestPublicChatAttachmentTranscriptCommitAndProjection(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	attachment := &publicChatCommittedTranscriptAttachment{ArtifactID: "artifact_01J", MimeType: "image/png"}
	if err := svc.commitPublicChatTranscriptTurn(context.Background(), anchorID, "", publicChatTurnOriginUser, "", attachment, "I cannot view images on this route.", nil); err != nil {
		t.Fatalf("commit attachment-only turn: %v", err)
	}
	if err := svc.commitPublicChatTranscriptTurn(context.Background(), anchorID, "", publicChatTurnOriginUser, "", nil, "missing attachment must fail", nil); err == nil {
		t.Fatal("empty input without attachment must fail closed")
	}
	if err := svc.commitPublicChatTranscriptTurn(context.Background(), anchorID, "", publicChatTurnOriginFollowUp, "", attachment, "follow-up attachment must fail", nil); err == nil {
		t.Fatal("follow-up turns must not carry attachments")
	}

	snapshot := svc.chatAnchors[anchorID]
	if snapshot == nil || len(snapshot.CommittedTranscript) != 1 {
		t.Fatalf("committed transcript mismatch: %#v", snapshot)
	}
	committed := snapshot.CommittedTranscript[0]
	if committed.InputAttachment == nil || committed.InputAttachment.ArtifactID != "artifact_01J" || committed.InputAttachment.MimeType != "image/png" {
		t.Fatalf("committed attachment mismatch: %#v", committed.InputAttachment)
	}
	if err := validatePublicChatCommittedTranscript(snapshot.CommittedTranscript); err != nil {
		t.Fatalf("attachment transcript must validate: %v", err)
	}

	messages, err := publicChatTranscriptProjection(snapshot.CommittedTranscript)
	if err != nil {
		t.Fatalf("projection: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("projection message count = %d", len(messages))
	}
	user := messages[0]
	if user.GetRole() != "user" || user.GetContent() != "" || len(user.GetParts()) != 1 {
		t.Fatalf("user attachment message mismatch: %#v", user)
	}
	ref := user.GetParts()[0].GetArtifactRef()
	if ref.GetLocalArtifactId() != "artifact_01J" || ref.GetMimeType() != "image/png" {
		t.Fatalf("user attachment part mismatch: %#v", ref)
	}

	envelopes := publicChatMessageEnvelopePayloads(messages, anchorID, snapshot.CreatedAt, snapshot.UpdatedAt)
	if len(envelopes) != 2 {
		t.Fatalf("envelope count = %d", len(envelopes))
	}
	userEnvelope, ok := envelopes[0].(map[string]any)
	if !ok {
		t.Fatalf("user envelope type = %T", envelopes[0])
	}
	if userEnvelope["kind"] != "image" || userEnvelope["artifact_id"] != "artifact_01J" || userEnvelope["media_mime_type"] != "image/png" {
		t.Fatalf("user envelope mismatch: %#v", userEnvelope)
	}
	if content, present := userEnvelope["content"]; !present || content != "" {
		t.Fatalf("empty-content image message must be kept, envelope=%#v", userEnvelope)
	}
	assistantEnvelope, ok := envelopes[1].(map[string]any)
	if !ok || assistantEnvelope["kind"] != "text" {
		t.Fatalf("assistant envelope mismatch: %#v", envelopes[1])
	}
}

func TestPublicChatAttachmentTranscriptSurvivesRestart(t *testing.T) {
	statePath := t.TempDir() + "/runtime-state.json"
	svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	attachment := &publicChatCommittedTranscriptAttachment{ArtifactID: "artifact_restart", MimeType: "image/webp"}
	if err := svc.commitPublicChatTranscriptTurn(context.Background(), anchorID, "", publicChatTurnOriginUser, "", attachment, "kept but not processed.", nil); err != nil {
		t.Fatalf("commit attachment turn: %v", err)
	}
	closeSvc()

	restarted, closeRestarted := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	defer closeRestarted()
	restartedCapture := newPublicChatEmitCapture()
	snapshot := requestPublicChatSessionSnapshot(t, restarted, restartedCapture, anchorID, "snapshot-attachment-restart")
	detail := publicChatSessionSnapshotDetail(t, snapshot)
	transcript, ok := detail["transcript"].([]any)
	if !ok || len(transcript) != 2 {
		t.Fatalf("restart transcript mismatch: %#v", detail["transcript"])
	}
	userEnvelope, ok := transcript[0].(map[string]any)
	if !ok || userEnvelope["kind"] != "image" || userEnvelope["artifact_id"] != "artifact_restart" || userEnvelope["media_mime_type"] != "image/webp" {
		t.Fatalf("restart user envelope mismatch: %#v", transcript[0])
	}
}

func TestPublicChatVisionUnsupportedRouteCommitsAttachmentAndFailsTyped(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if err := svc.runtimeArtifacts.Put("artifact_vision", runtimeartifact.ArtifactRecord{
		Bytes:    []byte("png-bytes"),
		MimeType: "image/png",
		Owner:    &runtimeartifact.ArtifactOwner{SubjectUserID: "user-1", AppID: "desktop.app"},
	}); err != nil {
		t.Fatalf("seed artifact: %v", err)
	}
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, _ func(*runtimev1.StreamScenarioEvent) error) error {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
		},
	})
	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages": []any{map[string]any{
				"role":        "user",
				"content":     "look at this",
				"attachments": []any{map[string]any{"artifact_id": "artifact_vision", "display_name": "photo.png"}},
			}},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	failed := capture.waitForMessageType(t, publicChatTurnFailedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	failedDetail := failed.GetPayload().AsMap()["detail"]
	failedMap, _ := failedDetail.(map[string]any)
	if failedMap["reason_code"] != publicChatTurnAttachmentVisionUnsupportedReasonCode {
		t.Fatalf("turn.failed detail = %#v", failedMap)
	}
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatTurnMessageCommittedType || messageType == publicChatTurnCompletedType {
			t.Fatalf("vision-unsupported turn must not report success: %v", capture.messageTypes())
		}
	}

	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-vision-unsupported")
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if lastTurn["status"] != publicChatTurnStatusFailed || lastTurn["reason_code"] != publicChatTurnAttachmentVisionUnsupportedReasonCode {
		t.Fatalf("last_turn projection = %#v", lastTurn)
	}
	detail := publicChatSessionSnapshotDetail(t, snapshot)
	if got := detail["transcript_message_count"]; got != float64(2) {
		t.Fatalf("user attachment message must stay committed, transcript_message_count=%v", got)
	}
	transcript, _ := detail["transcript"].([]any)
	userEnvelope, _ := transcript[0].(map[string]any)
	if userEnvelope["kind"] != "image" || userEnvelope["artifact_id"] != "artifact_vision" || userEnvelope["media_mime_type"] != "image/png" || userEnvelope["content"] != "look at this" {
		t.Fatalf("user envelope = %#v", userEnvelope)
	}
	assistantEnvelope, _ := transcript[1].(map[string]any)
	if assistantEnvelope["role"] != "assistant" || assistantEnvelope["content"] != publicChatTurnAttachmentVisionUnsupportedBeatText {
		t.Fatalf("assistant failure beat = %#v", assistantEnvelope)
	}
}

func TestPublicChatCrossOwnerAttachmentReferenceRejected(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if err := svc.runtimeArtifacts.Put("artifact_foreign", runtimeartifact.ArtifactRecord{
		Bytes:    []byte("png-bytes"),
		MimeType: "image/png",
		Owner:    &runtimeartifact.ArtifactOwner{SubjectUserID: "user-1", AppID: "other.app"},
	}); err != nil {
		t.Fatalf("seed artifact: %v", err)
	}
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, _ func(*runtimev1.StreamScenarioEvent) error) error {
			return nil
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages": []any{map[string]any{
				"role":        "user",
				"content":     "look",
				"attachments": []any{map[string]any{"artifact_id": "artifact_foreign"}},
			}},
		}),
	})
	if err == nil {
		t.Fatal("cross-owner attachment reference must fail closed")
	}
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("reason = %v, err=%v", reason, err)
	}
	if types := capture.messageTypes(); len(types) != 0 {
		t.Fatalf("rejected turn must not emit events: %v", types)
	}
	if got := len(svc.chatAnchors[anchorID].CommittedTranscript); got != 0 {
		t.Fatalf("rejected turn must not commit, transcript len=%d", got)
	}
	if !strings.Contains(err.Error(), "ARTIFACT_FORBIDDEN") {
		t.Fatalf("typed forbidden error expected, got %v", err)
	}
}

// TestPublicChatVisionCapableRouteCompletesAttachmentTurn is the happy-path
// counterpart of TestPublicChatVisionUnsupportedRouteCommitsAttachmentAndFailsTyped:
// a route whose (fake) backend consumes the image part completes the
// attachment turn end to end. The provider-boundary request is inspected to
// prove the attachment reaches the model call as an artifact_ref part, and
// the committed transcript plus snapshot projection carry the user image
// message with its artifact reference and store-trusted mime. The table runs
// every admitted upload mime (png/jpeg/webp/gif) plus one attachment-only
// (textless) turn.
func TestPublicChatVisionCapableRouteCompletesAttachmentTurn(t *testing.T) {
	tests := []struct {
		name    string
		mime    string
		content string
	}{
		{name: "png", mime: "image/png", content: "look at this"},
		{name: "jpeg", mime: "image/jpeg", content: "look at this"},
		{name: "webp", mime: "image/webp", content: "look at this"},
		{name: "gif", mime: "image/gif", content: "look at this"},
		{name: "attachment only png", mime: "image/png", content: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			artifactID := "artifact_happy_" + strings.ReplaceAll(test.name, " ", "_")
			if err := svc.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
				Bytes:    []byte("image-bytes-" + test.mime),
				MimeType: test.mime,
				Owner:    &runtimeartifact.ArtifactOwner{SubjectUserID: "user-1", AppID: "desktop.app"},
			}); err != nil {
				t.Fatalf("seed artifact: %v", err)
			}
			assistantText := "I can see your " + test.mime + " image."
			var observedArtifactID, observedMime, observedDisplayName string
			mediaMessageCount := 0
			capture := newPublicChatEmitCapture()
			svc.SetPublicChatAppEmitter(capture.emit)
			svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
			svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
				stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
					for _, message := range req.Messages {
						if len(message.GetParts()) == 0 {
							continue
						}
						mediaMessageCount++
						if message.GetRole() != "user" || len(message.GetParts()) != 1 {
							continue
						}
						if ref := message.GetParts()[0].GetArtifactRef(); ref != nil {
							observedArtifactID = ref.GetLocalArtifactId()
							observedMime = ref.GetMimeType()
							observedDisplayName = ref.GetDisplayName()
						}
					}
					if err := emit(&runtimev1.StreamScenarioEvent{
						EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
						TraceId:   "trace-happy-" + test.name,
						Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
							ModelResolved: "qwen3-vl",
							RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
						}},
					}); err != nil {
						return err
					}
					if err := emit(&runtimev1.StreamScenarioEvent{
						EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
						TraceId:   "trace-happy-" + test.name,
						Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
							Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{
								Text: publicChatStructuredEnvelopeAPML("message-happy-"+test.name, assistantText),
							}},
						}},
					}); err != nil {
						return err
					}
					return emit(&runtimev1.StreamScenarioEvent{
						EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
						TraceId:   "trace-happy-" + test.name,
						Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
							FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
						}},
					})
				},
			})
			if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
				ToAppId:       publicChatRuntimeAppID,
				FromAppId:     "desktop.app",
				SubjectUserId: "user-1",
				MessageType:   publicChatTurnRequestType,
				Payload: publicChatStructPayload(t, map[string]any{
					"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
					"owner_user_id":          "user-1",
					"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
					"conversation_anchor_id": anchorID,
					"messages": []any{map[string]any{
						"role":        "user",
						"content":     test.content,
						"attachments": []any{map[string]any{"artifact_id": artifactID, "display_name": "photo.png"}},
					}},
				}),
			}); err != nil {
				t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
			}
			_ = capture.waitForMessageType(t, publicChatTurnStartedType)
			_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
			_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
			_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
			waitForPublicChatAgentIdle(t, svc, "agent-alpha")
			for _, messageType := range capture.messageTypes() {
				if messageType == publicChatTurnFailedType || messageType == publicChatTurnInterruptedType {
					t.Fatalf("happy-path attachment turn emitted %s: %v", messageType, capture.messageTypes())
				}
			}
			if mediaMessageCount != 1 || observedArtifactID != artifactID || observedMime != test.mime || observedDisplayName != "photo.png" {
				t.Fatalf("attachment did not reach the model call as an artifact_ref part: messages_with_parts=%d ref=(%q, %q, %q)",
					mediaMessageCount, observedArtifactID, observedMime, observedDisplayName)
			}

			snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-happy-"+test.name)
			lastTurn := publicChatLastTurnSnapshot(t, snapshot)
			if lastTurn["status"] != publicChatTurnStatusCompleted {
				t.Fatalf("last_turn status = %#v", lastTurn)
			}
			if reasonCode, present := lastTurn["reason_code"]; present {
				t.Fatalf("completed turn must not carry a failure reason: %v", reasonCode)
			}
			detail := publicChatSessionSnapshotDetail(t, snapshot)
			if got := detail["transcript_message_count"]; got != float64(2) {
				t.Fatalf("transcript_message_count = %v", got)
			}
			transcript, _ := detail["transcript"].([]any)
			if len(transcript) != 2 {
				t.Fatalf("transcript envelope count = %d", len(transcript))
			}
			userEnvelope, _ := transcript[0].(map[string]any)
			if userEnvelope["kind"] != "image" || userEnvelope["artifact_id"] != artifactID ||
				userEnvelope["media_mime_type"] != test.mime || userEnvelope["content"] != test.content ||
				userEnvelope["role"] != "user" {
				t.Fatalf("user image envelope = %#v", userEnvelope)
			}
			assistantEnvelope, _ := transcript[1].(map[string]any)
			if assistantEnvelope["role"] != "assistant" || assistantEnvelope["kind"] != "text" || assistantEnvelope["content"] != assistantText {
				t.Fatalf("assistant envelope = %#v", assistantEnvelope)
			}
			if assistantEnvelope["content"] == publicChatTurnAttachmentVisionUnsupportedBeatText {
				t.Fatal("vision-capable route must not emit the vision-unsupported failure beat")
			}

			committed := svc.chatAnchors[anchorID].CommittedTranscript
			if len(committed) != 1 || committed[0].InputAttachment == nil ||
				committed[0].InputAttachment.ArtifactID != artifactID || committed[0].InputAttachment.MimeType != test.mime ||
				committed[0].InputText != test.content || committed[0].AssistantText != assistantText {
				t.Fatalf("committed transcript turn = %#v", committed)
			}
		})
	}
}
