package account

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/metadata"
)

type hostCallerEnvelope struct {
	sessionID    string
	sessionToken string
}

const protectedLocalDesktopAccountSourceHost = "protected-local-desktop-account-host"

func parseHostCallerEnvelope(ctx context.Context) (hostCallerEnvelope, bool) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return hostCallerEnvelope{}, false
	}
	value := func(key string) string {
		values := md.Get(key)
		if len(values) != 1 {
			return ""
		}
		return strings.TrimSpace(values[0])
	}
	envelope := hostCallerEnvelope{
		sessionID:    value("x-nimi-session-id"),
		sessionToken: value("x-nimi-session-token"),
	}
	return envelope, true
}

func (s *Service) validateDesktopAccountHost(ctx context.Context, caller *runtimev1.AccountCaller) (runtimev1.AccountReasonCode, bool) {
	connection, protected := protectedlocal.DesktopConnectionFromContext(ctx)
	if protected && connection != nil {
		if connection.VerifiedDesktopTransport() &&
			desktopCallerMatchesHostEnvelope(ctx, caller) {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
	}
	if s.nonProductionHarnessMode {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
	}
	if s.logger != nil {
		s.logger.Warn("desktop account protected origin rejected",
			"protected_connection", protected,
			"caller_present", caller != nil,
		)
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
}

// desktopCallerMatchesHostEnvelope joins the request projection to identity
// stamped by the native Desktop host. The renderer can construct protobuf
// request bytes, so the AccountCaller message alone is never authority. The
// protected process/connection proves who may act and this host-owned envelope
// prevents renderer-selected app-instance or device partitions.
func desktopCallerMatchesHostEnvelope(ctx context.Context, caller *runtimev1.AccountCaller) bool {
	if caller == nil {
		return false
	}
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return false
	}
	value := func(key string) string {
		values := md.Get(key)
		if len(values) != 1 {
			return ""
		}
		return strings.TrimSpace(values[0])
	}
	return value("x-nimi-source-host") == protectedLocalDesktopAccountSourceHost &&
		value("x-nimi-caller-kind") == "desktop-shell" &&
		value("x-nimi-app-id") == strings.TrimSpace(caller.GetAppId()) &&
		value("x-nimi-app-instance-id") == strings.TrimSpace(caller.GetAppInstanceId()) &&
		value("x-nimi-device-id") == strings.TrimSpace(caller.GetDeviceId())
}

func (s *Service) validateLocalCallerAppSession(ctx context.Context, caller *runtimev1.AccountCaller) (runtimev1.AccountReasonCode, bool) {
	if s.nonProductionHarnessMode {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
	}
	envelope, ok := parseHostCallerEnvelope(ctx)
	if !ok || envelope.sessionID == "" || envelope.sessionToken == "" || s.appSessionValidator == nil {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
	}
	if _, valid := s.appSessionValidator.ValidateAppSessionBinding(
		strings.TrimSpace(caller.GetAppId()),
		strings.TrimSpace(caller.GetAppInstanceId()),
		strings.TrimSpace(caller.GetDeviceId()),
		envelope.sessionID,
		envelope.sessionToken,
	); !valid {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}
