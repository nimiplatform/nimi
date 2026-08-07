//go:build darwin && cgo && nimi_macos_source_local_development

package entrypoint

import "testing"

func TestMacOSSourceLocalDevelopmentRealmProfileIsLoopbackOnly(t *testing.T) {
	for _, test := range []struct {
		name  string
		value *string
		ok    bool
	}{
		{name: "missing", ok: true},
		{name: "localhost", value: stringPointer("http://localhost:3002"), ok: true},
		{name: "canonical", value: stringPointer(macOSSourceLocalDevelopmentDefaultRealmBaseURL), ok: true},
		{name: "remote", value: stringPointer("https://example.invalid"), ok: false},
		{name: "wrong-port", value: stringPointer("http://127.0.0.1:3000"), ok: false},
		{name: "credential", value: stringPointer("http://user@127.0.0.1:3002"), ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.value == nil {
				t.Setenv("NIMI_REALM_URL", "")
			} else {
				t.Setenv("NIMI_REALM_URL", *test.value)
			}
			value, err := loadMacOSProtectedRealmBaseURL()
			if test.ok {
				if err != nil || value != macOSSourceLocalDevelopmentDefaultRealmBaseURL {
					t.Fatalf("value = %q, err = %v", value, err)
				}
			} else if err == nil {
				t.Fatalf("expected fail-closed error, got %q", value)
			}
		})
	}
}

func stringPointer(value string) *string { return &value }
