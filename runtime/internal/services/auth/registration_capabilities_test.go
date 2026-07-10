package auth

import (
	"reflect"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
)

func TestRegistrationCapabilitiesUseAdmittedCatalogPolicy(t *testing.T) {
	svc := New(nil)
	svc.nimiApps = &appregistrycatalog.Registry{Apps: []appregistrycatalog.App{{
		AppID:           "nimi.avatar",
		AdmissionStatus: appregistrycatalog.AdmissionStatusAdmitted,
		PermissionScopeRefs: []appregistrycatalog.PermissionScopeRef{
			{ScopeName: "account.session.read"},
			{ScopeName: "account.raw-token"},
			{ScopeName: "data.scope.read", Qualifier: "realm.worlds.read-probe"},
		},
	}}}

	got := svc.registrationCapabilities("nimi.avatar", []string{"realm.admin", "attacker.claim"}, false)
	want := []string{"account.session.read", "account.raw-token", "data.scope.read#realm.worlds.read-probe"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("catalog-derived capabilities = %#v, want %#v", got, want)
	}
}

func TestRegistrationCapabilitiesCannotSelfAdmitRawToken(t *testing.T) {
	svc := New(nil)
	got := svc.registrationCapabilities("community.example", []string{"account.session.read", "account.raw-token"}, false)
	want := []string{"account.session.read"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("non-catalog capabilities = %#v, want %#v", got, want)
	}
}
