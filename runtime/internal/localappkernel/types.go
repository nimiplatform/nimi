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
	SourceClassVerified         SourceClass = "verified"
	SourceClassUserImported     SourceClass = "user_imported"
	SourceClassLocalDevelopment SourceClass = "local_development"
)

type RegistrationState string

const (
	RegistrationStateActive     RegistrationState = "active"
	RegistrationStateTombstoned RegistrationState = "tombstoned"
)

type Registration struct {
	LocalOSUserAnchor         string
	BindingSlot               string
	RegistrationHandle        string
	RegisteredAppSubject      string
	AppID                     string
	DisplayName               string
	SourceClass               SourceClass
	SourceRef                 string
	ProjectRoot               string
	ManifestPath              string
	ShellKind                 int32
	RawDeclaration            []string
	ActivatedDomains          []string
	SourceGeneration          uint64
	DeclarationGeneration     uint64
	ImmutableLineageID        string
	ProvenanceAttestationRefs []string
	ProvenanceRevision        uint64
	ExecutionProfileRef       string
	DeclarationDigest         string
	HostExecutableDigest      string
	PayloadRootDigest         string
	State                     RegistrationState
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
	TombstonedAt              *time.Time
}

// ImmutablePackageFactsComplete is the fail-closed canonical seam required
// before a verified or user-imported registration may be reported available
// or admitted to an installed session. Local development has no package seam.
func (registration Registration) ImmutablePackageFactsComplete() bool {
	if registration.SourceClass != SourceClassVerified && registration.SourceClass != SourceClassUserImported {
		return false
	}
	if strings.TrimSpace(registration.ImmutableLineageID) == "" ||
		registration.ProvenanceRevision == 0 ||
		strings.TrimSpace(registration.ExecutionProfileRef) == "" {
		return false
	}
	if registration.SourceClass == SourceClassVerified && len(registration.ProvenanceAttestationRefs) == 0 {
		return false
	}
	for _, reference := range registration.ProvenanceAttestationRefs {
		if strings.TrimSpace(reference) == "" || reference != strings.TrimSpace(reference) {
			return false
		}
	}
	return true
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
	RawDeclaration             []string
	SourceClass                SourceClass
	ImmutableLineageID         string
	ProvenanceAttestationRefs  []string
	ProvenanceRevision         uint64
	ExecutionProfileRef        string
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
	if input.ShellKind <= 0 {
		return fmt.Errorf("%w: shell_kind", ErrInvalidArgument)
	}
	return validateRegistrationInput(input.AppID, input.DisplayName, input.SourceRef, input.ProjectRoot,
		input.ManifestPath, input.HostExecutableDigest)
}

func validateInstalledInput(input RegisterInstalledInput) error {
	if err := validateOptionalRegistrationHandle(input.ExistingRegistrationHandle); err != nil {
		return err
	}
	if err := validateOptionalBindingSlot(input.BindingSlot); err != nil {
		return err
	}
	if input.SourceClass != SourceClassVerified && input.SourceClass != SourceClassUserImported {
		return fmt.Errorf("%w: source_class", ErrInvalidArgument)
	}
	if err := validateRegistrationInput(input.AppID, input.DisplayName, input.SourceRef, input.ProjectRoot,
		input.ManifestPath, input.HostExecutableDigest); err != nil {
		return err
	}
	for name, value := range map[string]string{
		"immutable_lineage_id":  input.ImmutableLineageID,
		"execution_profile_ref": input.ExecutionProfileRef,
		"payload_root_digest":   input.PayloadRootDigest,
	} {
		if err := requireExactText(name, value); err != nil {
			return err
		}
	}
	if input.ProvenanceRevision == 0 {
		return fmt.Errorf("%w: provenance_revision", ErrInvalidArgument)
	}
	seen := make(map[string]struct{}, len(input.ProvenanceAttestationRefs))
	if input.SourceClass == SourceClassVerified && len(input.ProvenanceAttestationRefs) == 0 {
		return fmt.Errorf("%w: provenance_attestation_refs", ErrInvalidArgument)
	}
	for _, ref := range input.ProvenanceAttestationRefs {
		if err := requireExactText("provenance_attestation_ref", ref); err != nil {
			return err
		}
		if _, duplicate := seen[ref]; duplicate {
			return fmt.Errorf("%w: provenance_attestation_refs", ErrInvalidArgument)
		}
		seen[ref] = struct{}{}
	}
	return nil
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

func validateRegistrationInput(appID, displayName, sourceRef, projectRoot, manifestPath string, hostExecutableDigest string) error {
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
	return nil
}

func requireExactText(name, value string) error {
	if value == "" || value != strings.TrimSpace(value) || !utf8.ValidString(value) || len([]byte(value)) > 16*1024 {
		return fmt.Errorf("%w: %s", ErrInvalidArgument, name)
	}
	return nil
}
