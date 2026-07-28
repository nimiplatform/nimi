package auth

import (
	"testing"
)

func TestRegistrationCapabilitiesIgnoreFirstPartyIdentityForBindingOnlyBootstrap(t *testing.T) {
	svc := New(nil)
	svc.SetNimiAppIdentityProjection(testNimiAppIdentityProjection(t))

	got := svc.registrationCapabilities("nimi.avatar", []string{"realm.admin", "attacker.claim"})
	if len(got) != 0 {
		t.Fatalf("binding-only first-party registration retained capabilities: %#v", got)
	}
}

func TestRegistrationCapabilitiesCannotSelfAdmitAnyBusinessCapability(t *testing.T) {
	svc := New(nil)
	got := svc.registrationCapabilities("community.example", []string{"account.session.read", "account.raw-token"})
	if len(got) != 0 {
		t.Fatalf("binding-only third-party registration retained capabilities: %#v", got)
	}
}
