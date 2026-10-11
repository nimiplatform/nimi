package productrelease

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

type CandidatePreparation string

const (
	CandidateExtract       CandidatePreparation = "extract"
	CandidateCompleteOwner CandidatePreparation = "complete-current-owner"
)

type CandidateUse struct {
	ServiceReferencesTarget bool
	ActiveFiles             bool
}

func SameCandidate(left, right Identity) bool { return reflect.DeepEqual(left, right) }

func CompleteExistingService(candidate, prior Identity, serviceReferencesTarget bool) (bool, error) {
	order, err := CompareVersions(candidate.Version, prior.Version)
	completion := order == 0 && serviceReferencesTarget && SameCandidate(candidate, prior)
	if err != nil || order < 0 || (order == 0 && !completion) {
		return false, fmt.Errorf("UPDATE_COMPATIBILITY_INVALID")
	}
	return completion, nil
}

// The already signed product identity is reserved before exposing a version
// directory. It is not an installation receipt: normal admission still needs
// all actual bytes. No separate retry journal or version ledger is created.
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-012
func EnsurePreparedCandidate(root string, expectedRaw []byte, key string, use CandidateUse, seal func(string) error) (CandidatePreparation, error) {
	expected, err := VerifyIdentity(expectedRaw, key)
	if err != nil || filepath.Base(root) != expected.Version {
		return "", fmt.Errorf("UPDATE_COHORT_INVALID")
	}
	if _, err := os.Lstat(root); err == nil {
		return InspectPreparedCandidate(root, expected, key, use)
	} else if !os.IsNotExist(err) {
		return "", err
	}
	if use.ServiceReferencesTarget || use.ActiveFiles {
		return "", fmt.Errorf("UPDATE_ACTIVE_CANDIDATE_REPAIR_REQUIRED")
	}
	temporary, err := os.MkdirTemp(filepath.Dir(root), ".candidate-")
	if err != nil {
		return "", err
	}
	// Cleanup of an unused staging directory cannot change candidate admission.
	defer func() { _ = os.RemoveAll(temporary) }()
	if err := seal(temporary); err != nil {
		return "", err
	}
	identityFile := filepath.Join(temporary, IdentityFile)
	if err := os.WriteFile(identityFile, expectedRaw, 0600); err != nil {
		return "", err
	}
	if err := seal(identityFile); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, root); err != nil {
		return "", err
	}
	return CandidateExtract, nil
}

// Safe reuse of an unused partial tree requires the same publisher identity
// and only its admitted names. Contents may be truncated by a failed extract;
// they gain no trust and the installer must restage/verify every final byte.
func InspectPreparedCandidate(root string, expected Identity, key string, use CandidateUse) (CandidatePreparation, error) {
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("UPDATE_DESTINATION_UNTRUSTED")
	}
	raw, err := os.ReadFile(filepath.Join(root, IdentityFile))
	if err != nil {
		return "", fmt.Errorf("UPDATE_DESTINATION_UNTRUSTED")
	}
	stored, err := VerifyIdentity(raw, key)
	if err != nil || !SameCandidate(stored, expected) {
		return "", fmt.Errorf("UPDATE_DESTINATION_UNTRUSTED")
	}
	err = filepath.WalkDir(root, func(file string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("UPDATE_DESTINATION_UNTRUSTED")
		}
		if file == root {
			return nil
		}
		relative, err := filepath.Rel(root, file)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		if entry.IsDir() {
			for admitted := range expected.Files {
				if strings.HasPrefix(admitted, name+"/") {
					return nil
				}
			}
			return fmt.Errorf("UPDATE_DESTINATION_UNTRUSTED")
		}
		if !entry.Type().IsRegular() || (name != IdentityFile && expected.Files[name] == "") {
			return fmt.Errorf("UPDATE_DESTINATION_UNTRUSTED")
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if use.ServiceReferencesTarget {
		if err := VerifyInventory(root, expected); err != nil {
			return "", fmt.Errorf("UPDATE_ACTIVE_CANDIDATE_REPAIR_REQUIRED: %w", err)
		}
		return CandidateCompleteOwner, nil
	}
	if use.ActiveFiles {
		return "", fmt.Errorf("UPDATE_DESTINATION_IN_USE")
	}
	return CandidateExtract, nil
}
