package nimiapppackage

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestLocalPackageVersionsRequireAllSemverComponents(t *testing.T) {
	for _, version := range []string{"1", "1.2", "1.02.3", "v1.2.3", "1.2.3", "1.2.3-beta.1", "1.2.3+build.2"} {
		t.Run(version, func(t *testing.T) {
			entries := validArchiveEntries(t)
			for i := range entries {
				entries[i].bytes = bytes.ReplaceAll(entries[i].bytes, []byte("1.2.3"), []byte(version))
			}
			file, _ := writeArchiveFixture(t, entries)
			metadata, err := InspectLocal(context.Background(), file, "windows", "x86_64")
			if strings.HasPrefix(version, "1.2.3") {
				if err != nil || metadata.Expected.Version != version {
					t.Fatalf("valid version %q: %+v %v", version, metadata, err)
				}
			} else if !errors.Is(err, ErrInvalidPackage) {
				t.Fatalf("invalid version must be an invalid package: %v", err)
			}
		})
	}
}

func TestInspectLocalUsesPackageFactsAndValidatesCompleteArchive(t *testing.T) {
	entries := validArchiveEntries(t)
	entries[2].bytes = []byte(strings.ReplaceAll(string(entries[2].bytes), "Example App", "Local Example"))
	info := testAppInfo(t)
	info.DisplayName = "Local Example"
	entries[6].bytes = mustJSON(t, info)
	archive, expected := writeArchiveFixture(t, entries)
	local, err := InspectLocal(context.Background(), archive, "windows", "x86_64")
	if err != nil {
		t.Fatal(err)
	}
	if local.DisplayName != "Local Example" || !reflect.DeepEqual(local.Expected, expected) {
		t.Fatalf("local metadata = %+v", local)
	}
	owner, _ := openOwnerRoot(t)
	materialized, err := Materialize(context.Background(), archive, owner, "local-release", local.Expected)
	if err != nil {
		t.Fatal(err)
	}
	installed, err := ReadInstalledLocalMetadata(materialized.Root, "windows", "x86_64")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyMaterialized(context.Background(), materialized.Root, installed.Expected, PayloadRootDigestRef(materialized.PayloadRootSHA256), materialized.HostExecutableSHA256); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectLocal(context.Background(), archive, "macos", "arm64"); !errors.Is(err, ErrUnsupportedTarget) {
		t.Fatalf("wrong platform accepted: %v", err)
	}
	entries = append(entries, entries[2])
	duplicate, _ := writeArchiveFixture(t, entries)
	if _, err := InspectLocal(context.Background(), duplicate, "windows", "x86_64"); err == nil {
		t.Fatal("duplicate declaration accepted")
	}
}

func TestInspectLocalRejectsDevelopmentAndContradictoryDeclarations(t *testing.T) {
	for _, condition := range []string{"development", "version", "access"} {
		t.Run(condition, func(t *testing.T) {
			entries := validArchiveEntries(t)
			if condition == "development" {
				manifest := validManifest()
				manifest.NativeTrust = ManifestNativeTrust{Posture: "development-unsigned"}
				manifest.ExecutionProfile = nil
				entries[1].bytes = mustJSON(t, manifest)
			} else if condition == "version" {
				entries[2].bytes = []byte("app_id: publisher.example-app\nversion: 9.9.9\napp_access: [runtime.consume]\n")
			} else {
				entries[2].bytes = []byte("app_id: publisher.example-app\nversion: 1.2.3\napp_access: [runtime.consume, runtime.consume]\n")
			}
			archive, _ := writeArchiveFixture(t, entries)
			if _, err := InspectLocal(context.Background(), archive, "windows", "x86_64"); err == nil {
				t.Fatal("invalid local package accepted")
			}
		})
	}
}

func TestLocalInfoAcceptsUnicodeNamesOptionalDocumentsAndExactLicense(t *testing.T) {
	for _, length := range []int{86, 120, 121} {
		entries := validArchiveEntries(t)
		info := testAppInfo(t)
		info.DisplayName = strings.Repeat("名", length)
		info.ReadmeMarkdown, info.ReleaseNotesMarkdown = "", ""
		info.License.Text = "\ufeff" + info.License.Text
		entries[2].bytes = []byte(strings.ReplaceAll(string(entries[2].bytes), "Example App", info.DisplayName))
		for i := range entries {
			if entries[i].name == "LICENSE" {
				entries[i].bytes = []byte(info.License.Text)
			}
		}
		entries[6].bytes = mustJSON(t, info)
		archive, _ := writeArchiveFixture(t, entries)
		local, err := InspectLocal(context.Background(), archive, "windows", "x86_64")
		if length > 120 {
			if !errors.Is(err, ErrInvalidPackage) {
				t.Fatalf("overlong name accepted: %v", err)
			}
		} else if err != nil || local.DisplayName != info.DisplayName {
			t.Fatalf("valid %d-character local package rejected: %v", length, err)
		}
	}
}
