package localappkernel

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalidArgument         = errors.New("registered App kernel invalid argument")
	ErrNotFound                = errors.New("registered App record not found")
	ErrStateConflict           = errors.New("registered App state conflict")
	ErrRegistrationUnavailable = errors.New("registered App is unavailable on the current host")
	ErrRegistrationTombstoned  = errors.New("registered App record tombstoned")
	ErrRevisionConflict        = errors.New("registered App generation conflict")
	ErrRandomExhausted         = errors.New("registered App identifier allocation exhausted")
)

type SourceClass string

const (
	SourceClassInstalled   SourceClass = "installed"
	SourceClassLocalImport SourceClass = "local_import"
	SourceClassDevelopment SourceClass = "development"
)

type RegistrationState string

const (
	RegistrationStateActive     RegistrationState = "active"
	RegistrationStateTombstoned RegistrationState = "tombstoned"
)

type Registration struct {
	LocalOSUserAnchor     string
	BindingSlot           string
	RegistrationHandle    string
	RegisteredAppSubject  string
	AppID                 string
	DisplayName           string
	SourceClass           SourceClass
	SourceRef             string
	ProjectRoot           string
	ManifestPath          string
	ShellKind             int32
	RawDeclaration        []string
	ActivatedDomains      []string
	SourceGeneration      uint64
	DeclarationGeneration uint64
	SourceDigest          string
	DeclarationDigest     string
	HostExecutableDigest  string
	PayloadRootDigest     string
	State                 RegistrationState
	CreatedAt             time.Time
	UpdatedAt             time.Time
	TombstonedAt          *time.Time
}

type RegisterDevelopmentInput struct {
	ExistingRegistrationHandle string
	AppID                      string
	DisplayName                string
	SourceRef                  string
	ProjectRoot                string
	ManifestPath               string
	ShellKind                  int32
	RawDeclaration             []string
	HostExecutableDigest       string
}

// RegisterInstalledInput is lifecycle-owner installation truth for one formal
// App whose executable peer has already been verified by protected transport.
// It uses the same durable registration subject and declaration generations for
// ordinary, bundled, and platform releases without a first-party shortcut.
type RegisterInstalledInput struct {
	ExistingRegistrationHandle string
	BindingSlot                string
	AppID                      string
	DisplayName                string
	SourceRef                  string
	ProjectRoot                string
	ManifestPath               string
	ShellKind                  int32
	RawDeclaration             []string
	SourceDigest               string
	HostExecutableDigest       string
	PayloadRootDigest          string
}

// RegistrationStatus reports canonical lifecycle state separately from the
// exact current-host binding required to use the registration. It never
// selects a registration by App ID, source reference, or a physical path.
type RegistrationStatus struct {
	RegistrationHandle   string
	RegisteredAppSubject string
	AppID                string
	SourceClass          SourceClass
	State                RegistrationState
	CurrentHostBound     bool
	Available            bool
}

type SecurityKeys struct {
	StoragePartitionKey string
	AudienceKey         string
	AuditSubjectKey     string
}

func validateDevelopmentInput(input RegisterDevelopmentInput) error {
	if err := validateOptionalRegistrationHandle(input.ExistingRegistrationHandle); err != nil {
		return err
	}
	return validateRegistrationInput(input.AppID, input.DisplayName, input.SourceRef, input.ProjectRoot,
		input.ManifestPath, input.ShellKind, "", false, input.HostExecutableDigest, "", false)
}

func validateInstalledInput(input RegisterInstalledInput) error {
	if err := validateOptionalRegistrationHandle(input.ExistingRegistrationHandle); err != nil {
		return err
	}
	if err := validateOptionalBindingSlot(input.BindingSlot); err != nil {
		return err
	}
	return validateRegistrationInput(input.AppID, input.DisplayName, input.SourceRef, input.ProjectRoot,
		input.ManifestPath, input.ShellKind, input.SourceDigest, true, input.HostExecutableDigest, input.PayloadRootDigest, true)
}

func validateOptionalBindingSlot(slot string) error {
	if slot == "" {
		return nil
	}
	return requireExactText("binding_slot", slot)
}

func validateOptionalRegistrationHandle(handle string) error {
	if handle == "" {
		return nil
	}
	return requireExactText("existing_registration_handle", handle)
}

func validateRegistrationInput(appID, displayName, sourceRef, projectRoot, manifestPath string, shellKind int32, sourceDigest string, requireSourceDigest bool, hostExecutableDigest, payloadRootDigest string, requirePayload bool) error {
	for name, value := range map[string]string{
		"app_id":                 appID,
		"display_name":           displayName,
		"source_ref":             sourceRef,
		"project_root":           projectRoot,
		"manifest_path":          manifestPath,
		"host_executable_digest": hostExecutableDigest,
	} {
		if err := requireExactText(name, value); err != nil {
			return err
		}
	}
	if requireSourceDigest {
		if err := requireExactText("source_digest", sourceDigest); err != nil {
			return err
		}
	}
	if requirePayload {
		if err := requireExactText("payload_root_digest", payloadRootDigest); err != nil {
			return err
		}
	}
	if shellKind <= 0 {
		return fmt.Errorf("%w: shell_kind", ErrInvalidArgument)
	}
	return nil
}

func requireExactText(name, value string) error {
	if value == "" || value != strings.TrimSpace(value) || !utf8.ValidString(value) || len([]byte(value)) > 16*1024 {
		return fmt.Errorf("%w: %s", ErrInvalidArgument, name)
	}
	return nil
}
