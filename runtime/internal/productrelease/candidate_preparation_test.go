package productrelease

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func preparationFixture(t *testing.T) (string, string, Identity, []byte, string) {
	t.Helper()
	identity, source := fixtureIdentity(t)
	raw, key := signed(t, identity)
	parent := filepath.Join(t.TempDir(), "Nimi", "Product")
	if err := os.MkdirAll(parent, 0700); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(parent, identity.Version), source, identity, raw, key
}
func portableSeal(file string) error {
	info, err := os.Stat(file)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return os.Chmod(file, 0700)
	}
	return os.Chmod(file, 0600)
}
func restageFixture(t *testing.T, root, source string, identity Identity) {
	t.Helper()
	for name := range identity.Files {
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		bytes, err := os.ReadFile(filepath.Join(source, filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, bytes, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
func TestFailedPreparationDoesNotExposeBlockingUnsignedVersionDirectory(t *testing.T) {
	root, _, _, raw, key := preparationFixture(t)
	calls := 0
	if _, err := EnsurePreparedCandidate(root, raw, key, CandidateUse{}, func(file string) error {
		calls++
		if calls == 2 {
			return fmt.Errorf("injected identity-seal failure")
		}
		return portableSeal(file)
	}); err == nil {
		t.Fatal("reservation failure ignored")
	}
	if _, err := os.Lstat(root); !os.IsNotExist(err) {
		t.Fatalf("unsigned blocking root exposed: %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(root))
	if err != nil || len(entries) != 0 {
		t.Fatalf("own reservation debris: %v %v", entries, err)
	}
	if decision, err := EnsurePreparedCandidate(root, raw, key, CandidateUse{}, portableSeal); err != nil || decision != CandidateExtract {
		t.Fatalf("second prepare %s %v", decision, err)
	}
}
func TestSameAdmittedCandidateRetriesRealPartialTreeThenCompletesOwnerWithoutExtraction(t *testing.T) {
	for _, failure := range []string{"after-prepare", "partial-extract", "validation", "before-scm"} {
		t.Run(failure, func(t *testing.T) {
			root, source, identity, raw, key := preparationFixture(t)
			if _, err := EnsurePreparedCandidate(root, raw, key, CandidateUse{}, portableSeal); err != nil {
				t.Fatal(err)
			}
			switch failure {
			case "partial-extract", "validation":
				if err := os.WriteFile(filepath.Join(root, "Nimi.exe"), []byte("truncated installer output"), 0600); err != nil {
					t.Fatal(err)
				}
			case "before-scm":
				restageFixture(t, root, source, identity)
			}
			before, err := os.Stat(root)
			if err != nil {
				t.Fatal(err)
			}
			decision, err := EnsurePreparedCandidate(root, raw, key, CandidateUse{}, portableSeal)
			if err != nil || decision != CandidateExtract {
				t.Fatalf("second attempt refused: %s %v", decision, err)
			}
			after, _ := os.Stat(root)
			if !os.SameFile(before, after) {
				t.Fatal("retry deleted/replaced candidate directory")
			}
			restageFixture(t, root, source, identity)
			if err := VerifyInventory(root, identity); err != nil {
				t.Fatal(err)
			}
			// SCM switched after bytes were admitted; retry must complete this owner
			// without another file extraction, even if its Runtime holds code files.
			decision, err = EnsurePreparedCandidate(root, raw, key, CandidateUse{ServiceReferencesTarget: true, ActiveFiles: true}, portableSeal)
			if err != nil || decision != CandidateCompleteOwner {
				t.Fatalf("owner completion %s %v", decision, err)
			}
			if err := VerifyInventory(root, identity); err != nil {
				t.Fatal("completion modified admitted bytes")
			}
		})
	}
}
func TestUnknownAndActiveCandidatesArePreservedAndCannotBeRestaged(t *testing.T) {
	for _, fault := range []string{"missing-identity", "different-source", "unknown-file", "unknown-directory", "symlink", "active-files", "active-damaged"} {
		t.Run(fault, func(t *testing.T) {
			root, source, identity, raw, key := preparationFixture(t)
			if _, err := EnsurePreparedCandidate(root, raw, key, CandidateUse{}, portableSeal); err != nil {
				t.Fatal(err)
			}
			use := CandidateUse{}
			switch fault {
			case "missing-identity":
				_ = os.Remove(filepath.Join(root, IdentityFile))
			case "different-source":
				identity.SourceRevision = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
			case "unknown-file":
				_ = os.WriteFile(filepath.Join(root, "unknown.txt"), []byte("retain unknown"), 0600)
			case "unknown-directory":
				_ = os.Mkdir(filepath.Join(root, "unknown"), 0700)
			case "symlink":
				if err := os.Symlink(source, filepath.Join(root, "runtime")); err != nil {
					t.Fatal(err)
				}
			case "active-files":
				use.ActiveFiles = true
			case "active-damaged":
				use.ServiceReferencesTarget = true
				use.ActiveFiles = true
			}
			before, _ := os.Stat(root)
			var rejection error
			if fault == "different-source" {
				_, rejection = InspectPreparedCandidate(root, identity, key, use)
			} else {
				_, rejection = EnsurePreparedCandidate(root, raw, key, use, portableSeal)
			}
			if rejection == nil {
				t.Fatal("unsafe candidate reused")
			}
			after, err := os.Stat(root)
			if err != nil || !os.SameFile(before, after) {
				t.Fatal("unsafe candidate removed")
			}
			if fault == "unknown-file" {
				bytes, err := os.ReadFile(filepath.Join(root, "unknown.txt"))
				if err != nil || string(bytes) != "retain unknown" {
					t.Fatal("unknown member changed")
				}
			}
		})
	}
}

func TestExistingSCMTargetCompletesOnlyExactCandidateWithoutDowngrade(t *testing.T) {
	identity, _ := fixtureIdentity(t)
	if complete, err := CompleteExistingService(identity, identity, true); err != nil || !complete {
		t.Fatalf("current exact owner rejected: %v", err)
	}
	for _, fault := range []string{"other-root", "other-source", "other-bytes", "older-candidate"} {
		prior := identity
		target := true
		switch fault {
		case "other-root":
			target = false
		case "other-source":
			prior.SourceRevision = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		case "other-bytes":
			prior.Files = map[string]string{}
		case "older-candidate":
			prior.Version = "0.4.0"
			prior.ReleaseID = "nimi/v0.4.0"
		}
		if _, err := CompleteExistingService(identity, prior, target); err == nil {
			t.Fatalf("unsafe completion %s", fault)
		}
	}
	prior := identity
	prior.Version = "0.2.0"
	prior.ReleaseID = "nimi/v0.2.0"
	if complete, err := CompleteExistingService(identity, prior, false); err != nil || complete {
		t.Fatalf("forward owner refused/promoted completion: %v", err)
	}
}
