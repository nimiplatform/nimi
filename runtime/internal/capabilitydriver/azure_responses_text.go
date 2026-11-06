package capabilitydriver

import (
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

type AzureResponsesTextBehavior struct {
	model, version string
	profile        responsesProfile
}

func NewAzureResponsesTextBehavior(model string) (AzureResponsesTextBehavior, error) {
	versions := map[string]string{"gpt-6-astra": "2026-09-03", "gpt-6.1-sol": "2026-09-29", "gpt-6.1-terra": "2026-10-26", "gpt-6-luna": "2026-09-22"}
	version, ok := versions[model]
	if !ok {
		return AzureResponsesTextBehavior{}, deepseekUnsupported()
	}
	profile := responsesProfile{
		label: "Azure OpenAI Responses", continuityKind: "azure.responses.encrypted-reasoning." + model,
		outputLimit: true, namedToolChoice: true, parallelToolCalls: true, reasoningControls: true,
		reasoningDisabled: model == "gpt-6.1-terra" || model == "gpt-6-luna", jsonObject: true, samplingControls: true,
		failure: OpenAIResponsesFailure,
	}
	return AzureResponsesTextBehavior{model: model, version: version, profile: profile}, nil
}

func (p AzureResponsesTextBehavior) ContinuityKind() string { return p.profile.continuityKind }

// @nimi-authority: rule.nimi.runtime.ai-provider.azure-current-responses
func (p AzureResponsesTextBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	if p.model == "" {
		return textbehavior.SerializedRequest{}, deepseekUnsupported()
	}
	if spec.GetMaxTokens() > 128000 {
		return textbehavior.SerializedRequest{}, p.profile.inputError("Azure output limit")
	}
	return serializeResponsesRequest(&p.profile, spec)
}

func (p AzureResponsesTextBehavior) Parse(_ []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return textbehavior.NormalizedResult{}, p.profile.outputError("Azure Responses requires SSE delivery")
}
func (p AzureResponsesTextBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if p.model == "" {
		return nil, deepseekUnsupported()
	}
	return &azureResponsesModelStream{StreamFragmentAssembler: newResponsesStreamAssembler(&p.profile, spec), model: p.model, version: p.version}, nil
}

// Azure deployment names can be chosen independently of model names. Before
// exposing output, verify the native model claim against the selected cohort.
type azureResponsesModelStream struct {
	textbehavior.StreamFragmentAssembler
	model, version string
	confirmed      bool
}

func (s *azureResponsesModelStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(payload)) == "[DONE]" {
		return s.StreamFragmentAssembler.Append(payload)
	}
	var event struct {
		Type     string `json:"type"`
		Response *struct {
			Model string `json:"model"`
		} `json:"response"`
	}
	if json.Unmarshal(payload, &event) != nil {
		return nil, deepseekJSONOutputError()
	}
	if event.Response != nil && event.Response.Model != "" {
		if event.Response.Model != s.model && event.Response.Model != s.model+"-"+s.version {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, grpcerr.ReasonOptions{Message: "Azure deployment returned a different model", ActionHint: "configure_azure_model_deployment"})
		}
		s.confirmed = true
	}
	if event.Type == "response.created" || event.Type == "response.completed" {
		if event.Response == nil || event.Response.Model == "" {
			return nil, deepseekJSONOutputError()
		}
	}
	if !s.confirmed && event.Type != "error" && event.Type != "response.failed" && event.Type != "response.in_progress" && event.Type != "response.queued" {
		return nil, deepseekJSONOutputError()
	}
	return s.StreamFragmentAssembler.Append(payload)
}
