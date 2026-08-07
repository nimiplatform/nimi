package appaccess

import (
	"reflect"
	"testing"
)

func TestResolveDeclarationPreservesRawItemsAndActivatesOnlyClosedDomains(t *testing.T) {
	items := []string{"realm.data", "future.domain", "runtime.consume", "agent.local"}
	raw, activated, err := ResolveDeclaration(items)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(raw, items) {
		t.Fatalf("raw declaration = %v", raw)
	}
	wantActivated := []string{"realm.data", "runtime.consume", "agent.local"}
	if !reflect.DeepEqual(activated, wantActivated) {
		t.Fatalf("activated domains = %v, want %v", activated, wantActivated)
	}
	items[0] = "changed.after.resolve"
	if raw[0] != "realm.data" {
		t.Fatal("resolved declaration aliases caller input")
	}
}

func TestSupportedDomainsAreExactlyTheAdmittedVocabulary(t *testing.T) {
	for _, domain := range []string{"realm.data", "runtime.consume", "agent.local"} {
		if !IsSupportedDomain(domain) {
			t.Fatalf("supported domain %q is inactive", domain)
		}
	}
	for _, domain := range []string{"", "realm", "future.domain", "agents.interact"} {
		if IsSupportedDomain(domain) {
			t.Fatalf("unknown domain %q was activated", domain)
		}
	}
}
