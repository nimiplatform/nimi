// @nimi-authority: rule.nimi.runtime.ai-provider.r006

package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const cloudResolvedAssemblyVersion = 2

const (
	cloudResolvedRequestText          = "text.generate"
	cloudResolvedRequestEmbed         = "text.embed"
	cloudResolvedRequestMedia         = "media"
	cloudResolvedRequestVoiceWorkflow = "voice.create"
)

// cloudResolvedAssembly is the secret-free, durable Cloud counterpart of the
// Local ResolvedAssembly. It contains every immutable dispatch input and only
// an exact Connector custody record; credential material stays in the
// request-scoped Remote ExecutionHost opening point.
type cloudResolvedAssembly struct {
	Version              int                                   `json:"version"`
	RequestKind          string                                `json:"request_kind"`
	CapabilityContract   string                                `json:"capability_contract"`
	Implementation       json.RawMessage                       `json:"implementation"`
	ProviderModelTarget  json.RawMessage                       `json:"provider_model_target"`
	Connector            connector.ConnectorRecord             `json:"connector"`
	CredentialCustodyRef string                                `json:"credential_custody_ref"`
	Defaults             json.RawMessage                       `json:"defaults,omitempty"`
	Request              json.RawMessage                       `json:"request"`
	ExecutionMode        runtimev1.ExecutionMode               `json:"execution_mode"`
	MediaStreamMode      capabilitydriver.CloudMediaStreamMode `json:"media_stream_mode,omitempty"`
	TraceID              string                                `json:"trace_id"`
	AppID                string                                `json:"app_id"`
	AccountID            string                                `json:"account_id"`
	VoiceWorkflow        *cloudVoiceWorkflowCapture            `json:"voice_workflow,omitempty"`
}

type cloudVoiceWorkflowCapture struct {
	Provider                      string          `json:"provider"`
	ModelID                       string          `json:"model_id"`
	APIModelID                    string          `json:"api_model_id"`
	WorkflowType                  string          `json:"workflow_type"`
	WorkflowModelID               string          `json:"workflow_model_id"`
	WorkflowFamily                string          `json:"workflow_family,omitempty"`
	OutputPersistence             string          `json:"output_persistence"`
	HandlePolicyID                string          `json:"handle_policy_id,omitempty"`
	HandlePolicyPersistence       string          `json:"handle_policy_persistence,omitempty"`
	HandlePolicyScope             string          `json:"handle_policy_scope,omitempty"`
	HandlePolicyDefaultTTL        string          `json:"handle_policy_default_ttl,omitempty"`
	HandlePolicyDeleteSemantics   string          `json:"handle_policy_delete_semantics,omitempty"`
	RuntimeReconciliationRequired bool            `json:"runtime_reconciliation_required,omitempty"`
	Extensions                    json.RawMessage `json:"extensions,omitempty"`
}

func newCloudResolvedAssembly(
	requestKind string,
	capabilityContract string,
	implementation *runtimev1.CapabilityImplementationIdentity,
	providerModelTarget *structpb.Struct,
	connectorRecord connector.ConnectorRecord,
	defaults *structpb.Struct,
	request proto.Message,
	mode runtimev1.ExecutionMode,
	mediaStreamMode capabilitydriver.CloudMediaStreamMode,
	traceID string,
	appID string,
	accountID string,
	voice *cloudVoiceWorkflowCapture,
) (*cloudResolvedAssembly, error) {
	marshal := func(name string, message proto.Message, optional bool) (json.RawMessage, error) {
		if message == nil {
			if optional {
				return nil, nil
			}
			return nil, fmt.Errorf("Cloud ResolvedAssembly %s is required", name)
		}
		raw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(message)
		if err != nil {
			return nil, fmt.Errorf("marshal Cloud ResolvedAssembly %s: %w", name, err)
		}
		var compact bytes.Buffer
		if err := json.Compact(&compact, raw); err != nil {
			return nil, fmt.Errorf("compact Cloud ResolvedAssembly %s: %w", name, err)
		}
		return append(json.RawMessage(nil), compact.Bytes()...), nil
	}
	implementationRaw, err := marshal("implementation", implementation, false)
	if err != nil {
		return nil, err
	}
	targetRaw, err := marshal("provider-model target", providerModelTarget, false)
	if err != nil {
		return nil, err
	}
	defaultsRaw, err := marshal("defaults", defaults, true)
	if err != nil {
		return nil, err
	}
	requestRaw, err := marshal("request", request, false)
	if err != nil {
		return nil, err
	}
	assembly := &cloudResolvedAssembly{
		Version: cloudResolvedAssemblyVersion, RequestKind: strings.TrimSpace(requestKind),
		CapabilityContract: strings.TrimSpace(capabilityContract), Implementation: implementationRaw,
		ProviderModelTarget: targetRaw, Connector: connectorRecord, Defaults: defaultsRaw,
		Request: requestRaw, ExecutionMode: mode, MediaStreamMode: mediaStreamMode, TraceID: strings.TrimSpace(traceID),
		AppID: strings.TrimSpace(appID), AccountID: strings.TrimSpace(accountID), VoiceWorkflow: voice,
	}
	if err := validateCloudResolvedAssemblyDraft(assembly); err != nil {
		return nil, err
	}
	return assembly, nil
}

func cloneCloudResolvedAssembly(input *cloudResolvedAssembly) (*cloudResolvedAssembly, error) {
	if input == nil {
		return nil, nil
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	var out cloudResolvedAssembly
	if err := decodeScenarioJobStrictJSON(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func validateCloudResolvedAssembly(assembly *cloudResolvedAssembly) error {
	if err := validateCloudResolvedAssemblyDraft(assembly); err != nil {
		return err
	}
	if strings.TrimSpace(assembly.CredentialCustodyRef) == "" {
		return fmt.Errorf("Cloud ResolvedAssembly credential custody reference is incomplete")
	}
	return nil
}

func validateCloudResolvedAssemblyDraft(assembly *cloudResolvedAssembly) error {
	if assembly == nil || assembly.Version != cloudResolvedAssemblyVersion {
		return fmt.Errorf("Cloud ResolvedAssembly version is invalid")
	}
	switch assembly.RequestKind {
	case cloudResolvedRequestText, cloudResolvedRequestEmbed, cloudResolvedRequestMedia, cloudResolvedRequestVoiceWorkflow:
	default:
		return fmt.Errorf("Cloud ResolvedAssembly request kind is invalid")
	}
	switch assembly.ExecutionMode {
	case runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB:
	default:
		return fmt.Errorf("Cloud ResolvedAssembly execution mode is invalid")
	}
	if assembly.RequestKind == cloudResolvedRequestEmbed && assembly.ExecutionMode != runtimev1.ExecutionMode_EXECUTION_MODE_SYNC {
		return fmt.Errorf("Cloud embedding ResolvedAssembly execution mode is invalid")
	}
	if assembly.RequestKind == cloudResolvedRequestVoiceWorkflow && assembly.ExecutionMode != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		return fmt.Errorf("Cloud voice ResolvedAssembly execution mode is invalid")
	}
	if assembly.RequestKind != cloudResolvedRequestMedia {
		if assembly.MediaStreamMode != capabilitydriver.CloudMediaStreamNone {
			return fmt.Errorf("non-media Cloud ResolvedAssembly cannot contain media stream behavior")
		}
	} else if assembly.ExecutionMode == runtimev1.ExecutionMode_EXECUTION_MODE_STREAM {
		if assembly.CapabilityContract != capabilitydriver.AudioSynthesizeContract ||
			(assembly.MediaStreamMode != capabilitydriver.CloudMediaStreamNative &&
				assembly.MediaStreamMode != capabilitydriver.CloudMediaStreamSimulated) {
			return fmt.Errorf("streaming Cloud media ResolvedAssembly has invalid stream behavior")
		}
	} else if assembly.MediaStreamMode != capabilitydriver.CloudMediaStreamNone {
		return fmt.Errorf("non-streaming Cloud media ResolvedAssembly cannot contain stream behavior")
	}
	expectedRequestKind := cloudResolvedRequestMedia
	switch assembly.CapabilityContract {
	case capabilitydriver.LlamaCapabilityContract:
		expectedRequestKind = cloudResolvedRequestText
	case capabilitydriver.TextEmbedCapabilityContract:
		expectedRequestKind = cloudResolvedRequestEmbed
	case capabilitydriver.VoiceCreateContract:
		expectedRequestKind = cloudResolvedRequestVoiceWorkflow
	}
	if assembly.RequestKind != expectedRequestKind {
		return fmt.Errorf("Cloud ResolvedAssembly request kind and capability are mismatched")
	}
	if strings.TrimSpace(assembly.CapabilityContract) == "" || strings.TrimSpace(assembly.TraceID) == "" ||
		strings.TrimSpace(assembly.AppID) == "" || strings.TrimSpace(assembly.AccountID) == "" ||
		strings.TrimSpace(assembly.Connector.ConnectorID) == "" || assembly.Connector.OwnerID != strings.TrimSpace(assembly.AccountID) ||
		assembly.Connector.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER ||
		assembly.Connector.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		assembly.Connector.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE || !assembly.Connector.HasCredential ||
		!json.Valid(assembly.Implementation) || !json.Valid(assembly.ProviderModelTarget) || !json.Valid(assembly.Request) {
		return fmt.Errorf("Cloud ResolvedAssembly identity or payload is incomplete")
	}
	implementation := &runtimev1.CapabilityImplementationIdentity{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Implementation, implementation); err != nil ||
		strings.TrimSpace(implementation.GetImplementationId()) == "" || strings.TrimSpace(implementation.GetDriverId()) == "" ||
		strings.TrimSpace(implementation.GetDriverDialect()) == "" {
		return fmt.Errorf("Cloud ResolvedAssembly implementation is invalid")
	}
	target := &structpb.Struct{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.ProviderModelTarget, target); err != nil || len(target.GetFields()) == 0 {
		return fmt.Errorf("Cloud ResolvedAssembly provider-model target is invalid")
	}
	provider := strings.TrimSpace(target.GetFields()["provider"].GetStringValue())
	providerModelID := strings.TrimSpace(target.GetFields()["providerModelId"].GetStringValue())
	remoteModelCatalogID := strings.TrimSpace(target.GetFields()["remoteModelCatalogId"].GetStringValue())
	if provider == "" || providerModelID == "" || remoteModelCatalogID == "" || provider != assembly.Connector.Provider {
		return fmt.Errorf("Cloud ResolvedAssembly Connector provider is mismatched")
	}
	if len(assembly.Defaults) > 0 {
		defaults := &structpb.Struct{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Defaults, defaults); err != nil {
			return fmt.Errorf("Cloud ResolvedAssembly defaults are invalid")
		}
	}
	if assembly.RequestKind != cloudResolvedRequestVoiceWorkflow && assembly.VoiceWorkflow != nil {
		return fmt.Errorf("non-voice Cloud ResolvedAssembly cannot contain a voice workflow capture")
	}
	if assembly.RequestKind == cloudResolvedRequestVoiceWorkflow {
		voice := assembly.VoiceWorkflow
		if voice == nil {
			return fmt.Errorf("Cloud voice ResolvedAssembly workflow capture is required")
		}
		workflowType := strings.TrimSpace(voice.WorkflowType)
		outputPersistence := strings.TrimSpace(voice.OutputPersistence)
		if strings.TrimSpace(voice.Provider) != provider || strings.TrimSpace(voice.ModelID) != providerModelID ||
			strings.TrimSpace(voice.WorkflowModelID) == "" ||
			(workflowType != "reference_audio" && workflowType != "text_description") ||
			(outputPersistence != "provider_persistent" && outputPersistence != "session_ephemeral") {
			return fmt.Errorf("Cloud voice ResolvedAssembly workflow identity is invalid")
		}
		if len(voice.Extensions) > 0 {
			extensions := &structpb.Struct{}
			if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(voice.Extensions, extensions); err != nil {
				return fmt.Errorf("Cloud voice ResolvedAssembly workflow extensions are invalid")
			}
		}
	}
	if err := validateCloudResolvedAssemblyRequest(assembly); err != nil {
		return err
	}
	return nil
}

func validateCloudResolvedAssemblyRequest(assembly *cloudResolvedAssembly) error {
	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
	switch assembly.RequestKind {
	case cloudResolvedRequestText:
		request := &runtimev1.TextGenerateScenarioSpec{}
		if err := unmarshal.Unmarshal(assembly.Request, request); err != nil {
			return fmt.Errorf("Cloud text ResolvedAssembly request is invalid")
		}
		if len(request.GetInput()) == 0 && strings.TrimSpace(request.GetSystemPrompt()) == "" {
			return fmt.Errorf("Cloud text ResolvedAssembly request is empty")
		}
	case cloudResolvedRequestEmbed:
		request := &runtimev1.TextEmbedScenarioSpec{}
		if err := unmarshal.Unmarshal(assembly.Request, request); err != nil || len(request.GetInputs()) == 0 {
			return fmt.Errorf("Cloud embedding ResolvedAssembly request is invalid")
		}
		for _, input := range request.GetInputs() {
			if strings.TrimSpace(input) == "" {
				return fmt.Errorf("Cloud embedding ResolvedAssembly request contains an empty input")
			}
		}
	case cloudResolvedRequestMedia, cloudResolvedRequestVoiceWorkflow:
		request := &runtimev1.SubmitScenarioJobRequest{}
		if err := unmarshal.Unmarshal(assembly.Request, request); err != nil || request.GetHead() == nil || request.GetSpec() == nil {
			return fmt.Errorf("Cloud media ResolvedAssembly request is invalid")
		}
		if strings.TrimSpace(request.GetHead().GetAppId()) != assembly.AppID ||
			strings.TrimSpace(request.GetHead().GetSubjectUserId()) != assembly.AccountID ||
			request.GetExecutionMode() != assembly.ExecutionMode ||
			scenarioTargetCapability(request.GetScenarioType()) != assembly.CapabilityContract {
			return fmt.Errorf("Cloud media ResolvedAssembly request identity is mismatched")
		}
		if err := validateScenarioExecutionMode(request.GetScenarioType(), request.GetExecutionMode()); err != nil {
			return fmt.Errorf("Cloud media ResolvedAssembly request mode is invalid")
		}
		if assembly.RequestKind == cloudResolvedRequestVoiceWorkflow {
			if request.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE ||
				workflowTypeFromScenarioSpec(request.GetSpec()) != strings.TrimSpace(assembly.VoiceWorkflow.WorkflowType) {
				return fmt.Errorf("Cloud voice ResolvedAssembly request and workflow are mismatched")
			}
		} else if request.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE {
			return fmt.Errorf("Cloud media ResolvedAssembly cannot contain a voice request")
		}
	default:
		return fmt.Errorf("Cloud ResolvedAssembly request kind is invalid")
	}
	return nil
}

func validateScenarioJobCapturedInputsPair(job *runtimev1.ScenarioJob, local *localResolvedAssembly, cloud *cloudResolvedAssembly) error {
	if job == nil {
		return fmt.Errorf("ScenarioJob is required")
	}
	if local != nil && cloud != nil {
		return fmt.Errorf("ScenarioJob cannot contain both Local and Cloud resolved inputs")
	}
	if err := validateScenarioJobResolvedAssemblyPair(job, local); err != nil {
		return err
	}
	if cloud != nil {
		if isTerminalScenarioJobStatus(job.GetStatus()) && strings.TrimSpace(cloud.CredentialCustodyRef) == "" {
			if err := validateCloudResolvedAssemblyDraft(cloud); err != nil {
				return err
			}
		} else {
			if err := validateCloudResolvedAssembly(cloud); err != nil {
				return err
			}
			if err := connector.ValidateCredentialCustodyRefForJob(cloud.CredentialCustodyRef, job.GetJobId()); err != nil {
				return fmt.Errorf("Cloud ResolvedAssembly credential custody reference is invalid: %w", err)
			}
		}
	}
	if job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		if cloud != nil {
			return fmt.Errorf("non-Cloud ScenarioJob cannot contain Cloud resolved inputs")
		}
		return nil
	}
	if cloud == nil {
		return fmt.Errorf("Cloud ScenarioJob requires complete private Cloud ResolvedAssembly")
	}
	if strings.TrimSpace(job.GetTraceId()) != cloud.TraceID {
		return fmt.Errorf("Cloud ScenarioJob trace identity does not match private Cloud ResolvedAssembly")
	}
	if strings.TrimSpace(job.GetHead().GetAppId()) != cloud.AppID {
		return fmt.Errorf("Cloud ScenarioJob App identity does not match private Cloud ResolvedAssembly")
	}
	if strings.TrimSpace(job.GetHead().GetSubjectUserId()) != cloud.AccountID {
		return fmt.Errorf("Cloud ScenarioJob account identity does not match private Cloud ResolvedAssembly")
	}
	if job.GetExecutionMode() != cloud.ExecutionMode {
		return fmt.Errorf("Cloud ScenarioJob execution mode does not match private Cloud ResolvedAssembly")
	}
	if scenarioTargetCapability(job.GetScenarioType()) != cloud.CapabilityContract {
		return fmt.Errorf("Cloud ScenarioJob capability does not match private Cloud ResolvedAssembly")
	}
	target, err := cloud.providerTargetProto()
	if err != nil || strings.TrimSpace(job.GetModelResolved()) != strings.TrimSpace(target.GetFields()["providerModelId"].GetStringValue()) {
		return fmt.Errorf("Cloud ScenarioJob model attribution does not match private Cloud ResolvedAssembly")
	}
	return nil
}

func (assembly *cloudResolvedAssembly) implementationProto() (*runtimev1.CapabilityImplementationIdentity, error) {
	value := &runtimev1.CapabilityImplementationIdentity{}
	if assembly == nil {
		return nil, fmt.Errorf("Cloud ResolvedAssembly is required")
	}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Implementation, value); err != nil {
		return nil, err
	}
	return value, nil
}

func (assembly *cloudResolvedAssembly) providerTargetProto() (*structpb.Struct, error) {
	value := &structpb.Struct{}
	if assembly == nil {
		return nil, fmt.Errorf("Cloud ResolvedAssembly is required")
	}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.ProviderModelTarget, value); err != nil {
		return nil, err
	}
	return value, nil
}

func (assembly *cloudResolvedAssembly) defaultsProto() (*structpb.Struct, error) {
	if assembly == nil || len(assembly.Defaults) == 0 {
		return nil, nil
	}
	value := &structpb.Struct{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Defaults, value); err != nil {
		return nil, err
	}
	return value, nil
}

func (capture *cloudVoiceWorkflowCapture) resolution() catalog.ResolveVoiceWorkflowResult {
	if capture == nil {
		return catalog.ResolveVoiceWorkflowResult{}
	}
	return catalog.ResolveVoiceWorkflowResult{
		Provider: capture.Provider, ModelID: capture.ModelID, APIModelID: capture.APIModelID,
		WorkflowType: capture.WorkflowType, WorkflowModelID: capture.WorkflowModelID,
		WorkflowFamily: capture.WorkflowFamily, OutputPersistence: capture.OutputPersistence,
		HandlePolicyID: capture.HandlePolicyID, HandlePolicyPersistence: capture.HandlePolicyPersistence,
		HandlePolicyScope: capture.HandlePolicyScope, HandlePolicyDefaultTTL: capture.HandlePolicyDefaultTTL,
		HandlePolicyDeleteSemantics:   capture.HandlePolicyDeleteSemantics,
		RuntimeReconciliationRequired: capture.RuntimeReconciliationRequired,
	}
}

func cloneConnectorRecord(input connector.ConnectorRecord) connector.ConnectorRecord { return input }
