package engine

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func TestAudioCppMacArchiveAdmitsOnlyExecutableAndLicense(t *testing.T) {
	identity, err := AudioCppPackageForPlatform("darwin/arm64")
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"", "duplicate", "symlink", "missing"} {
		t.Run(invalid, func(t *testing.T) {
			archive := filepath.Join(t.TempDir(), "package.tar.gz")
			f, err := os.Create(archive)
			if err != nil {
				t.Fatal(err)
			}
			gz := gzip.NewWriter(f)
			tw := tar.NewWriter(gz)
			names := []string{"audiocpp_cli", "LICENSE", "audiocpp_server", "tools/model.py", "../outside"}
			if invalid == "duplicate" {
				names = append(names, "audiocpp_cli")
			}
			for _, name := range names {
				if invalid == "missing" && name == "LICENSE" {
					continue
				}
				header := &tar.Header{Name: "./" + name, Mode: 0644, Size: 5, Typeflag: tar.TypeReg}
				if invalid == "symlink" && name == "audiocpp_cli" {
					header.Typeflag = tar.TypeSymlink
					header.Linkname = "../outside"
					header.Size = 0
				}
				if err := tw.WriteHeader(header); err != nil {
					t.Fatal(err)
				}
				if header.Size != 0 {
					if _, err := tw.Write([]byte("owned")); err != nil {
						t.Fatal(err)
					}
				}
			}
			if err := tw.Close(); err != nil {
				t.Fatal(err)
			}
			if err := gz.Close(); err != nil {
				t.Fatal(err)
			}
			if err := f.Close(); err != nil {
				t.Fatal(err)
			}
			dest := t.TempDir()
			err = extractAudioCppPackageFiles(archive, dest, identity)
			if invalid != "" {
				if err == nil {
					t.Fatal("invalid cohort admitted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			files, err := os.ReadDir(dest)
			if err != nil || len(files) != 2 {
				t.Fatalf("unexpected admitted files: %v %v", files, err)
			}
			info, err := os.Stat(filepath.Join(dest, "audiocpp_cli"))
			if err != nil || info.Mode().Perm() != 0755 {
				t.Fatal("upstream CLI mode was not materialized")
			}
		})
	}
}

func TestAudioCppMacRegistryRejectsTamperedLicenseAndWindowsIdentity(t *testing.T) {
	if currentGOOS() != "darwin" || currentGOARCH() != "arm64" {
		t.Skip("Mac owner verification")
	}
	identity, _ := AudioCppPackageForPlatform("darwin/arm64")
	root := t.TempDir()
	for _, name := range identity.AdmittedFiles {
		if err := os.WriteFile(filepath.Join(root, name), []byte("fixture:"+name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	hashes, err := audioCppFilesSHA256(root, identity.AdmittedFiles)
	if err != nil {
		t.Fatal(err)
	}
	entry := &RegistryEntry{Engine: EngineAudioCPP, Version: AudioCppPackageVersion, Platform: identity.Platform, AssetName: identity.AssetName, AcceleratorPlane: identity.AcceleratorPlane, SHA256: identity.ArchiveSHA256, BinaryPath: filepath.Join(root, identity.ExecutableName), BinarySHA256: hashes[identity.ExecutableName], AudioCppFileSHA256: hashes}
	m := &Manager{}
	if _, err := m.audioCppStatusFromRegistryEntry(entry); err != nil {
		t.Fatal(err)
	}
	copy := *entry
	copy.Platform = "windows/amd64"
	if _, err := m.audioCppStatusFromRegistryEntry(&copy); err == nil {
		t.Fatal("Windows substitution passed Mac owner")
	}
	if err := os.WriteFile(filepath.Join(root, "LICENSE"), []byte("tampered"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.audioCppStatusFromRegistryEntry(entry); err == nil {
		t.Fatal("tampered cohort passed owner verification")
	}
}
