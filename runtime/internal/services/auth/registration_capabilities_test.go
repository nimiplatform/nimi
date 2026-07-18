package auth

import (
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
)

func TestRegistrationCapabilitiesIgnoreCatalogPrivilegeForBindingOnlyBootstrap(t *testing.T) {
	svc := New(nil)
	svc.nimiApps = &appregistrycatalog.Registry{Apps: []appregistrycatalog.App{{
		AppID:           "nimi.avatar",
		AdmissionStatus: appregistrycatalog.AdmissionStatusAdmitted,
	}}}

	got := svc.registrationCapabilities("nimi.avatar", []string{"realm.admin", "attacker.claim"})
	if len(got) != 0 {
		t.Fatalf("binding-only catalog registration retained capabilities: %#v", got)
	}
}

func TestRegistrationCapabilitiesCannotSelfAdmitAnyBusinessCapability(t *testing.T) {
	svc := New(nil)
	got := svc.registrationCapabilities("community.example", []string{"account.session.read", "account.raw-token"})
	if len(got) != 0 {
		t.Fatalf("binding-only non-catalog registration retained capabilities: %#v", got)
	}
}
