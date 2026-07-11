package auth

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/metadata"
)

func TestA0PublicBootstrapCreatesOnlyBindingOnlySession(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	register, err := svc.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{
		AppId:         "community.example.binding-only",
		AppInstanceId: "binding-instance-1",
		DeviceId:      "device-1",
		Capabilities:  []string{"account.raw-token", "runtime.agent.write", "ai.spend.meter", "artifact.read"},
		ModeManifest: &runtimev1.AppModeManifest{
			AppMode:         runtimev1.AppMode_APP_MODE_FULL,
			RuntimeRequired: true,
			RealmRequired:   true,
		},
	})
	if err != nil || !register.GetAccepted() {
		t.Fatalf("RegisterApp binding bootstrap: response=%+v err=%v", register, err)
	}

	svc.mu.RLock()
	registration := svc.apps["community.example.binding-only::binding-instance-1"]
	svc.mu.RUnlock()
	if len(registration.Capabilities) != 0 {
		t.Fatalf("binding-only registration retained privileged capabilities: %v", registration.Capabilities)
	}

	opened, err := svc.OpenSession(context.Background(), &runtimev1.OpenSessionRequest{
		AppId:         "community.example.binding-only",
		AppInstanceId: "binding-instance-1",
		DeviceId:      "device-1",
		SubjectUserId: "forged-account-subject",
	})
	if err != nil || opened.GetSessionId() == "" || opened.GetSessionToken() == "" {
		t.Fatalf("OpenSession binding-only: response=%+v err=%v", opened, err)
	}
	svc.mu.RLock()
	session := svc.appSessions[opened.GetSessionId()]
	svc.mu.RUnlock()
	if session.Authority != appSessionAuthorityBindingOnly || session.SubjectUserID != "" {
		t.Fatalf("unexpected bootstrap authority: authority=%q subject=%q", session.Authority, session.SubjectUserID)
	}
}

func TestA0KnownDesktopAndBundledIDsCannotSelfSelectPrivilegedPosture(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	forgedHost := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-source-host", "desktop-electron-account-host",
		"x-nimi-caller-kind", "desktop-core",
	))
	manifest := &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
	}

	desktop, err := svc.RegisterApp(forgedHost, &runtimev1.RegisterAppRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: "forged-desktop-instance",
		DeviceId:      "forged-device",
		Capabilities:  []string{"account.session.read", "runtime.agent.write", "ai.spend.meter"},
		ModeManifest:  manifest,
	})
	if err != nil || !desktop.GetAccepted() {
		t.Fatalf("desktop binding-only registration: response=%+v err=%v", desktop, err)
	}
	svc.mu.RLock()
	desktopRegistration := svc.apps["nimi.desktop::forged-desktop-instance"]
	svc.mu.RUnlock()
	if len(desktopRegistration.Capabilities) != 0 {
		t.Fatalf("known desktop id self-selected capabilities: %v", desktopRegistration.Capabilities)
	}

	opened, err := svc.OpenSession(forgedHost, &runtimev1.OpenSessionRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: "forged-desktop-instance",
		DeviceId:      "forged-device",
	})
	if err != nil || opened.GetSessionId() == "" {
		t.Fatalf("desktop binding-only session: response=%+v err=%v", opened, err)
	}
	svc.mu.RLock()
	desktopSession := svc.appSessions[opened.GetSessionId()]
	svc.mu.RUnlock()
	if desktopSession.Authority != appSessionAuthorityBindingOnly || desktopSession.SubjectUserID != "" {
		t.Fatalf("known desktop id obtained privileged session: authority=%q subject=%q", desktopSession.Authority, desktopSession.SubjectUserID)
	}

	for _, appID := range []string{"nimi.avatar", "nimi.zhiyu"} {
		resp, err := svc.RegisterApp(forgedHost, &runtimev1.RegisterAppRequest{
			AppId:         appID,
			AppInstanceId: "forged-bundled-instance",
			DeviceId:      "forged-device",
			Capabilities:  []string{"runtime.agent.write", "ai.spend.meter"},
			ModeManifest:  manifest,
		})
		if err != nil {
			t.Fatalf("%s RegisterApp transport error: %v", appID, err)
		}
		if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_APP_NOT_REGISTERED {
			t.Fatalf("direct bundled id registration was not denied: app=%s response=%+v", appID, resp)
		}
	}
}
