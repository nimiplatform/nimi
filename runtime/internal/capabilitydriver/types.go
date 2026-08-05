// Package capabilitydriver interprets exact capability implementation
// dialects. Local Drivers project and validate verified asset bindings; Cloud
// Drivers separate target/config validation, request mapping, response/stream
// normalization, and reason normalization. Drivers have no route, grant,
// execution-host, fallback, or live-registration ownership.
package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

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

// BundleEntryDescriptor is one LocalAsset-owned per-entry digest. Slice order
// and Ordinal must agree; callers never sort or infer an order before hashing.
type BundleEntryDescriptor struct {
	Ordinal uint32
	SHA256  string
}

// CanonicalBundleSHA256 returns SHA-256 over the concatenated decoded 32-byte
// entry digests in exact declared order. Fixed-width entries make the encoding
// unambiguous. A sharded bundle has at least two one-based contiguous entries.
func CanonicalBundleSHA256(entries []BundleEntryDescriptor) (string, error) {
	if len(entries) < 2 {
		return "", fmt.Errorf("canonical bundle digest requires at least two entries")
	}
	hasher := sha256.New()
	for index, entry := range entries {
		if entry.Ordinal != uint32(index+1) {
			return "", fmt.Errorf("canonical bundle entry %d has ordinal %d", index, entry.Ordinal)
		}
		digest := strings.TrimSpace(entry.SHA256)
		if digest != entry.SHA256 || digest != strings.ToLower(digest) || len(digest) != 64 {
			return "", fmt.Errorf("canonical bundle entry %d has invalid sha256", index)
		}
		decoded, err := hex.DecodeString(digest)
		if err != nil {
			return "", fmt.Errorf("canonical bundle entry %d sha256: %w", index, err)
		}
		_, _ = hasher.Write(decoded)
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// AssetDescriptor is restricted to finite facts verified by the local store.
// It carries no path, filename, runtime, cache, or process information.
type AssetDescriptor struct {
	LocalAssetID      string
	VerifiedContentID string
	EntrySHA256       string
	Kind              runtimev1.LocalAssetKind
	Family            string
	Engine            string
	ArtifactRoles     []string
	BundleEntries     []BundleEntryDescriptor
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

// ImageInvocationInput is the complete Driver-owned image invocation input.
// Host selection, endpoints, binaries, routes, and fallback never enter it.
type ImageInvocationInput struct {
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Request        *runtimev1.ImageGenerateScenarioSpec
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

// ImageInvocationLoRA is one exact Driver-declared ordered LoRA occurrence.
type ImageInvocationLoRA struct {
	RequirementID     string
	OccurrenceOrdinal uint32
	DisplayLabel      string
	AbsolutePath      string
	Weight            float64
}

// ImageInvocationPlan is private to the image Driver/Host seam. Its fields are
// immutable after construction and accessors return copies where needed.
type ImageInvocationPlan struct {
	processKey              string
	modelFiles              []InvocationExactBinding
	mainModelPath           string
	textEncoderPath         string
	vaePath                 string
	uncondDiffusionPath     string
	loras                   []ImageInvocationLoRA
	modelFamily             string
	prompt                  string
	negativePrompt          string
	inputImage              string
	mask                    string
	responseFormat          string
	width                   int
	height                  int
	steps                   int
	cfgScale                float64
	seed                    int64
	imageCount              int
	sampler                 string
	scheduler               string
	threads                 int
	diffusionFlashAttention bool
	offloadParamsToCPU      bool
}

func (p *ImageInvocationPlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}

func (p *ImageInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return append([]InvocationExactBinding(nil), p.modelFiles...)
}

func (p *ImageInvocationPlan) MainModelPath() string {
	if p == nil {
		return ""
	}
	return p.mainModelPath
}

func (p *ImageInvocationPlan) TextEncoderPath() string {
	if p == nil {
		return ""
	}
	return p.textEncoderPath
}

func (p *ImageInvocationPlan) VAEPath() string {
	if p == nil {
		return ""
	}
	return p.vaePath
}

func (p *ImageInvocationPlan) UncondDiffusionPath() string {
	if p == nil {
		return ""
	}
	return p.uncondDiffusionPath
}

func (p *ImageInvocationPlan) LoRAs() []ImageInvocationLoRA {
	if p == nil {
		return nil
	}
	return append([]ImageInvocationLoRA(nil), p.loras...)
}

func (p *ImageInvocationPlan) ModelFamily() string {
	if p == nil {
		return ""
	}
	return p.modelFamily
}

func (p *ImageInvocationPlan) Prompt() string {
	if p == nil {
		return ""
	}
	return p.prompt
}

func (p *ImageInvocationPlan) NegativePrompt() string {
	if p == nil {
		return ""
	}
	return p.negativePrompt
}

func (p *ImageInvocationPlan) InputImage() string {
	if p == nil {
		return ""
	}
	return p.inputImage
}

func (p *ImageInvocationPlan) Mask() string {
	if p == nil {
		return ""
	}
	return p.mask
}

func (p *ImageInvocationPlan) ResponseFormat() string {
	if p == nil {
		return ""
	}
	return p.responseFormat
}

func (p *ImageInvocationPlan) Size() (int, int) {
	if p == nil {
		return 0, 0
	}
	return p.width, p.height
}

func (p *ImageInvocationPlan) Steps() int {
	if p == nil {
		return 0
	}
	return p.steps
}

func (p *ImageInvocationPlan) CFGScale() float64 {
	if p == nil {
		return 0
	}
	return p.cfgScale
}

func (p *ImageInvocationPlan) Seed() int64 {
	if p == nil {
		return 0
	}
	return p.seed
}

func (p *ImageInvocationPlan) ImageCount() int {
	if p == nil {
		return 0
	}
	return p.imageCount
}

func (p *ImageInvocationPlan) Sampler() string {
	if p == nil {
		return ""
	}
	return p.sampler
}

func (p *ImageInvocationPlan) Scheduler() string {
	if p == nil {
		return ""
	}
	return p.scheduler
}

func (p *ImageInvocationPlan) Threads() int {
	if p == nil {
		return 0
	}
	return p.threads
}

func (p *ImageInvocationPlan) DiffusionFlashAttention() bool {
	return p != nil && p.diffusionFlashAttention
}

func (p *ImageInvocationPlan) OffloadParamsToCPU() bool {
	return p != nil && p.offloadParamsToCPU
}

// ImageInvocationDriver is the invocation seam implemented by an image
// Driver. This slice forms plans only; no ExecutionHost consumes them yet.
type ImageInvocationDriver interface {
	Driver
	PlanImageInvocation(input ImageInvocationInput) (*ImageInvocationPlan, error)
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
		{CapabilityContract: LlamaCapabilityContract, Identity: Identity{ImplementationID: LlamaImplementationID, DriverID: LlamaDriverID, DriverDialect: LlamaDriverDialect}}:                                         LlamaTextDriver{},
		{CapabilityContract: StableDiffusionCapabilityContract, Identity: Identity{ImplementationID: StableDiffusionImplementationID, DriverID: StableDiffusionDriverID, DriverDialect: StableDiffusionDriverDialect}}: StableDiffusionImageDriver{},
	})
	if err != nil {
		panic(err)
	}
	return registry
}
