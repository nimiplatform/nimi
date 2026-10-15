package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestAudioCppInvocationOwnsAndCleansWindowsTemp(t *testing.T) {
	for _, mode := range []string{"success", "failure", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			root, ambient := t.TempDir(), t.TempDir()
			for _, key := range managedCommandTempEnvironmentKeys() {
				t.Setenv(key, ambient)
			}
			data := []byte("temporary directory lifecycle fixture")
			model := filepath.Join(root, "model.gguf")
			if err := os.WriteFile(model, data, 0600); err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(data)
			digest := hex.EncodeToString(hash[:])
			report, output := filepath.Join(root, "temp.txt"), filepath.Join(root, "output.wav")
			t.Setenv("NIMI_AUDIO_CPP_TEMP_PROBE", mode)
			t.Setenv("NIMI_AUDIO_CPP_TEMP_REPORT", report)
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, err := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: executable, workingDir: root, cuda13Root: root,
					args: []string{"-test.run=^TestAudioCppWindowsTempProbe$"}, stagingOutputPath: output,
					modelBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: "model", ModelAssetID: "fixture", AbsolutePath: model, BundleDir: root, DeclaredFiles: []string{"model.gguf"}, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}}})
				done <- err
			}()
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, err := os.Stat(report); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("child did not publish its temporary directory")
				}
				time.Sleep(5 * time.Millisecond)
			}
			if mode == "cancel" {
				cancel()
			}
			select {
			case err := <-done:
				if (err == nil) != (mode == "success") {
					t.Fatalf("mode=%s err=%v", mode, err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("child did not finish")
			}
			raw, err := os.ReadFile(report)
			if err != nil {
				t.Fatal(err)
			}
			temp := string(raw)
			parent, err := os.Stat(filepath.Dir(temp))
			want, wantErr := os.Stat(root)
			if err != nil || wantErr != nil || !os.SameFile(parent, want) {
				t.Fatalf("child temp %q escaped invocation staging", temp)
			}
			if _, err := os.Stat(temp); !os.IsNotExist(err) {
				t.Fatalf("invocation temp remains after %s: %v", mode, err)
			}
			if entries, err := os.ReadDir(ambient); err != nil || len(entries) != 0 {
				t.Fatalf("ambient temp was used: %v %v", entries, err)
			}
			for _, key := range managedCommandTempEnvironmentKeys() {
				if os.Getenv(key) != ambient {
					t.Fatalf("parent environment %s changed", key)
				}
			}
		})
	}
}

func TestAudioCppWindowsTempProbe(t *testing.T) {
	mode := os.Getenv("NIMI_AUDIO_CPP_TEMP_PROBE")
	if mode == "" {
		return
	}
	temp := os.TempDir()
	if err := os.WriteFile(filepath.Join(temp, "cache.bin"), []byte("cache"), 0600); err != nil {
		t.Fatal(err)
	}
	// GetTempPath2 uses SystemTemp for SYSTEM; all spellings must identify
	// the same private directory even when this test runs as an ordinary user.
	info, err := os.Stat(temp)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range managedCommandTempEnvironmentKeys() {
		other, err := os.Stat(os.Getenv(key))
		if err != nil || !os.SameFile(info, other) {
			t.Fatalf("divergent child temp %s", key)
		}
	}
	report := os.Getenv("NIMI_AUDIO_CPP_TEMP_REPORT")
	if err := os.WriteFile(report+".tmp", []byte(temp), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(report+".tmp", report); err != nil {
		t.Fatal(err)
	}
	if mode == "cancel" {
		time.Sleep(30 * time.Second)
	}
	if mode == "failure" {
		os.Exit(7)
	}
}
