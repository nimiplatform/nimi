package aiconfig

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// LocalAgentSubsystemOwner returns the singular machine-scoped owner marker.
// Individual LocalAgent identity is deliberately not representable here.
func LocalAgentSubsystemOwner() *runtimev1.AIConfigOwner {
	return &runtimev1.AIConfigOwner{
		Owner: &runtimev1.AIConfigOwner_RuntimeLocalAgentSubsystem{
			RuntimeLocalAgentSubsystem: &runtimev1.AIConfigRuntimeLocalAgentSubsystemOwner{},
		},
	}
}

// Hash is a deterministic content identity for one canonical AIConfig value.
// It is a projection/capture fact, not a revision or a compare-and-swap token.
func Hash(input *runtimev1.AIConfig) string {
	canonical, err := Canonicalize(input)
	if err != nil {
		return ""
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(canonical)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Canonicalize validates the portable storage shape of an AIConfig, clones it,
// and gives repeated capability and feature values a deterministic order. Live
// App, CapabilityContract, feature, and Driver admission remains outside this
// dormant domain/store layer. It never mutates input.
func Canonicalize(input *runtimev1.AIConfig) (*runtimev1.AIConfig, error) {
	if input == nil {
		return nil, fmt.Errorf("AIConfig is required")
	}
	out, ok := proto.Clone(input).(*runtimev1.AIConfig)
	if !ok || out == nil {
		return nil, fmt.Errorf("clone AIConfig")
	}
	if err := validateOwner(out.GetOwner()); err != nil {
		return nil, err
	}

	seenCapabilities := make(map[string]struct{}, len(out.GetCapabilities()))
	for _, capability := range out.GetCapabilities() {
		if err := canonicalizeCapability(capability); err != nil {
			return nil, err
		}
		contract := capability.GetCapabilityContract()
		if _, exists := seenCapabilities[contract]; exists {
			return nil, fmt.Errorf("duplicate capability_contract %q", contract)
		}
		seenCapabilities[contract] = struct{}{}
	}
	sort.Slice(out.Capabilities, func(i, j int) bool {
		return out.Capabilities[i].GetCapabilityContract() < out.Capabilities[j].GetCapabilityContract()
	})
	return out, nil
}

func canonicalizeCapability(capability *runtimev1.AIConfigCapabilityIntent) error {
	if capability == nil {
		return fmt.Errorf("capability intent is required")
	}
	contract := capability.GetCapabilityContract()
	if err := requireExactNonEmpty("capability_contract", contract); err != nil {
		return err
	}
	if !aicapabilities.IsCanonicalCatalogCapability(contract) {
		return fmt.Errorf("capability_contract %q is not in the canonical capability catalog", contract)
	}

	seenFeatures := make(map[string]struct{}, len(capability.GetRequiredFeatures()))
	for _, feature := range capability.GetRequiredFeatures() {
		if err := requireExactNonEmpty("required_feature", feature); err != nil {
			return fmt.Errorf("capability %q: %w", contract, err)
		}
		if strings.HasPrefix(feature, contract+".") {
			return fmt.Errorf("capability %q: required_feature %q must be contract-local", contract, feature)
		}
		if !aicapabilities.SupportsStandardizedFeature(contract, feature) {
			return fmt.Errorf("capability %q: required_feature %q is not in the standardized feature vocabulary", contract, feature)
		}
		if _, exists := seenFeatures[feature]; exists {
			return fmt.Errorf("capability %q: duplicate required_feature %q", contract, feature)
		}
		seenFeatures[feature] = struct{}{}
	}
	sort.Strings(capability.RequiredFeatures)

	if err := validateDefaults(capability.GetDefaults(), "defaults"); err != nil {
		return fmt.Errorf("capability %q: %w", contract, err)
	}
	switch route := capability.GetRoute().(type) {
	case *runtimev1.AIConfigCapabilityIntent_Local:
		if route.Local == nil {
			return fmt.Errorf("capability %q: Local route marker is required", contract)
		}
		if len(route.Local.ProtoReflect().GetUnknown()) != 0 {
			return fmt.Errorf("capability %q: Local intent contains unknown wire fields", contract)
		}
	case *runtimev1.AIConfigCapabilityIntent_Cloud:
		if err := validateCloudIntent(route.Cloud); err != nil {
			return fmt.Errorf("capability %q: %w", contract, err)
		}
	default:
		return fmt.Errorf("capability %q: route must be Local or Cloud", contract)
	}
	return nil
}

func validateOwner(owner *runtimev1.AIConfigOwner) error {
	if owner == nil {
		return fmt.Errorf("AIConfig owner is required")
	}
	switch typed := owner.GetOwner().(type) {
	case *runtimev1.AIConfigOwner_App:
		if typed.App == nil {
			return fmt.Errorf("App AIConfig owner is required")
		}
		if err := requireExactNonEmpty("app_id", typed.App.GetAppId()); err != nil {
			return err
		}
	case *runtimev1.AIConfigOwner_RuntimeLocalAgentSubsystem:
		if typed.RuntimeLocalAgentSubsystem == nil {
			return fmt.Errorf("Runtime LocalAgent subsystem owner marker is required")
		}
	default:
		return fmt.Errorf("AIConfig owner kind must be App or shared LocalAgent")
	}
	return nil
}

func validateCloudIntent(cloud *runtimev1.AIConfigCloudIntent) error {
	if cloud == nil {
		return fmt.Errorf("Cloud intent is required for Cloud route")
	}
	if len(cloud.ProtoReflect().GetUnknown()) != 0 {
		return fmt.Errorf("Cloud intent contains unknown wire fields")
	}
	if err := requireExactNonEmpty("connector_ref", cloud.GetConnectorRef()); err != nil {
		return err
	}
	implementation := cloud.GetImplementation()
	if implementation == nil {
		return fmt.Errorf("Cloud implementation is required")
	}
	if err := requireExactNonEmpty("implementation_id", implementation.GetImplementationId()); err != nil {
		return err
	}
	if err := requireExactNonEmpty("driver_id", implementation.GetDriverId()); err != nil {
		return err
	}
	if err := requireExactNonEmpty("driver_dialect", implementation.GetDriverDialect()); err != nil {
		return err
	}
	target := cloud.GetProviderModelTarget()
	if target == nil || len(target.GetFields()) == 0 {
		return fmt.Errorf("provider_model_target is required")
	}
	if err := validateStruct(target, "provider_model_target", cloudTargetKeyAllowed); err != nil {
		return err
	}
	if _, exists := target.GetFields()["model"]; exists {
		return fmt.Errorf("provider_model_target.model is not permitted")
	}
	for _, key := range []string{"provider", "providerModelId", "remoteModelCatalogId"} {
		value := target.GetFields()[key]
		if value == nil || value.GetStringValue() == "" || strings.TrimSpace(value.GetStringValue()) != value.GetStringValue() {
			return fmt.Errorf("provider_model_target.%s is required", key)
		}
	}
	return nil
}

func validateDefaults(value *structpb.Struct, path string) error {
	if value == nil {
		return nil
	}
	return validateStruct(value, path, defaultsKeyAllowed)
}

func validateStruct(value *structpb.Struct, path string, keyAllowed func(string) bool) error {
	keys := make([]string, 0, len(value.GetFields()))
	for key := range value.GetFields() {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if err := requireExactNonEmpty(path+" key", key); err != nil {
			return err
		}
		if !keyAllowed(key) {
			return fmt.Errorf("%s.%s is not permitted in canonical AIConfig", path, key)
		}
		if err := validateValue(value.GetFields()[key], path+"."+key, keyAllowed); err != nil {
			return err
		}
	}
	return nil
}

func validateValue(value *structpb.Value, path string, keyAllowed func(string) bool) error {
	if value == nil || value.GetKind() == nil {
		return fmt.Errorf("%s has no value", path)
	}
	switch typed := value.GetKind().(type) {
	case *structpb.Value_NullValue, *structpb.Value_BoolValue:
		return nil
	case *structpb.Value_NumberValue:
		if math.IsNaN(typed.NumberValue) || math.IsInf(typed.NumberValue, 0) {
			return fmt.Errorf("%s must be a finite number", path)
		}
		return nil
	case *structpb.Value_StringValue:
		if isExplicitMachinePrivateReference(typed.StringValue) {
			return fmt.Errorf("%s contains a machine-private value", path)
		}
		return nil
	case *structpb.Value_StructValue:
		return validateStruct(typed.StructValue, path, keyAllowed)
	case *structpb.Value_ListValue:
		for index, item := range typed.ListValue.GetValues() {
			if err := validateValue(item, fmt.Sprintf("%s[%d]", path, index), keyAllowed); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("%s has an unsupported value", path)
	}
}

func defaultsKeyAllowed(key string) bool {
	normalized := normalizedKey(key)
	_, forbidden := forbiddenDefaultsKeys[normalized]
	return !forbidden && cloudTargetKeyAllowed(key)
}

func cloudTargetKeyAllowed(key string) bool {
	normalized := normalizedKey(key)
	_, forbidden := forbiddenCloudTargetKeys[normalized]
	return !forbidden
}

// These are cross-engine portability and secret-custody boundaries only.
// Passing this filter does not validate CapabilityContract or Driver semantics.
var forbiddenDefaultsKeys = map[string]struct{}{
	"accesskey": {}, "accesstoken": {}, "account": {}, "accountid": {}, "accountidentity": {}, "apikey": {},
	"authorization": {}, "authorizationheader": {}, "authtoken": {}, "baseurl": {}, "bearer": {}, "clientsecret": {},
	"binding": {}, "bindingid": {}, "bindings": {}, "configurationid": {}, "connector": {},
	"connectorgrant": {}, "connectorgrantid": {}, "connectorid": {}, "credential": {}, "credentials": {},
	"driver": {}, "driverdialect": {}, "driverid": {}, "endpoint": {}, "engine": {}, "enginekind": {},
	"exactbinding": {}, "executionhost": {}, "filepath": {}, "grant": {}, "grantid": {}, "health": {}, "host": {},
	"implementation": {}, "implementationid": {}, "lcc": {},
	"localasset": {}, "localassetid": {}, "localcapabilityconfiguration": {}, "localcapabilityconfigurationid": {},
	"localpath": {}, "mainmodel": {}, "mmproj": {}, "model": {}, "modelid": {}, "modelpath": {}, "node": {},
	"nodeid": {}, "password": {}, "path": {}, "privatekey": {}, "probe": {}, "proberesult": {},
	"process": {}, "processstate": {}, "providermodeltarget": {}, "providersecret": {}, "readiness": {},
	"readinessref": {}, "residency": {}, "route": {}, "secret": {}, "secretkey": {}, "selection": {},
	"selectionid": {}, "target": {}, "targetid": {}, "targetref": {}, "token": {}, "warm": {}, "workflow": {},
	"workflowid": {}, "endpointurl": {},
}

// Provider/model/region keys are intentionally allowed here. The target is
// Driver-owned opaque data; Core only enforces portable identity and custody.
var forbiddenCloudTargetKeys = map[string]struct{}{
	"accesskey": {}, "accesstoken": {}, "account": {}, "accountid": {}, "accountidentity": {}, "apikey": {},
	"authorization": {}, "authorizationheader": {}, "authtoken": {}, "baseurl": {}, "bearer": {}, "clientsecret": {},
	"binding": {}, "bindingid": {}, "connector": {}, "connectorgrant": {}, "connectorgrantid": {}, "connectorid": {},
	"credential": {}, "credentials": {}, "driver": {}, "driverdialect": {}, "driverid": {}, "endpoint": {},
	"engine": {}, "enginekind": {}, "executionhost": {}, "filepath": {}, "grant": {}, "grantid": {}, "health": {},
	"host":       {},
	"localasset": {}, "localassetid": {}, "localpath": {}, "node": {}, "nodeid": {}, "password": {}, "path": {},
	"privatekey": {}, "probe": {}, "proberesult": {}, "process": {}, "processstate": {}, "providersecret": {},
	"readiness": {}, "readinessref": {}, "residency": {}, "secret": {}, "secretkey": {}, "selection": {},
	"selectionid": {}, "token": {}, "warm": {}, "workflow": {}, "workflowid": {}, "endpointurl": {},
}

func normalizedKey(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(unicode.ToLower(r))
		}
	}
	return builder.String()
}

func isExplicitMachinePrivateReference(value string) bool {
	trimmed := strings.TrimSpace(value)
	lower := strings.ToLower(trimmed)
	return strings.HasPrefix(lower, "file://") ||
		strings.HasPrefix(lower, "local-asset:") ||
		strings.HasPrefix(lower, "local_asset:")
}

func requireExactNonEmpty(name string, value string) error {
	if value == "" || strings.TrimSpace(value) != value {
		return fmt.Errorf("%s must be non-empty canonical text", name)
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return fmt.Errorf("%s must not contain control characters", name)
		}
	}
	return nil
}
