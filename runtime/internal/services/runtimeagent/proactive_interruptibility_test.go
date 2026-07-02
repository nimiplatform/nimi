package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestProactiveInterruptibilityDefaultsOffAndSuppressesBeforeDelivery(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	agentID := "agent-proactive-default-off"
	mustInitializeProactiveAgent(t, svc, ctx, agentID, runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW, false)

	projection, events, err := svc.commitProactiveInterruptibilityDecision(ctx, proactiveInterruptibilityDecision{
		AgentID:           testRuntimeAgentLocalRef(agentID),
		OwnerDomain:       "runtime",
		TriggerSource:     runtimev1.AgentProactiveTriggerSource_AGENT_PROACTIVE_TRIGGER_SOURCE_LIFE_TRACK_CADENCE,
		DeliveryChannel:   runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_IN_APP_SURFACE,
		PermissionState:   runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_GRANTED,
		QuietHoursState:   runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_INACTIVE,
		FrequencyCapState: runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_WITHIN_CAP,
		SourceCadenceID:   "cadence-default-off",
		ReasonCode:        "cadence_due",
		AuditRef:          "runtime.audit.proactive/default-off",
		ObservedAt:        time.Date(2026, 7, 2, 1, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("commitProactiveInterruptibilityDecision: %v", err)
	}
	if projection.GetMode() != runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		t.Fatalf("default-off projection mode = %s", projection.GetMode())
	}
	if projection.GetSuggestedEvent() == nil {
		t.Fatalf("expected suggested event before suppression, got %#v", projection)
	}
	if projection.GetLastDeliveredEvent() != nil {
		t.Fatalf("default-off projection must not deliver, got %#v", projection.GetLastDeliveredEvent())
	}
	if got := projection.GetLastSuppressedEvent().GetSuppressionReason(); got != runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_AUTONOMY_OFF {
		t.Fatalf("suppression reason = %s", got)
	}
	if !stringSliceContains(projection.GetAuditRefs(), "runtime.audit.proactive/default-off") {
		t.Fatalf("projection missing audit ref: %#v", projection.GetAuditRefs())
	}
	requireProactiveEventFamilies(t, events,
		runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_SUGGESTED,
		runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_SUPPRESSED,
	)

	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{Context: testRuntimeAgentIdentityContext(agentID)})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetProactiveInterruptibility().GetProjectionId() != projection.GetProjectionId() {
		t.Fatalf("state projection did not persist proactive projection: got %#v want %#v", stateResp.GetState().GetProactiveInterruptibility(), projection)
	}
}

func TestProactiveInterruptibilityPermissionDeniedOrRevokedBlocksDelivery(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name       string
		state      runtimev1.AgentProactiveOptInState
		suppressed runtimev1.AgentProactiveSuppressionReason
	}{
		{name: "denied", state: runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_DENIED, suppressed: runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_PERMISSION_DENIED},
		{name: "revoked", state: runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_REVOKED, suppressed: runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_PERMISSION_REVOKED},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newRuntimeAgentTestService(t)
			ctx := context.Background()
			agentID := "agent-proactive-permission-" + tc.name
			mustInitializeProactiveAgent(t, svc, ctx, agentID, runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM, true)

			projection, events, err := svc.commitProactiveInterruptibilityDecision(ctx, proactiveInterruptibilityDecision{
				AgentID:           testRuntimeAgentLocalRef(agentID),
				OwnerDomain:       "runtime",
				TriggerSource:     runtimev1.AgentProactiveTriggerSource_AGENT_PROACTIVE_TRIGGER_SOURCE_HOOK_INTENT,
				DeliveryChannel:   runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_IN_APP_SURFACE,
				PermissionState:   tc.state,
				QuietHoursState:   runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_INACTIVE,
				FrequencyCapState: runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_WITHIN_CAP,
				SourceHookID:      "hook-permission-" + tc.name,
				ReasonCode:        "hook_due",
				AuditRef:          "runtime.audit.proactive/permission-" + tc.name,
			})
			if err != nil {
				t.Fatalf("commitProactiveInterruptibilityDecision: %v", err)
			}
			if projection.GetLastDeliveredEvent() != nil {
				t.Fatalf("permission %s must not deliver: %#v", tc.state, projection.GetLastDeliveredEvent())
			}
			if got := projection.GetLastSuppressedEvent().GetSuppressionReason(); got != tc.suppressed {
				t.Fatalf("suppression reason = %s want %s", got, tc.suppressed)
			}
			requireProactiveEventFamilies(t, events,
				runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_SUGGESTED,
				runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_SUPPRESSED,
			)
		})
	}
}

func TestProactiveInterruptibilityQuietHoursAndFrequencyCapSuppressDelivery(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name       string
		quiet      runtimev1.AgentProactiveQuietHoursState
		frequency  runtimev1.AgentProactiveFrequencyCapState
		suppressed runtimev1.AgentProactiveSuppressionReason
	}{
		{
			name:       "quiet-hours",
			quiet:      runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_ACTIVE,
			frequency:  runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_WITHIN_CAP,
			suppressed: runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_QUIET_HOURS_ACTIVE,
		},
		{
			name:       "frequency-cap",
			quiet:      runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_INACTIVE,
			frequency:  runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_CAPPED,
			suppressed: runtimev1.AgentProactiveSuppressionReason_AGENT_PROACTIVE_SUPPRESSION_REASON_FREQUENCY_CAP_EXCEEDED,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newRuntimeAgentTestService(t)
			ctx := context.Background()
			agentID := "agent-proactive-" + tc.name
			mustInitializeProactiveAgent(t, svc, ctx, agentID, runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_HIGH, true)

			projection, events, err := svc.commitProactiveInterruptibilityDecision(ctx, proactiveInterruptibilityDecision{
				AgentID:           testRuntimeAgentLocalRef(agentID),
				OwnerDomain:       "runtime",
				TriggerSource:     runtimev1.AgentProactiveTriggerSource_AGENT_PROACTIVE_TRIGGER_SOURCE_LIFE_TRACK_CADENCE,
				DeliveryChannel:   runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_IN_APP_SURFACE,
				PermissionState:   runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_GRANTED,
				QuietHoursState:   tc.quiet,
				FrequencyCapState: tc.frequency,
				SourceCadenceID:   "cadence-" + tc.name,
				ReasonCode:        "cadence_due",
				AuditRef:          "runtime.audit.proactive/" + tc.name,
			})
			if err != nil {
				t.Fatalf("commitProactiveInterruptibilityDecision: %v", err)
			}
			if projection.GetLastDeliveredEvent() != nil {
				t.Fatalf("%s must not deliver: %#v", tc.name, projection.GetLastDeliveredEvent())
			}
			if got := projection.GetLastSuppressedEvent().GetSuppressionReason(); got != tc.suppressed {
				t.Fatalf("suppression reason = %s want %s", got, tc.suppressed)
			}
			requireProactiveEventFamilies(t, events,
				runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_SUGGESTED,
				runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_SUPPRESSED,
			)
		})
	}
}

func TestProactiveInterruptibilityDeliversInAppWithAuditRefs(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	agentID := "agent-proactive-deliver"
	mustInitializeProactiveAgent(t, svc, ctx, agentID, runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM, true)

	projection, events, err := svc.commitProactiveInterruptibilityDecision(ctx, proactiveInterruptibilityDecision{
		AgentID:           testRuntimeAgentLocalRef(agentID),
		OwnerDomain:       "runtime",
		TriggerSource:     runtimev1.AgentProactiveTriggerSource_AGENT_PROACTIVE_TRIGGER_SOURCE_LIFE_TRACK_CADENCE,
		DeliveryChannel:   runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_IN_APP_SURFACE,
		PermissionState:   runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_GRANTED,
		QuietHoursState:   runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_INACTIVE,
		FrequencyCapState: runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_WITHIN_CAP,
		SourceCadenceID:   "cadence-deliver",
		ReasonCode:        "cadence_due",
		AuditRef:          "runtime.audit.proactive/deliver",
	})
	if err != nil {
		t.Fatalf("commitProactiveInterruptibilityDecision: %v", err)
	}
	delivered := projection.GetLastDeliveredEvent()
	if delivered == nil {
		t.Fatalf("expected delivered event, got %#v", projection)
	}
	if projection.GetLastSuppressedEvent() != nil {
		t.Fatalf("delivered projection must not carry last suppressed event: %#v", projection.GetLastSuppressedEvent())
	}
	if delivered.GetOwnerDomain() != "runtime" {
		t.Fatalf("owner_domain = %q", delivered.GetOwnerDomain())
	}
	if delivered.GetDeliveryChannel() != runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_IN_APP_SURFACE {
		t.Fatalf("delivery_channel = %s", delivered.GetDeliveryChannel())
	}
	if delivered.GetAuditRef() != "runtime.audit.proactive/deliver" || !stringSliceContains(projection.GetAuditRefs(), delivered.GetAuditRef()) {
		t.Fatalf("delivered audit refs mismatch: projection=%#v delivered=%#v", projection.GetAuditRefs(), delivered)
	}
	requireProactiveEventFamilies(t, events,
		runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_SUGGESTED,
		runtimev1.AgentProactiveEventFamily_AGENT_PROACTIVE_EVENT_FAMILY_DELIVERED,
	)
}

func TestProactiveInterruptibilityRejectsAppOwnedDeliveryTruth(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	agentID := "agent-proactive-app-owner"
	mustInitializeProactiveAgent(t, svc, ctx, agentID, runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM, true)

	_, _, err := svc.commitProactiveInterruptibilityDecision(ctx, proactiveInterruptibilityDecision{
		AgentID:           testRuntimeAgentLocalRef(agentID),
		OwnerDomain:       "app.renderer",
		TriggerSource:     runtimev1.AgentProactiveTriggerSource_AGENT_PROACTIVE_TRIGGER_SOURCE_LIFE_TRACK_CADENCE,
		DeliveryChannel:   runtimev1.AgentProactiveDeliveryChannel_AGENT_PROACTIVE_DELIVERY_CHANNEL_IN_APP_SURFACE,
		PermissionState:   runtimev1.AgentProactiveOptInState_AGENT_PROACTIVE_OPT_IN_STATE_GRANTED,
		QuietHoursState:   runtimev1.AgentProactiveQuietHoursState_AGENT_PROACTIVE_QUIET_HOURS_STATE_INACTIVE,
		FrequencyCapState: runtimev1.AgentProactiveFrequencyCapState_AGENT_PROACTIVE_FREQUENCY_CAP_STATE_WITHIN_CAP,
		SourceCadenceID:   "cadence-app-owner",
		ReasonCode:        "cadence_due",
		AuditRef:          "runtime.audit.proactive/app-owner",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("app-owned delivery truth must fail closed with InvalidArgument, got %v", err)
	}

	stateResp, stateErr := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{Context: testRuntimeAgentIdentityContext(agentID)})
	if stateErr != nil {
		t.Fatalf("GetAgentState: %v", stateErr)
	}
	if stateResp.GetState().GetProactiveInterruptibility() != nil {
		t.Fatalf("app-owned input must not write proactive projection: %#v", stateResp.GetState().GetProactiveInterruptibility())
	}
	for _, event := range svc.events {
		if event.GetEventType() == runtimev1.AgentEventType_AGENT_EVENT_TYPE_PROACTIVE {
			t.Fatalf("app-owned input must not append proactive events: %#v", svc.events)
		}
	}
}

func mustInitializeProactiveAgent(t *testing.T, svc *Service, ctx context.Context, agentID string, mode runtimev1.AgentAutonomyMode, enable bool) {
	t.Helper()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext(agentID),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             mode,
			DailyTokenBudget: 20,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	if enable {
		mustEnableAutonomy(t, svc, ctx, agentID)
	}
}

func requireProactiveEventFamilies(t *testing.T, events []*runtimev1.AgentEvent, families ...runtimev1.AgentProactiveEventFamily) {
	t.Helper()
	if len(events) != len(families) {
		t.Fatalf("expected %d proactive events, got %d: %#v", len(families), len(events), events)
	}
	for index, event := range events {
		if event.GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_PROACTIVE {
			t.Fatalf("event[%d] type = %s", index, event.GetEventType())
		}
		if event.GetProactive().GetFamily() != families[index] {
			t.Fatalf("event[%d] family = %s want %s", index, event.GetProactive().GetFamily(), families[index])
		}
		if event.GetProactive().GetAuditRef() == "" {
			t.Fatalf("event[%d] missing audit ref: %#v", index, event.GetProactive())
		}
	}
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
