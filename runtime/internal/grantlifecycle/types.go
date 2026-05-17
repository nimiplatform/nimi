// Package grantlifecycle implements the typed Runtime-local grant
// lifecycle state machine per
// `.nimi/spec/runtime/kernel/grant-service.md`. Per Wave 5 admission
// rule, this is the Runtime local custody portion; Realm cloud-side
// app-permission projection is BLOCKER-002 (out of this topic's scope).
//
// Per implementation doctrine: no false readiness — revocation during
// use fails closed for streaming and background work.
package grantlifecycle

import "errors"

// GrantState enumerates the canonical grant lifecycle states. The
// closed set must match the SDK PermissionClient `GrantState` enum.
type GrantState string

const (
	GrantStateRequested GrantState = "requested"
	GrantStatePrompted  GrantState = "prompted"
	GrantStateGranted   GrantState = "granted"
	GrantStateInUse     GrantState = "in-use"
	GrantStateRevoked   GrantState = "revoked"
	GrantStateExpired   GrantState = "expired"
	GrantStateDenied    GrantState = "denied"
	GrantStateFailed    GrantState = "failed"
)

func (s GrantState) Valid() bool {
	switch s {
	case GrantStateRequested, GrantStatePrompted, GrantStateGranted,
		GrantStateInUse, GrantStateRevoked, GrantStateExpired,
		GrantStateDenied, GrantStateFailed:
		return true
	}
	return false
}

// IsTerminal reports whether the state is terminal (no further
// transitions allowed). Per contract: revoked / expired / denied /
// failed are terminal.
func (s GrantState) IsTerminal() bool {
	switch s {
	case GrantStateRevoked, GrantStateExpired, GrantStateDenied, GrantStateFailed:
		return true
	}
	return false
}

// AllowsExecution reports whether a grant in this state authorizes
// in-flight execution (in-use is the only allowed execution-time
// state per grant-service contract).
func (s GrantState) AllowsExecution() bool {
	return s == GrantStateInUse
}

// Grant is the typed Runtime-local grant record. The Realm cloud-side
// audit projection is BLOCKER-002 and consumed via a separate future
// topic.
type Grant struct {
	GrantID        string
	AppID          string
	SubjectUserID  string
	ScopeKey       string
	State          GrantState
	IssuedAt       int64
	ExpiresAt      int64
	LastTransition int64
	Detail         string
}

// Sentinel errors.
var (
	ErrGrantInvalidTransition = errors.New("grantlifecycle invalid state transition")
	ErrGrantUnknownState      = errors.New("grantlifecycle unknown state")
	ErrGrantTerminalLocked    = errors.New("grantlifecycle grant is in terminal state")
	ErrGrantNotInUse          = errors.New("grantlifecycle grant is not in-use; cannot revoke active execution")
	ErrGrantRequired          = errors.New("grantlifecycle grant is required")
)
