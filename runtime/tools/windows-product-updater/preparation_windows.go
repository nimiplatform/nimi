//go:build windows

package main

import (
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/mgr"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"
)

func bootstrapIdentity(version string) (productrelease.Identity, []byte, error) {
	executable, err := os.Executable()
	if err != nil {
		return productrelease.Identity{}, nil, err
	}
	root, err := productrelease.ProductRoot()
	if err != nil {
		return productrelease.Identity{}, nil, err
	}
	directory := filepath.Dir(executable)
	if !strings.EqualFold(filepath.Dir(directory), filepath.Dir(root)) || strings.EqualFold(directory, root) {
		return productrelease.Identity{}, nil, fmt.Errorf("UPDATE_HANDOFF_INVALID")
	}
	if err := productrelease.ValidateAdministrativePath(directory); err != nil {
		return productrelease.Identity{}, nil, err
	}
	file := filepath.Join(directory, productrelease.IdentityFile)
	if err := noReparse(file); err != nil {
		return productrelease.Identity{}, nil, err
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return productrelease.Identity{}, nil, err
	}
	identity, err := productrelease.VerifyIdentity(raw, productrelease.PublicKey)
	if err != nil || identity.Version != version {
		return productrelease.Identity{}, nil, fmt.Errorf("UPDATE_COHORT_INVALID")
	}
	digest, err := productrelease.FileSHA256(executable)
	if err != nil || digest != identity.Files["NimiProductUpdater.exe"] {
		return productrelease.Identity{}, nil, fmt.Errorf("UPDATE_INSTALLER_TRUST_FAILED")
	}
	return identity, raw, nil
}

// This is a read-only query of the actual fixed SCM definition. A cache
// receipt, leftover directory or installer exit cannot select this branch.
func candidateUse(root string, expected productrelease.Identity) (productrelease.CandidateUse, error) {
	manager, err := mgr.Connect()
	if err != nil {
		return productrelease.CandidateUse{}, err
	}
	defer func() { _ = manager.Disconnect() }()
	service, err := manager.OpenService(protectedlocal.WindowsProductionServiceName)
	use := productrelease.CandidateUse{}
	if err == nil {
		defer func() { _ = service.Close() }()
		config, err := service.Config()
		if err != nil {
			return use, err
		}
		if config.ServiceType != windows.SERVICE_WIN32_OWN_PROCESS || !strings.EqualFold(config.ServiceStartName, "LocalSystem") {
			return use, fmt.Errorf("unadmitted existing service")
		}
		path, err := runtimeServiceExecutable(config.BinaryPathName)
		if err != nil {
			return use, err
		}
		identity, err := productrelease.ReadServiceDefinitionForForwardRepair(path, productrelease.PublicKey)
		if err != nil {
			return use, err
		}
		use.ServiceReferencesTarget = strings.EqualFold(path, filepath.Join(root, "runtime", "nimi.exe"))
		if use.ServiceReferencesTarget && !productrelease.SameCandidate(identity, expected) {
			return use, fmt.Errorf("UPDATE_DESTINATION_UNTRUSTED")
		}
	} else if err != windows.ERROR_SERVICE_DOES_NOT_EXIST {
		return use, err
	}
	if !use.ServiceReferencesTarget {
		active, err := candidateResourcesActive(root, expected)
		if err != nil {
			return use, err
		}
		use.ActiveFiles = active
	}
	return use, nil
}

// Restart Manager is used only to enumerate holders of this admitted code
// tree. No RmShutdown/RmRestart or process termination is invoked.
func candidateResourcesActive(root string, expected productrelease.Identity) (bool, error) {
	files := []*uint16{}
	for name := range expected.Files {
		file := filepath.Join(root, filepath.FromSlash(name))
		info, err := os.Lstat(file)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return false, err
		}
		if !info.Mode().IsRegular() {
			return false, fmt.Errorf("UPDATE_DESTINATION_UNTRUSTED")
		}
		pointer, err := windows.UTF16PtrFromString(file)
		if err != nil {
			return false, err
		}
		files = append(files, pointer)
	}
	if len(files) == 0 {
		return false, nil
	}
	dll := windows.NewLazySystemDLL("rstrtmgr.dll")
	var session uint32
	var key [33]uint16
	code, _, _ := dll.NewProc("RmStartSession").Call(uintptr(unsafe.Pointer(&session)), 0, uintptr(unsafe.Pointer(&key[0])))
	if code != 0 {
		return false, fmt.Errorf("query candidate holders: %d", code)
	}
	defer func() { _, _, _ = dll.NewProc("RmEndSession").Call(uintptr(session)) }()
	code, _, _ = dll.NewProc("RmRegisterResources").Call(uintptr(session), uintptr(len(files)), uintptr(unsafe.Pointer(&files[0])), 0, 0, 0, 0)
	runtime.KeepAlive(files)
	if code != 0 {
		return false, fmt.Errorf("register candidate files: %d", code)
	}
	var needed, count, reasons uint32
	code, _, _ = dll.NewProc("RmGetList").Call(uintptr(session), uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&count)), 0, uintptr(unsafe.Pointer(&reasons)))
	if code == uintptr(windows.ERROR_MORE_DATA) {
		return true, nil
	}
	if code != 0 {
		return false, fmt.Errorf("query candidate holders: %d", code)
	}
	return needed != 0 || count != 0, nil
}
