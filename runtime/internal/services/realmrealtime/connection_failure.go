package realmrealtime

import (
	"encoding/json"
	"errors"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type connectionClosedError struct {
	ReasonCode string `json:"reasonCode"`
}

func (e *connectionClosedError) Error() string {
	return "Realm realtime connection closed: " + e.ReasonCode
}

// @nimi-authority: rule.nimi.runtime.realm-realtime.r001
func decodeConnectionClosed(raw json.RawMessage) error {
	var closed connectionClosedError
	if err := decodeStrictJSON(raw, &closed); err != nil {
		return errSocketProtocol
	}
	switch closed.ReasonCode {
	case "token-expired", "unauthenticated", "denied", "unavailable", "protocol-failure", "closed":
		return &closed
	default:
		return errSocketProtocol
	}
}

func connectionCloseReason(err error) string {
	var closed *connectionClosedError
	if errors.As(err, &closed) {
		return closed.ReasonCode
	}
	if errors.Is(err, errSocketAuth) {
		return "unauthenticated"
	}
	if errors.Is(err, errSocketProtocol) {
		return "protocol-failure"
	}
	// Transport loss does not establish an authentication or authorization failure.
	return "unavailable"
}

func connectionTerminalReason(err error) runtimev1.RealtimeTerminalReason {
	switch connectionCloseReason(err) {
	case "token-expired", "unauthenticated":
		return runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_UNAUTHENTICATED
	case "denied":
		return runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_PERMISSION_DENIED
	case "protocol-failure":
		return runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_PROTOCOL_FAILURE
	case "closed":
		return runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_CANCELLED
	default:
		return runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_UNAVAILABLE
	}
}
