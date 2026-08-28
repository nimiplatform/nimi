package runtimeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
)

const chatTrackSidecarIngressType = "agent.chat_track.sidecar_input.v1"

type chatTrackSidecarIngressPayload struct {
	AgentID       string            `json:"agent_id"`
	SourceEventID string            `json:"source_event_id"`
	ThreadID      string            `json:"thread_id"`
	Messages      []json.RawMessage `json:"messages"`
}

type ChatTrackSidecarResult struct {
	PosturePatch         *BehavioralPosturePatch
	CancelPendingHookIDs []string
	// NextHookIntent carries a model-proposed follow-up HookIntent per
	// K-AGCORE-041. Runtime admission validates and finalizes it.
	NextHookIntent *runtimev1.HookIntent
}

func (s *Service) ConsumeChatTrackSidecarAppMessage(ctx context.Context, event *runtimev1.AppMessageEvent) error {
	return s.chatTrackRuntime().consumeSidecarAppMessage(ctx, event)
}

func (s *Service) ApplyChatTrackSidecar(ctx context.Context, agentID string, sourceEventID string, result ChatTrackSidecarResult) error {
	return s.chatTrackRuntime().applySidecarResult(ctx, agentID, sourceEventID, result)
}

func (s *Service) applyChatTrackSidecar(ctx context.Context, agentID string, sourceEventID string, result ChatTrackSidecarResult) (*ChatTrackSidecarApplySummary, error) {
	return s.chatTrackRuntime().applySidecar(ctx, agentID, sourceEventID, result)
}

func validateChatTrackSidecarCancelHookIDs(entry *agentEntry, values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		hookID := strings.TrimSpace(value)
		if hookID == "" {
			return nil, status.Error(codes.InvalidArgument, "chat sidecar cancel_pending_hook_ids must not contain empty hook ids")
		}
		if _, ok := seen[hookID]; ok {
			continue
		}
		hook := entry.Hooks[hookID]
		if hook == nil {
			return nil, status.Error(codes.NotFound, "hook not found")
		}
		if !isCancelableAdmissionState(hookAdmissionState(hook)) {
			return nil, status.Error(codes.FailedPrecondition, "hook is not cancelable")
		}
		seen[hookID] = struct{}{}
		out = append(out, hookID)
	}
	return out, nil
}

func decodeChatTrackSidecarIngressPayload(payload any) (ChatTrackSidecarExecutionRequest, error) {
	structPayload, ok := payload.(interface{ AsMap() map[string]any })
	if !ok || structPayload == nil {
		return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar payload is required")
	}
	raw, err := json.Marshal(structPayload.AsMap())
	if err != nil {
		return ChatTrackSidecarExecutionRequest{}, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "chat track sidecar payload invalid"},
		)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var decoded chatTrackSidecarIngressPayload
	if err := decoder.Decode(&decoded); err != nil {
		return ChatTrackSidecarExecutionRequest{}, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "chat track sidecar payload invalid"},
		)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar payload must contain one object")
		}
		return ChatTrackSidecarExecutionRequest{}, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "chat track sidecar payload invalid"},
		)
	}
	agentID := strings.TrimSpace(decoded.AgentID)
	sourceEventID := strings.TrimSpace(decoded.SourceEventID)
	threadID := strings.TrimSpace(decoded.ThreadID)
	if agentID == "" || sourceEventID == "" || threadID == "" {
		return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar payload fields required")
	}
	if len(decoded.Messages) == 0 {
		return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar messages required")
	}
	messages := make([]*runtimev1.ChatMessage, 0, len(decoded.Messages))
	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
	for _, item := range decoded.Messages {
		message := &runtimev1.ChatMessage{}
		if err := unmarshal.Unmarshal(item, message); err != nil {
			return ChatTrackSidecarExecutionRequest{}, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "chat track sidecar message invalid"},
			)
		}
		if strings.TrimSpace(message.GetRole()) == "" {
			return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar message role required")
		}
		if strings.TrimSpace(message.GetContent()) == "" && len(message.GetParts()) == 0 {
			return ChatTrackSidecarExecutionRequest{}, status.Error(codes.InvalidArgument, "chat track sidecar message content required")
		}
		messages = append(messages, message)
	}
	return ChatTrackSidecarExecutionRequest{
		AgentID:       agentID,
		SourceEventID: sourceEventID,
		Messages:      messages,
	}, nil
}
