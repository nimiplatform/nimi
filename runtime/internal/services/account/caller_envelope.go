package account

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"google.golang.org/grpc/metadata"
)

const (
	installedAppCapabilitySetRef = "installed-nimi-app-standard-shell-v1"
	desktopTauriAccountHostID    = "desktop-tauri-account-host"
	desktopElectronAccountHostID = "desktop-electron-account-host"
	tauriStandardShellHostID     = "tauri-standard-shell"
)

type hostCallerEnvelope struct {
	sourceHost           string
	appID                string
	appInstanceID        string
	deviceID             string
	launchHostID         string
	launchNonce          string
	releaseDescriptorRef string
	capabilitySetRef     string
	sessionID            string
	sessionToken         string
}

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
		sourceHost:           value("x-nimi-source-host"),
		appID:                value("x-nimi-app-id"),
		appInstanceID:        value("x-nimi-app-instance-id"),
		deviceID:             value("x-nimi-device-id"),
		launchHostID:         value("x-nimi-launch-host-id"),
		launchNonce:          value("x-nimi-launch-nonce"),
		releaseDescriptorRef: value("x-nimi-release-descriptor-ref"),
		capabilitySetRef:     value("x-nimi-capability-set-ref"),
		sessionID:            value("x-nimi-session-id"),
		sessionToken:         value("x-nimi-session-token"),
	}
	return envelope, true
}

func (s *Service) validateInstalledCallerEnvelope(ctx context.Context, caller *runtimev1.AccountCaller) (runtimev1.AccountReasonCode, bool) {
	envelope, ok := parseHostCallerEnvelope(ctx)
	if !ok || (envelope.sourceHost != appregistry.DesktopInstalledAppLaunchHostID && envelope.sourceHost != tauriStandardShellHostID) ||
		envelope.capabilitySetRef != installedAppCapabilitySetRef ||
		envelope.appID == "" || envelope.appInstanceID == "" || envelope.deviceID == "" ||
		envelope.launchHostID == "" || envelope.launchNonce == "" ||
		envelope.releaseDescriptorRef == "" || envelope.sessionID == "" || envelope.sessionToken == "" {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
	}
	if envelope.appID != strings.TrimSpace(caller.GetAppId()) ||
		envelope.appInstanceID != strings.TrimSpace(caller.GetAppInstanceId()) ||
		envelope.deviceID != strings.TrimSpace(caller.GetDeviceId()) ||
		envelope.launchHostID != strings.TrimSpace(caller.GetLaunchHostId()) ||
		envelope.launchNonce != strings.TrimSpace(caller.GetLaunchNonce()) ||
		envelope.releaseDescriptorRef != strings.TrimSpace(caller.GetReleaseDescriptorRef()) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
	}
	if s.appSessionValidator != nil {
		if _, valid := s.appSessionValidator.ValidateAppSessionBinding(
			envelope.appID,
			envelope.appInstanceID,
			envelope.deviceID,
			envelope.sessionID,
			envelope.sessionToken,
		); !valid {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
		}
	} else if !s.nonProductionHarnessMode {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
	}

	nonceKey := strings.Join([]string{envelope.appID, envelope.appInstanceID, envelope.launchNonce}, "\x00")
	s.mu.Lock()
	boundSessionID, bound := s.launchNonceSessions[nonceKey]
	if !bound {
		s.launchNonceSessions[nonceKey] = envelope.sessionID
	}
	s.mu.Unlock()
	if bound && boundSessionID != envelope.sessionID {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LAUNCH_NONCE_REPLAY, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func (s *Service) validateDesktopAccountHost(ctx context.Context, caller *runtimev1.AccountCaller) (runtimev1.AccountReasonCode, bool) {
	if s.nonProductionHarnessMode {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
	}
	envelope, ok := parseHostCallerEnvelope(ctx)
	if !ok || (envelope.sourceHost != desktopTauriAccountHostID && envelope.sourceHost != desktopElectronAccountHostID) ||
		envelope.appID != strings.TrimSpace(caller.GetAppId()) ||
		envelope.appInstanceID != strings.TrimSpace(caller.GetAppInstanceId()) ||
		envelope.deviceID != strings.TrimSpace(caller.GetDeviceId()) ||
		envelope.sessionID == "" || envelope.sessionToken == "" {
		if s.logger != nil {
			s.logger.Warn("desktop account caller envelope rejected",
				"has_envelope", ok,
				"source_host", envelope.sourceHost,
				"source_host_admitted", envelope.sourceHost == desktopTauriAccountHostID || envelope.sourceHost == desktopElectronAccountHostID,
				"app_id_match", envelope.appID == strings.TrimSpace(caller.GetAppId()),
				"app_instance_id_match", envelope.appInstanceID == strings.TrimSpace(caller.GetAppInstanceId()),
				"device_id_match", envelope.deviceID == strings.TrimSpace(caller.GetDeviceId()),
				"session_proof_present", envelope.sessionID != "" && envelope.sessionToken != "",
			)
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
	}
	if s.appSessionValidator == nil {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
	}
	if _, valid := s.appSessionValidator.ValidateAppSessionBinding(
		envelope.appID,
		envelope.appInstanceID,
		envelope.deviceID,
		envelope.sessionID,
		envelope.sessionToken,
	); !valid {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
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
