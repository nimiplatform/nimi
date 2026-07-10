package auth

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestValidateAppSessionBindingRejectsIdentityAndSecretMismatch(t *testing.T) {
	svc := New(nil)
	svc.registeredApps["nimi.avatar"] = 1
	svc.appSessions["session-1"] = appSession{
		SessionID:     "session-1",
		AppID:         "nimi.avatar",
		AppInstanceID: "avatar-instance-1",
		DeviceID:      "device-1",
		ExpiresAt:     time.Now().UTC().Add(time.Minute),
		SessionToken:  "session-secret-1",
	}

	if reason, ok := svc.ValidateAppSessionBinding("nimi.avatar", "avatar-instance-1", "device-1", "session-1", "session-secret-1"); !ok || reason != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("exact app-session binding rejected: ok=%v reason=%v", ok, reason)
	}
	for _, tc := range []struct {
		name          string
		appID         string
		appInstanceID string
		deviceID      string
		sessionToken  string
	}{
		{name: "app", appID: "nimi.zhiyu", appInstanceID: "avatar-instance-1", deviceID: "device-1", sessionToken: "session-secret-1"},
		{name: "instance", appID: "nimi.avatar", appInstanceID: "avatar-instance-2", deviceID: "device-1", sessionToken: "session-secret-1"},
		{name: "device", appID: "nimi.avatar", appInstanceID: "avatar-instance-1", deviceID: "device-2", sessionToken: "session-secret-1"},
		{name: "secret", appID: "nimi.avatar", appInstanceID: "avatar-instance-1", deviceID: "device-1", sessionToken: "wrong-secret"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, ok := svc.ValidateAppSessionBinding(tc.appID, tc.appInstanceID, tc.deviceID, "session-1", tc.sessionToken); ok {
				t.Fatalf("forged %s binding must fail closed", tc.name)
			}
		})
	}
}
