package productrelease

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func signed(t *testing.T, value any) ([]byte, string) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(Envelope{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(private, payload))})
	if err != nil {
		t.Fatal(err)
	}
	return raw, base64.StdEncoding.EncodeToString(public)
}
func fixtureIdentity(t *testing.T) (Identity, string) {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{}
	for _, name := range []string{"Nimi.exe", "runtime/nimi.exe", "NimiProductUpdater.exe", "resources/app.asar", "resources/app.asar.unpacked/native.node"} {
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("engineering "+name), 0600); err != nil {
			t.Fatal(err)
		}
		files[name], _ = FileSHA256(file)
	}
	identity := Identity{Schema: "nimi-windows-product-identity/v1", ReleaseID: "nimi/v0.3.0", Version: "0.3.0", Channel: "beta", Target: "windows-amd64", SourceRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Files: files, Components: Components{Desktop: Component{Version: "0.3.0", SHA256: files["resources/app.asar"]}, Runtime: Component{Version: "0.3.0", SHA256: files["runtime/nimi.exe"]}, Avatar: Component{Version: "0.3.0", SHA256: files["Nimi.exe"]}}}
	return identity, root
}
func TestSignedCompleteIdentityRejectsWrongKeyAndUnadmittedBytes(t *testing.T) {
	identity, root := fixtureIdentity(t)
	raw, key := signed(t, identity)
	admitted, err := VerifyIdentity(raw, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyInventory(root, admitted); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyIdentity(raw, ""); err == nil {
		t.Fatal("missing trust accepted")
	}
	_, wrong := signed(t, identity)
	if _, err := VerifyIdentity(raw, wrong); err == nil {
		t.Fatal("wrong publisher accepted")
	}
	if err := os.WriteFile(filepath.Join(root, "resources/app.asar.unpacked/native.node"), []byte("changed native bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	if VerifyInventory(root, admitted) == nil {
		t.Fatal("changed native dependency admitted")
	}
}
func TestIdentityRejectsAliasesMissingRolesAndUnknownFields(t *testing.T) {
	for _, name := range []string{"../Nimi.exe", "C:/Nimi.exe", "Nimi.exe:evil", "Nimi.exe.", "nul.txt", "resources\\evil.dll"} {
		if ValidRelativeFile(name) {
			t.Fatalf("path alias admitted: %s", name)
		}
	}
	identity, _ := fixtureIdentity(t)
	identity.Files["nimi.exe"] = identity.Files["Nimi.exe"]
	raw, key := signed(t, identity)
	if _, err := VerifyIdentity(raw, key); err == nil {
		t.Fatal("case collision admitted")
	}
	delete(identity.Files, "nimi.exe")
	delete(identity.Files, "Nimi.exe")
	raw, key = signed(t, identity)
	if _, err := VerifyIdentity(raw, key); err == nil {
		t.Fatal("missing Home role admitted")
	}
	var object map[string]any
	encoded, _ := json.Marshal(identity)
	_ = json.Unmarshal(encoded, &object)
	object["notSigned"] = true
	raw, key = signed(t, object)
	if _, err := VerifyIdentity(raw, key); err == nil {
		t.Fatal("unknown policy field admitted")
	}
}
func TestInventoryRejectsExtraAndSymlink(t *testing.T) {
	identity, root := fixtureIdentity(t)
	_ = os.WriteFile(filepath.Join(root, "extra.dll"), []byte("unadmitted"), 0600)
	if VerifyInventory(root, identity) == nil {
		t.Fatal("extra executable admitted")
	}
	_ = os.Remove(filepath.Join(root, "extra.dll"))
	if err := os.Symlink(filepath.Join(root, "Nimi.exe"), filepath.Join(root, "alias")); err != nil {
		t.Fatal(err)
	}
	if VerifyInventory(root, identity) == nil {
		t.Fatal("symlink admitted")
	}
}
func TestReleaseFreshnessImmutableURLAndForwardCompatibility(t *testing.T) {
	identity, _ := fixtureIdentity(t)
	now := time.Now().UTC().Truncate(time.Millisecond)
	release := Release{Schema: "nimi-product-release/v1", ReleaseID: identity.ReleaseID, Version: identity.Version, Channel: "beta", Target: identity.Target, SourceRevision: identity.SourceRevision, Components: identity.Components, PublishedAt: now.Add(-time.Minute).Format("2006-01-02T15:04:05.000Z"), ExpiresAt: now.Add(time.Hour).Format("2006-01-02T15:04:05.000Z"), Compatibility: Compatibility{MinimumProductVersion: "0.2.0", MinimumOSVersion: "10.0.19041", DataPolicy: "owner-approved-forward"}, Asset: Asset{Name: "Nimi-0.3.0-windows-amd64.exe", URL: "https://github.com/nimiplatform/nimi/releases/download/nimi%2Fv0.3.0/Nimi-0.3.0-windows-amd64.exe", Size: 100, SHA256: identity.Files["Nimi.exe"], Installer: "windows-exe"}}
	raw, key := signed(t, release)
	if _, err := VerifyRelease(raw, key, now); err != nil {
		t.Fatal(err)
	}
	if CheckCompatibility(release, "0.2.0", "10.0.22631") != nil {
		t.Fatal("forward candidate refused")
	}
	for _, current := range []string{"0.3.0", "0.4.0", "0.1.0"} {
		if CheckCompatibility(release, current, "10.0.22631") == nil {
			t.Fatal("incompatible product accepted")
		}
	}
	if CheckCompatibility(release, "0.2.0", "10.0.17763") == nil {
		t.Fatal("unsupported OS accepted")
	}
	if _, err := VerifyRelease(raw, key, now.Add(2*time.Hour)); err == nil {
		t.Fatal("expired install admission accepted")
	}
	release.Asset.URL = "https://example.org/nimi.exe"
	raw, key = signed(t, release)
	if _, err := VerifyRelease(raw, key, now); err == nil {
		t.Fatal("arbitrary source admitted")
	}
}
