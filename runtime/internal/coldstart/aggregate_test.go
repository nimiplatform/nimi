package coldstart

import (
	"errors"
	"testing"
)

func allReady() UpstreamInputs {
	return UpstreamInputs{
		RuntimeDaemon:          StateReady,
		Account:                StateReady,
		DefaultExperienceProfile: StateReady,
		Materialization:        StateReady,
		AppRegistry:            StateReady,
		CognitionMemory:        StateReady,
	}
}

func TestState_Valid(t *testing.T) {
	for _, s := range []State{
		StateUnavailable, StateSetupRequired, StateNeedsConfirmation,
		StateInProgress, StateFailed, StateUnsupported, StateStaleProjection,
		StateReady,
	} {
		if !s.Valid() {
			t.Errorf("Valid() = false for canonical %q", s)
		}
	}
	if State("active_ready").Valid() {
		t.Error("Valid() = true for non-canonical 'active_ready'")
	}
}

func TestAggregate_AllReady(t *testing.T) {
	projection, err := Aggregate(allReady())
	if err != nil {
		t.Fatalf("Aggregate returned error: %v", err)
	}
	if projection.State != StateReady {
		t.Errorf("State = %q, want ready", projection.State)
	}
	if projection.ReasonOwner != "" {
		t.Errorf("ReasonOwner = %q, want empty for ready", projection.ReasonOwner)
	}
}

func TestAggregate_FailedAccountPreemptsReady(t *testing.T) {
	inputs := allReady()
	inputs.Account = StateFailed
	projection, err := Aggregate(inputs)
	if err != nil {
		t.Fatalf("Aggregate returned error: %v", err)
	}
	if projection.State != StateFailed {
		t.Errorf("State = %q, want failed", projection.State)
	}
	if projection.ReasonOwner != "account" {
		t.Errorf("ReasonOwner = %q, want account", projection.ReasonOwner)
	}
}

func TestAggregate_UnsupportedMaterializationPreemptsFailed(t *testing.T) {
	inputs := allReady()
	inputs.Account = StateFailed
	inputs.Materialization = StateUnsupported
	projection, err := Aggregate(inputs)
	if err != nil {
		t.Fatalf("Aggregate returned error: %v", err)
	}
	if projection.State != StateUnsupported {
		t.Errorf("State = %q, want unsupported (higher priority than failed)", projection.State)
	}
	if projection.ReasonOwner != "materialization" {
		t.Errorf("ReasonOwner = %q, want materialization", projection.ReasonOwner)
	}
}

func TestAggregate_SetupRequiredWhenDependencyMissing(t *testing.T) {
	inputs := allReady()
	inputs.Materialization = StateSetupRequired
	projection, err := Aggregate(inputs)
	if err != nil {
		t.Fatalf("Aggregate returned error: %v", err)
	}
	if projection.State != StateSetupRequired {
		t.Errorf("State = %q, want setup-required", projection.State)
	}
}

func TestAggregate_InProgressWhenOnlyInProgress(t *testing.T) {
	inputs := allReady()
	inputs.Materialization = StateInProgress
	projection, err := Aggregate(inputs)
	if err != nil {
		t.Fatalf("Aggregate returned error: %v", err)
	}
	if projection.State != StateInProgress {
		t.Errorf("State = %q, want in-progress", projection.State)
	}
}

func TestAggregate_UnavailableWhenRuntimeDaemonMissing(t *testing.T) {
	inputs := allReady()
	inputs.RuntimeDaemon = StateUnavailable
	projection, err := Aggregate(inputs)
	if err != nil {
		t.Fatalf("Aggregate returned error: %v", err)
	}
	if projection.State != StateUnavailable {
		t.Errorf("State = %q, want unavailable", projection.State)
	}
	if projection.ReasonOwner != "runtime-daemon" {
		t.Errorf("ReasonOwner = %q, want runtime-daemon", projection.ReasonOwner)
	}
}

func TestAggregate_EmptyUpstreamTreatedAsUnavailable(t *testing.T) {
	// Zero-value upstreams default to "unavailable" so missing fields
	// cannot silently project as ready.
	projection, err := Aggregate(UpstreamInputs{})
	if err != nil {
		t.Fatalf("Aggregate returned error: %v", err)
	}
	if projection.State != StateUnavailable {
		t.Errorf("State = %q, want unavailable (fail-closed default)", projection.State)
	}
}

func TestAggregate_UnknownUpstreamStateReturnsError(t *testing.T) {
	inputs := allReady()
	inputs.Account = State("anonymous_success")
	_, err := Aggregate(inputs)
	if err == nil {
		t.Fatal("Aggregate accepted unknown upstream state")
	}
	if !errors.Is(err, ErrUnknownUpstreamState) {
		t.Errorf("error = %v, want wrapped ErrUnknownUpstreamState", err)
	}
}

func TestAggregate_NeverReturnsReadyWhenAnyUpstreamIsNotReady(t *testing.T) {
	// Sweep across all upstream fields; each non-ready value must prevent
	// the aggregation from returning ready.
	nonReadyStates := []State{
		StateUnavailable, StateSetupRequired, StateNeedsConfirmation,
		StateInProgress, StateFailed, StateUnsupported, StateStaleProjection,
	}
	upstreams := []struct {
		name   string
		assign func(*UpstreamInputs, State)
	}{
		{"runtime-daemon", func(i *UpstreamInputs, s State) { i.RuntimeDaemon = s }},
		{"account", func(i *UpstreamInputs, s State) { i.Account = s }},
		{"default-experience-profile", func(i *UpstreamInputs, s State) { i.DefaultExperienceProfile = s }},
		{"materialization", func(i *UpstreamInputs, s State) { i.Materialization = s }},
		{"app-registry", func(i *UpstreamInputs, s State) { i.AppRegistry = s }},
		{"cognition-memory", func(i *UpstreamInputs, s State) { i.CognitionMemory = s }},
	}
	for _, upstream := range upstreams {
		for _, badState := range nonReadyStates {
			inputs := allReady()
			upstream.assign(&inputs, badState)
			projection, err := Aggregate(inputs)
			if err != nil {
				t.Fatalf("Aggregate(%s=%s) returned error: %v", upstream.name, badState, err)
			}
			if projection.State == StateReady {
				t.Errorf("Aggregate(%s=%s) returned ready (must fail-closed)", upstream.name, badState)
			}
		}
	}
}

func TestAggregate_AllUpstreamsConsidered(t *testing.T) {
	// Confirm each upstream owner can drive the projection's ReasonOwner.
	expected := map[string]func(i *UpstreamInputs){
		"runtime-daemon":             func(i *UpstreamInputs) { i.RuntimeDaemon = StateFailed },
		"account":                    func(i *UpstreamInputs) { i.Account = StateFailed },
		"default-experience-profile": func(i *UpstreamInputs) { i.DefaultExperienceProfile = StateFailed },
		"materialization":            func(i *UpstreamInputs) { i.Materialization = StateFailed },
		"app-registry":               func(i *UpstreamInputs) { i.AppRegistry = StateFailed },
		"cognition-memory":           func(i *UpstreamInputs) { i.CognitionMemory = StateFailed },
	}
	for owner, mutate := range expected {
		inputs := allReady()
		mutate(&inputs)
		projection, err := Aggregate(inputs)
		if err != nil {
			t.Fatalf("Aggregate(%s) returned error: %v", owner, err)
		}
		if projection.ReasonOwner != owner {
			t.Errorf("ReasonOwner = %q, want %q", projection.ReasonOwner, owner)
		}
	}
}
