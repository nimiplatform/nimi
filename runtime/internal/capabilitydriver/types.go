// Package capabilitydriver interprets local capability resource intent and
// validates its verified local-asset bindings. It intentionally has no
// execution, host, or live-registration dependencies.
package capabilitydriver

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	LlamaImplementationID   = "local.text.generate.llama-cpp"
	LlamaDriverID           = "nimi.runtime.driver.llama-cpp"
	LlamaDriverDialect      = "llama.cpp/text-generate/v1"
	LlamaCapabilityContract = "text.generate"

	MainGGUFRequirementID        = "main.gguf"
	CompanionMMProjRequirementID = "companion.mmproj"
)

// Identity is the complete implementation vocabulary key. Partial identity
// matching is deliberately unsupported.
type Identity struct {
	ImplementationID string
	DriverID         string
	DriverDialect    string
}

func IdentityFromProto(value *runtimev1.CapabilityImplementationIdentity) Identity {
	if value == nil {
		return Identity{}
	}
	return Identity{
		ImplementationID: value.GetImplementationId(),
		DriverID:         value.GetDriverId(),
		DriverDialect:    value.GetDriverDialect(),
	}
}

func (identity Identity) Proto() *runtimev1.CapabilityImplementationIdentity {
	return &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: identity.ImplementationID,
		DriverId:         identity.DriverID,
		DriverDialect:    identity.DriverDialect,
	}
}

// AssetDescriptor is restricted to finite facts verified by the local store.
// It carries no path, filename, runtime, cache, or process information.
type AssetDescriptor struct {
	LocalAssetID      string
	VerifiedContentID string
	EntrySHA256       string
	Engine            string
	ArtifactRoles     []string
}

// InterpretInput is the portable resource intent interpreted by a driver.
// It deliberately excludes the larger stored configuration and all execution
// or host fields.
type InterpretInput struct {
	PortableConfig    *structpb.Struct
	SupportedFeatures []string
}

// Driver is the complete production driver contract. Registry identity is
// owned by Registry rather than by this interface.
type Driver interface {
	Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason)
	ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.LocalAssetExactBinding, asset AssetDescriptor) runtimev1.LocalCapabilityReason
	ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.LocalAssetExactBinding, assets []AssetDescriptor) runtimev1.LocalCapabilityReason
}

// InvocationExactBinding is the immutable, already-verified occurrence passed
// to a Driver at job submission. Drivers receive exact absolute paths; they
// never discover files or resolve paths relative to a host model directory.
type InvocationExactBinding struct {
	RequirementID     string
	LocalAssetID      string
	AbsolutePath      string
	VerifiedContentID string
	EntrySHA256       string
}

// TextInvocationInput is the complete Driver-owned text invocation input. It
// deliberately contains no binary, port, endpoint, resident-process, route,
// model-selector, or fallback facts.
type TextInvocationInput struct {
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Request        *runtimev1.TextGenerateScenarioSpec
	Stream         bool
}

// InvocationFailureKind classifies failures while a Driver is forming a plan.
type InvocationFailureKind string

const (
	InvocationFailureInvalidConfig  InvocationFailureKind = "invalid_config"
	InvocationFailureInvalidBinding InvocationFailureKind = "invalid_binding"
	InvocationFailureInvalidRequest InvocationFailureKind = "invalid_request"
	InvocationFailureUnsupported    InvocationFailureKind = "unsupported"
)

// InvocationError is returned before any host process or HTTP operation.
type InvocationError struct {
	Kind InvocationFailureKind
	Err  error
}

func (e *InvocationError) Error() string {
	if e == nil || e.Err == nil {
		return "capability invocation failed"
	}
	return e.Err.Error()
}

func (e *InvocationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// TextInvocationPlan is a Driver-private semantic plan flattened into opaque
// substrate instructions. Accessors return copies so captured job inputs
// cannot be changed after submission. The ExecutionHost only supplements host,
// port, and binary facts and executes these instructions.
type TextInvocationPlan struct {
	processKey    string
	processArgs   []string
	modelFiles    []InvocationExactBinding
	requestPath   string
	requestBody   []byte
	stream        bool
	contextWindow uint64
}

func (p *TextInvocationPlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}

func (p *TextInvocationPlan) ProcessArgs() []string {
	if p == nil {
		return nil
	}
	return append([]string(nil), p.processArgs...)
}

// ModelFiles returns the exact captured content identities that must be
// revalidated immediately before a new process loads them. A resident process
// reused for the same ProcessKey does not reopen or revalidate these paths.
func (p *TextInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return append([]InvocationExactBinding(nil), p.modelFiles...)
}

func (p *TextInvocationPlan) RequestPath() string {
	if p == nil {
		return ""
	}
	return p.requestPath
}

func (p *TextInvocationPlan) RequestBody() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.requestBody...)
}

func (p *TextInvocationPlan) Stream() bool {
	return p != nil && p.stream
}

func (p *TextInvocationPlan) ContextWindowTokens() uint64 {
	if p == nil {
		return 0
	}
	return p.contextWindow
}

// TextInvocationDriver is the invocation seam implemented by a text Driver.
// Configuration projection and invocation remain one exact Driver identity,
// while Registry continues to admit non-text Drivers through Driver.
type TextInvocationDriver interface {
	Driver
	PlanTextInvocation(input TextInvocationInput) (*TextInvocationPlan, error)
	TextContextWindow(portableConfig *structpb.Struct) (uint64, error)
}

// RegistrationKey scopes an exact driver identity to one capability contract.
// Capability contracts deliberately remain outside the public implementation
// identity proto message.
type RegistrationKey struct {
	CapabilityContract string
	Identity           Identity
}

// Registry resolves only an exact capability-contract and three-part identity.
type Registry struct {
	drivers map[RegistrationKey]Driver
}

func NewRegistry(entries map[RegistrationKey]Driver) (*Registry, error) {
	drivers := make(map[RegistrationKey]Driver, len(entries))
	for key, driver := range entries {
		identity := key.Identity
		if key.CapabilityContract == "" || identity.ImplementationID == "" || identity.DriverID == "" || identity.DriverDialect == "" || driver == nil {
			return nil, fmt.Errorf("capabilitydriver registry: capability contract, identity, and driver are required")
		}
		drivers[key] = driver
	}
	return &Registry{drivers: drivers}, nil
}

// Resolve returns the driver or the public reason which explains why its
// contract-scoped identity could not be resolved.
func (registry *Registry) Resolve(capabilityContract string, identity Identity) (Driver, runtimev1.LocalCapabilityReason) {
	if registry == nil {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED
	}
	driver, ok := registry.drivers[RegistrationKey{CapabilityContract: capabilityContract, Identity: identity}]
	if ok {
		return driver, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	implementationKnown := false
	driverKnown := false
	for key := range registry.drivers {
		if key.CapabilityContract != capabilityContract || key.Identity.ImplementationID != identity.ImplementationID {
			continue
		}
		implementationKnown = true
		if key.Identity.DriverID == identity.DriverID {
			driverKnown = true
		}
	}
	if driverKnown {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	if implementationKnown {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_NOT_FOUND
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED
}

func NewProductionRegistry() *Registry {
	registry, err := NewRegistry(map[RegistrationKey]Driver{
		{CapabilityContract: LlamaCapabilityContract, Identity: Identity{ImplementationID: LlamaImplementationID, DriverID: LlamaDriverID, DriverDialect: LlamaDriverDialect}}: LlamaTextDriver{},
	})
	if err != nil {
		panic(err)
	}
	return registry
}
