package protectedlocal

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
)

const (
	WindowsProductionServiceName    = "NimiRuntime"
	WindowsProductionServiceAccount = `NT SERVICE\NimiRuntime`
	WindowsProductionServiceSID     = "S-1-5-80-152272774-1324336204-4147968316-71209937-3548791786"

	WindowsLedgerRecordMACKeyName  = "ledger-record-hmac-v1"
	windowsLedgerAnchorSecretName  = "ledger-anchor-v1"
	windowsLedgerRecordMACKeyBytes = 32
	windowsAnchorEncodingBytes     = 8 + IdentifierBytes + 8 + IdentifierBytes
)

var (
	ErrProtectedSecretNotFound = errors.New("protected-local secret not found")
	windowsSecretNamePattern   = regexp.MustCompile(`^[a-z][a-z0-9.-]{0,62}[a-z0-9]$|^[a-z]$`)
)

// BinarySecretStore is the Runtime-private service-principal custody surface.
// Logical names are identifiers, not paths, keyring services, or caller-selected
// protection descriptors.
type BinarySecretStore interface {
	Load(context.Context, string) ([]byte, error)
	Store(context.Context, string, []byte) error
	Delete(context.Context, string) error
}

// WindowsServicePrincipal is an unforgeable package capability returned only
// after the fixed NimiRuntime SCM definition and current process token pass
// production validation.
type WindowsServicePrincipal struct {
	serviceSID   string
	tokenUserSID string
}

func (principal WindowsServicePrincipal) ServiceSID() string { return principal.serviceSID }

// WindowsProtectedStateRoot is an unforgeable package capability for an
// already-provisioned, service-SID-only, non-reparse directory. The physical
// path must originate in signed service configuration; this type validates the
// boundary but does not select it from env, argv, or a user profile.
type WindowsProtectedStateRoot struct {
	path       string
	serviceSID string
	identity   windowsFileIdentity
}

func (root WindowsProtectedStateRoot) Path() string { return root.path }

type windowsFileIdentity struct {
	volumeSerial uint32
	fileIndex    uint64
}

func WindowsProtectedLedgerPath(root WindowsProtectedStateRoot) (string, error) {
	if root.path == "" || root.serviceSID != WindowsProductionServiceSID || !filepath.IsAbs(root.path) {
		return "", fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("resolve Windows protected-local ledger path: invalid state-root capability"))
	}
	return filepath.Join(root.path, LedgerFilename), nil
}

type windowsSIDAttributes struct {
	SID        string
	Attributes uint32
}

type windowsPrincipalSnapshot struct {
	ResolvedServiceSID string
	TokenUserSID       string
	TokenSessionID     uint32
	TokenType          uint32
	TokenRestricted    bool
	ServiceSIDType     uint32
	InteractiveService bool
	Groups             []windowsSIDAttributes
	RestrictedSIDs     []windowsSIDAttributes
}

const (
	windowsTokenPrimary              = 1
	windowsServiceSIDTypeRestricted  = 3
	windowsGroupEnabled              = 0x00000004
	windowsGroupUseForDenyOnly       = 0x00000010
	windowsServiceLogonSID           = "S-1-5-6"
	windowsInteractiveLogonSID       = "S-1-5-4"
	windowsRemoteInteractiveLogonSID = "S-1-5-14"
)

func validateWindowsPrincipalSnapshot(snapshot windowsPrincipalSnapshot) (WindowsServicePrincipal, error) {
	failure := func(message string) (WindowsServicePrincipal, error) {
		return WindowsServicePrincipal{}, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "repair_runtime_service", errors.New(message))
	}
	if snapshot.ResolvedServiceSID != WindowsProductionServiceSID {
		return failure("validate Windows Runtime principal: fixed service SID resolution mismatch")
	}
	if snapshot.ServiceSIDType != windowsServiceSIDTypeRestricted {
		return failure("validate Windows Runtime principal: NimiRuntime service SID is not restricted")
	}
	if snapshot.InteractiveService {
		return failure("validate Windows Runtime principal: interactive service definition is forbidden")
	}
	if snapshot.TokenType != windowsTokenPrimary {
		return failure("validate Windows Runtime principal: primary process token required")
	}
	if snapshot.TokenSessionID != 0 {
		return failure("validate Windows Runtime principal: service must execute in non-interactive session zero")
	}
	if !snapshot.TokenRestricted {
		return failure("validate Windows Runtime principal: restricted process token required")
	}
	if !containsEnabledSID(snapshot.Groups, WindowsProductionServiceSID) {
		return failure("validate Windows Runtime principal: exact NimiRuntime service SID is not enabled")
	}
	if !containsSID(snapshot.RestrictedSIDs, WindowsProductionServiceSID) {
		return failure("validate Windows Runtime principal: exact NimiRuntime service SID is absent from restricted SIDs")
	}
	if !containsEnabledSID(snapshot.Groups, windowsServiceLogonSID) {
		return failure("validate Windows Runtime principal: service-logon SID is not enabled")
	}
	if containsSID(snapshot.Groups, windowsInteractiveLogonSID) || containsSID(snapshot.Groups, windowsRemoteInteractiveLogonSID) {
		return failure("validate Windows Runtime principal: interactive logon membership is forbidden")
	}
	if snapshot.TokenUserSID == "" || snapshot.TokenUserSID == WindowsProductionServiceSID {
		return failure("validate Windows Runtime principal: invalid token user identity")
	}
	return WindowsServicePrincipal{serviceSID: WindowsProductionServiceSID, tokenUserSID: snapshot.TokenUserSID}, nil
}

func containsEnabledSID(values []windowsSIDAttributes, expected string) bool {
	for _, value := range values {
		if value.SID == expected && value.Attributes&windowsGroupEnabled != 0 && value.Attributes&windowsGroupUseForDenyOnly == 0 {
			return true
		}
	}
	return false
}

func containsSID(values []windowsSIDAttributes, expected string) bool {
	for _, value := range values {
		if value.SID == expected {
			return true
		}
	}
	return false
}

func validateWindowsSecretName(name string) error {
	if !windowsSecretNamePattern.MatchString(name) {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("validate protected-local secret name: invalid logical identifier"))
	}
	return nil
}

type windowsServiceAnchorStore struct {
	secrets BinarySecretStore
}

func NewWindowsServiceAnchorStore(secrets BinarySecretStore) (AnchorStore, error) {
	if secrets == nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("create Windows anchor store: secret custody is required"))
	}
	return &windowsServiceAnchorStore{secrets: secrets}, nil
}

func (store *windowsServiceAnchorStore) Load(ctx context.Context) (Anchor, error) {
	encoded, err := store.secrets.Load(ctx, windowsLedgerAnchorSecretName)
	if errors.Is(err, ErrProtectedSecretNotFound) {
		return Anchor{}, ErrAnchorNotFound
	}
	if err != nil {
		return Anchor{}, err
	}
	if len(encoded) != windowsAnchorEncodingBytes || string(encoded[:8]) != "NIMIWA01" {
		return Anchor{}, fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reset_protected_state", fmt.Errorf("decode Windows protected-local anchor: invalid encoding"))
	}
	var anchor Anchor
	copy(anchor.LedgerUUID[:], encoded[8:8+IdentifierBytes])
	anchor.CommitSequence = binary.BigEndian.Uint64(encoded[8+IdentifierBytes : 8+IdentifierBytes+8])
	copy(anchor.CommitChainHead[:], encoded[8+IdentifierBytes+8:])
	if anchor.LedgerUUID == (Identifier{}) || anchor.CommitChainHead == (Identifier{}) {
		return Anchor{}, fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reset_protected_state", fmt.Errorf("decode Windows protected-local anchor: empty identity"))
	}
	return anchor, nil
}

func (store *windowsServiceAnchorStore) Store(ctx context.Context, anchor Anchor) error {
	if anchor.LedgerUUID == (Identifier{}) || anchor.CommitChainHead == (Identifier{}) {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("store Windows protected-local anchor: empty identity"))
	}
	encoded := make([]byte, windowsAnchorEncodingBytes)
	copy(encoded[:8], "NIMIWA01")
	copy(encoded[8:8+IdentifierBytes], anchor.LedgerUUID[:])
	binary.BigEndian.PutUint64(encoded[8+IdentifierBytes:8+IdentifierBytes+8], anchor.CommitSequence)
	copy(encoded[8+IdentifierBytes+8:], anchor.CommitChainHead[:])
	return store.secrets.Store(ctx, windowsLedgerAnchorSecretName, encoded)
}

func LoadOrCreateWindowsLedgerRecordMACKey(ctx context.Context, secrets BinarySecretStore) ([]byte, error) {
	if secrets == nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("load Windows ledger record key: secret custody is required"))
	}
	key, err := secrets.Load(ctx, WindowsLedgerRecordMACKeyName)
	if err == nil {
		if len(key) != windowsLedgerRecordMACKeyBytes {
			return nil, fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reset_protected_state", fmt.Errorf("load Windows ledger record key: invalid key length"))
		}
		return key, nil
	}
	if !errors.Is(err, ErrProtectedSecretNotFound) {
		return nil, err
	}
	key = make([]byte, windowsLedgerRecordMACKeyBytes)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("generate Windows ledger record key: %w", err))
	}
	if err := secrets.Store(ctx, WindowsLedgerRecordMACKeyName, key); err != nil {
		zeroBytes(key)
		return nil, err
	}
	return key, nil
}

func zeroBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
