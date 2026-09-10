package nimiappnative

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestMacOSVerifierObservesRealAdHocBundleAndRejectsResourceTampering(t *testing.T) {
	root := t.TempDir()
	bundle := filepath.Join(root, "Example.app")
	contents := filepath.Join(bundle, "Contents")
	binary := filepath.Join(contents, "MacOS", "example")
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(contents, "Resources"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(path string, bytes []byte) {
		t.Helper()
		if err := os.WriteFile(path, bytes, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(root, "main.c"), []byte("int main(void) { return 0; }\n"))
	write(filepath.Join(contents, "Info.plist"), []byte(`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.nimi.native</string><key>CFBundleExecutable</key><string>example</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`))
	resource := filepath.Join(contents, "Resources", "text.txt")
	write(resource, []byte("original"))
	for _, invocation := range [][]string{{"/usr/bin/xcrun", "clang", "-arch", "arm64", filepath.Join(root, "main.c"), "-o", binary}, {"/usr/bin/codesign", "--force", "--sign", "-", bundle}} {
		if output, err := exec.Command(invocation[0], invocation[1:]...).CombinedOutput(); err != nil {
			t.Fatalf("native fixture: %v: %s", err, output)
		}
	}
	bytes, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(bytes)
	expected := MacOSExpectation{Arch: "arm64", ExecutionProfileRef: MacOSExecutionProfileRef, Notarization: "absent"}
	observed, err := VerifyMacOSRuntimeEntry(context.Background(), binary, expected, digest)
	if err != nil || observed.DeveloperIDSubject != nil || observed.Notarization != "absent" {
		t.Fatalf("ad-hoc observation: %+v %v", observed, err)
	}
	write(resource, []byte("changed after sealing"))
	if _, err := VerifyMacOSRuntimeEntry(context.Background(), binary, expected, digest); !errors.Is(err, ErrNativeVerification) {
		t.Fatalf("tampered bundle: %v", err)
	}
}
