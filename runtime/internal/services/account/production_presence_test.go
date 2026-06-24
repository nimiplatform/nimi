package account

import "testing"

func TestNewProductionBindsHostPresenceVerifier(t *testing.T) {
	svc := NewProduction(nil, ProductionConfig{})
	if _, ok := svc.presenceVerifier.(inertPresenceVerifier); ok {
		t.Fatalf("NewProduction uses inertPresenceVerifier; want host presence verifier")
	}
	if _, ok := svc.presenceVerifier.(hostPresenceVerifier); !ok {
		t.Fatalf("presence verifier = %T, want hostPresenceVerifier", svc.presenceVerifier)
	}
}

func TestNewProductionBindsRealmReauthFallbackAfterLocalPresence(t *testing.T) {
	svc := NewProduction(nil, ProductionConfig{RealmBaseURL: "https://realm.test"})
	verifier, ok := svc.presenceVerifier.(hostPresenceVerifier)
	if !ok {
		t.Fatalf("presence verifier = %T, want hostPresenceVerifier", svc.presenceVerifier)
	}
	if len(verifier.providers) < 2 {
		t.Fatalf("providers = %d, want local presence plus Realm reauth fallback", len(verifier.providers))
	}
	if _, ok := verifier.providers[1].(realmOAuthPresenceProvider); !ok {
		t.Fatalf("second provider = %T, want realmOAuthPresenceProvider", verifier.providers[1])
	}
}
