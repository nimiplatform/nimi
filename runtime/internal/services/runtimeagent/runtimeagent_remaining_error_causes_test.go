package runtimeagent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type failingSharedAIConfigStore struct{ err error }

func (s failingSharedAIConfigStore) Get(context.Context, string, *runtimev1.AIConfigOwner) (*runtimev1.AIConfig, string, bool, error) {
	return nil, "", false, s.err
}

func (s failingSharedAIConfigStore) Overwrite(context.Context, string, string, *runtimev1.AIConfig) (*runtimev1.AIConfig, string, bool, error) {
	return nil, "", false, s.err
}

type runtimeAgentTestStructPayload struct {
	values map[string]any
}

func (p runtimeAgentTestStructPayload) AsMap() map[string]any {
	return p.values
}

func TestSharedAIConfigReadPreservesRepositoryCause(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	svc.SetAIConfigStore(failingSharedAIConfigStore{err: errors.New("private store closed")})

	_, _, _, err := svc.readSharedLocalAgentAIConfig(context.Background(), "account-a")
	if err == nil {
		t.Fatal("expected repository error")
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

func TestSharedAIConfigReadClassifiesInvalidPersistedConfiguration(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	svc.SetAIConfigStore(failingSharedAIConfigStore{err: fmt.Errorf("stale row: %w", aiconfig.ErrInvalidPersistedConfig)})

	_, _, _, err := svc.readSharedLocalAgentAIConfig(context.Background(), "account-a")
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
		t.Fatalf("reason = %s, ok = %v, err = %v", reason, ok, err)
	}
	if got := status.Code(err); got != codes.FailedPrecondition {
		t.Fatalf("status code = %s, want FailedPrecondition", got)
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

func TestComposePublicChatTurnContextDoesNotReadFullSourceSnapshot(t *testing.T) {
	resolverCalls := 0
	svc := &Service{
		publicChatSourceSnapshotResolve: func(context.Context, string) (localAgentSourceSnapshotV2, bool, error) {
			resolverCalls++
			return localAgentSourceSnapshotV2{}, false, errors.New("turn must not read full source snapshot")
		},
	}

	_, err := svc.publicChatRuntime().composePublicChatTurnContext(
		context.Background(),
		publicChatAnchorState{AgentID: "agent-a", LocalAgentRef: "agent-a"},
		publicChatTurnState{TurnID: "turn-a"},
		publicChatTurnRequestPayload{},
	)
	if err == nil {
		t.Fatal("expected missing compact turn source view error")
	}
	if resolverCalls != 0 {
		t.Fatalf("ordinary turn read full source snapshot %d time(s)", resolverCalls)
	}
	publicCause := errors.Unwrap(err)
	if status.Code(publicCause) != codes.FailedPrecondition {
		t.Fatalf("status code = %s, want FailedPrecondition", status.Code(publicCause))
	}
	if strings.Contains(status.Convert(publicCause).Message(), "full source snapshot") {
		t.Fatalf("public status leaked full-source implementation detail: %q", status.Convert(publicCause).Message())
	}
}
