//go:build darwin && cgo && nimi_macos_source_local_development

package entrypoint

import "testing"

func TestMacOSSourceRealmSelection(t *testing.T) {
	t.Setenv("NIMI_DEV_REALM", "official")
	api, realtime, err := loadMacOSProtectedRealmEndpoints()
	if err != nil || api != "https://realm.nimi.ai" || realtime != api {
		t.Fatalf("official endpoints: %s %s %v", api, realtime, err)
	}
	t.Setenv("NIMI_DEV_REALM", "local")
	t.Setenv("NIMI_DEV_REALM_URL", "http://localhost:3002")
	t.Setenv("NIMI_DEV_REALTIME_URL", "http://localhost:3003")
	api, realtime, err = loadMacOSProtectedRealmEndpoints()
	if err != nil || api != "http://localhost:3002" || realtime != "http://localhost:3003" {
		t.Fatalf("local endpoints: %s %s %v", api, realtime, err)
	}
	t.Setenv("NIMI_DEV_REALM_URL", "http://user@localhost:3002")
	if _, _, err := loadMacOSProtectedRealmEndpoints(); err == nil {
		t.Fatal("credential origin accepted")
	}
}
