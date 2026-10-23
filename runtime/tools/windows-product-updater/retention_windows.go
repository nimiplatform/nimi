//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
	"golang.org/x/sys/windows"
)

type cleanupJob struct {
	Schema          string                          `json:"schema"`
	ParentPID       uint32                          `json:"parentPid"`
	ConsentApproved bool                            `json:"consentApproved"`
	CurrentVersion  string                          `json:"currentVersion"`
	Targets         []productrelease.RetentionEntry `json:"targets"`
}

func previewProductRetention(selected map[string]bool) (productrelease.RetentionPreview, error) {
	identity, root, err := currentIdentity()
	if err != nil {
		return productrelease.RetentionPreview{}, err
	}
	if err := verifyCurrentService(root, identity); err != nil {
		return productrelease.RetentionPreview{}, err
	}
	productRoot, err := productrelease.ProductRoot()
	if err != nil {
		return productrelease.RetentionPreview{}, err
	}
	references, err := runningProductVersions(productRoot)
	if err != nil {
		return productrelease.RetentionPreview{}, err
	}
	references[identity.Version] = "current-service"
	preview, err := productrelease.PreviewRetentionSelection(productRoot, identity.Version, productrelease.PublicKey, references, productrelease.RetentionDirectoryID, productrelease.ValidateAdministrativePath, selected)
	preview.RuntimeVersion = identity.Components.Runtime.Version
	return preview, err
}

// Enumerate actual process images, not PID receipts. Inability to resolve a
// potential Nimi code owner is unresolved, not evidence that it is inactive.
func runningProductVersions(root string) (map[string]string, error) {
	result := map[string]string{}
	names := map[string]bool{"nimi.exe": true, "nimiproductupdater.exe": true}
	directories, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	for _, directory := range directories {
		if !directory.IsDir() {
			continue
		}
		if _, err := productrelease.CompareVersions(directory.Name(), directory.Name()); err != nil {
			continue
		}
		file := filepath.Join(root, directory.Name(), productrelease.IdentityFile)
		if err := productrelease.ValidateAdministrativePath(file); err != nil {
			continue
		}
		input, err := os.Open(file)
		if err != nil {
			continue
		}
		raw, readErr := io.ReadAll(io.LimitReader(input, productrelease.MaxIdentityBytes+1))
		_ = input.Close()
		if readErr != nil {
			continue
		}
		identity, err := productrelease.VerifyIdentity(raw, productrelease.PublicKey)
		if err != nil {
			continue
		}
		for name := range identity.Files {
			if strings.EqualFold(filepath.Ext(name), ".exe") {
				names[strings.ToLower(filepath.Base(name))] = true
			}
		}
	}
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		name := strings.ToLower(windows.UTF16ToString(entry.ExeFile[:]))
		if !names[name] {
			continue
		}
		process, openErr := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, entry.ProcessID)
		if openErr != nil {
			if openErr == windows.ERROR_INVALID_PARAMETER {
				continue
			}
			return nil, fmt.Errorf("UPDATE_RETENTION_REFERENCE_UNKNOWN: %w", openErr)
		}
		image, queryErr := processPath(process)
		_ = windows.CloseHandle(process)
		if queryErr != nil {
			return nil, fmt.Errorf("UPDATE_RETENTION_REFERENCE_UNKNOWN: %w", queryErr)
		}
		relative, relErr := filepath.Rel(root, image)
		if relErr != nil || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
			continue
		}
		parts := strings.Split(relative, string(filepath.Separator))
		if len(parts) < 2 {
			continue
		}
		if _, versionErr := productrelease.CompareVersions(parts[0], parts[0]); versionErr == nil {
			result[parts[0]] = "live-code"
		}
	}
	if err != windows.ERROR_NO_MORE_FILES {
		return nil, err
	}
	return result, nil
}

func readCleanupJob(file string) (cleanupJob, []byte, *os.File, error) {
	var input cleanupJob
	if filepath.Base(file) != "job.json" || !regexp.MustCompile(`^cleanup-[A-Za-z0-9]{6}$`).MatchString(filepath.Base(filepath.Dir(file))) {
		return input, nil, nil, fmt.Errorf("UPDATE_RETENTION_REQUEST_INVALID")
	}
	locked, err := lockFile(file)
	if err != nil {
		return input, nil, nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(locked, 128*1024+1))
	if err == nil && len(raw) <= 128*1024 {
		decoder := json.NewDecoder(strings.NewReader(string(raw)))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || input.Schema != "nimi-product-cleanup/v1" || !input.ConsentApproved || len(input.Targets) == 0 || len(input.Targets) > 256 {
			err = fmt.Errorf("UPDATE_RETENTION_REQUEST_INVALID")
		}
	} else {
		err = fmt.Errorf("UPDATE_RETENTION_REQUEST_INVALID")
	}
	if err != nil {
		_ = locked.Close()
		return input, nil, nil, err
	}
	return input, raw, locked, nil
}

func requestProductCleanup(file string) error {
	identity, root, err := currentIdentity()
	if err != nil {
		return err
	}
	userSID, err := ordinaryUser()
	if err != nil {
		return err
	}
	cache, err := fixedCache()
	if err != nil || !strings.EqualFold(filepath.Dir(filepath.Dir(file)), cache) {
		return fmt.Errorf("UPDATE_RETENTION_REQUEST_INVALID")
	}
	if err := verifyCacheFile(file); err != nil {
		return err
	}
	input, raw, locked, err := readCleanupJob(file)
	if err != nil {
		return err
	}
	defer locked.Close()
	if input.CurrentVersion != identity.Version {
		return fmt.Errorf("UPDATE_RETENTION_PREVIEW_CHANGED")
	}
	actualParent, err := parentPID()
	if err != nil || input.ParentPID != actualParent {
		return fmt.Errorf("UPDATE_CALLER_UNTRUSTED")
	}
	parent, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, actualParent)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(parent)
	parentImage, err := processPath(parent)
	if err != nil || !strings.EqualFold(parentImage, filepath.Join(root, "Nimi.exe")) {
		return fmt.Errorf("UPDATE_CALLER_UNTRUSTED")
	}
	var token windows.Token
	if err := windows.OpenProcessToken(parent, windows.TOKEN_QUERY, &token); err != nil {
		return err
	}
	defer token.Close()
	parentUser, err := token.GetTokenUser()
	if err != nil || parentUser.User.Sid.String() != userSID || token.IsElevated() {
		return fmt.Errorf("UPDATE_USER_CONTEXT_INVALID")
	}
	parentFile, err := lockFile(parentImage)
	if err != nil {
		return err
	}
	defer parentFile.Close()
	digest, err := hashLocked(parentFile)
	if err != nil || digest != identity.Files["Nimi.exe"] {
		return fmt.Errorf("UPDATE_CALLER_UNTRUSTED")
	}
	productRoot, err := productrelease.ProductRoot()
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, target := range input.Targets {
		order, err := productrelease.CompareVersions(target.Version, identity.Version)
		if err != nil || order >= 0 || !target.Eligible || seen[target.Version] || target.Path != filepath.Join(productRoot, target.Version) ||
			!regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(target.IdentitySHA256) || target.DirectoryID == "" || target.LogicalBytes < 0 {
			return fmt.Errorf("UPDATE_RETENTION_SELECTION_INVALID")
		}
		seen[target.Version] = true
	}
	sum := sha256.Sum256(raw)
	helper, err := os.Executable()
	if err != nil {
		return err
	}
	requestHash := hex.EncodeToString(sum[:])
	pipe, outcomes, closeAuthorization, err := startCleanupAuthorization(file, requestHash, userSID, identity, root)
	if err != nil {
		return err
	}
	defer closeAuthorization()
	exit, err := runElevated(helper, "--cleanup-authorized "+syscall.EscapeArg(pipe)+" "+requestHash, 0)
	if err == windows.ERROR_CANCELLED {
		return fmt.Errorf("UPDATE_AUTHORIZATION_CANCELED")
	}
	if err != nil {
		return err
	}
	if exit != 0 {
		return fmt.Errorf("UPDATE_RETENTION_FAILED")
	}
	select {
	case result := <-outcomes:
		if result.err != nil || !json.Valid(result.raw) {
			return fmt.Errorf("UPDATE_RETENTION_RESULT_UNAVAILABLE")
		}
		_, err = os.Stdout.Write(result.raw)
		return err
	case <-time.After(10 * time.Second):
		return fmt.Errorf("UPDATE_RETENTION_RESULT_UNAVAILABLE")
	}
}

func withProductInstallerMutex(operation func() error) error {
	return withRetentionMutex(`Global\NimiProductInstaller`, operation)
}

func withRetentionMutex(mutexName string, operation func() error) error {
	// Windows mutex ownership belongs to the acquiring OS thread. A Go
	// goroutine must not migrate before ReleaseMutex.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	name, _ := windows.UTF16PtrFromString(mutexName)
	mutex, err := windows.CreateMutex(nil, false, name)
	if mutex == 0 || (err != nil && err != windows.ERROR_ALREADY_EXISTS) {
		return fmt.Errorf("UPDATE_HANDOFF_IN_PROGRESS")
	}
	defer windows.CloseHandle(mutex)
	owned, err := windows.WaitForSingleObject(mutex, 0)
	if err != nil || (owned != windows.WAIT_OBJECT_0 && owned != windows.WAIT_ABANDONED) {
		return fmt.Errorf("UPDATE_HANDOFF_IN_PROGRESS")
	}
	defer windows.ReleaseMutex(mutex)
	return operation()
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-013
func executeProductCleanup(pipe, expectedHash string) error {
	if err := elevated(); err != nil {
		return err
	}
	identity, root, err := currentIdentity()
	if err != nil {
		return err
	}
	captured, authorization, err := receiveCleanupAuthorization(pipe, expectedHash, identity, root)
	if err != nil {
		return err
	}
	defer authorization.Close()
	file := captured.JobPath
	if !strings.EqualFold(filepath.Dir(filepath.Dir(file)), captured.CacheRoot) {
		return fmt.Errorf("UPDATE_RETENTION_REQUEST_INVALID")
	}
	if err := verifyCacheFileOwnerAtRoot(file, captured.UserSID, captured.CacheRoot); err != nil {
		return err
	}
	input, raw, locked, err := readCleanupJob(file)
	if err != nil {
		return err
	}
	defer locked.Close()
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != expectedHash || identity.Version != input.CurrentVersion {
		return fmt.Errorf("UPDATE_RETENTION_PREVIEW_CHANGED")
	}
	productRoot, err := productrelease.ProductRoot()
	if err != nil {
		return err
	}
	return withProductInstallerMutex(func() error {
		selected := map[string]bool{}
		for _, target := range input.Targets {
			selected[target.Version] = true
		}
		fresh, err := previewProductRetention(selected)
		if err != nil {
			return err
		}
		results := []productrelease.RetentionResult{}
		seen := map[string]bool{}
		for _, target := range input.Targets {
			if seen[target.Version] {
				return fmt.Errorf("UPDATE_RETENTION_SELECTION_INVALID")
			}
			seen[target.Version] = true
		}
		for _, target := range input.Targets {
			if err := productrelease.ValidateRetentionSelection(productRoot, fresh, []productrelease.RetentionEntry{target}); err != nil {
				results = append(results, productrelease.RetentionResult{Version: target.Version, Reason: err.Error()})
				continue
			}
			results = append(results, productrelease.DeleteRetainedVersion(target, productrelease.PublicKey, productrelease.ValidateAdministrativePath, func() error {
				if err := verifyCurrentService(root, identity); err != nil {
					return err
				}
				references, err := runningProductVersions(productRoot)
				if err != nil {
					return err
				}
				if references[target.Version] != "" {
					return fmt.Errorf("UPDATE_RETENTION_VERSION_IN_USE")
				}
				return nil
			}))
		}
		output, err := json.Marshal(struct {
			Results []productrelease.RetentionResult `json:"results"`
		}{results})
		if err != nil {
			return err
		}
		// Results use the authenticated channel. No elevated write traverses
		// an ordinary-user-controlled result path.
		_, err = authorization.Write(append(output, '\n'))
		return err
	})
}
