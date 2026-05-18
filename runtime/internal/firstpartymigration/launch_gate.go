package firstpartymigration

import "strings"

type LaunchDecision struct {
	Admitted bool
	Reason   string
}

type LaunchGate struct {
	avatarMasterGateAcked bool
	notRequired           map[string]bool
	states                map[string]MigrationState
}

type LaunchGateOption func(*LaunchGate)

const (
	LaunchReasonAdmitted                = "admitted"
	LaunchReasonNotRequired             = "migration-not-required"
	LaunchReasonCompleted               = "migration-completed"
	LaunchReasonStateMissing            = "migration-state-missing"
	LaunchReasonAvatarMasterGateBlocked = "avatar-master-gate-blocked"
)

func NewLaunchGate(opts ...LaunchGateOption) *LaunchGate {
	gate := &LaunchGate{
		notRequired: map[string]bool{},
		states:      map[string]MigrationState{},
	}
	for _, opt := range opts {
		if opt != nil {
			opt(gate)
		}
	}
	return gate
}

func WithAvatarMasterGateAcked(acked bool) LaunchGateOption {
	return func(gate *LaunchGate) {
		gate.avatarMasterGateAcked = acked
	}
}

func WithMigrationNotRequired(appID string) LaunchGateOption {
	return func(gate *LaunchGate) {
		gate.notRequired[normalizeNimiAppID(appID)] = true
	}
}

func WithMigrationState(appID string, state MigrationState) LaunchGateOption {
	return func(gate *LaunchGate) {
		gate.states[normalizeNimiAppID(appID)] = state
	}
}

func (g *LaunchGate) Evaluate(appID string) LaunchDecision {
	normalized := normalizeNimiAppID(appID)
	if normalized == "" || !isFirstPartyHardcutTarget(normalized) {
		return LaunchDecision{Admitted: true, Reason: LaunchReasonAdmitted}
	}
	if normalized == "nimi.avatar" && (g == nil || !g.avatarMasterGateAcked) {
		return LaunchDecision{Admitted: false, Reason: LaunchReasonAvatarMasterGateBlocked}
	}
	if g != nil && g.notRequired[normalized] {
		return LaunchDecision{Admitted: true, Reason: LaunchReasonNotRequired}
	}
	if g != nil {
		if state, ok := g.states[normalized]; ok {
			if state == MigrationStateCompleted {
				return LaunchDecision{Admitted: true, Reason: LaunchReasonCompleted}
			}
			return LaunchDecision{Admitted: false, Reason: string(state)}
		}
	}
	return LaunchDecision{Admitted: false, Reason: LaunchReasonStateMissing}
}

func normalizeNimiAppID(appID string) string {
	appID = strings.TrimSpace(appID)
	if strings.HasPrefix(appID, "app.nimi.") {
		return "nimi." + strings.TrimPrefix(appID, "app.nimi.")
	}
	return appID
}

func isFirstPartyHardcutTarget(appID string) bool {
	switch appID {
	case "nimi.avatar", "nimi.parentos":
		return true
	default:
		return false
	}
}
