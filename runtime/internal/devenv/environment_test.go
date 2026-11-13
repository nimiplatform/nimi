package devenv

import "testing"

func TestEnvironmentSelection(t *testing.T) {
	for _, tt := range []struct{ name, origin string }{{"official", "https://realm.nimi.ai"}, {"local", "http://127.0.0.1:3002"}} {
		t.Run(tt.name, func(t *testing.T) {
			name, p, err := Resolve(func(key string) string {
				if key == "NIMI_DEV_REALM" {
					return tt.name
				}
				return ""
			})
			if err != nil || name != tt.name || p.APIOrigin != tt.origin {
				t.Fatalf("unexpected profile %q %+v %v", name, p, err)
			}
		})
	}
	name, _, err := Resolve(func(string) string { return "" })
	if err != nil || name != "official" {
		t.Fatal("default must be official")
	}
	if _, _, err := Resolve(func(string) string { return "unexpected" }); err == nil {
		t.Fatal("unknown environment accepted")
	}
}

func TestStateNamespacesAreSeparate(t *testing.T) {
	base := t.TempDir()
	t.Setenv("NIMI_DEV_REALM", "official")
	official, err := StateRoot(base)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIMI_DEV_REALM", "local")
	local, err := StateRoot(base)
	if err != nil {
		t.Fatal(err)
	}
	if official == local || official == base || local == base {
		t.Fatal("source custody namespaces overlap")
	}
}
