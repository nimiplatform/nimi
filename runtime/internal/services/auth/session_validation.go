package auth

import (
	"crypto/subtle"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// ValidateAppSession validates app registration and a current app session token
// for protected service operations such as cross-app messaging.
func (s *Service) ValidateAppSession(appID string, sessionID string, sessionToken string) (runtimev1.ReasonCode, bool) {
	appID = strings.TrimSpace(appID)
	sessionID = strings.TrimSpace(sessionID)
	sessionToken = strings.TrimSpace(sessionToken)
	if appID == "" {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	if !s.appRegisteredLocked(appID) {
		return runtimev1.ReasonCode_APP_NOT_REGISTERED, false
	}
	if sessionID == "" || sessionToken == "" {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
	}

	session, exists := s.appSessions[sessionID]
	if !exists || session.AppID != appID {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
	}
	if session.Revoked || time.Now().UTC().After(session.ExpiresAt) {
		return runtimev1.ReasonCode_SESSION_EXPIRED, false
	}
	if subtle.ConstantTimeCompare([]byte(session.SessionToken), []byte(sessionToken)) != 1 {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
	}

	return runtimev1.ReasonCode_ACTION_EXECUTED, true
}

// ValidateAppSessionBinding additionally binds the session credential to the
// Runtime-registered app instance and device used by a trusted shell envelope.
func (s *Service) ValidateAppSessionBinding(appID string, appInstanceID string, deviceID string, sessionID string, sessionToken string) (runtimev1.ReasonCode, bool) {
	appID = strings.TrimSpace(appID)
	appInstanceID = strings.TrimSpace(appInstanceID)
	deviceID = strings.TrimSpace(deviceID)
	sessionID = strings.TrimSpace(sessionID)
	sessionToken = strings.TrimSpace(sessionToken)
	if appID == "" || appInstanceID == "" || deviceID == "" || sessionID == "" || sessionToken == "" {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.appRegisteredLocked(appID) {
		return runtimev1.ReasonCode_APP_NOT_REGISTERED, false
	}
	session, exists := s.appSessions[sessionID]
	if !exists || session.AppID != appID || session.AppInstanceID != appInstanceID || session.DeviceID != deviceID {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
	}
	if session.Revoked || time.Now().UTC().After(session.ExpiresAt) {
		return runtimev1.ReasonCode_SESSION_EXPIRED, false
	}
	if subtle.ConstantTimeCompare([]byte(session.SessionToken), []byte(sessionToken)) != 1 {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
	}
	return runtimev1.ReasonCode_ACTION_EXECUTED, true
}

func (s *Service) appRegisteredLocked(appID string) bool {
	return s.registeredApps[appID] > 0
}
