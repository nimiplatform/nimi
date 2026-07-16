package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSubscribeAgentVoiceStreamAdmitsExactLocalAppPrincipalScope(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetAuditStore(auditlog.New(64, 64))
	const appID = "world.nimi.zhiyu"
	const principalID = "lap_v1_zhiyu_voice_stream"
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", appID, "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-local-app-voice",
		StreamID:             "stream-local-app-voice",
		AgentID:              localAgentRef,
		CallerAppID:          appID,
		SubjectUserID:        "user-1",
		TimelineStartedAt:    time.Now().UTC(),
	}
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].LocalAppPrincipalID = principalID
	svc.chatTurns[turn.TurnID] = &turn
	svc.chatSurfaceMu.Unlock()
	voiceStreamID := "runtime-agent-voice-stream:local-app"
	svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: anchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            "message-local-app-voice",
		ChunkSequence:        1,
		Chunk:                []byte("RIFF-local-app"),
		MimeType:             "audio/wav",
		Terminal:             true,
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_COMPLETED,
	})
	decision := accountservice.LocalAppCallerDecision{
		AppID: appID, AccountID: "user-1", LocalAppPrincipalID: principalID, LocalAppRecordID: "lar_v1_zhiyu_voice_stream",
		Operation: accountservice.LocalAppOperationVoiceStreamSubscribe, PermissionScope: "runtime.agent.voice.read",
	}
	streamContext := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	capture := newAgentVoiceStreamCaptureStreamLimit(streamContext, 1)
	err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		AgentId: localAgentRef, ConversationAnchorId: anchorID, TurnId: turn.TurnID, VoiceStreamId: voiceStreamID,
	}, capture)
	if err != nil {
		t.Fatalf("SubscribeAgentVoiceStream(local app): %v", err)
	}
	if len(capture.events) != 1 || string(capture.events[0].GetChunk()) != "RIFF-local-app" || !capture.events[0].GetTerminal() {
		t.Fatalf("local-app voice events = %#v", capture.events)
	}
	events, listErr := svc.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.agent.local_app_voice"})
	if listErr != nil || len(events.GetEvents()) != 1 || events.GetEvents()[0].GetOperation() != string(accountservice.LocalAppOperationVoiceStreamSubscribe) {
		t.Fatalf("voice subscription audit = (%#v, %v)", events, listErr)
	}
	fields := events.GetEvents()[0].GetPayload().GetFields()
	if len(fields) != 1 || fields["backlog_event_count"].GetNumberValue() != 1 {
		t.Fatalf("voice subscription audit payload = %#v", fields)
	}
}

func TestSubscribeAgentVoiceStreamRejectsMixedLocalAndOrdinaryRequestShape(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetAuditStore(auditlog.New(64, 64))
	decision := accountservice.LocalAppCallerDecision{
		AppID: "world.nimi.zhiyu", AccountID: "user-1", LocalAppPrincipalID: "lap_v1_voice", LocalAppRecordID: "lar_v1_voice",
		Operation: accountservice.LocalAppOperationVoiceStreamSubscribe, PermissionScope: "runtime.agent.voice.read",
	}
	capture := newAgentVoiceStreamCaptureStreamLimit(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), 1)
	err := svc.SubscribeAgentVoiceStream(&runtimev1.SubscribeAgentVoiceStreamRequest{
		Context: testRuntimeAgentIdentityContext("agent-alpha"), AgentId: testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: "anchor-mixed", TurnId: "turn-mixed", VoiceStreamId: "voice-mixed",
	}, capture)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("mixed request shape code = %s err=%v", status.Code(err), err)
	}
}
