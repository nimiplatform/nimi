package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	proactiveInterruptibilityProjectionKind = "proactive_interruptibility_v1"
	proactiveOwnerRuntime                   = "runtime"
	proactiveOwnerHost                      = "host"
	proactiveAuditRefPrefix                 = "runtime.audit.proactive/"
)

type proactiveInterruptibilityDecision struct {
	AgentID              string
	ProjectionID         string
	OwnerDomain          string
	TriggerSource        runtimev1.AgentProactiveTriggerSource
	DeliveryChannel      runtimev1.AgentProactiveDeliveryChannel
	PermissionState      runtimev1.AgentProactiveOptInState
	QuietHoursState      runtimev1.AgentProactiveQuietHoursState
	FrequencyCapState    runtimev1.AgentProactiveFrequencyCapState
	SourceHookID         string
	SourceCadenceID      string
	ConversationAnchorID string
	OriginatingTurnID    string
	OriginatingStreamID  string
	ReasonCode           string
	AuditRef             string
	ObservedAt           time.Time
}

// commitProactiveInterruptibilityDecision is the K-AGCORE-143 Runtime-owned
// commit seam for proactive_interruptibility_v1. It is deliberately not a
// public RPC: apps/SDKs consume the committed projection and events, but cannot
// create delivery truth by passing renderer-local scheduler or permission
// state into Runtime.
func (s *Service) commitProactiveInterruptibilityDecision(ctx context.Context, decision proactiveInterruptibilityDecision) (*runtimev1.AgentProactiveInterruptibilityProjection, []*runtimev1.AgentEvent, error) {
	if s == nil {
		return nil, nil, status.Error(codes.FailedPrecondition, "runtime agent service is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	ownerDomain := strings.TrimSpace(decision.OwnerDomain)
	if ownerDomain != proactiveOwnerRuntime && ownerDomain != proactiveOwnerHost {
		return nil, nil, status.Error(codes.InvalidArgument, "proactive interruptibility owner_domain must be runtime or host")
	}
	entry, err := s.agentByID(strings.TrimSpace(decision.AgentID))
	if err != nil {
		return nil, nil, err
	}
	observedAt := decision.ObservedAt.UTC()
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	}
	projectionID := strings.TrimSpace(decision.ProjectionID)
	if projectionID == "" {
		projectionID = "proactive_" + ulid.Make().String()
	}
	auditRef := strings.TrimSpace(decision.AuditRef)
	missingAuditRef := auditRef == ""
	if missingAuditRef {
		auditRef = proactiveAuditRefPrefix + projectionID
	}

	mode := runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF
	if entry.Agent.GetAutonomy().GetEnabled() {
		mode = autonomyMode(entry.Agent.GetAutonomy().GetConfig())
	}
	deliveryChannel := normalizeProactiveDeliveryChannel(decision.DeliveryChannel)
	permissionState := normalizeProactivePermissionState(decision.PermissionState)
	quietHours := normalizeProactiveQuietHoursState(decision.QuietHoursState)
	frequencyCap := normalizeProactiveFrequencyCapState(decision.FrequencyCapState)
	triggerSource := decision.TriggerSource
	if triggerSource == runtimev1.AgentProactiveTriggerSource_AGENT_PROACTIVE_TRIGGER_SOURCE_UNSPECIFIED {
		triggerSource = runtimev1.AgentProactiveTriggerSource_AGENT_PROACTIVE_TRIGGER_SOURCE_LIFE_TRACK_CADENCE
	}

	unsupportedFields := proactiveUnsupportedFields(decision)
	suppression := proactiveSuppressionReason(
		mode,
		entry.Agent.GetAutonomy(),
		permissionState,
		quietHours,
		frequencyCap,
		deliveryChannel,
		missingAuditRef,
		unsupportedFields,
	)
	base := runtimev1.AgentProactiveEventDetail{
		ProjectionId:         projectionID,
		ProjectionKind:       proactiveInterruptibilityProjectionKind,
		OwnerDomain:          ownerDomain,
		TriggerSource:        triggerSource,
		EffectClass:          runtimev1.AgentProactiveEffectClass_AGENT_PROACTIVE_EFFECT_CLASS_IN_APP_COMPANION_SURFACE,
		DeliveryChannel:      deliveryChannel,
		Mode:                 mode,
		OptInState:           permissionState,
		QuietHours:           quietHours,
		FrequencyCap:         frequencyCap,
		ReasonCode:           strings.TrimSpace(decision.ReasonCode),
		AuditRef:             auditRef,
		SourceHookId:         strings.TrimSpace(decision.SourceHookID),
		SourceCadenceId:      strings.TrimSpace(decision.SourceCadenceID),
		ConversationAnchorId: strings.TrimSpace(decision.ConversationAnchorID),
		OriginatingTurnId:    strings.TrimSpace(decision.OriginatingTurnID),
		OriginatingStreamId:  strings.TrimSpace(decision.OriginatingStreamID),
		ObservedAt:           timestamppb.New(observedAt),
	}
	if base.ReasonCode == "" {
		base.ReasonCode = "proactive_interruptibility_evaluated"
	}

	suggested := cloneProactiveEventDetail(&base)
	suggested.Family = runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_SUGGESTED

	projection := &runtimev1.AgentProactiveInterruptibilityProjection{
		ProjectionId:      projectionID,
		ProjectionKind:    proactiveInterruptibilityProjectionKind,
		Mode:              mode,
		OptInState:        permissionState,
		DeliveryChannel:   deliveryChannel,
		QuietHours:        quietHours,
		FrequencyCap:      frequencyCap,
		AuditRefs:         []string{auditRef},
		SuggestedEvent:    suggested,
		UnsupportedFields: unsupportedFields,
	}

	final := cloneProactiveEventDetail(&base)
	if suppression != runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_UNSPECIFIED {
		final.Family = runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_SUPPRESSED
		final.SuppressionReason = suppression
		projection.LastSuppressedEvent = final
	} else {
		final.Family = runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_DELIVERED
		projection.LastDeliveredEvent = final
	}
	events := []*runtimev1.AgentEvent{
		s.proactiveEvent(entry.Agent.GetAgentId(), suggested, observedAt),
		s.proactiveEvent(entry.Agent.GetAgentId(), final, observedAt),
	}
	entry.State.ProactiveInterruptibility = cloneProactiveProjection(projection)
	entry.State.UpdatedAt = timestamppb.New(observedAt)
	if err := s.updateAgent(entry, events...); err != nil {
		return nil, nil, err
	}
	return cloneProactiveProjection(projection), cloneAgentEvents(events), nil
}

func (s *Service) proactiveEvent(agentID string, detail *runtimev1.AgentProactiveEventDetail, observedAt time.Time) *runtimev1.AgentEvent {
	return s.newEventAt(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_PROACTIVE, &runtimev1.AgentEvent_Proactive{
		Proactive: cloneProactiveEventDetail(detail),
	}, observedAt)
}

func proactiveSuppressionReason(
	mode runtimev1.AgentAutonomyMode,
	autonomy *runtimev1.AgentAutonomyState,
	permissionState runtimev1.AgentProactiveOptInState,
	quietHours runtimev1.AgentProactiveQuietHoursState,
	frequencyCap runtimev1.AgentProactiveFrequencyCapState,
	deliveryChannel runtimev1.AgentProactiveDeliveryChannel,
	missingAuditRef bool,
	unsupportedFields []string,
) runtimev1.AgentProactiveSuppressionReason {
	if missingAuditRef {
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_MISSING_AUDIT_REF
	}
	if len(unsupportedFields) > 0 {
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_RUNTIME_UNAVAILABLE
	}
	if mode == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF || autonomy == nil || !autonomy.GetEnabled() {
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_AUTONOMY_OFF
	}
	if autonomy.GetBudgetExhausted() {
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_BUDGET_EXHAUSTED
	}
	switch permissionState {
	case runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_DENIED:
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_PERMISSION_DENIED
	case runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_REVOKED:
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_PERMISSION_REVOKED
	case runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_EXPIRED:
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_PERMISSION_EXPIRED
	case runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_MISSING,
		runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_OFF,
		runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_PENDING:
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_PERMISSION_MISSING
	}
	if quietHours == runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_ACTIVE {
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_QUIET_HOURS_ACTIVE
	}
	if frequencyCap == runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_CAPPED {
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_FREQUENCY_CAP_EXCEEDED
	}
	if deliveryChannel != runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_IN_APP_SURFACE {
		return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_UNSUPPORTED_DELIVERY_CHANNEL
	}
	return runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_UNSPECIFIED
}

func proactiveUnsupportedFields(decision proactiveInterruptibilityDecision) []string {
	fields := make([]string, 0, 4)
	if decision.TriggerSource == runtimev1.AgentProactiveTriggerSource_AGENT_PROACTIVE_TRIGGER_SOURCE_UNSPECIFIED {
		fields = append(fields, "trigger_source")
	}
	if decision.DeliveryChannel == runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_UNSPECIFIED {
		fields = append(fields, "delivery_channel")
	}
	if decision.QuietHoursState == runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_UNSPECIFIED {
		fields = append(fields, "quiet_hours")
	}
	if decision.FrequencyCapState == runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_UNSPECIFIED {
		fields = append(fields, "frequency_cap")
	}
	return fields
}

func normalizeProactiveDeliveryChannel(input runtimev1.AgentProactiveDeliveryChannel) runtimev1.AgentProactiveDeliveryChannel {
	if input == runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_UNSPECIFIED {
		return runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_NOTIFICATION_NOT_ADMITTED
	}
	return input
}

func normalizeProactivePermissionState(input runtimev1.AgentProactiveOptInState) runtimev1.AgentProactiveOptInState {
	if input == runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_UNSPECIFIED {
		return runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_MISSING
	}
	return input
}

func normalizeProactiveQuietHoursState(input runtimev1.AgentProactiveQuietHoursState) runtimev1.AgentProactiveQuietHoursState {
	if input == runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_UNSPECIFIED {
		return runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_NOT_CONFIGURED
	}
	return input
}

func normalizeProactiveFrequencyCapState(input runtimev1.AgentProactiveFrequencyCapState) runtimev1.AgentProactiveFrequencyCapState {
	if input == runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_UNSPECIFIED {
		return runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_NOT_CONFIGURED
	}
	return input
}

func cloneProactiveProjection(input *runtimev1.AgentProactiveInterruptibilityProjection) *runtimev1.AgentProactiveInterruptibilityProjection {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentProactiveInterruptibilityProjection)
}

func cloneProactiveEventDetail(input *runtimev1.AgentProactiveEventDetail) *runtimev1.AgentProactiveEventDetail {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentProactiveEventDetail)
}

func cloneAgentEvents(input []*runtimev1.AgentEvent) []*runtimev1.AgentEvent {
	out := make([]*runtimev1.AgentEvent, 0, len(input))
	for _, event := range input {
		out = append(out, cloneAgentEvent(event))
	}
	return out
}

func proactiveProjectionDebugString(projection *runtimev1.AgentProactiveInterruptibilityProjection) string {
	if projection == nil {
		return "<nil>"
	}
	return fmt.Sprintf("%s/%s", projection.GetProjectionKind(), projection.GetProjectionId())
}
