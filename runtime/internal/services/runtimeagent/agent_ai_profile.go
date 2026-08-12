package runtimeagent

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"google.golang.org/protobuf/types/known/structpb"
)

var errPortableAIProfileInvalid = errors.New("portable AIProfile is invalid")

var portableAIProfileForbiddenKeys = map[string]struct{}{
	"connectorgrantid": {}, "connectorgrant": {}, "grantid": {}, "connectorid": {}, "connector": {},
	"accountid": {}, "account": {}, "subjectuserid": {}, "owneruserid": {}, "localassetid": {},
	"localassetpath": {}, "binding": {}, "bindings": {}, "exactbinding": {}, "exactbindings": {},
	"path": {}, "filepath": {}, "secret": {}, "secrets": {}, "credential": {}, "credentials": {},
	"credentialpayload": {}, "apikey": {}, "accesstoken": {}, "refreshtoken": {}, "oauthtoken": {},
	"endpoint": {}, "endpointurl": {}, "baseurl": {}, "runtimeprocessid": {}, "jobid": {},
}

type portableAIProfileCapability struct {
	route               string
	requiredFeatures    []string
	defaults            *structpb.Struct
	implementation      *runtimev1.CapabilityImplementationIdentity
	providerModelTarget *structpb.Struct
}

type portableAIProfile struct {
	capabilities map[string]portableAIProfileCapability
}

// sharedLocalAgentAIConfigFromProfile parses the same closed portable
// AIProfile document admitted by the TypeScript SDK, projects consumer intent
// only, and canonicalizes the resulting singular shared-owner AIConfig. Local
// implementation and resource recommendations are validated but never become
// a model, binding, or machine selection.
func sharedLocalAgentAIConfigFromProfile(raw []byte) (*runtimev1.AIConfig, error) {
	profile, err := parsePortableAIProfile(raw)
	if err != nil {
		return nil, err
	}
	contracts := make([]string, 0, len(profile.capabilities))
	for contract := range profile.capabilities {
		contracts = append(contracts, contract)
	}
	sort.Strings(contracts)
	capabilities := make([]*runtimev1.AIConfigCapabilityIntent, 0, len(contracts))
	for _, contract := range contracts {
		capability := profile.capabilities[contract]
		intent := &runtimev1.AIConfigCapabilityIntent{
			CapabilityContract: contract,
			RequiredFeatures:   append([]string(nil), capability.requiredFeatures...),
			Defaults:           capability.defaults,
		}
		switch capability.route {
		case "local":
			intent.Route = &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}}
		case "cloud":
			intent.Route = &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
				Implementation:      capability.implementation,
				ProviderModelTarget: capability.providerModelTarget,
			}}
		default:
			return nil, errPortableAIProfileInvalid
		}
		capabilities = append(capabilities, intent)
	}
	canonical, err := aiconfig.Canonicalize(&runtimev1.AIConfig{
		Owner:        aiconfig.LocalAgentSubsystemOwner(),
		Capabilities: capabilities,
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errPortableAIProfileInvalid, err)
	}
	return canonical, nil
}

func parsePortableAIProfile(raw []byte) (*portableAIProfile, error) {
	if len(bytes.TrimSpace(raw)) == 0 || !utf8.Valid(raw) {
		return nil, errPortableAIProfileInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, errPortableAIProfileInvalid
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errPortableAIProfileInvalid
	}
	root, ok := value.(map[string]any)
	if !ok {
		return nil, errPortableAIProfileInvalid
	}
	if err := requirePortableExactKeys(root, []string{
		"profileId", "title", "description", "capabilities", "provenance", "license", "displayMetadata",
	}); err != nil {
		return nil, err
	}
	if err := validatePortableAIProfileValue(root); err != nil {
		return nil, err
	}
	if _, err := requirePortableText(root["profileId"]); err != nil {
		return nil, err
	}
	if _, err := requirePortableText(root["title"]); err != nil {
		return nil, err
	}
	if value, present := root["description"]; present {
		if _, err := requirePortableExactText(value); err != nil {
			return nil, err
		}
	}
	for _, key := range []string{"provenance", "displayMetadata"} {
		if value, present := root[key]; present {
			if _, ok := value.(map[string]any); !ok {
				return nil, errPortableAIProfileInvalid
			}
		}
	}
	capabilityRecord, ok := root["capabilities"].(map[string]any)
	if !ok || len(capabilityRecord) == 0 {
		return nil, errPortableAIProfileInvalid
	}
	contracts := make([]string, 0, len(capabilityRecord))
	for contract := range capabilityRecord {
		contracts = append(contracts, contract)
	}
	sort.Strings(contracts)
	profile := &portableAIProfile{capabilities: make(map[string]portableAIProfileCapability, len(contracts))}
	for _, rawContract := range contracts {
		contract, err := requirePortableText(rawContract)
		if err != nil {
			return nil, err
		}
		record, ok := capabilityRecord[rawContract].(map[string]any)
		if !ok {
			return nil, errPortableAIProfileInvalid
		}
		if err := requirePortableExactKeys(record, []string{
			"route", "requiredFeatures", "defaults", "implementation", "driverPortableConfig", "resourceOccurrences", "providerModelTarget",
		}); err != nil {
			return nil, err
		}
		route, err := requirePortableText(record["route"])
		if err != nil {
			return nil, err
		}
		requiredFeatures, err := parsePortableFeatureSet(record, "requiredFeatures", false)
		if err != nil {
			return nil, err
		}
		var defaults *structpb.Struct
		if value, present := record["defaults"]; present {
			defaults, err = portableStruct(value)
			if err != nil {
				return nil, err
			}
		}
		capability := portableAIProfileCapability{
			route:            route,
			requiredFeatures: requiredFeatures,
			defaults:         defaults,
		}
		switch route {
		case "local":
			if _, present := record["providerModelTarget"]; present {
				return nil, errPortableAIProfileInvalid
			}
			if value, present := record["implementation"]; present {
				capability.implementation, err = parsePortableImplementation(value, requiredFeatures)
				if err != nil {
					return nil, err
				}
			}
			_, driverConfigPresent := record["driverPortableConfig"]
			if driverConfigPresent {
				if _, err := portableStruct(record["driverPortableConfig"]); err != nil {
					return nil, err
				}
			}
			resourceCount := 0
			if value, present := record["resourceOccurrences"]; present {
				resourceCount, err = validatePortableResourceOccurrences(value)
				if err != nil {
					return nil, err
				}
			}
			if capability.implementation == nil && (driverConfigPresent || resourceCount > 0) {
				return nil, errPortableAIProfileInvalid
			}
		case "cloud":
			if _, present := record["driverPortableConfig"]; present {
				return nil, errPortableAIProfileInvalid
			}
			if _, present := record["resourceOccurrences"]; present {
				return nil, errPortableAIProfileInvalid
			}
			capability.providerModelTarget, err = portableStruct(record["providerModelTarget"])
			if err != nil || len(capability.providerModelTarget.GetFields()) == 0 {
				return nil, errPortableAIProfileInvalid
			}
			if err := validatePortableCloudTarget(capability.providerModelTarget); err != nil {
				return nil, err
			}
			capability.implementation, err = parsePortableImplementation(record["implementation"], requiredFeatures)
			if err != nil {
				return nil, err
			}
		default:
			return nil, errPortableAIProfileInvalid
		}
		profile.capabilities[contract] = capability
	}
	return profile, nil
}

func validatePortableCloudTarget(target *structpb.Struct) error {
	if target == nil {
		return errPortableAIProfileInvalid
	}
	if _, exists := target.GetFields()["model"]; exists {
		return errPortableAIProfileInvalid
	}
	for _, key := range []string{"provider", "providerModelId", "remoteModelCatalogId"} {
		value := target.GetFields()[key].GetStringValue()
		if value == "" || strings.TrimSpace(value) != value {
			return errPortableAIProfileInvalid
		}
	}
	return nil
}

func parsePortableImplementation(value any, requiredFeatures []string) (*runtimev1.CapabilityImplementationIdentity, error) {
	record, ok := value.(map[string]any)
	if !ok {
		return nil, errPortableAIProfileInvalid
	}
	if err := requirePortableExactKeys(record, []string{"implementationId", "driverId", "driverDialect", "supportedFeatures"}); err != nil {
		return nil, err
	}
	supportedFeatures, err := parsePortableFeatureSet(record, "supportedFeatures", true)
	if err != nil {
		return nil, err
	}
	supported := make(map[string]struct{}, len(supportedFeatures))
	for _, feature := range supportedFeatures {
		supported[feature] = struct{}{}
	}
	for _, feature := range requiredFeatures {
		if _, ok := supported[feature]; !ok {
			return nil, errPortableAIProfileInvalid
		}
	}
	implementationID, err := requirePortableText(record["implementationId"])
	if err != nil {
		return nil, err
	}
	driverID, err := requirePortableText(record["driverId"])
	if err != nil {
		return nil, err
	}
	driverDialect, err := requirePortableText(record["driverDialect"])
	if err != nil {
		return nil, err
	}
	return &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: implementationID,
		DriverId:         driverID,
		DriverDialect:    driverDialect,
	}, nil
}

func parsePortableFeatureSet(record map[string]any, key string, required bool) ([]string, error) {
	value, present := record[key]
	if !present {
		if required {
			return nil, errPortableAIProfileInvalid
		}
		return []string{}, nil
	}
	items, ok := value.([]any)
	if !ok {
		return nil, errPortableAIProfileInvalid
	}
	features := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		feature, err := requirePortableText(item)
		if err != nil {
			return nil, err
		}
		if _, duplicate := seen[feature]; duplicate {
			return nil, errPortableAIProfileInvalid
		}
		seen[feature] = struct{}{}
		features = append(features, feature)
	}
	sort.Strings(features)
	return features, nil
}

func validatePortableResourceOccurrences(value any) (int, error) {
	items, ok := value.([]any)
	if !ok {
		return 0, errPortableAIProfileInvalid
	}
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			return 0, errPortableAIProfileInvalid
		}
		occurrenceID, err := requirePortableText(record["occurrenceId"])
		if err != nil {
			return 0, err
		}
		if _, duplicate := seen[occurrenceID]; duplicate {
			return 0, errPortableAIProfileInvalid
		}
		seen[occurrenceID] = struct{}{}
	}
	return len(items), nil
}

func validatePortableAIProfileValue(value any) error {
	switch typed := value.(type) {
	case nil, bool:
		return nil
	case string:
		if portableAIProfileStringIsPath(typed) {
			return errPortableAIProfileInvalid
		}
		return nil
	case json.Number:
		number, _ := strconv.ParseFloat(typed.String(), 64)
		if math.IsNaN(number) || math.IsInf(number, 0) {
			return errPortableAIProfileInvalid
		}
		return nil
	case []any:
		for _, child := range typed {
			if err := validatePortableAIProfileValue(child); err != nil {
				return err
			}
		}
		return nil
	case map[string]any:
		for key, child := range typed {
			if portableAIProfileUnsafeKey(key) || portableAIProfileForbiddenKey(key) {
				return errPortableAIProfileInvalid
			}
			if err := validatePortableAIProfileValue(child); err != nil {
				return err
			}
		}
		return nil
	default:
		return errPortableAIProfileInvalid
	}
}

func portableAIProfileForbiddenKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
	if _, forbidden := portableAIProfileForbiddenKeys[normalized]; forbidden {
		return true
	}
	return strings.HasSuffix(normalized, "path") ||
		strings.HasSuffix(normalized, "bindingid") ||
		strings.Contains(normalized, "connectorgrant") ||
		strings.HasSuffix(normalized, "connectorid") ||
		strings.HasSuffix(normalized, "accountid") ||
		strings.Contains(normalized, "localasset")
}

func portableAIProfileUnsafeKey(key string) bool {
	return key == "__proto__" || key == "constructor" || key == "prototype"
}

func portableAIProfileStringIsPath(value string) bool {
	trimmed := trimJavaScriptWhitespace(value)
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, "~/") || strings.HasPrefix(lower, "file://") {
		return true
	}
	return len(trimmed) >= 3 && ((trimmed[0] >= 'A' && trimmed[0] <= 'Z') || (trimmed[0] >= 'a' && trimmed[0] <= 'z')) &&
		trimmed[1] == ':' && (trimmed[2] == '/' || trimmed[2] == '\\')
}

func portableStruct(value any) (*structpb.Struct, error) {
	record, ok := value.(map[string]any)
	if !ok {
		return nil, errPortableAIProfileInvalid
	}
	normalized, err := portableStructValue(record)
	if err != nil {
		return nil, err
	}
	out, err := structpb.NewStruct(normalized.(map[string]any))
	if err != nil {
		return nil, errPortableAIProfileInvalid
	}
	return out, nil
}

func portableStructValue(value any) (any, error) {
	switch typed := value.(type) {
	case nil, bool, string:
		return typed, nil
	case json.Number:
		number, _ := strconv.ParseFloat(typed.String(), 64)
		if math.IsNaN(number) || math.IsInf(number, 0) {
			return nil, errPortableAIProfileInvalid
		}
		return number, nil
	case []any:
		out := make([]any, len(typed))
		for index, child := range typed {
			converted, err := portableStructValue(child)
			if err != nil {
				return nil, err
			}
			out[index] = converted
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, child := range typed {
			converted, err := portableStructValue(child)
			if err != nil {
				return nil, err
			}
			out[key] = converted
		}
		return out, nil
	default:
		return nil, errPortableAIProfileInvalid
	}
}

func requirePortableExactKeys(record map[string]any, allowed []string) error {
	admitted := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		admitted[key] = struct{}{}
	}
	for key := range record {
		if _, ok := admitted[key]; !ok {
			return errPortableAIProfileInvalid
		}
	}
	return nil
}

func requirePortableText(value any) (string, error) {
	text, ok := value.(string)
	if !ok || text == "" || trimJavaScriptWhitespace(text) != text {
		return "", errPortableAIProfileInvalid
	}
	return text, nil
}

func requirePortableExactText(value any) (string, error) {
	text, ok := value.(string)
	if !ok || trimJavaScriptWhitespace(text) != text {
		return "", errPortableAIProfileInvalid
	}
	return text, nil
}

func trimJavaScriptWhitespace(value string) string {
	return strings.TrimFunc(value, func(r rune) bool {
		switch r {
		case '\u0009', '\u000a', '\u000b', '\u000c', '\u000d', '\u0020', '\u00a0', '\u1680',
			'\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
			return true
		default:
			return r >= '\u2000' && r <= '\u200a'
		}
	})
}
