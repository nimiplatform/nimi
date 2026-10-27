//go:build windows

// Nimi's fixed product updater bridge. It carries one admitted NSIS installer
// through public UAC/SCM APIs. It is not a generic launcher or Runtime owner.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unsafe"

	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

type job struct {
	Schema                  string          `json:"schema"`
	ParentPID               uint32          `json:"parentPid"`
	ConsentApproved         bool            `json:"consentApproved"`
	CriticalCleanupComplete bool            `json:"criticalCleanupComplete"`
	Envelope                json.RawMessage `json:"envelope"`
	PackagePath             string          `json:"packagePath"`
	ResultPath              string          `json:"resultPath"`
}

func main() {
	var err error
	args := os.Args[1:]
	switch {
	case len(args) == 1 && args[0] == "--probe":
		probe()
		return
	case len(args) == 1 && args[0] == "--retention-preview":
		var preview productrelease.RetentionPreview
		err = withProductInstallerMutex(func() error {
			var previewErr error
			preview, previewErr = previewProductRetention(nil)
			return previewErr
		})
		if err == nil {
			emit(preview)
		}
	case len(args) == 2 && args[0] == "--cleanup":
		err = requestProductCleanup(args[1])
	case len(args) == 3 && args[0] == "--cleanup-authorized":
		err = executeProductCleanup(args[1], args[2])
	case len(args) == 1 && args[0] == "--prepare-cache":
		if _, _, err = currentIdentity(); err == nil {
			err = prepareCache()
		}
	case len(args) == 2 && args[0] == "--verify-cache-file":
		err = verifyCacheFile(args[1])
	case len(args) == 2 && args[0] == "--apply":
		err = apply(args[1])
	case len(args) == 4 && args[0] == "--prepare":
		err = prepareWithBudget(args[1], args[2], args[3])
	case len(args) == 6 && args[0] == "--prepare":
		if err = verifyAuthorizedUpdate(args[1], args[4], args[5], nil); err == nil {
			err = prepareWithBudget(args[1], args[2], args[3])
		}
	case len(args) == 2 && args[0] == "--install":
		err = install(args[1], "", "")
	case len(args) == 4 && args[0] == "--install":
		err = install(args[1], args[2], args[3])
	default:
		err = fmt.Errorf("UPDATE_REQUEST_REJECTED")
	}
	if err != nil {
		if errors.Is(err, errCompleteCurrentOwner) {
			os.Exit(10)
		}
		fmt.Fprintln(os.Stderr, err)
		if strings.Contains(err.Error(), "UPDATE_SERVICE_STOP_FAILED") {
			os.Exit(30)
		}
		if strings.Contains(err.Error(), "UPDATE_SERVICE_START_FAILED") {
			os.Exit(31)
		}
		if strings.Contains(err.Error(), "UPDATE_METADATA_EXPIRED") {
			os.Exit(32)
		}
		if strings.Contains(err.Error(), "UPDATE_DISK_SPACE_INSUFFICIENT") {
			os.Exit(33)
		}
		os.Exit(5)
	}
}
func emit(value any) { _ = json.NewEncoder(os.Stdout).Encode(value) }
func currentIdentity() (productrelease.Identity, string, error) {
	executable, err := os.Executable()
	if err != nil {
		return productrelease.Identity{}, "", err
	}
	digest, err := productrelease.FileSHA256(executable)
	if err != nil {
		return productrelease.Identity{}, "", err
	}
	identity, err := productrelease.VerifyInstalledExecutable(executable, digest, "NimiProductUpdater.exe", productrelease.PublicKey)
	return identity, filepath.Dir(executable), err
}
func ordinaryUser() (string, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return "", err
	}
	defer func() { _ = token.Close() }()
	user, err := token.GetTokenUser()
	if err != nil {
		return "", err
	}
	if token.IsElevated() {
		return "", fmt.Errorf("UPDATE_USER_CONTEXT_INVALID")
	}
	return user.User.Sid.String(), nil
}
func probe() {
	identity, root, trustErr := currentIdentity()
	if trustErr == nil {
		trustErr = verifyCurrentService(root, identity)
	}
	_, userErr := ordinaryUser()
	fingerprint := sha256.Sum256([]byte(productrelease.PublicKey))
	emit(map[string]any{"protocolVersion": 1, "productionTrusted": trustErr == nil && userErr == nil, "publicKeyConfigured": productrelease.PublicKey != "", "publicKeyFingerprint": hex.EncodeToString(fingerprint[:]), "installer": "nsis", "authorization": "uac"})
}
func verifyCurrentService(root string, identity productrelease.Identity) error {
	managerHandle, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseServiceHandle(managerHandle) }()
	serviceName, _ := windows.UTF16PtrFromString(protectedlocal.WindowsProductionServiceName)
	serviceHandle, err := windows.OpenService(managerHandle, serviceName, windows.SERVICE_QUERY_CONFIG|windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return err
	}
	service := &mgr.Service{Name: protectedlocal.WindowsProductionServiceName, Handle: serviceHandle}
	defer func() { _ = service.Close() }()
	config, err := service.Config()
	if err != nil {
		return err
	}
	executable, err := runtimeServiceExecutable(config.BinaryPathName)
	if err != nil || config.ServiceType != windows.SERVICE_WIN32_OWN_PROCESS || !strings.EqualFold(config.ServiceStartName, "LocalSystem") || !strings.EqualFold(executable, filepath.Join(root, "runtime", "nimi.exe")) {
		return fmt.Errorf("unadmitted fixed service definition")
	}
	var size uint32
	var info uint32
	if err := windows.QueryServiceConfig2(service.Handle, windows.SERVICE_CONFIG_SERVICE_SID_INFO, (*byte)(unsafe.Pointer(&info)), 4, &size); err != nil || info != windows.SERVICE_SID_TYPE_RESTRICTED {
		return fmt.Errorf("unadmitted fixed service SID type")
	}
	if identity.ReleaseID == "" {
		return fmt.Errorf("UPDATE_COHORT_INVALID")
	}
	return nil
}
func fixedCache() (string, error) {
	root, err := windows.KnownFolderPath(windows.FOLDERID_RoamingAppData, windows.KF_FLAG_DEFAULT)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "Nimi", "product-updates"), nil
}
func noReparse(file string) error {
	for current := filepath.Clean(file); current != filepath.Dir(current); current = filepath.Dir(current) {
		p, err := windows.UTF16PtrFromString(current)
		if err != nil {
			return err
		}
		attrs, err := windows.GetFileAttributes(p)
		if err != nil || attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return fmt.Errorf("UPDATE_HANDOFF_INVALID")
		}
	}
	return nil
}
func lockFile(file string) (*os.File, error) {
	if err := noReparse(file); err != nil {
		return nil, err
	}
	p, err := windows.UTF16PtrFromString(file)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(handle), file), nil
}
func hashLocked(file *os.File) (string, error) {
	if _, err := file.Seek(0, 0); err != nil {
		return "", err
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	_, err := file.Seek(0, 0)
	return hex.EncodeToString(hash.Sum(nil)), err
}
func processPath(process windows.Handle) (string, error) {
	buffer := make([]uint16, 32768)
	length := uint32(len(buffer))
	if err := windows.QueryFullProcessImageName(process, 0, &buffer[0], &length); err != nil {
		return "", err
	}
	return windows.UTF16ToString(buffer[:length]), nil
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-012
func apply(file string) error {
	identity, root, err := currentIdentity()
	if err != nil {
		return fmt.Errorf("UPDATE_INSTALL_NOT_READY: %w", err)
	}
	userSID, err := ordinaryUser()
	if err != nil {
		return err
	}
	mutexName, _ := windows.UTF16PtrFromString(`Local\NimiProductUpdate-` + userSID)
	mutex, mutexErr := windows.CreateMutex(nil, false, mutexName)
	if mutex == 0 || (mutexErr != nil && mutexErr != windows.ERROR_ALREADY_EXISTS) {
		return fmt.Errorf("UPDATE_HANDOFF_IN_PROGRESS")
	}
	defer func() { _ = windows.CloseHandle(mutex) }()
	owned, err := windows.WaitForSingleObject(mutex, 0)
	if err != nil || (owned != windows.WAIT_OBJECT_0 && owned != windows.WAIT_ABANDONED) {
		return fmt.Errorf("UPDATE_HANDOFF_IN_PROGRESS")
	}
	defer func() { _ = windows.ReleaseMutex(mutex) }()
	cache, err := fixedCache()
	if err != nil {
		return err
	}
	directory := filepath.Dir(file)
	if filepath.Base(file) != "job.json" || !strings.EqualFold(filepath.Dir(directory), cache) || !regexp.MustCompile(`^download-[a-zA-Z0-9]{6}$`).MatchString(filepath.Base(directory)) {
		return fmt.Errorf("UPDATE_HANDOFF_INVALID")
	}
	lockedJob, err := lockFile(file)
	if err != nil {
		return err
	}
	defer func() { _ = lockedJob.Close() }()
	if err := verifyCacheFile(file); err != nil {
		return err
	}
	raw, err := io.ReadAll(io.LimitReader(lockedJob, 128*1024+1))
	if err != nil || len(raw) > 128*1024 {
		return fmt.Errorf("UPDATE_HANDOFF_INVALID")
	}
	var input job
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || input.Schema != "nimi-product-install/v1" || !input.ConsentApproved || !input.CriticalCleanupComplete {
		return fmt.Errorf("UPDATE_HANDOFF_INVALID")
	}
	if actualParent, err := parentPID(); err != nil || actualParent != input.ParentPID {
		return fmt.Errorf("UPDATE_CALLER_UNTRUSTED")
	}
	release, err := productrelease.VerifyRelease(input.Envelope, productrelease.PublicKey, time.Now())
	if err != nil {
		return err
	}
	osVersion := windows.RtlGetVersion()
	if err := productrelease.CheckCompatibility(release, identity.Version, fmt.Sprintf("%d.%d.%d", osVersion.MajorVersion, osVersion.MinorVersion, osVersion.BuildNumber)); err != nil {
		return err
	}
	if input.PackagePath != filepath.Join(directory, release.Asset.Name) || input.ResultPath != filepath.Join(directory, "result.json") {
		return fmt.Errorf("UPDATE_HANDOFF_INVALID")
	}
	parent, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, input.ParentPID)
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseHandle(parent) }()
	parentPath, err := processPath(parent)
	if err != nil || !strings.EqualFold(parentPath, filepath.Join(root, "Nimi.exe")) {
		return fmt.Errorf("UPDATE_CALLER_UNTRUSTED")
	}
	var parentToken windows.Token
	if err := windows.OpenProcessToken(parent, windows.TOKEN_QUERY, &parentToken); err != nil {
		return err
	}
	defer func() { _ = parentToken.Close() }()
	parentUser, err := parentToken.GetTokenUser()
	if err != nil || parentUser.User.Sid.String() != userSID || parentToken.IsElevated() {
		return fmt.Errorf("UPDATE_USER_CONTEXT_INVALID")
	}
	parentExecutable, err := lockFile(parentPath)
	if err != nil {
		return err
	}
	defer func() { _ = parentExecutable.Close() }()
	parentDigest, err := hashLocked(parentExecutable)
	if err != nil || parentDigest != identity.Files["Nimi.exe"] {
		return fmt.Errorf("UPDATE_CALLER_UNTRUSTED")
	}
	packageFile, err := lockFile(input.PackagePath)
	if err != nil {
		return err
	}
	defer func() { _ = packageFile.Close() }()
	info, err := packageFile.Stat()
	if err != nil || info.Size() != release.Asset.Size {
		return fmt.Errorf("UPDATE_ASSET_DIGEST_MISMATCH")
	}
	digest, err := hashLocked(packageFile)
	if err != nil || digest != release.Asset.SHA256 {
		return fmt.Errorf("UPDATE_ASSET_DIGEST_MISMATCH")
	}
	requestHash := sha256.Sum256(raw)
	emit(map[string]any{"phase": "handoff", "releaseId": release.ReleaseID, "requestHash": hex.EncodeToString(requestHash[:])})
	status, err := windows.WaitForSingleObject(parent, 120000)
	if err != nil || status != windows.WAIT_OBJECT_0 {
		_ = os.WriteFile(input.ResultPath, []byte("{\"phase\":\"recovery-required\",\"reason\":\"UPDATE_PARENT_EXIT_FAILED\"}\n"), 0600)
		return fmt.Errorf("UPDATE_PARENT_EXIT_FAILED")
	}
	// The exact installer file remains locked against edits/replacement through
	// the entire public UAC execution. No elevated helper opens a user job.
	reason := ""
	phase := "installer-exited"
	if _, err = productrelease.VerifyRelease(input.Envelope, productrelease.PublicKey, time.Now()); err != nil {
		phase = "failed"
		reason = "UPDATE_METADATA_EXPIRED"
	} else {
		code, runErr := runInstaller(input.PackagePath, file, hex.EncodeToString(requestHash[:]))
		if runErr != nil {
			phase = "failed"
			reason = "UPDATE_INSTALL_FAILED"
			if runErr == windows.ERROR_CANCELLED {
				reason = "UPDATE_AUTHORIZATION_CANCELED"
			}
		} else if code != 0 {
			phase = "recovery-required"
			reason = "UPDATE_INSTALL_FAILED"
			if code == 30 {
				reason = "UPDATE_SERVICE_STOP_FAILED"
			}
			if code == 31 {
				reason = "UPDATE_SERVICE_START_FAILED"
			}
			if code == 32 {
				phase = "failed"
				reason = "UPDATE_METADATA_EXPIRED"
			}
			if code == 33 {
				phase = "failed"
				reason = "UPDATE_DISK_SPACE_INSUFFICIENT"
			}
		}
	}
	// These results are diagnostics only. New Home verifies the signed installed
	// cohort, the protected Runtime peer/READY and its own readiness.
	_ = os.WriteFile(input.ResultPath, []byte(fmt.Sprintf("{\"phase\":%q,\"reason\":%q}\n", phase, reason)), 0600)
	productRoot, _ := productrelease.ProductRoot()
	nextRoot := filepath.Join(productRoot, release.Version)
	reopen := filepath.Join(root, "Nimi.exe")
	if phase == "installer-exited" {
		if digest, err := productrelease.FileSHA256(filepath.Join(nextRoot, "Nimi.exe")); err == nil {
			if installed, err := productrelease.VerifyInstalledExecutable(filepath.Join(nextRoot, "Nimi.exe"), digest, "Nimi.exe", productrelease.PublicKey); err == nil && installed.ReleaseID == release.ReleaseID {
				reopen = filepath.Join(nextRoot, "Nimi.exe")
			}
		}
	}
	if err := exec.Command(reopen).Start(); err != nil {
		_ = os.WriteFile(input.ResultPath, []byte("{\"phase\":\"recovery-required\",\"reason\":\"UPDATE_HOME_REOPEN_FAILED\"}\n"), 0600)
		return err
	}
	return nil
}

type shellExecuteInfo struct {
	Size       uint32
	Mask       uint32
	Window     windows.Handle
	Verb       *uint16
	File       *uint16
	Parameters *uint16
	Directory  *uint16
	Show       int32
	Instance   windows.Handle
	IDList     uintptr
	Class      *uint16
	ClassKey   windows.Handle
	HotKey     uint32
	Icon       windows.Handle
	Process    windows.Handle
}

func runInstaller(file, jobPath, requestHash string) (uint32, error) {
	return runElevated(file, `/S /UpdateJob="`+jobPath+`" /UpdateHash=`+requestHash, 1)
}

func runElevated(file, parameters string, show int32) (uint32, error) {
	verb, _ := windows.UTF16PtrFromString("runas")
	path, _ := windows.UTF16PtrFromString(file)
	args, _ := windows.UTF16PtrFromString(parameters)
	info := shellExecuteInfo{Mask: 0x40 | 0x400, Verb: verb, File: path, Parameters: args, Show: show}
	info.Size = uint32(unsafe.Sizeof(info))
	result, _, err := windows.NewLazySystemDLL("shell32.dll").NewProc("ShellExecuteExW").Call(uintptr(unsafe.Pointer(&info)))
	if result == 0 {
		return 0, err
	}
	if info.Process == 0 {
		return 0, fmt.Errorf("installer process unavailable")
	}
	defer func() { _ = windows.CloseHandle(info.Process) }()
	if _, err := windows.WaitForSingleObject(info.Process, windows.INFINITE); err != nil {
		return 0, err
	}
	var exit uint32
	err = windows.GetExitCodeProcess(info.Process, &exit)
	return exit, err
}
func releaseRoot(version string) (string, error) {
	if !regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(beta|rc)\.[1-9][0-9]*)?$`).MatchString(version) || productrelease.PublicKey == "" {
		return "", fmt.Errorf("UPDATE_REQUEST_REJECTED")
	}
	root, err := productrelease.ProductRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, version), nil
}
func elevated() error {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return err
	}
	defer func() { _ = token.Close() }()
	if !token.IsElevated() {
		return fmt.Errorf("UPDATE_AUTHORIZATION_REQUIRED")
	}
	return nil
}
func prepare(version string, payloadBytes, payloadEntries uint64) error {
	if err := elevated(); err != nil {
		return err
	}
	root, err := releaseRoot(version)
	if err != nil {
		return err
	}
	expected, raw, err := bootstrapIdentity(version)
	if err != nil {
		return err
	}
	productRoot := filepath.Dir(root)
	if err := os.MkdirAll(productRoot, 0755); err != nil {
		return err
	}
	if err := noReparse(productRoot); err != nil {
		return err
	}
	descriptor, err := windows.SecurityDescriptorFromString("O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)")
	if err != nil {
		return err
	}
	owner, _, _ := descriptor.Owner()
	acl, _, _ := descriptor.DACL()
	if err := windows.SetNamedSecurityInfo(productRoot, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, owner, nil, acl, nil); err != nil {
		return err
	}
	if err := productrelease.ValidateAdministrativePath(productRoot); err != nil {
		return err
	}
	if info, err := os.Lstat(root); err == nil {
		if !info.IsDir() {
			return fmt.Errorf("UPDATE_DESTINATION_UNTRUSTED")
		}
		if err := productrelease.ValidateAdministrativePath(root); err != nil {
			return err
		}
		if err := productrelease.ValidateAdministrativePath(filepath.Join(root, productrelease.IdentityFile)); err != nil {
			return err
		}
		// First authenticate names before asking OS about their current users.
		if _, err := productrelease.InspectPreparedCandidate(root, expected, productrelease.PublicKey, productrelease.CandidateUse{}); err != nil {
			return err
		}
		if err := filepath.WalkDir(root, func(file string, _ os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			return noReparse(file)
		}); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	use, err := candidateUse(root, expected)
	if err != nil {
		return err
	}
	if err := preflightCandidateExtraction(root, expected, productrelease.PublicKey, use, payloadBytes, payloadEntries); err != nil {
		return err
	}
	decision, err := productrelease.EnsurePreparedCandidate(root, raw, productrelease.PublicKey, use, sealAdministrative)
	if err != nil {
		return err
	}
	if decision == productrelease.CandidateCompleteOwner {
		if err := filepath.WalkDir(root, func(file string, _ os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			return productrelease.ValidateAdministrativePath(file)
		}); err != nil {
			return err
		}
		return errCompleteCurrentOwner
	}
	// Known unused partial members gain the fixed administrative policy before
	// restaging. Neither their partial bytes nor this operation admit them.
	return filepath.WalkDir(root, func(file string, _ os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := noReparse(file); err != nil {
			return err
		}
		return sealAdministrative(file)
	})
}

var errCompleteCurrentOwner = errors.New("complete current installer owner without code extraction")

func install(version, jobPath, requestHash string) error {
	if err := elevated(); err != nil {
		return err
	}
	root, err := releaseRoot(version)
	if err != nil {
		return err
	}
	// Admission precedes normalization and is repeated after it, so a racing
	// medium-user write to a newly extracted owned file cannot become trusted.
	raw, err := os.ReadFile(filepath.Join(root, productrelease.IdentityFile))
	if err != nil {
		return err
	}
	admitted, err := productrelease.VerifyIdentity(raw, productrelease.PublicKey)
	if err != nil || admitted.Version != version {
		return fmt.Errorf("UPDATE_COHORT_INVALID")
	}
	if err := productrelease.VerifyInventory(root, admitted); err != nil {
		return err
	}
	if err := filepath.WalkDir(root, func(file string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := noReparse(file); err != nil {
			return err
		}
		return sealAdministrative(file)
	}); err != nil {
		return err
	}
	digest, err := productrelease.FileSHA256(filepath.Join(root, "NimiProductUpdater.exe"))
	if err != nil {
		return err
	}
	identity, err := productrelease.VerifyInstalledExecutable(filepath.Join(root, "NimiProductUpdater.exe"), digest, "NimiProductUpdater.exe", productrelease.PublicKey)
	if err != nil {
		return err
	}
	if jobPath != "" {
		if err := verifyAuthorizedUpdate(version, jobPath, requestHash, &identity); err != nil {
			return err
		}
	}
	manager, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer func() { _ = manager.Disconnect() }()
	service, err := manager.OpenService(protectedlocal.WindowsProductionServiceName)
	binaryPath, commandErr := runtimeServiceCommand(filepath.Join(root, "runtime", "nimi.exe"))
	if commandErr != nil {
		return commandErr
	}
	config := mgr.Config{ServiceType: windows.SERVICE_WIN32_OWN_PROCESS, StartType: mgr.StartManual, ErrorControl: mgr.ErrorNormal, DisplayName: "Nimi Runtime", ServiceStartName: "LocalSystem", BinaryPathName: binaryPath}
	if err == nil {
		defer func() { _ = service.Close() }()
		prior, err := service.Config()
		if err != nil {
			return err
		}
		priorPath, err := runtimeServiceExecutable(prior.BinaryPathName)
		if err != nil {
			return err
		}
		if prior.ServiceType != windows.SERVICE_WIN32_OWN_PROCESS || !strings.EqualFold(prior.ServiceStartName, "LocalSystem") {
			return fmt.Errorf("unadmitted existing service")
		}
		priorIdentity, err := productrelease.ReadServiceDefinitionForForwardRepair(priorPath, productrelease.PublicKey)
		if err != nil {
			return err
		}
		completion, err := productrelease.CompleteExistingService(identity, priorIdentity, strings.EqualFold(priorPath, filepath.Join(root, "runtime", "nimi.exe")))
		if err != nil {
			return err
		}
		var sidType, required uint32
		if err := windows.QueryServiceConfig2(service.Handle, windows.SERVICE_CONFIG_SERVICE_SID_INFO, (*byte)(unsafe.Pointer(&sidType)), 4, &required); err != nil {
			return err
		}
		status, err := service.Query()
		if err != nil {
			return err
		}
		if status.State != svc.Stopped && (!completion || sidType != windows.SERVICE_SID_TYPE_RESTRICTED) {
			if _, err := service.Control(svc.Stop); err != nil {
				return err
			}
			deadline := time.Now().Add(40 * time.Second)
			for status.State != svc.Stopped {
				if time.Now().After(deadline) {
					return fmt.Errorf("UPDATE_SERVICE_STOP_FAILED")
				}
				time.Sleep(100 * time.Millisecond)
				status, err = service.Query()
				if err != nil {
					return err
				}
			}
		}
		if !completion || prior.StartType != mgr.StartManual {
			if err := service.UpdateConfig(config); err != nil {
				return err
			}
		}
	} else if err == windows.ERROR_SERVICE_DOES_NOT_EXIST {
		service, err = manager.CreateService(protectedlocal.WindowsProductionServiceName, filepath.Join(root, "runtime", "nimi.exe"), config, "serve")
		if err != nil {
			return err
		}
		defer func() { _ = service.Close() }()
	} else {
		return err
	}
	info := struct{ Type uint32 }{windows.SERVICE_SID_TYPE_RESTRICTED}
	if err := windows.ChangeServiceConfig2(service.Handle, windows.SERVICE_CONFIG_SERVICE_SID_INFO, (*byte)(unsafe.Pointer(&info))); err != nil {
		return err
	}
	if err := service.SetRecoveryActions([]mgr.RecoveryAction{{Type: mgr.ServiceRestart, Delay: time.Second}, {Type: mgr.ServiceRestart, Delay: 3 * time.Second}, {Type: mgr.NoAction}}, 300); err != nil {
		return err
	}
	if err := service.SetRecoveryActionsOnNonCrashFailures(true); err != nil {
		return err
	}
	serviceDescriptor, err := windows.SecurityDescriptorFromString("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;CCLCSWRPLOCRRC;;;IU)")
	if err != nil {
		return err
	}
	serviceACL, _, err := serviceDescriptor.DACL()
	if err != nil {
		return err
	}
	if err := windows.SetSecurityInfo(service.Handle, windows.SE_SERVICE, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, serviceACL, nil); err != nil {
		return err
	}
	if err := protectedlocal.ProvisionWindowsProductCustody(); err != nil {
		return err
	}
	if identity.Components.Runtime.Version == "" {
		return fmt.Errorf("UPDATE_COHORT_INVALID")
	}
	status, err := service.Query()
	if err != nil {
		return err
	}
	// @nimi-authority: rule.nimi.platform.product-lifecycle.p-home-runtime-lifecycle
	// A fresh install only registers the service. Home starts it on demand;
	// an authorized update still performs its guarded activation handoff.
	if jobPath == "" && status.State == svc.Stopped {
		return nil
	}
	if status.State == svc.Stopped {
		if err := service.Start(); err != nil {
			return err
		}
	}
	// SCM Running is only installer handoff, never product activation/health.
	deadline := time.Now().Add(45 * time.Second)
	for {
		status, err := service.Query()
		if err != nil {
			return err
		}
		if status.State == svc.Running {
			return nil
		}
		if status.State == svc.Stopped || time.Now().After(deadline) {
			return fmt.Errorf("UPDATE_SERVICE_START_FAILED")
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// Public UAC may stay pending beyond the candidate lifetime. The root
// installer reauthenticates the captured unchanged job and the actual NSIS
// parent bytes AFTER authorization and again before SCM mutation. It never
// accepts a cache field as consent, freshness or installer identity by itself.
func verifyAuthorizedUpdate(version, file, expectedHash string, identity *productrelease.Identity) error {
	if err := elevated(); err != nil {
		return err
	}
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(expectedHash) {
		return fmt.Errorf("UPDATE_HANDOFF_INVALID")
	}
	locked, err := lockFile(file)
	if err != nil {
		return err
	}
	defer func() { _ = locked.Close() }()
	raw, err := io.ReadAll(io.LimitReader(locked, 128*1024+1))
	if err != nil || len(raw) > 128*1024 {
		return fmt.Errorf("UPDATE_HANDOFF_INVALID")
	}
	hash := sha256.Sum256(raw)
	if hex.EncodeToString(hash[:]) != expectedHash {
		return fmt.Errorf("UPDATE_HANDOFF_INVALID")
	}
	var input job
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || input.Schema != "nimi-product-install/v1" || !input.ConsentApproved || !input.CriticalCleanupComplete {
		return fmt.Errorf("UPDATE_HANDOFF_INVALID")
	}
	release, err := productrelease.VerifyRelease(input.Envelope, productrelease.PublicKey, time.Now())
	if err != nil {
		return err
	}
	if release.Version != version || (identity != nil && (identity.ReleaseID != release.ReleaseID || identity.SourceRevision != release.SourceRevision || identity.Components != release.Components)) {
		return fmt.Errorf("UPDATE_COHORT_INVALID")
	}
	pid, err := parentPID()
	if err != nil {
		return err
	}
	parent, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseHandle(parent) }()
	path, err := processPath(parent)
	if err != nil || !strings.EqualFold(path, input.PackagePath) {
		return fmt.Errorf("UPDATE_INSTALLER_TRUST_FAILED")
	}
	installer, err := lockFile(path)
	if err != nil {
		return err
	}
	defer func() { _ = installer.Close() }()
	digest, err := hashLocked(installer)
	if err != nil || digest != release.Asset.SHA256 {
		return fmt.Errorf("UPDATE_ASSET_DIGEST_MISMATCH")
	}
	info, err := installer.Stat()
	if err != nil || info.Size() != release.Asset.Size {
		return fmt.Errorf("UPDATE_ASSET_SIZE_MISMATCH")
	}
	return nil
}

func sealAdministrative(file string) error {
	if err := noReparse(file); err != nil {
		return err
	}
	descriptor, err := windows.SecurityDescriptorFromString("O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)")
	if err != nil {
		return err
	}
	owner, _, err := descriptor.Owner()
	if err != nil {
		return err
	}
	acl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(file, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, owner, nil, acl, nil)
}
func parentPID() (uint32, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0, err
	}
	defer func() { _ = windows.CloseHandle(snapshot) }()
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	err = windows.Process32First(snapshot, &entry)
	for err == nil {
		if entry.ProcessID == uint32(os.Getpid()) {
			return entry.ParentProcessID, nil
		}
		err = windows.Process32Next(snapshot, &entry)
	}
	return 0, fmt.Errorf("parent unavailable")
}
func prepareCache() error {
	user, err := ordinaryUser()
	if err != nil {
		return err
	}
	root, err := fixedCache()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	if err := noReparse(root); err != nil {
		return err
	}
	descriptor, err := windows.SecurityDescriptorFromString("O:" + user + "D:P(A;OICI;FA;;;" + user + ")(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")
	if err != nil {
		return err
	}
	owner, _, err := descriptor.Owner()
	if err != nil {
		return err
	}
	acl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, owner, nil, acl, nil)
}

func verifyCacheFile(file string) error {
	user, err := ordinaryUser()
	if err != nil {
		return err
	}
	return verifyCacheFileOwner(file, user)
}

func verifyCacheFileOwner(file, user string) error {
	cache, err := fixedCache()
	if err != nil {
		return err
	}
	return verifyCacheFileOwnerAtRoot(file, user, cache)
}

func verifyCacheFileOwnerAtRoot(file, user, cache string) error {
	rel, err := filepath.Rel(cache, file)
	if err != nil || filepath.IsAbs(rel) || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("UPDATE_CACHE_UNSAFE")
	}
	if err := noReparse(file); err != nil {
		return err
	}
	for current := file; ; current = filepath.Dir(current) {
		descriptor, err := windows.GetNamedSecurityInfo(current, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
		if err != nil {
			return err
		}
		owner, _, err := descriptor.Owner()
		if err != nil || owner == nil || owner.String() != user {
			return fmt.Errorf("UPDATE_CACHE_UNSAFE")
		}
		acl, _, err := descriptor.DACL()
		if err != nil || acl == nil || acl.AceCount == 0 {
			return fmt.Errorf("UPDATE_CACHE_UNSAFE")
		}
		for index := uint32(0); index < uint32(acl.AceCount); index++ {
			var ace *windows.ACCESS_ALLOWED_ACE
			if err := windows.GetAce(acl, index, &ace); err != nil {
				return err
			}
			if ace.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE {
				continue
			}
			if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
				return fmt.Errorf("UPDATE_CACHE_UNSAFE")
			}
			sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
			if sid != user && sid != "S-1-5-18" && sid != "S-1-5-32-544" {
				return fmt.Errorf("UPDATE_CACHE_UNSAFE")
			}
		}
		if strings.EqualFold(current, cache) {
			return nil
		}
	}
}
