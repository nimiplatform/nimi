//go:build windows

package nimiappnative

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	windowsPESignature                   = uint32(0x00004550)
	windowsPEMachineAMD64                = uint16(0x8664)
	windowsPE32PlusMagic                 = uint16(0x020b)
	windowsPECharacteristicExecutable    = uint16(0x0002)
	windowsPECharacteristicSystem        = uint16(0x1000)
	windowsPECharacteristicDLL           = uint16(0x2000)
	windowsPESubsystemGUI                = uint16(2)
	windowsPESubsystemCUI                = uint16(3)
	windowsPESecurityDirectoryIndex      = uint32(4)
	windowsPE32PlusDataDirectoryOffset   = 112
	windowsPENumberOfDataDirectoryOffset = 108
	windowsActCtxResourceNameValid       = uint32(0x00000008)
	windowsRunLevelInformation           = uint32(5)
	windowsRunLevelAsInvoker             = uint32(1)
	windowsCertX500NameString            = uint32(3)
	windowsCertNameStringReverse         = uint32(0x02000000)
	windowsTrustNoSignature              = uint32(0x800b0100)
	windowsCMSGSignerCountParam          = uint32(5)
	windowsCMSGSignerInfoParam           = uint32(6)
)

var (
	kernel32                  = windows.NewLazySystemDLL("kernel32.dll")
	procCreateActCtxW         = kernel32.NewProc("CreateActCtxW")
	procQueryActCtxW          = kernel32.NewProc("QueryActCtxW")
	procReleaseActCtx         = kernel32.NewProc("ReleaseActCtx")
	wintrust                  = windows.NewLazySystemDLL("wintrust.dll")
	procCatalogAcquireContext = wintrust.NewProc("CryptCATAdminAcquireContext2")
	procCatalogReleaseContext = wintrust.NewProc("CryptCATAdminReleaseContext")
	procCatalogCalculateHash  = wintrust.NewProc("CryptCATAdminCalcHashFromFileHandle2")
	procCatalogFromHash       = wintrust.NewProc("CryptCATAdminEnumCatalogFromHash")
	procCatalogReleaseCatalog = wintrust.NewProc("CryptCATAdminReleaseCatalogContext")
	crypt32                   = windows.NewLazySystemDLL("crypt32.dll")
	procCertNameToStrW        = crypt32.NewProc("CertNameToStrW")
	procCryptMsgGetParam      = crypt32.NewProc("CryptMsgGetParam")
	procCryptMsgClose         = crypt32.NewProc("CryptMsgClose")
)

type windowsPEFacts struct {
	embeddedCertificateTable bool
}

type windowsActivationContext struct {
	size                  uint32
	flags                 uint32
	source                *uint16
	processorArchitecture uint16
	languageID            uint16
	assemblyDirectory     *uint16
	resourceName          uintptr
	applicationName       *uint16
	module                windows.Handle
}

type windowsRunLevel struct {
	flags    uint32
	runLevel uint32
	uiAccess uint32
}

type windowsCryptAttribute struct {
	objectID   *byte
	valueCount uint32
	values     *windows.CryptAttrBlob
}

type windowsCryptAttributes struct {
	count      uint32
	attributes *windowsCryptAttribute
}

type windowsCMSGSignerInfo struct {
	version                 uint32
	issuer                  windows.CertNameBlob
	serialNumber            windows.CryptIntegerBlob
	hashAlgorithm           windows.CryptAlgorithmIdentifier
	hashEncryptionAlgorithm windows.CryptAlgorithmIdentifier
	encryptedHash           windows.CryptDataBlob
	authAttributes          windowsCryptAttributes
	unauthAttributes        windowsCryptAttributes
}

func verifyWindowsRuntimeEntry(
	ctx context.Context,
	executablePath string,
	expectedSHA256 [sha256.Size]byte,
) (WindowsObservation, error) {
	rawPath := strings.TrimSpace(executablePath)
	cleanPath := filepath.Clean(rawPath)
	if rawPath == "" || rawPath != cleanPath || !filepath.IsAbs(cleanPath) {
		return WindowsObservation{}, fmt.Errorf("validate Windows App Runtime-entry path: %w", ErrNativeVerification)
	}
	pathPointer, err := windows.UTF16PtrFromString(cleanPath)
	if err != nil {
		return WindowsObservation{}, fmt.Errorf("encode Windows App Runtime-entry path: %w", errors.Join(ErrNativeVerification, err))
	}
	handle, err := windows.CreateFile(
		pathPointer,
		windows.GENERIC_READ|windows.FILE_READ_ATTRIBUTES|windows.READ_CONTROL,
		windows.FILE_SHARE_READ,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_SEQUENTIAL_SCAN,
		0,
	)
	if err != nil {
		return WindowsObservation{}, fmt.Errorf("lock Windows App Runtime entry: %w", errors.Join(ErrNativeVerification, err))
	}
	file := os.NewFile(uintptr(handle), cleanPath)
	if file == nil {
		_ = windows.CloseHandle(handle)
		return WindowsObservation{}, fmt.Errorf("wrap Windows App Runtime-entry handle: %w", ErrNativeVerification)
	}
	defer func() { _ = file.Close() }()
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil ||
		information.FileAttributes&(windows.FILE_ATTRIBUTE_DIRECTORY|windows.FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
		return WindowsObservation{}, fmt.Errorf("validate Windows App Runtime-entry file: %w", errors.Join(ErrNativeVerification, err))
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 {
		return WindowsObservation{}, fmt.Errorf("stat Windows App Runtime entry: %w", errors.Join(ErrNativeVerification, err))
	}
	digest, err := digestLockedWindowsFile(ctx, file, uint64(info.Size()))
	if err != nil || digest != expectedSHA256 {
		return WindowsObservation{}, fmt.Errorf("verify Windows App Runtime-entry SHA-256: %w", errors.Join(ErrNativeVerification, err))
	}
	peFacts, err := inspectWindowsPE(file, info.Size())
	if err != nil {
		return WindowsObservation{}, err
	}
	if err := verifyWindowsExecutionProfile(cleanPath); err != nil {
		return WindowsObservation{}, err
	}
	hasCatalog, err := windowsCatalogContains(handle)
	if err != nil {
		return WindowsObservation{}, err
	}
	if hasCatalog {
		return WindowsObservation{}, fmt.Errorf("reject catalog-signed Windows App Runtime entry: %w", ErrNativeVerification)
	}
	signing, subject, err := observeWindowsAuthenticode(handle, cleanPath, peFacts.embeddedCertificateTable)
	if err != nil {
		return WindowsObservation{}, err
	}
	if err := ctx.Err(); err != nil {
		return WindowsObservation{}, fmt.Errorf("verify Windows App Runtime-entry context: %w", errors.Join(ErrNativeVerification, err))
	}
	return WindowsObservation{
		Arch: "x86_64", WindowsCodeSigning: signing, CertificateSubject: subject,
		RequestedExecutionLevel: "asInvoker", UIAccess: false, HostExecutableSHA256: digest,
	}, nil
}

func windowsCatalogContains(file windows.Handle) (bool, error) {
	for _, algorithm := range []string{"SHA256", "SHA1"} {
		found, err := windowsCatalogContainsWithAlgorithm(file, algorithm)
		if err != nil {
			return false, err
		}
		if found {
			return true, nil
		}
	}
	return false, nil
}

func windowsCatalogContainsWithAlgorithm(file windows.Handle, algorithm string) (found bool, err error) {
	algorithmPointer, err := windows.UTF16PtrFromString(algorithm)
	if err != nil {
		return false, fmt.Errorf("encode Windows catalog hash algorithm: %w", errors.Join(ErrNativeVerification, err))
	}
	var catalogAdmin windows.Handle
	ok, _, callErr := procCatalogAcquireContext.Call(
		uintptr(unsafe.Pointer(&catalogAdmin)), 0, uintptr(unsafe.Pointer(algorithmPointer)), 0, 0,
	)
	if ok == 0 || catalogAdmin == 0 {
		return false, fmt.Errorf("acquire Windows catalog context: %w", errors.Join(ErrNativeVerification, realWindowsCallError(callErr)))
	}
	defer func() {
		released, _, releaseErr := procCatalogReleaseContext.Call(uintptr(catalogAdmin), 0)
		if released == 0 {
			err = errors.Join(err, fmt.Errorf("release Windows catalog context: %w", errors.Join(ErrNativeVerification, realWindowsCallError(releaseErr))))
		}
	}()
	var hashSize uint32
	ok, _, callErr = procCatalogCalculateHash.Call(
		uintptr(catalogAdmin), uintptr(file), uintptr(unsafe.Pointer(&hashSize)), 0, 0,
	)
	if ok == 0 || hashSize == 0 || hashSize > sha256.Size {
		return false, fmt.Errorf("size Windows catalog member hash: %w", errors.Join(ErrNativeVerification, realWindowsCallError(callErr)))
	}
	hash := make([]byte, hashSize)
	ok, _, callErr = procCatalogCalculateHash.Call(
		uintptr(catalogAdmin), uintptr(file), uintptr(unsafe.Pointer(&hashSize)), uintptr(unsafe.Pointer(&hash[0])), 0,
	)
	if ok == 0 || hashSize != uint32(len(hash)) {
		return false, fmt.Errorf("calculate Windows catalog member hash: %w", errors.Join(ErrNativeVerification, realWindowsCallError(callErr)))
	}
	catalog, _, callErr := procCatalogFromHash.Call(
		uintptr(catalogAdmin), uintptr(unsafe.Pointer(&hash[0])), uintptr(hashSize), 0, 0,
	)
	if catalog == 0 {
		if callErr = realWindowsCallError(callErr); callErr != nil && !errors.Is(callErr, windows.ERROR_NOT_FOUND) {
			return false, fmt.Errorf("enumerate Windows catalog member: %w", errors.Join(ErrNativeVerification, callErr))
		}
		return false, nil
	}
	released, _, releaseErr := procCatalogReleaseCatalog.Call(uintptr(catalogAdmin), catalog, 0)
	if released == 0 {
		return false, fmt.Errorf("release Windows catalog member: %w", errors.Join(ErrNativeVerification, realWindowsCallError(releaseErr)))
	}
	return true, nil
}

func digestLockedWindowsFile(ctx context.Context, file *os.File, size uint64) ([sha256.Size]byte, error) {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return [sha256.Size]byte{}, err
	}
	digest := sha256.New()
	buffer := make([]byte, 128*1024)
	var total uint64
	for {
		if err := ctx.Err(); err != nil {
			return [sha256.Size]byte{}, err
		}
		count, readErr := file.Read(buffer)
		if count > 0 {
			total += uint64(count)
			if total > size {
				return [sha256.Size]byte{}, ErrNativeVerification
			}
			_, _ = digest.Write(buffer[:count])
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return [sha256.Size]byte{}, readErr
		}
	}
	if total != size {
		return [sha256.Size]byte{}, ErrNativeVerification
	}
	var result [sha256.Size]byte
	copy(result[:], digest.Sum(nil))
	return result, nil
}

func inspectWindowsPE(file *os.File, size int64) (windowsPEFacts, error) {
	if file == nil || size < 64 {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App DOS header: %w", ErrNativeVerification)
	}
	dosHeader, err := readWindowsFileAt(file, 64, 0)
	if err != nil || dosHeader[0] != 'M' || dosHeader[1] != 'Z' {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App DOS signature: %w", errors.Join(ErrNativeVerification, err))
	}
	peOffset := int64(binary.LittleEndian.Uint32(dosHeader[0x3c:]))
	if peOffset < 64 || peOffset > size-24 {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App PE offset: %w", ErrNativeVerification)
	}
	coffHeader, err := readWindowsFileAt(file, 24, peOffset)
	if err != nil || binary.LittleEndian.Uint32(coffHeader[0:4]) != windowsPESignature {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App PE signature: %w", errors.Join(ErrNativeVerification, err))
	}
	machine := binary.LittleEndian.Uint16(coffHeader[4:6])
	sectionCount := binary.LittleEndian.Uint16(coffHeader[6:8])
	optionalHeaderSize := binary.LittleEndian.Uint16(coffHeader[20:22])
	characteristics := binary.LittleEndian.Uint16(coffHeader[22:24])
	if machine != windowsPEMachineAMD64 || sectionCount == 0 || optionalHeaderSize < windowsPE32PlusDataDirectoryOffset ||
		characteristics&windowsPECharacteristicExecutable == 0 ||
		characteristics&(windowsPECharacteristicDLL|windowsPECharacteristicSystem) != 0 {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App PE target/type: %w", ErrNativeVerification)
	}
	optionalOffset := peOffset + 24
	sectionTableOffset := optionalOffset + int64(optionalHeaderSize)
	sectionBytes := int64(sectionCount) * 40
	if optionalOffset > size-int64(optionalHeaderSize) || sectionTableOffset > size-sectionBytes {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App PE bounds: %w", ErrNativeVerification)
	}
	optionalHeader, err := readWindowsFileAt(file, int(optionalHeaderSize), optionalOffset)
	if err != nil || binary.LittleEndian.Uint16(optionalHeader[0:2]) != windowsPE32PlusMagic {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App PE32+ header: %w", errors.Join(ErrNativeVerification, err))
	}
	subsystem := binary.LittleEndian.Uint16(optionalHeader[68:70])
	if subsystem != windowsPESubsystemGUI && subsystem != windowsPESubsystemCUI {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App PE subsystem: %w", ErrNativeVerification)
	}
	directoryCount := binary.LittleEndian.Uint32(optionalHeader[windowsPENumberOfDataDirectoryOffset:windowsPE32PlusDataDirectoryOffset])
	if directoryCount > 16 {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App PE data directories: %w", ErrNativeVerification)
	}
	if directoryCount <= windowsPESecurityDirectoryIndex {
		return windowsPEFacts{}, nil
	}
	securityDirectoryOffset := windowsPE32PlusDataDirectoryOffset + int(windowsPESecurityDirectoryIndex)*8
	if len(optionalHeader) < securityDirectoryOffset+8 {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App certificate directory: %w", ErrNativeVerification)
	}
	certificateOffset := binary.LittleEndian.Uint32(optionalHeader[securityDirectoryOffset : securityDirectoryOffset+4])
	certificateSize := binary.LittleEndian.Uint32(optionalHeader[securityDirectoryOffset+4 : securityDirectoryOffset+8])
	if certificateOffset == 0 && certificateSize == 0 {
		return windowsPEFacts{}, nil
	}
	if certificateOffset == 0 || certificateSize < 8 || certificateOffset%8 != 0 ||
		int64(certificateOffset) > size-int64(certificateSize) {
		return windowsPEFacts{}, fmt.Errorf("inspect Windows App certificate table: %w", ErrNativeVerification)
	}
	return windowsPEFacts{embeddedCertificateTable: true}, nil
}

func readWindowsFileAt(file *os.File, size int, offset int64) ([]byte, error) {
	if file == nil || size <= 0 || offset < 0 {
		return nil, ErrNativeVerification
	}
	result := make([]byte, size)
	if _, err := file.ReadAt(result, offset); err != nil {
		return nil, err
	}
	return result, nil
}

func verifyWindowsExecutionProfile(executablePath string) error {
	source, err := windows.UTF16PtrFromString(executablePath)
	if err != nil {
		return fmt.Errorf("encode Windows App activation-context path: %w", errors.Join(ErrNativeVerification, err))
	}
	activation := windowsActivationContext{
		size: uint32(unsafe.Sizeof(windowsActivationContext{})), flags: windowsActCtxResourceNameValid,
		source: source, resourceName: 1,
	}
	handle, _, callErr := procCreateActCtxW.Call(uintptr(unsafe.Pointer(&activation)))
	if handle == ^uintptr(0) {
		return fmt.Errorf("create Windows App activation context: %w", errors.Join(ErrNativeVerification, callErr))
	}
	defer func() { _, _, _ = procReleaseActCtx.Call(handle) }()
	var runLevel windowsRunLevel
	var written uintptr
	ok, _, callErr := procQueryActCtxW.Call(
		0,
		handle,
		0,
		uintptr(windowsRunLevelInformation),
		uintptr(unsafe.Pointer(&runLevel)),
		unsafe.Sizeof(runLevel),
		uintptr(unsafe.Pointer(&written)),
	)
	if ok == 0 {
		return fmt.Errorf("query Windows App activation context: %w", errors.Join(ErrNativeVerification, callErr))
	}
	if runLevel.flags != 0 || runLevel.runLevel != windowsRunLevelAsInvoker || runLevel.uiAccess != 0 {
		return fmt.Errorf("validate Windows App activation-context run level: %w", ErrNativeVerification)
	}
	return nil
}

func observeWindowsAuthenticode(
	handle windows.Handle,
	executablePath string,
	embeddedCertificateTable bool,
) (string, *string, error) {
	pathPointer, err := windows.UTF16PtrFromString(executablePath)
	if err != nil {
		return "", nil, fmt.Errorf("encode Windows App Authenticode path: %w", errors.Join(ErrNativeVerification, err))
	}
	fileInfo := windows.WinTrustFileInfo{
		Size: uint32(unsafe.Sizeof(windows.WinTrustFileInfo{})), FilePath: pathPointer, File: handle,
	}
	trustData := windows.WinTrustData{
		Size: uint32(unsafe.Sizeof(windows.WinTrustData{})), UIChoice: windows.WTD_UI_NONE,
		RevocationChecks: windows.WTD_REVOKE_WHOLECHAIN, UnionChoice: windows.WTD_CHOICE_FILE,
		FileOrCatalogOrBlobOrSgnrOrCert: unsafe.Pointer(&fileInfo), StateAction: windows.WTD_STATEACTION_VERIFY,
		ProvFlags: windows.WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT, UIContext: windows.WTD_UICONTEXT_EXECUTE,
	}
	action := windows.WINTRUST_ACTION_GENERIC_VERIFY_V2
	verifyErr := windows.WinVerifyTrustEx(0, &action, &trustData)
	var subject string
	var subjectErr error
	if verifyErr == nil && embeddedCertificateTable {
		subject, subjectErr = windowsEmbeddedSignerSubject(executablePath)
	}
	trustData.StateAction = windows.WTD_STATEACTION_CLOSE
	closeErr := windows.WinVerifyTrustEx(0, &action, &trustData)
	if closeErr != nil {
		return "", nil, fmt.Errorf("close Windows App Authenticode state: %w", errors.Join(ErrNativeVerification, closeErr))
	}
	if verifyErr == nil {
		if !embeddedCertificateTable {
			return "", nil, fmt.Errorf("reject catalog or non-embedded Windows App signature: %w", ErrNativeVerification)
		}
		if subjectErr != nil || !exactText(subject) {
			return "", nil, fmt.Errorf("read Windows App Authenticode signer: %w", errors.Join(ErrNativeVerification, subjectErr))
		}
		return "signed", &subject, nil
	}
	if !embeddedCertificateTable && windowsHRESULT(verifyErr) == windowsTrustNoSignature {
		return "unsigned", nil, nil
	}
	return "", nil, fmt.Errorf("verify Windows App Authenticode: %w", errors.Join(ErrNativeVerification, verifyErr))
}

func windowsEmbeddedSignerSubject(path string) (string, error) {
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return "", err
	}
	var encoding, contentType, formatType uint32
	var store, message windows.Handle
	if err := windows.CryptQueryObject(
		windows.CERT_QUERY_OBJECT_FILE,
		unsafe.Pointer(pathPointer),
		windows.CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
		windows.CERT_QUERY_FORMAT_FLAG_BINARY,
		0,
		&encoding,
		&contentType,
		&formatType,
		&store,
		&message,
		nil,
	); err != nil {
		return "", err
	}
	defer func() { _ = windows.CertCloseStore(store, 0) }()
	defer func() { _, _, _ = procCryptMsgClose.Call(uintptr(message)) }()
	var signerCount uint32
	countSize := uint32(unsafe.Sizeof(signerCount))
	if ok, _, callErr := procCryptMsgGetParam.Call(
		uintptr(message), uintptr(windowsCMSGSignerCountParam), 0,
		uintptr(unsafe.Pointer(&signerCount)), uintptr(unsafe.Pointer(&countSize)),
	); ok == 0 || signerCount != 1 {
		return "", errors.Join(ErrNativeVerification, realWindowsCallError(callErr))
	}
	var size uint32
	if ok, _, callErr := procCryptMsgGetParam.Call(
		uintptr(message), uintptr(windowsCMSGSignerInfoParam), 0, 0, uintptr(unsafe.Pointer(&size)),
	); ok == 0 || size < uint32(unsafe.Sizeof(windowsCMSGSignerInfo{})) {
		return "", errors.Join(ErrNativeVerification, realWindowsCallError(callErr))
	}
	buffer := make([]byte, size)
	if ok, _, callErr := procCryptMsgGetParam.Call(
		uintptr(message), uintptr(windowsCMSGSignerInfoParam), 0,
		uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)),
	); ok == 0 {
		return "", errors.Join(ErrNativeVerification, realWindowsCallError(callErr))
	}
	signer := (*windowsCMSGSignerInfo)(unsafe.Pointer(&buffer[0]))
	certificateInfo := windows.CertInfo{Issuer: signer.issuer, SerialNumber: signer.serialNumber}
	certificate, err := windows.CertFindCertificateInStore(
		store,
		windows.X509_ASN_ENCODING|windows.PKCS_7_ASN_ENCODING,
		0,
		windows.CERT_FIND_SUBJECT_CERT,
		unsafe.Pointer(&certificateInfo),
		nil,
	)
	if err != nil || certificate == nil || certificate.CertInfo == nil {
		return "", err
	}
	defer func() { _ = windows.CertFreeCertificateContext(certificate) }()
	return windowsCertificateSubject(certificate)
}

func windowsCertificateSubject(certificate *windows.CertContext) (string, error) {
	if certificate == nil || certificate.CertInfo == nil {
		return "", ErrNativeVerification
	}
	stringType := windowsCertX500NameString | windowsCertNameStringReverse
	length, _, callErr := procCertNameToStrW.Call(
		uintptr(windows.X509_ASN_ENCODING|windows.PKCS_7_ASN_ENCODING),
		uintptr(unsafe.Pointer(&certificate.CertInfo.Subject)),
		uintptr(stringType),
		0,
		0,
	)
	if length <= 1 {
		return "", callErr
	}
	buffer := make([]uint16, length)
	written, _, callErr := procCertNameToStrW.Call(
		uintptr(windows.X509_ASN_ENCODING|windows.PKCS_7_ASN_ENCODING),
		uintptr(unsafe.Pointer(&certificate.CertInfo.Subject)),
		uintptr(stringType),
		uintptr(unsafe.Pointer(&buffer[0])),
		length,
	)
	if written != length {
		return "", callErr
	}
	return windows.UTF16ToString(buffer), nil
}

func windowsHRESULT(err error) uint32 {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return uint32(errno)
	}
	return 0
}

func realWindowsCallError(err error) error {
	var errno syscall.Errno
	if errors.As(err, &errno) && errno == 0 {
		return nil
	}
	return err
}
