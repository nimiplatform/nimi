package localappkernel

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalidArgument        = errors.New("registered App kernel invalid argument")
	ErrNotFound               = errors.New("registered App record not found")
	ErrPartitionMismatch      = errors.New("registered App OS-user partition mismatch")
	ErrStateConflict          = errors.New("registered App state conflict")
	ErrRegistrationTombstoned = errors.New("registered App record tombstoned")
	ErrRevisionConflict       = errors.New("registered App generation conflict")
	ErrRandomExhausted        = errors.New("registered App identifier allocation exhausted")
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
	AppID                string
	DisplayName          string
	SourceRef            string
	ProjectRoot          string
	ManifestPath         string
	ShellKind            int32
	RawDeclaration       []string
	SourceDigest         string
	HostExecutableDigest string
	PayloadRootDigest    string
}

// RegisterBuiltInInput is Runtime-owned installation truth for a fixed Nimi
// App whose executable peer has already been verified by protected transport.
// It uses the same durable registration subject and declaration generations as
// every other formal App; it is not a first-party authorization shortcut.
type RegisterBuiltInInput struct {
	AppID                string
	DisplayName          string
	SourceRef            string
	ProjectRoot          string
	ManifestPath         string
	ShellKind            int32
	RawDeclaration       []string
	SourceDigest         string
	HostExecutableDigest string
	PayloadRootDigest    string
}

type SecurityKeys struct {
	StoragePartitionKey string
	AudienceKey         string
	AuditSubjectKey     string
}

func validateDevelopmentInput(input RegisterDevelopmentInput) error {
	return validateRegistrationInput(input.AppID, input.DisplayName, input.SourceRef, input.ProjectRoot,
		input.ManifestPath, input.ShellKind, input.SourceDigest, input.HostExecutableDigest, input.PayloadRootDigest)
}

func validateBuiltInInput(input RegisterBuiltInInput) error {
	return validateRegistrationInput(input.AppID, input.DisplayName, input.SourceRef, input.ProjectRoot,
		input.ManifestPath, input.ShellKind, input.SourceDigest, input.HostExecutableDigest, input.PayloadRootDigest)
}

func validateRegistrationInput(appID, displayName, sourceRef, projectRoot, manifestPath string, shellKind int32, sourceDigest, hostExecutableDigest, payloadRootDigest string) error {
	for name, value := range map[string]string{
		"app_id":                 appID,
		"display_name":           displayName,
		"source_ref":             sourceRef,
		"project_root":           projectRoot,
		"manifest_path":          manifestPath,
		"source_digest":          sourceDigest,
		"host_executable_digest": hostExecutableDigest,
		"payload_root_digest":    payloadRootDigest,
	} {
		if err := requireExactText(name, value); err != nil {
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
