//go:build windows

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
)

func TestCompleteCurrentCandidateDoesNotNeedExtractionSpace(t *testing.T) {
	root := filepath.Join(t.TempDir(), "0.3.0")
	files := map[string]string{}
	for _, name := range []string{"Nimi.exe", "NimiProductUpdater.exe", "runtime/nimi.exe", "resources/app.asar"} {
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
		files[name], _ = productrelease.FileSHA256(file)
	}
	identity := productrelease.Identity{Schema: "nimi-windows-product-identity/v1", Version: "0.3.0", ReleaseID: "nimi/v0.3.0", Channel: "beta", Target: "windows-amd64", SourceRevision: strings.Repeat("a", 40), Files: files,
		Components: productrelease.Components{Desktop: productrelease.Component{Version: "0.3.0", SHA256: files["resources/app.asar"]}, Runtime: productrelease.Component{Version: "0.3.0", SHA256: files["runtime/nimi.exe"]}, Avatar: productrelease.Component{Version: "0.3.0", SHA256: files["Nimi.exe"]}}}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key := base64.StdEncoding.EncodeToString(public)
	payload, _ := json.Marshal(identity)
	raw, _ := json.Marshal(productrelease.Envelope{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(private, payload))})
	if err := os.WriteFile(filepath.Join(root, productrelease.IdentityFile), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := preflightCandidateExtraction(root, identity, key, productrelease.CandidateUse{ServiceReferencesTarget: true}, 1<<62, 4); err != nil {
		t.Fatalf("complete current owner incorrectly needs disk: %v", err)
	}
	if err := os.Remove(filepath.Join(root, "Nimi.exe")); err != nil {
		t.Fatal(err)
	}
	if err := preflightCandidateExtraction(root, identity, key, productrelease.CandidateUse{}, 1<<62, 4); err == nil || !strings.Contains(err.Error(), "UPDATE_DISK_SPACE_INSUFFICIENT") {
		t.Fatalf("partial extraction bypassed space: %v", err)
	}
}

func TestExtractionBudgetIncludesAllocationAndRefusesOverflow(t *testing.T) {
	got, err := extractionRequiredBytes(1000, 4, 4096)
	if err != nil || got != 17384 {
		t.Fatalf("%d %v", got, err)
	}
	for _, input := range [][3]uint64{{0, 1, 4096}, {1, 0, 4096}, {1, 1, 0}, {math.MaxUint64, 1, 4096}, {1, math.MaxUint64, 4096}} {
		if _, err := extractionRequiredBytes(input[0], input[1], input[2]); err == nil {
			t.Fatalf("accepted %+v", input)
		}
	}
}

func TestExtractionSpaceReadsRealVolumeBeforeCreatingTarget(t *testing.T) {
	target := filepath.Join(t.TempDir(), "not-created", "Product")
	if err := checkExtractionSpace(target, 1024, 4); err != nil {
		t.Fatal(err)
	}
	if err := checkExtractionSpace(target, 1<<62, 4); err == nil || !strings.Contains(err.Error(), "UPDATE_DISK_SPACE_INSUFFICIENT") {
		t.Fatalf("%v", err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("preflight created destination: %v", err)
	}
}

func TestRetentionWindowsMutexExcludesOtherThreadAndReleases(t *testing.T) {
	name := "Local\\NimiRetentionTest-" + strconv.Itoa(os.Getpid())
	acquired, finish, result := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() { result <- withRetentionMutex(name, func() error { close(acquired); <-finish; return nil }) }()
	<-acquired
	if err := withRetentionMutex(name, func() error { t.Error("overlapping mutex owner"); return nil }); err == nil {
		close(finish)
		<-result
		t.Fatal("busy mutex admitted")
	}
	close(finish)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if err := withRetentionMutex(name, func() error { return nil }); err != nil {
		t.Fatalf("mutex not released: %v", err)
	}
}
