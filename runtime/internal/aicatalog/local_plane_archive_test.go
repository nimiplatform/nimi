package catalog

import (
	"strings"
	"testing"
)

func TestBuiltInSpacyOffersArePinnedReleaseArchives(t *testing.T) {
	local, err := LoadBuiltInLocalProviderCatalog()
	if err != nil {
		t.Fatalf("load built-in local catalog: %v", err)
	}
	seen := 0
	for _, row := range local.LocalPlaneModels() {
		if row.Install == nil || row.Install.InstallKind != LocalInstallKindReleaseArchive {
			continue
		}
		for _, variant := range row.Variants {
			seen++
			if variant.Archive == nil || variant.Archive.SizeBytes <= 0 || variant.TotalSizeBytes <= 0 ||
				!strings.HasPrefix(variant.Archive.Root, strings.TrimSuffix(variant.Archive.File, "-3.8.0-py3-none-any.whl")+"/") {
				t.Fatalf("release archive variant %q is incomplete: %+v", variant.VariantID, variant.Archive)
			}
			if row.Install.Repo != "explosion/spacy-models" || row.Install.Entry != "config.cfg" || row.Install.License == "" {
				t.Fatalf("release archive row %q source = %+v", row.ModelID, row.Install)
			}
		}
	}
	if seen != 8 {
		t.Fatalf("spaCy release archive variants = %d, want 8", seen)
	}
}

func TestValidateLocalPlaneArchiveRejectsUnsafeSources(t *testing.T) {
	valid := LocalPlaneArchive{File: "pkg-1.0-py3-none-any.whl", Format: "zip", SHA256: "sha256:" + strings.Repeat("a", 64), SizeBytes: 10, Root: "pkg/pkg-1.0"}
	if err := ValidateLocalPlaneArchive("owner/repo", "pkg-1.0", valid, []string{"config.cfg", "vocab/strings.json"}); err != nil {
		t.Fatalf("valid archive rejected: %v", err)
	}
	for name, check := range map[string]func() error{
		"repo URL": func() error {
			return ValidateLocalPlaneArchive("https://github.com/owner/repo", "pkg-1.0", valid, []string{"config.cfg"})
		},
		"tag path": func() error { return ValidateLocalPlaneArchive("owner/repo", "a/b", valid, []string{"config.cfg"}) },
		"asset path": func() error {
			bad := valid
			bad.File = "../pkg.whl"
			return ValidateLocalPlaneArchive("owner/repo", "pkg-1.0", bad, []string{"config.cfg"})
		},
		"format": func() error {
			bad := valid
			bad.Format = "tar.gz"
			return ValidateLocalPlaneArchive("owner/repo", "pkg-1.0", bad, []string{"config.cfg"})
		},
		"digest": func() error {
			bad := valid
			bad.SHA256 = strings.Repeat("a", 64)
			return ValidateLocalPlaneArchive("owner/repo", "pkg-1.0", bad, []string{"config.cfg"})
		},
		"root": func() error {
			bad := valid
			bad.Root = "pkg/../other"
			return ValidateLocalPlaneArchive("owner/repo", "pkg-1.0", bad, []string{"config.cfg"})
		},
		"file path": func() error {
			return ValidateLocalPlaneArchive("owner/repo", "pkg-1.0", valid, []string{"vocab\\strings.json"})
		},
	} {
		if check() == nil {
			t.Fatalf("%s: unsafe archive source admitted", name)
		}
	}
}
