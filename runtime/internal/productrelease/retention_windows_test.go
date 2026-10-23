//go:build windows

package productrelease

import (
	"bufio"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func retentionFixture(t *testing.T, versions ...string) (string, string) {
	t.Helper()
	root := t.TempDir()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	for _, version := range versions {
		identity, source := fixtureIdentity(t)
		// A signed payload may legitimately contain an identity-named file.
		// Only the root admission envelope has the special final-delete role.
		nested := filepath.Join(source, "resources", IdentityFile)
		if err := os.WriteFile(nested, []byte("ordinary admitted payload"), 0600); err != nil {
			t.Fatal(err)
		}
		identity.Files["resources/"+IdentityFile], _ = FileSHA256(nested)
		identity.Version, identity.ReleaseID = version, "nimi/v"+version
		destination := filepath.Join(root, version)
		restageFixture(t, destination, source, identity)
		payload, err := json.Marshal(identity)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(Envelope{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(private, payload))})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(destination, IdentityFile), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return root, base64.StdEncoding.EncodeToString(public)
}

func retentionTestBoundary(root string) func(string) error {
	return func(name string) error {
		relative, err := filepath.Rel(root, name)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return fmt.Errorf("outside test root")
		}
		info, err := os.Lstat(name)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("reparse")
		}
		return nil
	}
}

func retentionPreviewFixture(t *testing.T) (string, string, RetentionPreview, RetentionEntry) {
	t.Helper()
	root, key := retentionFixture(t, "0.1.0", "0.2.0", "0.3.0")
	preview, err := PreviewRetention(root, "0.3.0", key, nil, RetentionDirectoryID, retentionTestBoundary(root))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range preview.Entries {
		if entry.Version == "0.1.0" && entry.Eligible {
			return root, key, preview, entry
		}
	}
	t.Fatal("missing obsolete selection")
	return "", "", RetentionPreview{}, RetentionEntry{}
}

func TestRetentionPolicyProtectsCurrentNewerRecentAndReferenced(t *testing.T) {
	root, key := retentionFixture(t, "0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0")
	if err := os.Mkdir(filepath.Join(root, "unrecognized"), 0700); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewRetention(root, "0.3.0", key, map[string]string{"0.1.1": "live-code"}, RetentionDirectoryID, retentionTestBoundary(root))
	if err != nil {
		t.Fatal(err)
	}
	eligible := []string{}
	for _, item := range preview.Entries {
		if item.Eligible {
			eligible = append(eligible, item.Version)
		}
	}
	if strings.Join(eligible, ",") != "0.1.0" {
		t.Fatalf("unsafe selection: %+v", preview)
	}
}

func TestRetentionNewestCompleteReferencedVersionUsesSingleRetentionSlot(t *testing.T) {
	root, key := retentionFixture(t, "0.1.0", "0.2.0", "0.3.0")
	preview, err := PreviewRetention(root, "0.3.0", key, map[string]string{"0.2.0": "live-code"}, RetentionDirectoryID, retentionTestBoundary(root))
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range preview.Entries {
		if item.Version == "0.1.0" && !item.Eligible {
			t.Fatalf("extra older version retained: %+v", item)
		}
		if item.Version == "0.2.0" && item.Eligible {
			t.Fatal("live version eligible")
		}
	}
}

func TestRetentionSelectionDoesNotReadUnselectedObsoletePayload(t *testing.T) {
	root, key := retentionFixture(t, "0.0.1", "0.1.0", "0.2.0", "0.3.0")
	visitedOld := false
	boundary := retentionTestBoundary(root)
	preview, err := PreviewRetentionSelection(root, "0.3.0", key, nil, RetentionDirectoryID, func(name string) error {
		if strings.HasPrefix(name, filepath.Join(root, "0.0.1")) {
			visitedOld = true
		}
		return boundary(name)
	}, map[string]bool{"0.1.0": true})
	if err != nil {
		t.Fatal(err)
	}
	if visitedOld {
		t.Fatal("unselected obsolete payload was inspected")
	}
	for _, item := range preview.Entries {
		if item.Eligible && item.Version != "0.1.0" {
			t.Fatalf("expanded selected set: %+v", item)
		}
	}
}

func TestRetentionDeletesOnlyApprovedActualWindowsObjects(t *testing.T) {
	root, key, preview, target := retentionPreviewFixture(t)
	if err := ValidateRetentionSelection(root, preview, []RetentionEntry{target}); err != nil {
		t.Fatal(err)
	}
	result := DeleteRetainedVersion(target, key, retentionTestBoundary(root), func() error { return nil })
	if !result.Removed || result.DeletedBytes != target.LogicalBytes {
		t.Fatalf("%+v", result)
	}
	if _, err := os.Stat(target.Path); !os.IsNotExist(err) {
		t.Fatalf("target retained: %v", err)
	}
	for _, name := range []string{"0.2.0", "0.3.0"} {
		if _, err := os.Stat(filepath.Join(root, name, IdentityFile)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRetentionRefusesPreviewChanges(t *testing.T) {
	for _, change := range []string{"directory", "bytes", "unknown-empty-directory", "reference"} {
		t.Run(change, func(t *testing.T) {
			root, key, _, target := retentionPreviewFixture(t)
			before := target.LogicalBytes
			switch change {
			case "directory":
				if err := os.Rename(target.Path, target.Path+"-moved"); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(target.Path, 0700); err != nil {
					t.Fatal(err)
				}
				entries, err := os.ReadDir(target.Path + "-moved")
				if err != nil {
					t.Fatal(err)
				}
				for _, item := range entries {
					if err := os.Rename(filepath.Join(target.Path+"-moved", item.Name()), filepath.Join(target.Path, item.Name())); err != nil {
						t.Fatal(err)
					}
				}
			case "bytes":
				if err := os.WriteFile(filepath.Join(target.Path, "Nimi.exe"), []byte("engineering Nimu.exe"), 0600); err != nil {
					t.Fatal(err)
				}
			case "unknown-empty-directory":
				if err := os.Mkdir(filepath.Join(target.Path, "unknown"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			checks := 0
			result := DeleteRetainedVersion(target, key, retentionTestBoundary(root), func() error {
				checks++
				if change == "reference" && checks == 2 {
					return fmt.Errorf("new SCM reference")
				}
				return nil
			})
			if result.Removed || result.DeletedBytes != 0 || result.Reason == "" {
				t.Fatalf("preview changed, result %+v (before %d)", result, before)
			}
			if _, err := os.Stat(filepath.Join(target.Path, IdentityFile)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRetentionFileHolder(t *testing.T) {
	name := os.Getenv("NIMI_RETENTION_TEST_HOLD_FILE")
	if name == "" {
		return
	}
	encoded, _ := windows.UTF16PtrFromString(name)
	handle, err := windows.CreateFile(encoded, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	fmt.Println("locked")
	_, _ = io.Copy(io.Discard, os.Stdin)
}

func TestRetentionRealChildFileLockAndRetry(t *testing.T) {
	root, key, _, target := retentionPreviewFixture(t)
	command := exec.Command(os.Args[0], "-test.run=^TestRetentionFileHolder$")
	command.Env = append(os.Environ(), "NIMI_RETENTION_TEST_HOLD_FILE="+filepath.Join(target.Path, "Nimi.exe"))
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = input.Close(); _ = command.Wait() }()
	line, err := bufio.NewReader(output).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "locked" {
		t.Fatalf("child lock: %q %v", line, err)
	}
	result := DeleteRetainedVersion(target, key, retentionTestBoundary(root), func() error { return nil })
	if result.Removed || result.DeletedBytes != 0 || !strings.Contains(result.Reason, "LOCKED") {
		t.Fatalf("%+v", result)
	}
	_ = input.Close()
	if err := command.Wait(); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewRetention(root, "0.3.0", key, nil, RetentionDirectoryID, retentionTestBoundary(root))
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range preview.Entries {
		if item.Version == target.Version {
			target = item
		}
	}
	result = DeleteRetainedVersion(target, key, retentionTestBoundary(root), func() error { return nil })
	if !result.Removed {
		t.Fatalf("unlocked retry: %+v", result)
	}
}

func TestRetentionPartialTreeRequiresMatchingRemainingBytes(t *testing.T) {
	root, key, _, target := retentionPreviewFixture(t)
	if err := os.Remove(filepath.Join(target.Path, "Nimi.exe")); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewRetention(root, "0.3.0", key, nil, RetentionDirectoryID, retentionTestBoundary(root))
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range preview.Entries {
		if item.Version == target.Version {
			target = item
		}
	}
	if target.Complete || !target.Eligible {
		t.Fatalf("partial cannot resume: %+v", target)
	}
	result := DeleteRetainedVersion(target, key, retentionTestBoundary(root), func() error { return nil })
	if !result.Removed {
		t.Fatalf("%+v", result)
	}
}

func TestRetentionActualPartialFailureKeepsIdentityAndCanResume(t *testing.T) {
	root, key, _, target := retentionPreviewFixture(t)
	readOnly, _ := windows.UTF16PtrFromString(filepath.Join(target.Path, "NimiProductUpdater.exe"))
	if err := windows.SetFileAttributes(readOnly, windows.FILE_ATTRIBUTE_READONLY); err != nil {
		t.Fatal(err)
	}
	defer windows.SetFileAttributes(readOnly, windows.FILE_ATTRIBUTE_NORMAL)
	result := DeleteRetainedVersion(target, key, retentionTestBoundary(root), func() error { return nil })
	if result.Removed || result.DeletedBytes == 0 || result.Reason == "" {
		t.Fatalf("expected real partial failure: %+v", result)
	}
	if _, err := os.Stat(filepath.Join(target.Path, IdentityFile)); err != nil {
		t.Fatal(err)
	}
	if err := windows.SetFileAttributes(readOnly, windows.FILE_ATTRIBUTE_NORMAL); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewRetention(root, "0.3.0", key, nil, RetentionDirectoryID, retentionTestBoundary(root))
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range preview.Entries {
		if item.Version == target.Version {
			target = item
		}
	}
	if target.Complete || !target.Eligible {
		t.Fatalf("partial resume preview: %+v", target)
	}
	retried := DeleteRetainedVersion(target, key, retentionTestBoundary(root), func() error { return nil })
	if !retried.Removed {
		t.Fatalf("partial retry: %+v", retried)
	}
}
