package nimiapppackage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"image"
	"image/png"
	"testing"
)

func TestAppInfoRejectsIncompleteDocumentsAndInvisibleArtwork(t *testing.T) {
	for name, mutate := range map[string]func(*AppInfo){
		"name":                    func(info *AppInfo) { info.DisplayName = "" },
		"summary":                 func(info *AppInfo) { info.Summary = "" },
		"blank readme":            func(info *AppInfo) { info.ReadmeMarkdown = "  " },
		"blank notes":             func(info *AppInfo) { info.ReleaseNotesMarkdown = "\n" },
		"license":                 func(info *AppInfo) { info.License.Identifier = "" },
		"undeclared requirements": func(info *AppInfo) { info.CapabilityContractRefs = nil },
		"storage":                 func(info *AppInfo) { info.StoragePolicy.Kind = "" },
		"truncated PNG": func(info *AppInfo) {
			raw, _ := base64.StdEncoding.DecodeString(info.Icon.DataBase64)
			info.Icon.DataBase64 = base64.StdEncoding.EncodeToString(raw[:16])
		},
		"oversized notes": func(info *AppInfo) { info.ReleaseNotesMarkdown = string(bytes.Repeat([]byte("x"), 32*1024+1)) },
	} {
		t.Run(name, func(t *testing.T) {
			info := testAppInfo(t)
			mutate(&info)
			if _, err := ParseAppInfo(mustJSON(t, info)); !errors.Is(err, ErrInvalidPackage) {
				t.Fatalf("invalid %s accepted: %v", name, err)
			}
		})
	}
	for _, size := range []int{1, 128} {
		var raw bytes.Buffer
		if err := png.Encode(&raw, image.NewNRGBA(image.Rect(0, 0, size, size))); err != nil {
			t.Fatal(err)
		}
		if err := ValidateAppIcon(raw.Bytes()); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("transparent %d px placeholder accepted: %v", size, err)
		}
	}
}

func TestAppInfoIsBoundToReviewedAssetAndArchiveDeclaration(t *testing.T) {
	entries := validArchiveEntries(t)
	info := testAppInfo(t)
	digest := sha256.Sum256(entries[6].bytes)
	archive, expected := writeArchiveFixture(t, entries)
	expected.AppInfo = &AppInfoExpectation{SHA256: hex.EncodeToString(digest[:]), DisplayName: info.DisplayName, LicenseIdentifier: info.License.Identifier, CapabilityContractRefs: info.CapabilityContractRefs, RequiredStandardizedFeatureRefs: info.RequiredStandardizedFeatureRefs, StoragePolicy: info.StoragePolicy}
	if _, err := Inspect(context.Background(), archive, expected); err != nil {
		t.Fatal(err)
	}
	info.Summary = "Changed since Registry review."
	entries[6].bytes = mustJSON(t, info)
	changed, changedExpected := writeArchiveFixture(t, entries)
	changedExpected.AppInfo = expected.AppInfo
	if _, err := Inspect(context.Background(), changed, changedExpected); !errors.Is(err, ErrPackageIntegrity) {
		t.Fatalf("changed info asset accepted: %v", err)
	}
	info.DisplayName = "Different from declaration"
	entries[6].bytes = mustJSON(t, info)
	changed, changedExpected = writeArchiveFixture(t, entries)
	if _, err := Inspect(context.Background(), changed, changedExpected); !errors.Is(err, ErrInvalidPackage) {
		t.Fatalf("conflicting declaration accepted: %v", err)
	}
	legacy, legacyExpected := writeArchiveFixture(t, validArchiveEntries(t)[:6])
	if _, err := Inspect(context.Background(), legacy, legacyExpected); !errors.Is(err, ErrInvalidPackage) {
		t.Fatalf("package without portable info accepted: %v", err)
	}
}
