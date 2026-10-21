package runtimeagent

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"strings"
)

// validateHookIntent enforces the narrow follow-up admission matrix.
func validateHookIntent(intent *runtimev1.HookIntent) error {
	if intent == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if strings.TrimSpace(intent.GetIntentId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	// agent_id must be present once admitted; proposers (model-side) may emit
	// the field empty and runtime fills it at admission. This validator is
	// called both for proposal and admission paths; the caller sets agent_id.
	if intent.GetEffect() != runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	detail := intent.GetTriggerDetail()
	if detail == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch intent.GetTriggerFamily() {
	case runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME:
		timeDetail := detail.GetTime()
		if timeDetail == nil || timeDetail.GetDelay() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if detail.GetEventUserIdle() != nil || detail.GetEventChatEnded() != nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if timeDetail.GetDelay().AsDuration() < 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT:
		hasUserIdle := detail.GetEventUserIdle() != nil
		hasChatEnded := detail.GetEventChatEnded() != nil
		if !hasUserIdle && !hasChatEnded {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if hasUserIdle && hasChatEnded {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if detail.GetTime() != nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if hasUserIdle && detail.GetEventUserIdle().GetIdleFor() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if intent.GetNotBefore() != nil && intent.GetExpiresAt() != nil &&
		intent.GetExpiresAt().AsTime().Before(intent.GetNotBefore().AsTime()) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func cloneHookIntent(input *runtimev1.HookIntent) *runtimev1.HookIntent {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.HookIntent)
}
