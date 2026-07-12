//go:build windows

package protectedlocal

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	windowsSecretEncodingMagic = "NIMIWS01"
	windowsSecretHeaderBytes   = 12
	windowsMaxSecretBytes      = 1024 * 1024
	windowsMaxProtectedBytes   = 2 * 1024 * 1024
	windowsFileAllAccess       = 0x001f01ff

	ncryptSilentFlag                     = 0x00000040
	ncryptUnprotectNoDecrypt             = 0x00000001
	ncryptProtectionInfoDescriptorString = 0x00000001
)

type windowsDataProtector interface {
	Protect([]byte) ([]byte, error)
	Unprotect([]byte) ([]byte, error)
}

type WindowsServiceSecretStore struct {
	root      WindowsProtectedStateRoot
	protector windowsDataProtector
	random    io.Reader

	validateRoot func(context.Context) error
	secureFile   func(windows.Handle) error
	validateFile func(windows.Handle) error
	mu           sync.Mutex
}

func ValidateWindowsProtectedStateRoot(ctx context.Context, path string, principal WindowsServicePrincipal) (WindowsProtectedStateRoot, error) {
	profile := mustActiveWindowsRuntimeProfile()
	if err := ctx.Err(); err != nil {
		return WindowsProtectedStateRoot{}, fmt.Errorf("validate Windows protected state root: %w", err)
	}
	if principal.serviceSID != profile.serviceSID {
		return WindowsProtectedStateRoot{}, custodyFailure("validate Windows state-root principal", fmt.Errorf("invalid service principal capability"))
	}
	cleaned, err := validateWindowsStateRootPath(path)
	if err != nil {
		return WindowsProtectedStateRoot{}, err
	}
	identity, err := inspectWindowsStateRoot(cleaned, principal.serviceSID, nil)
	if err != nil {
		return WindowsProtectedStateRoot{}, err
	}
	return WindowsProtectedStateRoot{path: cleaned, serviceSID: principal.serviceSID, identity: identity}, nil
}

func OpenWindowsProductionSecretStore(ctx context.Context, principal WindowsServicePrincipal, root WindowsProtectedStateRoot) (*WindowsServiceSecretStore, error) {
	if principal.serviceSID != mustActiveWindowsRuntimeProfile().serviceSID || root.serviceSID != principal.serviceSID || root.path == "" {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageRootCapability, custodyFailure("open Windows protected secret store", fmt.Errorf("invalid principal or state-root capability")))
	}
	if _, err := inspectWindowsStateRoot(root.path, principal.serviceSID, &root.identity); err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageSecretRoot, err)
	}
	protector, err := newWindowsDPAPINGProtector(principal)
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageDPAPIProtector, err)
	}
	serviceSID, err := windows.StringToSid(principal.serviceSID)
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageServiceSID, custodyFailure("parse fixed Windows service SID", err))
	}
	store := &WindowsServiceSecretStore{
		root:      root,
		protector: protector,
		random:    rand.Reader,
	}
	store.validateRoot = func(ctx context.Context) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		_, err := inspectWindowsStateRoot(root.path, principal.serviceSID, &root.identity)
		return err
	}
	store.secureFile = func(handle windows.Handle) error {
		access := []windows.EXPLICIT_ACCESS{{
			AccessPermissions: windows.GENERIC_ALL,
			AccessMode:        windows.SET_ACCESS,
			Inheritance:       windows.NO_INHERITANCE,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_USER,
				TrusteeValue: windows.TrusteeValueFromSID(serviceSID),
			},
		}}
		acl, err := windows.ACLFromEntries(access, nil)
		if err != nil {
			return custodyFailure("build service-only secret DACL", err)
		}
		if err := windows.SetSecurityInfo(
			handle,
			windows.SE_FILE_OBJECT,
			windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
			nil,
			nil,
			acl,
			nil,
		); err != nil {
			return custodyFailure("apply service-only secret DACL", err)
		}
		return validateWindowsServiceOnlyACL(handle, serviceSID, false, false)
	}
	store.validateFile = func(handle windows.Handle) error {
		return validateWindowsServiceOnlyACL(handle, serviceSID, false, false)
	}
	return store, nil
}

func (store *WindowsServiceSecretStore) Load(ctx context.Context, name string) ([]byte, error) {
	if err := validateWindowsSecretName(name); err != nil {
		return nil, windowsCustodyStageFailure(WindowsCustodyStageSecretName, err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := store.validate(ctx); err != nil {
		return nil, err
	}
	encoded, err := store.readEncoded(name)
	if err != nil {
		return nil, err
	}
	if len(encoded) < windowsSecretHeaderBytes || string(encoded[:8]) != windowsSecretEncodingMagic {
		return nil, windowsCustodyRollbackFailure(WindowsCustodyStageDecode, "decode Windows protected secret", fmt.Errorf("invalid encoding"))
	}
	protectedBytes := int(binary.BigEndian.Uint32(encoded[8:12]))
	if protectedBytes <= 0 || protectedBytes > windowsMaxProtectedBytes || protectedBytes != len(encoded)-windowsSecretHeaderBytes {
		return nil, windowsCustodyRollbackFailure(WindowsCustodyStageDecode, "decode Windows protected secret", fmt.Errorf("invalid protected payload length"))
	}
	plaintext, err := store.protector.Unprotect(encoded[windowsSecretHeaderBytes:])
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		zeroBytes(plaintext)
		return nil, err
	}
	if len(plaintext) == 0 || len(plaintext) > windowsMaxSecretBytes {
		zeroBytes(plaintext)
		return nil, windowsCustodyRollbackFailure(WindowsCustodyStagePlaintext, "decode Windows protected secret", fmt.Errorf("invalid plaintext length"))
	}
	return plaintext, nil
}

func (store *WindowsServiceSecretStore) Store(ctx context.Context, name string, secret []byte) error {
	if err := validateWindowsSecretName(name); err != nil {
		return windowsCustodyStageFailure(WindowsCustodyStageSecretName, err)
	}
	if len(secret) == 0 || len(secret) > windowsMaxSecretBytes {
		return windowsCustodyFailure(WindowsCustodyStageProtectInput, "store Windows protected secret", fmt.Errorf("secret length outside fixed bounds"))
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := store.validate(ctx); err != nil {
		return err
	}
	protected, err := store.protector.Protect(secret)
	if err != nil {
		return err
	}
	defer zeroBytes(protected)
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(protected) == 0 || len(protected) > windowsMaxProtectedBytes {
		return windowsCustodyFailure(WindowsCustodyStageProtect, "store Windows protected secret", fmt.Errorf("DPAPI-NG payload length outside fixed bounds"))
	}
	encoded := make([]byte, windowsSecretHeaderBytes+len(protected))
	copy(encoded[:8], windowsSecretEncodingMagic)
	binary.BigEndian.PutUint32(encoded[8:12], uint32(len(protected)))
	copy(encoded[windowsSecretHeaderBytes:], protected)
	defer zeroBytes(encoded)

	suffix := make([]byte, 16)
	if _, err := io.ReadFull(store.random, suffix); err != nil {
		return windowsCustodyFailure(WindowsCustodyStageTemporaryName, "generate Windows secret temporary name", err)
	}
	destination := store.secretPath(name)
	temporary := fmt.Sprintf("%s.tmp-%x", destination, suffix)
	removeTemporary := true
	defer func() {
		if removeTemporary {
			_ = deleteWindowsPath(temporary)
		}
	}()
	handle, err := openWindowsFile(
		temporary,
		windows.GENERIC_WRITE|windows.READ_CONTROL|windows.WRITE_DAC,
		0,
		windows.CREATE_NEW,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_WRITE_THROUGH,
	)
	if err != nil {
		return windowsCustodyFailure(WindowsCustodyStageTemporaryCreate, "create Windows secret temporary file", err)
	}
	if err := store.secureFile(handle); err != nil {
		windows.CloseHandle(handle)
		return windowsCustodyStageFailure(WindowsCustodyStageTemporaryACL, err)
	}
	file := os.NewFile(uintptr(handle), temporary)
	if file == nil {
		windows.CloseHandle(handle)
		return windowsCustodyFailure(WindowsCustodyStageTemporaryWrapper, "create Windows secret file wrapper", fmt.Errorf("invalid file handle"))
	}
	if _, err := file.Write(encoded); err != nil {
		_ = file.Close()
		return windowsCustodyFailure(WindowsCustodyStageTemporaryWrite, "write Windows secret temporary file", err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return windowsCustodyFailure(WindowsCustodyStageTemporaryFlush, "flush Windows secret temporary file", err)
	}
	if err := file.Close(); err != nil {
		return windowsCustodyFailure(WindowsCustodyStageTemporaryClose, "close Windows secret temporary file", err)
	}
	from, err := windows.UTF16PtrFromString(temporary)
	if err != nil {
		return windowsCustodyFailure(WindowsCustodyStageTemporaryPath, "encode Windows secret temporary path", err)
	}
	to, err := windows.UTF16PtrFromString(destination)
	if err != nil {
		return windowsCustodyFailure(WindowsCustodyStageDestinationPath, "encode Windows secret destination path", err)
	}
	if err := windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH); err != nil {
		return windowsCustodyFailure(WindowsCustodyStageAtomicReplace, "atomically replace Windows secret", err)
	}
	removeTemporary = false
	if err := store.validateStoredFile(destination); err != nil {
		return err
	}
	return nil
}

func (store *WindowsServiceSecretStore) Delete(ctx context.Context, name string) error {
	if err := validateWindowsSecretName(name); err != nil {
		return windowsCustodyStageFailure(WindowsCustodyStageSecretName, err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := store.validate(ctx); err != nil {
		return err
	}
	path := store.secretPath(name)
	handle, err := openWindowsFile(
		path,
		windows.READ_CONTROL,
		windows.FILE_SHARE_READ,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT,
	)
	if isWindowsNotFound(err) {
		return ErrProtectedSecretNotFound
	}
	if err != nil {
		return windowsCustodyFailure(WindowsCustodyStageDeleteOpen, "open Windows secret for deletion", err)
	}
	if err := store.validateFile(handle); err != nil {
		windows.CloseHandle(handle)
		return windowsCustodyStageFailure(WindowsCustodyStageDeleteACL, err)
	}
	if err := windows.CloseHandle(handle); err != nil {
		return windowsCustodyFailure(WindowsCustodyStageDeleteClose, "close Windows secret before deletion", err)
	}
	if err := deleteWindowsPath(path); err != nil {
		if isWindowsNotFound(err) {
			return ErrProtectedSecretNotFound
		}
		return windowsCustodyFailure(WindowsCustodyStageDelete, "delete Windows protected secret", err)
	}
	return nil
}

func (store *WindowsServiceSecretStore) validate(ctx context.Context) error {
	if store == nil || store.protector == nil || store.validateRoot == nil || store.secureFile == nil || store.validateFile == nil || store.random == nil {
		return windowsCustodyFailure(WindowsCustodyStageStoreCapability, "validate Windows secret store", fmt.Errorf("incomplete store capability"))
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := store.validateRoot(ctx); err != nil {
		return windowsCustodyStageFailure(WindowsCustodyStageStateRoot, err)
	}
	return nil
}

func (store *WindowsServiceSecretStore) secretPath(name string) string {
	hash := sha256.Sum256(append([]byte("nimi/protected-local/windows-secret/v1\x00"), []byte(name)...))
	return filepath.Join(store.root.path, fmt.Sprintf("secret-%x.dpapi-ng", hash[:]))
}

func (store *WindowsServiceSecretStore) readEncoded(name string) ([]byte, error) {
	path := store.secretPath(name)
	handle, err := openWindowsFile(
		path,
		windows.GENERIC_READ|windows.READ_CONTROL,
		windows.FILE_SHARE_READ,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT,
	)
	if isWindowsNotFound(err) {
		return nil, ErrProtectedSecretNotFound
	}
	if err != nil {
		return nil, windowsCustodyFailure(WindowsCustodyStageReadOpen, "open Windows protected secret", err)
	}
	if err := validateWindowsRegularFile(handle); err != nil {
		windows.CloseHandle(handle)
		return nil, windowsCustodyStageFailure(WindowsCustodyStageReadIdentity, err)
	}
	if err := store.validateFile(handle); err != nil {
		windows.CloseHandle(handle)
		return nil, windowsCustodyStageFailure(WindowsCustodyStageReadACL, err)
	}
	file := os.NewFile(uintptr(handle), path)
	if file == nil {
		windows.CloseHandle(handle)
		return nil, windowsCustodyFailure(WindowsCustodyStageReadWrapper, "create Windows secret file wrapper", fmt.Errorf("invalid file handle"))
	}
	encoded, readErr := io.ReadAll(io.LimitReader(file, windowsSecretHeaderBytes+windowsMaxProtectedBytes+1))
	closeErr := file.Close()
	if readErr != nil {
		return nil, windowsCustodyFailure(WindowsCustodyStageRead, "read Windows protected secret", readErr)
	}
	if closeErr != nil {
		return nil, windowsCustodyFailure(WindowsCustodyStageReadClose, "close Windows protected secret", closeErr)
	}
	if len(encoded) > windowsSecretHeaderBytes+windowsMaxProtectedBytes {
		return nil, windowsCustodyRollbackFailure(WindowsCustodyStageDecode, "read Windows protected secret", fmt.Errorf("encoded payload exceeds fixed bounds"))
	}
	return encoded, nil
}

func (store *WindowsServiceSecretStore) validateStoredFile(path string) error {
	handle, err := openWindowsFile(
		path,
		windows.READ_CONTROL,
		windows.FILE_SHARE_READ,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT,
	)
	if err != nil {
		return windowsCustodyFailure(WindowsCustodyStageStoredReopen, "reopen stored Windows secret", err)
	}
	defer windows.CloseHandle(handle)
	if err := validateWindowsRegularFile(handle); err != nil {
		return windowsCustodyStageFailure(WindowsCustodyStageStoredIdentity, err)
	}
	if err := store.validateFile(handle); err != nil {
		return windowsCustodyStageFailure(WindowsCustodyStageStoredACL, err)
	}
	return nil
}

func validateWindowsStateRootPath(path string) (string, error) {
	cleaned := filepath.Clean(path)
	if path == "" || !filepath.IsAbs(cleaned) || strings.HasPrefix(cleaned, `\\`) || strings.HasPrefix(cleaned, `\\?\`) || strings.HasPrefix(cleaned, `\\.\`) {
		return "", custodyFailure("validate Windows protected state-root path", fmt.Errorf("absolute local drive path required"))
	}
	volume := filepath.VolumeName(cleaned)
	root := volume + `\`
	relative, err := filepath.Rel(root, cleaned)
	if err != nil || relative == "." || strings.HasPrefix(relative, "..") {
		return "", custodyFailure("validate Windows protected state-root path", fmt.Errorf("dedicated child directory required"))
	}
	current := root
	for _, component := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, component)
		pointer, err := windows.UTF16PtrFromString(current)
		if err != nil {
			return "", custodyFailure("encode Windows state-root component", err)
		}
		attributes, err := windows.GetFileAttributes(pointer)
		if err != nil {
			return "", custodyFailure("inspect Windows state-root component", err)
		}
		if attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return "", custodyFailure("inspect Windows state-root component", fmt.Errorf("reparse points are forbidden"))
		}
	}
	return cleaned, nil
}

func inspectWindowsStateRoot(path, serviceSID string, expected *windowsFileIdentity) (windowsFileIdentity, error) {
	cleaned, err := validateWindowsStateRootPath(path)
	if err != nil {
		return windowsFileIdentity{}, err
	}
	handle, err := openWindowsFile(
		cleaned,
		windows.FILE_READ_ATTRIBUTES|windows.READ_CONTROL,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT,
	)
	if err != nil {
		return windowsFileIdentity{}, custodyFailure("open Windows protected state root", err)
	}
	defer windows.CloseHandle(handle)
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil {
		return windowsFileIdentity{}, custodyFailure("query Windows state-root identity", err)
	}
	if information.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 || information.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return windowsFileIdentity{}, custodyFailure("validate Windows protected state root", fmt.Errorf("non-reparse directory required"))
	}
	identity := windowsFileIdentity{
		volumeSerial: information.VolumeSerialNumber,
		fileIndex:    uint64(information.FileIndexHigh)<<32 | uint64(information.FileIndexLow),
	}
	if expected != nil && identity != *expected {
		return windowsFileIdentity{}, rollbackFailure("validate Windows state-root identity", fmt.Errorf("directory identity changed"))
	}
	sid, err := windows.StringToSid(serviceSID)
	if err != nil {
		return windowsFileIdentity{}, custodyFailure("parse fixed Windows service SID", err)
	}
	if err := validateWindowsServiceOnlyACL(handle, sid, true, true); err != nil {
		return windowsFileIdentity{}, err
	}
	return identity, nil
}

func validateWindowsServiceOnlyACL(handle windows.Handle, serviceSID *windows.SID, requireOwner, directory bool) error {
	securityInformation := windows.SECURITY_INFORMATION(windows.DACL_SECURITY_INFORMATION)
	if requireOwner {
		securityInformation |= windows.OWNER_SECURITY_INFORMATION
	}
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT, securityInformation)
	if err != nil {
		return custodyFailure("read service-only Windows ACL", err)
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return custodyFailure("validate protected Windows DACL", err)
	}
	if requireOwner {
		owner, _, err := descriptor.Owner()
		if err != nil || owner == nil || !windows.EqualSid(owner, serviceSID) {
			return custodyFailure("validate Windows state-root owner", err)
		}
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil || dacl.AceCount != 1 {
		return custodyFailure("validate service-only Windows DACL", err)
	}
	var ace *windows.ACCESS_ALLOWED_ACE
	if err := windows.GetAce(dacl, 0, &ace); err != nil {
		return custodyFailure("read service-only Windows DACL entry", err)
	}
	if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || ace.Header.AceFlags&windows.INHERITED_ACE != 0 {
		return custodyFailure("validate service-only Windows DACL entry", fmt.Errorf("unexpected ACE type or inheritance"))
	}
	entrySID := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
	if !windows.EqualSid(entrySID, serviceSID) {
		return custodyFailure("validate service-only Windows DACL entry", fmt.Errorf("unexpected allowed principal"))
	}
	mask := uint32(ace.Mask)
	if mask != windows.GENERIC_ALL && mask != windowsFileAllAccess {
		return custodyFailure("validate service-only Windows DACL entry", fmt.Errorf("full service access required"))
	}
	if directory {
		required := uint8(windows.OBJECT_INHERIT_ACE | windows.CONTAINER_INHERIT_ACE)
		if ace.Header.AceFlags&required != required {
			return custodyFailure("validate service-only Windows directory DACL", fmt.Errorf("child inheritance is required"))
		}
	} else if ace.Header.AceFlags != 0 {
		return custodyFailure("validate service-only Windows file DACL", fmt.Errorf("unexpected file ACE flags"))
	}
	return nil
}

func validateWindowsRegularFile(handle windows.Handle) error {
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil {
		return custodyFailure("query Windows secret file identity", err)
	}
	if information.FileAttributes&(windows.FILE_ATTRIBUTE_DIRECTORY|windows.FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
		return rollbackFailure("validate Windows secret file identity", fmt.Errorf("regular non-reparse file required"))
	}
	return nil
}

func openWindowsFile(path string, access, share, creation, flags uint32) (windows.Handle, error) {
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return windows.InvalidHandle, err
	}
	return windows.CreateFile(pointer, access, share, nil, creation, flags, 0)
}

func deleteWindowsPath(path string) error {
	pointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	return windows.DeleteFile(pointer)
}

func isWindowsNotFound(err error) bool {
	return errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || errors.Is(err, windows.ERROR_PATH_NOT_FOUND)
}

type windowsDPAPINGProtector struct {
	descriptor string
	create     *windows.LazyProc
	close      *windows.LazyProc
	info       *windows.LazyProc
	protect    *windows.LazyProc
	unprotect  *windows.LazyProc
}

func newWindowsDPAPINGProtector(principal WindowsServicePrincipal) (*windowsDPAPINGProtector, error) {
	profile := mustActiveWindowsRuntimeProfile()
	if principal.serviceSID != profile.serviceSID || principal.tokenUserSID != profile.serviceHostSID {
		return nil, custodyFailure("create DPAPI-NG protector", fmt.Errorf("exact active service and fixed host principal required"))
	}
	library := windows.NewLazySystemDLL("ncrypt.dll")
	protector := &windowsDPAPINGProtector{
		descriptor: profile.custodyDescriptor,
		create:     library.NewProc("NCryptCreateProtectionDescriptor"),
		close:      library.NewProc("NCryptCloseProtectionDescriptor"),
		info:       library.NewProc("NCryptGetProtectionDescriptorInfo"),
		protect:    library.NewProc("NCryptProtectSecret"),
		unprotect:  library.NewProc("NCryptUnprotectSecret"),
	}
	for _, procedure := range []*windows.LazyProc{protector.create, protector.close, protector.info, protector.protect, protector.unprotect} {
		if err := procedure.Find(); err != nil {
			return nil, custodyFailure("load required DPAPI-NG primitive", err)
		}
	}
	return protector, nil
}

func (protector *windowsDPAPINGProtector) Protect(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 || len(plaintext) > windowsMaxSecretBytes {
		return nil, windowsCustodyFailure(WindowsCustodyStageProtectInput, "DPAPI-NG protect secret", fmt.Errorf("plaintext length outside fixed bounds"))
	}
	descriptor, err := windows.UTF16PtrFromString(protector.descriptor)
	if err != nil {
		return nil, windowsCustodyFailure(WindowsCustodyStageDescriptorEncode, "encode DPAPI-NG descriptor", err)
	}
	var descriptorHandle uintptr
	status, _, _ := protector.create.Call(uintptr(unsafe.Pointer(descriptor)), 0, uintptr(unsafe.Pointer(&descriptorHandle)))
	if status != 0 || descriptorHandle == 0 {
		return nil, windowsCustodyFailure(WindowsCustodyStageDescriptorCreate, "create DPAPI-NG descriptor", ncryptStatusError(status))
	}
	defer protector.close.Call(descriptorHandle)
	var protectedPointer *byte
	var protectedBytes uint32
	status, _, _ = protector.protect.Call(
		descriptorHandle,
		ncryptSilentFlag,
		uintptr(unsafe.Pointer(&plaintext[0])),
		uintptr(uint32(len(plaintext))),
		0,
		0,
		uintptr(unsafe.Pointer(&protectedPointer)),
		uintptr(unsafe.Pointer(&protectedBytes)),
	)
	runtime.KeepAlive(plaintext)
	if status != 0 || protectedPointer == nil || protectedBytes == 0 || protectedBytes > windowsMaxProtectedBytes {
		if protectedPointer != nil {
			windows.LocalFree(windows.Handle(unsafe.Pointer(protectedPointer)))
		}
		return nil, windowsCustodyFailure(WindowsCustodyStageProtect, "DPAPI-NG protect secret", ncryptStatusError(status))
	}
	native := unsafe.Slice(protectedPointer, int(protectedBytes))
	result := append([]byte(nil), native...)
	zeroBytes(native)
	_, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(protectedPointer)))
	return result, nil
}

func (protector *windowsDPAPINGProtector) Unprotect(protected []byte) ([]byte, error) {
	if len(protected) == 0 || len(protected) > windowsMaxProtectedBytes {
		return nil, windowsCustodyRollbackFailure(WindowsCustodyStageUnprotect, "DPAPI-NG unprotect secret", fmt.Errorf("protected payload length outside fixed bounds"))
	}
	if err := protector.verifyEmbeddedDescriptor(protected); err != nil {
		return nil, err
	}
	var descriptorHandle uintptr
	var plaintextPointer *byte
	var plaintextBytes uint32
	status, _, _ := protector.unprotect.Call(
		uintptr(unsafe.Pointer(&descriptorHandle)),
		ncryptSilentFlag,
		uintptr(unsafe.Pointer(&protected[0])),
		uintptr(uint32(len(protected))),
		0,
		0,
		uintptr(unsafe.Pointer(&plaintextPointer)),
		uintptr(unsafe.Pointer(&plaintextBytes)),
	)
	runtime.KeepAlive(protected)
	if descriptorHandle != 0 {
		defer protector.close.Call(descriptorHandle)
	}
	if status != 0 || plaintextPointer == nil || plaintextBytes == 0 || plaintextBytes > windowsMaxSecretBytes {
		if plaintextPointer != nil {
			windows.LocalFree(windows.Handle(unsafe.Pointer(plaintextPointer)))
		}
		return nil, windowsCustodyFailure(WindowsCustodyStageUnprotect, "DPAPI-NG unprotect secret", ncryptStatusError(status))
	}
	if err := protector.verifyDescriptorHandle(descriptorHandle); err != nil {
		native := unsafe.Slice(plaintextPointer, int(plaintextBytes))
		zeroBytes(native)
		windows.LocalFree(windows.Handle(unsafe.Pointer(plaintextPointer)))
		return nil, err
	}
	native := unsafe.Slice(plaintextPointer, int(plaintextBytes))
	result := append([]byte(nil), native...)
	zeroBytes(native)
	_, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(plaintextPointer)))
	return result, nil
}

func (protector *windowsDPAPINGProtector) verifyEmbeddedDescriptor(protected []byte) error {
	var descriptorHandle uintptr
	var unusedPointer *byte
	var unusedBytes uint32
	status, _, _ := protector.unprotect.Call(
		uintptr(unsafe.Pointer(&descriptorHandle)),
		ncryptUnprotectNoDecrypt|ncryptSilentFlag,
		uintptr(unsafe.Pointer(&protected[0])),
		uintptr(uint32(len(protected))),
		0,
		0,
		uintptr(unsafe.Pointer(&unusedPointer)),
		uintptr(unsafe.Pointer(&unusedBytes)),
	)
	runtime.KeepAlive(protected)
	if unusedPointer != nil {
		windows.LocalFree(windows.Handle(unsafe.Pointer(unusedPointer)))
	}
	if descriptorHandle != 0 {
		defer protector.close.Call(descriptorHandle)
	}
	if status != 0 || descriptorHandle == 0 {
		return windowsCustodyRollbackFailure(WindowsCustodyStageDescriptorInspect, "inspect DPAPI-NG descriptor", ncryptStatusError(status))
	}
	return protector.verifyDescriptorHandle(descriptorHandle)
}

func (protector *windowsDPAPINGProtector) verifyDescriptorHandle(descriptorHandle uintptr) error {
	if descriptorHandle == 0 {
		return windowsCustodyRollbackFailure(WindowsCustodyStageDescriptorInspect, "inspect DPAPI-NG descriptor", fmt.Errorf("missing descriptor handle"))
	}
	var descriptorPointer *uint16
	status, _, _ := protector.info.Call(
		descriptorHandle,
		0,
		ncryptProtectionInfoDescriptorString,
		uintptr(unsafe.Pointer(&descriptorPointer)),
	)
	if status != 0 || descriptorPointer == nil {
		return windowsCustodyRollbackFailure(WindowsCustodyStageDescriptorInspect, "inspect DPAPI-NG descriptor", ncryptStatusError(status))
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(descriptorPointer)))
	descriptor := windows.UTF16PtrToString(descriptorPointer)
	if descriptor != protector.descriptor {
		return windowsCustodyRollbackFailure(WindowsCustodyStageDescriptorInspect, "inspect DPAPI-NG descriptor", fmt.Errorf("protection descriptor mismatch"))
	}
	return nil
}

func ncryptStatusError(status uintptr) error {
	if status == 0 {
		return fmt.Errorf("DPAPI-NG returned incomplete output")
	}
	return fmt.Errorf("DPAPI-NG security status 0x%08x", uint32(status))
}

func windowsCustodyFailure(stage WindowsCustodyFailureStage, operation string, cause error) error {
	return windowsCustodyStageFailure(stage, custodyFailure(operation, cause))
}

func windowsCustodyRollbackFailure(stage WindowsCustodyFailureStage, operation string, cause error) error {
	return windowsCustodyStageFailure(stage, rollbackFailure(operation, cause))
}

func custodyFailure(operation string, cause error) error {
	return fail(
		ReasonProtectedLocalCustodyBoundaryUnavailable,
		false,
		"repair_runtime_service",
		fmt.Errorf("%s: %w", operation, cause),
	)
}

func rollbackFailure(operation string, cause error) error {
	return fail(
		ReasonProtectedLocalLedgerRollbackDetected,
		false,
		"reset_protected_state",
		fmt.Errorf("%s: %w", operation, cause),
	)
}
