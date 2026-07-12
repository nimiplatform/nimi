//go:build windows

package protectedlocal

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	cmsgSignerInfoParam = 6
)

var (
	crypt32              = windows.NewLazySystemDLL("crypt32.dll")
	procCryptMsgGetParam = crypt32.NewProc("CryptMsgGetParam")
	procCryptMsgClose    = crypt32.NewProc("CryptMsgClose")
)

type windowsNativeExecutableTrustVerifier struct {
	signerCertSHA256 [sha256.Size]byte
}

type windowsCryptAttribute struct {
	objID      *byte
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

// NewWindowsNativeExecutableTrustVerifier returns the verifier compiled for
// this binary's fixed production or separately tagged E2E profile. Trust comes
// from the platform chain plus the build-admitted signer and executable role;
// no runtime selector, portable record, or caller-selected trust root exists.
func NewWindowsNativeExecutableTrustVerifier() (WindowsExecutableTrustVerifier, error) {
	digest, err := decodeWindowsSignerCertSHA256(activeWindowsSignerCertSHA256())
	if err != nil {
		return nil, windowsExecutableTrustFailure("load Windows signer policy", err)
	}
	return &windowsNativeExecutableTrustVerifier{signerCertSHA256: digest}, nil
}

func (verifier *windowsNativeExecutableTrustVerifier) VerifyWindowsExecutable(ctx context.Context, role WindowsExecutableRole, executable WindowsLockedExecutable) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", windowsExecutableTrustFailure("verify Windows executable", err)
	}
	if verifier == nil || executable == nil || executable.NativeHandle() == 0 {
		return "", windowsExecutableTrustFailure("verify Windows executable", fmt.Errorf("native verifier and locked executable are required"))
	}
	evidence := executable.Evidence()
	expectedName, trustSetID, err := windowsExecutableRolePolicy(role)
	if err != nil {
		return "", err
	}
	if expectedName != "" && !strings.EqualFold(filepath.Base(evidence.Path), expectedName) {
		return "", windowsExecutableTrustFailure("verify Windows executable role", fmt.Errorf("unexpected executable name"))
	}
	if err := verifyWindowsAuthenticode(executable, evidence.Path); err != nil {
		return "", err
	}
	if role != WindowsExecutableRoleInstalled {
		observed, err := windowsEmbeddedSignerCertSHA256(evidence.Path)
		if err != nil {
			return "", err
		}
		if subtle.ConstantTimeCompare(observed[:], verifier.signerCertSHA256[:]) != 1 {
			return "", windowsExecutableTrustFailure("verify Windows signer identity", fmt.Errorf("signer certificate mismatch"))
		}
	}
	return trustSetID, nil
}

func windowsExecutableRolePolicy(role WindowsExecutableRole) (string, string, error) {
	profile := mustActiveWindowsRuntimeProfile()
	switch role {
	case WindowsExecutableRoleRuntime:
		return profile.runtimeExecutableName, profile.runtimeTrustSetID, nil
	case WindowsExecutableRoleDesktop:
		return profile.desktopExecutableName, profile.desktopTrustSetID, nil
	case WindowsExecutableRoleInstalled:
		// Installed publisher identity and release authority are supplied by the
		// Platform release digest. This verifier contributes only the native
		// Authenticode chain result and must not create a second signer registry.
		return "", WindowsInstalledReleaseTrustSetID, nil
	default:
		return "", "", windowsExecutableTrustFailure("verify Windows executable role", fmt.Errorf("unsupported executable role"))
	}
}

func verifyWindowsAuthenticode(executable WindowsLockedExecutable, path string) error {
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return windowsExecutableTrustFailure("encode Windows executable path", err)
	}
	fileInfo := windows.WinTrustFileInfo{
		Size:     uint32(unsafe.Sizeof(windows.WinTrustFileInfo{})),
		FilePath: pathPointer,
		File:     windows.Handle(executable.NativeHandle()),
	}
	trustData := windows.WinTrustData{
		Size:                            uint32(unsafe.Sizeof(windows.WinTrustData{})),
		UIChoice:                        windows.WTD_UI_NONE,
		RevocationChecks:                windows.WTD_REVOKE_WHOLECHAIN,
		UnionChoice:                     windows.WTD_CHOICE_FILE,
		FileOrCatalogOrBlobOrSgnrOrCert: unsafe.Pointer(&fileInfo),
		StateAction:                     windows.WTD_STATEACTION_VERIFY,
		ProvFlags:                       windows.WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT,
		UIContext:                       windows.WTD_UICONTEXT_EXECUTE,
	}
	action := windows.WINTRUST_ACTION_GENERIC_VERIFY_V2
	verifyErr := windows.WinVerifyTrustEx(0, &action, &trustData)
	trustData.StateAction = windows.WTD_STATEACTION_CLOSE
	closeErr := windows.WinVerifyTrustEx(0, &action, &trustData)
	if verifyErr != nil {
		return windowsExecutableTrustFailure("verify Windows Authenticode chain", verifyErr)
	}
	if closeErr != nil {
		return windowsExecutableTrustFailure("close Windows Authenticode state", closeErr)
	}
	return nil
}

func windowsEmbeddedSignerCertSHA256(path string) ([sha256.Size]byte, error) {
	var digest [sha256.Size]byte
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return digest, windowsExecutableTrustFailure("encode Windows signer path", err)
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
		return digest, windowsExecutableTrustFailure("read Windows embedded signature", err)
	}
	defer windows.CertCloseStore(store, 0)
	defer procCryptMsgClose.Call(uintptr(message))

	var size uint32
	if ok, _, callErr := procCryptMsgGetParam.Call(uintptr(message), cmsgSignerInfoParam, 0, 0, uintptr(unsafe.Pointer(&size))); ok == 0 || size < uint32(unsafe.Sizeof(windowsCMSGSignerInfo{})) {
		return digest, windowsExecutableTrustFailure("size Windows signer info", callErr)
	}
	buffer := make([]byte, size)
	if ok, _, callErr := procCryptMsgGetParam.Call(uintptr(message), cmsgSignerInfoParam, 0, uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size))); ok == 0 {
		return digest, windowsExecutableTrustFailure("read Windows signer info", callErr)
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
	if err != nil || certificate == nil || certificate.EncodedCert == nil || certificate.Length == 0 {
		return digest, windowsExecutableTrustFailure("resolve Windows signer certificate", err)
	}
	defer windows.CertFreeCertificateContext(certificate)
	encoded := unsafe.Slice(certificate.EncodedCert, certificate.Length)
	return sha256.Sum256(encoded), nil
}

var _ WindowsExecutableTrustVerifier = (*windowsNativeExecutableTrustVerifier)(nil)
