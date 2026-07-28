package runtimeagent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type runtimeAgentTestStructPayload struct {
	values map[string]any
}

func (p runtimeAgentTestStructPayload) AsMap() map[string]any {
	return p.values
}

type runtimeAgentTestLocalAppAuthorizationError struct {
	reason runtimev1.ReasonCode
}

func (e runtimeAgentTestLocalAppAuthorizationError) Error() string {
	return "private local-app authorization detail"
}

func (e runtimeAgentTestLocalAppAuthorizationError) LocalAppOperationReasonCode() runtimev1.ReasonCode {
	return e.reason
}

func TestCommittedRuntimeAgentAIConfigPreservesRepositoryCause(t *testing.T) {
	svc, closeService := newAgentAIConfigTestServiceWithClose(t, t.TempDir()+"/runtime-state.json")
	closeService()

	_, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(runtimeAgentAIConfigTestLocalRef)
	if err == nil {
		t.Fatal("expected closed repository error")
	}
	if errors.Unwrap(err) == nil {
		t.Fatalf("repository cause was discarded: %T: %v", err, err)
	}
	if got := status.Code(err); got != codes.Internal {
		t.Fatalf("status code = %s, want Internal", got)
	}
	if strings.Contains(strings.ToLower(status.Convert(err).Message()), "closed") {
		t.Fatalf("public status leaked repository detail: %q", status.Convert(err).Message())
	}
}

func TestDecodePublicChatTurnPayloadPreservesJSONCause(t *testing.T) {
	_, err := decodePublicChatTurnRequestPayload(runtimeAgentTestStructPayload{values: map[string]any{
		"messages": "private-invalid-message-shape",
	}})
	if err == nil {
		t.Fatal("expected invalid payload error")
	}
	var typeErr *json.UnmarshalTypeError
	if !errors.As(err, &typeErr) {
		t.Fatalf("expected json.UnmarshalTypeError cause, got %T: %v", errors.Unwrap(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("reason = %s, ok = %v", reason, ok)
	}
	if strings.Contains(status.Convert(err).Message(), "private-invalid-message-shape") {
		t.Fatalf("public status leaked payload detail: %q", status.Convert(err).Message())
	}
}

func TestDecodeChatTrackSidecarIngressPreservesProtoJSONCause(t *testing.T) {
	_, err := decodeChatTrackSidecarIngressPayload(runtimeAgentTestStructPayload{values: map[string]any{
		"agent_id":        "agent-a",
		"source_event_id": "event-a",
		"thread_id":       "thread-a",
		"messages": []any{
			map[string]any{"role": 42, "content": "private-message-content"},
		},
	}})
	if err == nil {
		t.Fatal("expected invalid sidecar message error")
	}
	if errors.Unwrap(err) == nil {
		t.Fatalf("protojson cause was discarded: %T: %v", err, err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("reason = %s, ok = %v", reason, ok)
	}
	if strings.Contains(status.Convert(err).Message(), "private-message-content") {
		t.Fatalf("public status leaked message detail: %q", status.Convert(err).Message())
	}
}

func TestCompanionParticipationPayloadPreservesStructCause(t *testing.T) {
	privateValue := make(chan struct{})
	_, err := newCompanionParticipationPayload(map[string]any{
		"private": privateValue,
	}, "companion participation request payload invalid")
	if err == nil {
		t.Fatal("expected invalid struct payload error")
	}
	if errors.Unwrap(err) == nil {
		t.Fatalf("structpb cause was discarded: %T: %v", err, err)
	}
	if strings.Contains(status.Convert(err).Message(), "chan") {
		t.Fatalf("public status leaked struct detail: %q", status.Convert(err).Message())
	}
}

func TestLocalAppConversationAuthorizationErrorPreservesCauseAndReason(t *testing.T) {
	cause := runtimeAgentTestLocalAppAuthorizationError{
		reason: runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED,
	}
	err := localAppConversationAuthorizationError(cause)
	if !errors.Is(err, cause) {
		t.Fatalf("authorization cause was discarded: %T: %v", errors.Unwrap(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED {
		t.Fatalf("reason = %s, ok = %v", reason, ok)
	}
	if strings.Contains(status.Convert(err).Message(), cause.Error()) {
		t.Fatalf("public status leaked authorization detail: %q", status.Convert(err).Message())
	}
}

func TestComposePublicChatTurnContextPreservesSourceSnapshotCause(t *testing.T) {
	cause := errors.New("private source snapshot repository path")
	svc := &Service{
		publicChatSourceSnapshotResolve: func(context.Context, string) (localAgentSourceSnapshotV2, bool, error) {
			return localAgentSourceSnapshotV2{}, false, cause
		},
	}

	_, err := svc.publicChatRuntime().composePublicChatTurnContext(
		context.Background(),
		publicChatAnchorState{AgentID: "agent-a", LocalAgentRef: "agent-a"},
		publicChatTurnState{TurnID: "turn-a"},
		publicChatTurnRequestPayload{},
	)
	if err == nil {
		t.Fatal("expected source snapshot load error")
	}
	if !errors.Is(err, cause) {
		t.Fatalf("source snapshot cause was discarded: %T: %v", errors.Unwrap(err), err)
	}
	publicCause := errors.Unwrap(err)
	if status.Code(publicCause) != codes.DataLoss {
		t.Fatalf("status code = %s, want DataLoss", status.Code(publicCause))
	}
	if strings.Contains(status.Convert(publicCause).Message(), "private source snapshot") {
		t.Fatalf("public status leaked source snapshot detail: %q", status.Convert(publicCause).Message())
	}
}
