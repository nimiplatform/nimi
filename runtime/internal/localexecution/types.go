// Package localexecution defines the Runtime-private job-time projection shared
// by machine configuration and execution consumers. It is not a public RPC or
// persisted contract.
package localexecution

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// ExactBinding is one verified occurrence in a selected local configuration.
// AbsolutePath is resolved beneath Runtime's owned models root.
type ExactBinding struct {
	RequirementID     string
	LocalAssetID      string
	AbsolutePath      string
	VerifiedContentID string
	EntrySHA256       string
}

// SelectedLocalExecution is the all-or-nothing execution projection for one
// machine selection. Configured is true for every successful resolution;
// incomplete configurations return a typed error instead of a partial value.
type SelectedLocalExecution struct {
	ConfigurationID    string
	CapabilityContract string
	DisplayName        string
	DriverIdentity     *runtimev1.CapabilityImplementationIdentity
	PortableConfig     *structpb.Struct
	Requirements       []*runtimev1.LocalCapabilityRequirement
	ExactBindings      []ExactBinding
	SupportedFeatures  []string
	Configured         bool
}

// Resolver is the private machine-configuration seam consumed by Runtime job
// composition. SelectedLocalCapabilityContracts returns stable sorted keys.
type Resolver interface {
	SelectedLocalCapabilityContracts() []string
	ResolveSelectedLocalExecution(capabilityContract string) (*SelectedLocalExecution, error)
}
