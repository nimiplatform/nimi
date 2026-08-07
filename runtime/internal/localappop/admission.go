package localappop

import (
	"errors"
	"fmt"
	"strings"
)

var (
	ErrCallerAssertion  = errors.New("caller-supplied protected App context is forbidden")
	ErrSessionInvalid   = errors.New("protected App session is invalid")
	ErrSnapshotMissing  = errors.New("Effective App Access Snapshot is missing")
	ErrSnapshotStale    = errors.New("Effective App Access Snapshot is stale")
	ErrDomainUncovered  = errors.New("Effective App Access Snapshot does not cover the operation domain")
	ErrOwnerUnavailable = errors.New("admitted App operation owner adapter is unavailable")
)

type SnapshotBinding struct {
	LaunchCorrelation     [32]byte
	RegistrationHandle    string
	RegisteredAppSubject  string
	SourceGeneration      uint64
	DeclarationGeneration uint64
	AccountID             string
	AccountGeneration     uint64
	RuntimeGeneration     uint64
}

type EffectiveAppAccessSnapshot struct {
	binding SnapshotBinding
	domains map[Domain]struct{}
	present bool
}

func NewEffectiveAppAccessSnapshot(binding SnapshotBinding, declaredDomains []string) (*EffectiveAppAccessSnapshot, error) {
	if err := validateSnapshotBinding(binding); err != nil {
		return nil, err
	}
	domains := make(map[Domain]struct{}, len(declaredDomains))
	for _, value := range declaredDomains {
		if value == "" || value != strings.TrimSpace(value) || !IsSupportedDomain(value) {
			return nil, fmt.Errorf("%w: unsupported snapshot domain", ErrContractInvalid)
		}
		domain := Domain(value)
		if _, duplicate := domains[domain]; duplicate {
			return nil, fmt.Errorf("%w: duplicate snapshot domain", ErrContractInvalid)
		}
		domains[domain] = struct{}{}
	}
	return &EffectiveAppAccessSnapshot{binding: binding, domains: domains, present: true}, nil
}

type CurrentBinding struct {
	LaunchCorrelation     [32]byte
	RegistrationHandle    string
	RegisteredAppSubject  string
	SourceGeneration      uint64
	DeclarationGeneration uint64
	AccountID             string
	AccountGeneration     uint64
	RuntimeGeneration     uint64
}

type CallerAssertions struct {
	AppOperationID     string
	AppAccessDomainID  string
	Classification     string
	RegisteredSubject  string
	RegistrationHandle string
	AccountID          string
	SessionID          string
	SnapshotID         string
	Credential         string
	PeerProof          string
	Generation         uint64
}

func (assertions CallerAssertions) empty() bool {
	return assertions == (CallerAssertions{})
}

type AdmissionInput struct {
	Ingress          Ingress
	Snapshot         *EffectiveAppAccessSnapshot
	Current          CurrentBinding
	CallerAssertions CallerAssertions
}

type Admission struct {
	Operation Operation
	Class     AuthorityClass
	Domain    Domain
}

func Admit(input AdmissionInput) (Admission, error) {
	if !input.CallerAssertions.empty() {
		return Admission{}, ErrCallerAssertion
	}
	if input.Snapshot == nil || !input.Snapshot.present {
		return Admission{}, ErrSnapshotMissing
	}
	if err := validateCurrentBinding(input.Current); err != nil {
		return Admission{}, err
	}
	if !sameBinding(input.Snapshot.binding, input.Current) {
		return Admission{}, ErrSnapshotStale
	}
	classification, err := ClassifyIngress(input.Ingress)
	if err != nil {
		return Admission{}, err
	}
	switch classification.Class {
	case AuthorityClassBase:
		return Admission{Operation: classification.Operation, Class: classification.Class}, nil
	case AuthorityClassAppAccess:
		if _, covered := input.Snapshot.domains[classification.Domain]; !covered {
			return Admission{}, ErrDomainUncovered
		}
		return Admission{Operation: classification.Operation, Class: classification.Class, Domain: classification.Domain}, nil
	default:
		return Admission{}, ErrOperationUnknown
	}
}

func validateSnapshotBinding(binding SnapshotBinding) error {
	return validateCurrentBinding(CurrentBinding(binding))
}

func validateCurrentBinding(binding CurrentBinding) error {
	if binding.LaunchCorrelation == ([32]byte{}) ||
		strings.TrimSpace(binding.RegistrationHandle) == "" ||
		strings.TrimSpace(binding.RegisteredAppSubject) == "" ||
		binding.SourceGeneration == 0 || binding.DeclarationGeneration == 0 ||
		strings.TrimSpace(binding.AccountID) == "" || binding.AccountGeneration == 0 ||
		binding.RuntimeGeneration == 0 {
		return ErrSessionInvalid
	}
	return nil
}

func sameBinding(snapshot SnapshotBinding, current CurrentBinding) bool {
	return snapshot.LaunchCorrelation == current.LaunchCorrelation &&
		snapshot.RegistrationHandle == current.RegistrationHandle &&
		snapshot.RegisteredAppSubject == current.RegisteredAppSubject &&
		snapshot.SourceGeneration == current.SourceGeneration &&
		snapshot.DeclarationGeneration == current.DeclarationGeneration &&
		snapshot.AccountID == current.AccountID &&
		snapshot.AccountGeneration == current.AccountGeneration &&
		snapshot.RuntimeGeneration == current.RuntimeGeneration
}
