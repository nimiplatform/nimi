package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	// TypeSafeProviderID is the provider registry identity of TypeSafe.
	TypeSafeProviderID = "typesafe"
	// TypeSafeSystemOneDialect names the System One wire mapping owned by the
	// Cloud text.decide Driver.
	TypeSafeSystemOneDialect = "typesafe/systemone/v1"
	// typeSafeMaxChoiceOptions is System One's documented option bound.
	typeSafeMaxChoiceOptions = 255
)

// CloudDecideTarget is one exact provider/model target interpreted by a Cloud
// text.decide Driver. It contains no route, credential, endpoint, or Host
// facts.
type CloudDecideTarget struct {
	provider             string
	providerModelID      string
	remoteModelCatalogID string
}

func (t CloudDecideTarget) Provider() string             { return t.provider }
func (t CloudDecideTarget) ProviderModelID() string      { return t.providerModelID }
func (t CloudDecideTarget) RemoteModelCatalogID() string { return t.remoteModelCatalogID }

type cloudDecideQuestionLayout struct {
	id         string
	boolean    bool
	candidates []string
}

// CloudDecideMappedRequest is the immutable output of Driver request mapping:
// the exact provider wire body plus the submitted question layout that
// response normalization must match.
type CloudDecideMappedRequest struct {
	providerModelID string
	dialect         string
	body            []byte
	questions       []cloudDecideQuestionLayout
}

func (r *CloudDecideMappedRequest) ProviderModelID() string {
	if r == nil {
		return ""
	}
	return r.providerModelID
}

func (r *CloudDecideMappedRequest) Dialect() string {
	if r == nil {
		return ""
	}
	return r.dialect
}

// Body returns a copy of the exact provider request bytes.
func (r *CloudDecideMappedRequest) Body() []byte {
	if r == nil {
		return nil
	}
	return append([]byte(nil), r.body...)
}

// CloudDecideTransportResponse is the credential-free raw provider body
// returned by the Remote ExecutionHost before Driver normalization.
type CloudDecideTransportResponse struct {
	Body []byte
}

// CloudDecideResult is the Driver-normalized typed decision. Provider
// confidence, legend, model and raw response are never part of it.
type CloudDecideResult struct {
	Result *runtimev1.TextDecisionResult
	Usage  *runtimev1.UsageStats
}

// CloudDecideDriver owns target/config validation, request mapping, response
// normalization and reason normalization for Cloud text.decide. Route, Host
// lifecycle, retries and fallback are absent.
type CloudDecideDriver interface {
	ValidateTarget(Identity, *structpb.Struct) (CloudDecideTarget, error)
	MapRequest(CloudDecideTarget, *runtimev1.TextDecideScenarioSpec, *structpb.Struct) (*CloudDecideMappedRequest, error)
	NormalizeResponse(*CloudDecideMappedRequest, CloudDecideTransportResponse) (CloudDecideResult, error)
	NormalizeReason(error) error
}

// CloudDecideRegistry resolves an admitted provider decision dialect. It never
// sees Connector custody and cannot become an account or route selector.
type CloudDecideRegistry struct {
	drivers map[string]CloudDecideDriver
}

// NewProductionCloudDecideRegistry admits a Driver only for a remote provider
// whose catalog declares text.decide and whose wire dialect is implemented.
func NewProductionCloudDecideRegistry() *CloudDecideRegistry {
	drivers := make(map[string]CloudDecideDriver)
	for providerID, record := range providerregistry.Records {
		if record.RuntimePlane != "remote" || !record.SupportsDecide {
			continue
		}
		if providerID == TypeSafeProviderID {
			drivers[providerID] = typeSafeSystemOneDriver{provider: providerID}
		}
	}
	return &CloudDecideRegistry{drivers: drivers}
}

// Resolve validates one exact provider target through its admitted Driver.
func (r *CloudDecideRegistry) Resolve(identity Identity, rawTarget *structpb.Struct) (CloudDecideDriver, CloudDecideTarget, error) {
	provider, ok := exactCloudTargetText(rawTarget, "provider")
	if !ok || r == nil {
		return nil, CloudDecideTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud decision provider target is required"))
	}
	driver := r.drivers[provider]
	if driver == nil {
		return nil, CloudDecideTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud decision provider %q has no admitted Driver", provider))
	}
	target, err := driver.ValidateTarget(identity, rawTarget)
	if err != nil {
		return nil, CloudDecideTarget{}, err
	}
	return driver, target, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.typesafe-cloud-decision
// typeSafeSystemOneDriver maps text.decide exactly to TypeSafe System One:
// submitted order, IDs, text and JSON content are preserved and every answer
// must match the submitted question layout.
type typeSafeSystemOneDriver struct {
	provider string
}

func (d typeSafeSystemOneDriver) ValidateTarget(identity Identity, raw *structpb.Struct) (CloudDecideTarget, error) {
	if !exactCloudIdentity(identity) {
		return CloudDecideTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud decision implementation identity is incomplete"))
	}
	if raw == nil || len(raw.GetFields()) == 0 {
		return CloudDecideTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider decision target is required"))
	}
	for key := range raw.GetFields() {
		switch key {
		case "provider", "providerModelId", "remoteModelCatalogId":
		default:
			return CloudDecideTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("decision target field %q is unsupported", key))
		}
	}
	provider, ok := exactCloudTargetText(raw, "provider")
	if !ok || provider != d.provider {
		return CloudDecideTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider target does not match decision Driver"))
	}
	record, ok := providerregistry.Lookup(provider)
	if !ok || record.RuntimePlane != "remote" || !record.SupportsDecide {
		return CloudDecideTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider %q does not implement %s", provider, aicapabilities.TextDecide))
	}
	providerModelID, ok := exactCloudTargetText(raw, "providerModelId")
	if !ok {
		return CloudDecideTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider decision model identity is required"))
	}
	remoteModelCatalogID, ok := exactCloudTargetText(raw, "remoteModelCatalogId")
	if !ok {
		return CloudDecideTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("remote decision model catalog identity is required"))
	}
	return CloudDecideTarget{provider: provider, providerModelID: providerModelID, remoteModelCatalogID: remoteModelCatalogID}, nil
}

// MapRequest renders the System One body by hand so question and candidate
// order follow submission order and JSON content is embedded verbatim.
func (d typeSafeSystemOneDriver) MapRequest(target CloudDecideTarget, spec *runtimev1.TextDecideScenarioSpec, defaults *structpb.Struct) (*CloudDecideMappedRequest, error) {
	if target.provider != d.provider || target.providerModelID == "" {
		return nil, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud decision target is incomplete"))
	}
	if defaults != nil && len(defaults.GetFields()) > 0 {
		return nil, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("%s defaults are unsupported", aicapabilities.TextDecide))
	}
	if spec == nil || len(spec.GetQuestions()) == 0 {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("%s questions are required", aicapabilities.TextDecide))
	}
	var body bytes.Buffer
	body.WriteString(`{"state":`)
	if err := writeSystemOneContent(&body, spec.GetState(), true); err != nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("decision state: %w", err))
	}
	body.WriteString(`,"model":`)
	if err := writeSystemOneString(&body, target.providerModelID); err != nil {
		return nil, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("decision model: %w", err))
	}
	body.WriteString(`,"questions":{`)
	layouts := make([]cloudDecideQuestionLayout, 0, len(spec.GetQuestions()))
	questionIDs := make(map[string]struct{}, len(spec.GetQuestions()))
	for index, question := range spec.GetQuestions() {
		id := question.GetId()
		if !validSystemOneKey(id) {
			return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("decision question %d has an invalid id", index))
		}
		if _, duplicate := questionIDs[id]; duplicate {
			return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("decision question id is duplicated"))
		}
		questionIDs[id] = struct{}{}
		if index > 0 {
			body.WriteByte(',')
		}
		if err := writeSystemOneString(&body, id); err != nil {
			return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("decision question id: %w", err))
		}
		body.WriteByte(':')
		layout, err := writeSystemOneQuestion(&body, question)
		if err != nil {
			return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("decision question %d: %w", index, err))
		}
		layout.id = id
		layouts = append(layouts, layout)
	}
	body.WriteString(`}}`)
	if !json.Valid(body.Bytes()) {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("decision request body is not valid JSON"))
	}
	return &CloudDecideMappedRequest{
		providerModelID: target.providerModelID,
		dialect:         TypeSafeSystemOneDialect,
		body:            append([]byte(nil), body.Bytes()...),
		questions:       layouts,
	}, nil
}

func writeSystemOneQuestion(body *bytes.Buffer, question *runtimev1.TextDecisionQuestion) (cloudDecideQuestionLayout, error) {
	switch kind := question.GetKind().(type) {
	case *runtimev1.TextDecisionQuestion_Choice:
		candidates := kind.Choice.GetCandidates()
		if len(candidates) < 2 || len(candidates) > typeSafeMaxChoiceOptions {
			return cloudDecideQuestionLayout{}, fmt.Errorf("choice requires 2 to %d candidates", typeSafeMaxChoiceOptions)
		}
		body.WriteString(`{"type":"choice","instructions":`)
		if err := writeSystemOneContent(body, question.GetInstructions(), true); err != nil {
			return cloudDecideQuestionLayout{}, fmt.Errorf("instructions: %w", err)
		}
		body.WriteString(`,"criteria":{`)
		ids := make([]string, 0, len(candidates))
		seen := make(map[string]struct{}, len(candidates))
		for position, candidate := range candidates {
			id := candidate.GetId()
			if !validSystemOneKey(id) {
				return cloudDecideQuestionLayout{}, fmt.Errorf("candidate %d has an invalid id", position)
			}
			if _, duplicate := seen[id]; duplicate {
				return cloudDecideQuestionLayout{}, fmt.Errorf("candidate id is duplicated")
			}
			seen[id] = struct{}{}
			if position > 0 {
				body.WriteByte(',')
			}
			if err := writeSystemOneString(body, id); err != nil {
				return cloudDecideQuestionLayout{}, fmt.Errorf("candidate id: %w", err)
			}
			body.WriteByte(':')
			if err := writeSystemOneContent(body, candidate.GetDescription(), false); err != nil {
				return cloudDecideQuestionLayout{}, fmt.Errorf("candidate description: %w", err)
			}
			ids = append(ids, id)
		}
		body.WriteString(`}}`)
		return cloudDecideQuestionLayout{candidates: ids}, nil
	case *runtimev1.TextDecisionQuestion_Boolean:
		if kind.Boolean == nil {
			return cloudDecideQuestionLayout{}, fmt.Errorf("boolean question is empty")
		}
		body.WriteString(`{"type":"noul","instructions":`)
		if err := writeSystemOneContent(body, question.GetInstructions(), true); err != nil {
			return cloudDecideQuestionLayout{}, fmt.Errorf("instructions: %w", err)
		}
		trueCriterion, falseCriterion := kind.Boolean.GetTrueCriterion(), kind.Boolean.GetFalseCriterion()
		hasTrue, hasFalse := systemOneContentPresent(trueCriterion), systemOneContentPresent(falseCriterion)
		if hasTrue || hasFalse {
			body.WriteString(`,"criteria":{`)
			if hasTrue {
				body.WriteString(`"true":`)
				if err := writeSystemOneContent(body, trueCriterion, true); err != nil {
					return cloudDecideQuestionLayout{}, fmt.Errorf("true criterion: %w", err)
				}
			}
			if hasFalse {
				if hasTrue {
					body.WriteByte(',')
				}
				body.WriteString(`"false":`)
				if err := writeSystemOneContent(body, falseCriterion, true); err != nil {
					return cloudDecideQuestionLayout{}, fmt.Errorf("false criterion: %w", err)
				}
			}
			body.WriteByte('}')
		}
		body.WriteByte('}')
		return cloudDecideQuestionLayout{boolean: true}, nil
	default:
		return cloudDecideQuestionLayout{}, fmt.Errorf("question kind is required")
	}
}

func systemOneContentPresent(content *runtimev1.TextDecisionContent) bool {
	return content != nil && content.GetValue() != nil
}

// writeSystemOneContent writes text as one JSON string and JSON content as the
// submitted value byte for byte; absent optional content is null.
func writeSystemOneContent(body *bytes.Buffer, content *runtimev1.TextDecisionContent, required bool) error {
	if !systemOneContentPresent(content) {
		if required {
			return fmt.Errorf("content is required")
		}
		body.WriteString("null")
		return nil
	}
	switch value := content.GetValue().(type) {
	case *runtimev1.TextDecisionContent_Text:
		if value.Text == "" || !utf8.ValidString(value.Text) {
			return fmt.Errorf("text content is invalid")
		}
		return writeSystemOneString(body, value.Text)
	case *runtimev1.TextDecisionContent_Json:
		raw := []byte(value.Json)
		if !utf8.Valid(raw) || !json.Valid(raw) || !systemOneJSONContainer(raw) {
			return fmt.Errorf("JSON content must be one object or array")
		}
		body.Write(raw)
		return nil
	default:
		return fmt.Errorf("content kind is unsupported")
	}
}

func systemOneJSONContainer(raw []byte) bool {
	trimmed := bytes.TrimLeft(raw, " \t\r\n")
	return len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[')
}

func validSystemOneKey(value string) bool {
	return value != "" && utf8.ValidString(value)
}

// writeSystemOneString writes one JSON string without HTML escaping so the
// provider receives the submitted characters.
func writeSystemOneString(body *bytes.Buffer, value string) error {
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return err
	}
	body.Write(bytes.TrimSuffix(encoded.Bytes(), []byte("\n")))
	return nil
}

// NormalizeResponse accepts only a complete System One response whose answers
// match the submitted question IDs, types and candidate sets. Provider
// confidence, legend and model metadata are discarded.
func (typeSafeSystemOneDriver) NormalizeResponse(request *CloudDecideMappedRequest, response CloudDecideTransportResponse) (CloudDecideResult, error) {
	invalid := func(format string, args ...any) (CloudDecideResult, error) {
		return CloudDecideResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf(format, args...))
	}
	if request == nil || len(request.questions) == 0 {
		return invalid("decision response has no submitted question layout")
	}
	top, err := strictJSONObjectMembers(response.Body)
	if err != nil {
		return invalid("decision response is not one JSON object: %v", err)
	}
	answers, err := strictJSONObjectMembers(top["answers"])
	if err != nil {
		return invalid("decision response answers are invalid: %v", err)
	}
	if len(answers) != len(request.questions) {
		return invalid("decision response answers %d questions, want %d", len(answers), len(request.questions))
	}
	result := &runtimev1.TextDecisionResult{Answers: make([]*runtimev1.TextDecisionAnswer, 0, len(request.questions))}
	for _, question := range request.questions {
		rawAnswer, ok := answers[question.id]
		if !ok {
			return invalid("decision response omits a submitted question")
		}
		answer, err := strictJSONObjectMembers(rawAnswer)
		if err != nil {
			return invalid("decision answer is not an object: %v", err)
		}
		answerType, err := strictJSONString(answer["type"])
		if err != nil {
			return invalid("decision answer type is invalid: %v", err)
		}
		if question.boolean {
			if answerType != "noul" {
				return invalid("boolean question received a %q answer", answerType)
			}
			probability, err := strictJSONProbability(answer["noul"])
			if err != nil {
				return invalid("boolean answer probability is invalid: %v", err)
			}
			result.Answers = append(result.Answers, &runtimev1.TextDecisionAnswer{
				QuestionId: question.id,
				Result: &runtimev1.TextDecisionAnswer_Boolean{Boolean: &runtimev1.TextDecisionBooleanAnswer{
					TrueProbability: probability,
				}},
			})
			continue
		}
		if answerType != "choice" {
			return invalid("choice question received a %q answer", answerType)
		}
		selected, err := strictJSONString(answer["choice"])
		if err != nil {
			return invalid("choice answer selection is invalid: %v", err)
		}
		probabilities, err := strictJSONObjectMembers(answer["probabilities"])
		if err != nil {
			return invalid("choice answer probabilities are invalid: %v", err)
		}
		if len(probabilities) != len(question.candidates) {
			return invalid("choice answer covers %d candidates, want %d", len(probabilities), len(question.candidates))
		}
		ordered := make([]*runtimev1.TextDecisionCandidateProbability, 0, len(question.candidates))
		selectedSubmitted := false
		for _, candidate := range question.candidates {
			rawProbability, ok := probabilities[candidate]
			if !ok {
				return invalid("choice answer omits a submitted candidate")
			}
			probability, err := strictJSONProbability(rawProbability)
			if err != nil {
				return invalid("choice candidate probability is invalid: %v", err)
			}
			if candidate == selected {
				selectedSubmitted = true
			}
			ordered = append(ordered, &runtimev1.TextDecisionCandidateProbability{CandidateId: candidate, Probability: probability})
		}
		if !selectedSubmitted {
			return invalid("choice answer selects an unknown candidate")
		}
		result.Answers = append(result.Answers, &runtimev1.TextDecisionAnswer{
			QuestionId: question.id,
			Result: &runtimev1.TextDecisionAnswer_Choice{Choice: &runtimev1.TextDecisionChoiceAnswer{
				SelectedCandidateId: selected,
				Probabilities:       ordered,
			}},
		})
	}
	return CloudDecideResult{Result: result, Usage: systemOneUsage(top["usage"])}, nil
}

// systemOneUsage keeps only reported non-negative token counts. Malformed or
// absent usage yields no usage rather than an estimate.
func systemOneUsage(raw json.RawMessage) *runtimev1.UsageStats {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	members, err := strictJSONObjectMembers(raw)
	if err != nil {
		return nil
	}
	count := func(key string) (int64, bool, bool) {
		value, present := members[key]
		if !present {
			return 0, false, true
		}
		number, err := strictJSONNumber(value)
		if err != nil {
			return 0, true, false
		}
		parsed, err := strconv.ParseInt(number.String(), 10, 64)
		if err != nil || parsed < 0 {
			return 0, true, false
		}
		return parsed, true, true
	}
	input, inputPresent, inputValid := count("input_tokens")
	output, outputPresent, outputValid := count("output_tokens")
	if !inputValid || !outputValid || (!inputPresent && !outputPresent) {
		return nil
	}
	return &runtimev1.UsageStats{InputTokens: input, OutputTokens: output}
}

var errSystemOneJSON = errors.New("value does not match the System One response schema")

// strictJSONObjectMembers decodes exactly one JSON object with unique keys and
// no trailing data, keeping each member value as raw JSON.
func strictJSONObjectMembers(raw json.RawMessage) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	open, err := decoder.Token()
	if err != nil || open != json.Delim('{') {
		return nil, errSystemOneJSON
	}
	members := make(map[string]json.RawMessage)
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return nil, errSystemOneJSON
		}
		key, ok := keyToken.(string)
		if !ok {
			return nil, errSystemOneJSON
		}
		if _, duplicate := members[key]; duplicate {
			return nil, fmt.Errorf("duplicate object key")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, errSystemOneJSON
		}
		members[key] = value
	}
	if closing, err := decoder.Token(); err != nil || closing != json.Delim('}') {
		return nil, errSystemOneJSON
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, fmt.Errorf("trailing data after JSON object")
	}
	return members, nil
}

func strictJSONString(raw json.RawMessage) (string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '"' {
		return "", errSystemOneJSON
	}
	var value string
	if err := json.Unmarshal(trimmed, &value); err != nil {
		return "", errSystemOneJSON
	}
	return value, nil
}

func strictJSONNumber(raw json.RawMessage) (json.Number, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || (trimmed[0] != '-' && (trimmed[0] < '0' || trimmed[0] > '9')) {
		return "", errSystemOneJSON
	}
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.UseNumber()
	var number json.Number
	if err := decoder.Decode(&number); err != nil {
		return "", errSystemOneJSON
	}
	if _, err := decoder.Token(); err != io.EOF {
		return "", errSystemOneJSON
	}
	return number, nil
}

func strictJSONProbability(raw json.RawMessage) (float64, error) {
	number, err := strictJSONNumber(raw)
	if err != nil {
		return 0, err
	}
	value, err := strconv.ParseFloat(number.String(), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, fmt.Errorf("probability is not a finite number")
	}
	if value < 0 || value > 1 {
		return 0, fmt.Errorf("probability is outside [0,1]")
	}
	if value == 0 {
		value = 0
	}
	return value, nil
}

// NormalizeReason maps transport and provider failures to typed reasons
// without retrying or selecting another implementation.
func (typeSafeSystemOneDriver) NormalizeReason(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
		return grpcerr.WrapWithReasonCode(codes.Canceled, runtimev1.ReasonCode_ACTION_EXECUTED, err, grpcerr.ReasonOptions{Message: "remote decision execution canceled"})
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return grpcerr.WrapWithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, err, grpcerr.ReasonOptions{Message: "provider decision request timed out"})
	}
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
		if statusCode, parseErr := strconv.Atoi(metadata["provider_http_status"]); parseErr == nil && statusCode > 0 {
			reason := CloudDecideReasonForHTTPStatus(statusCode)
			return grpcerr.WrapWithReasonCode(cloudDecideReasonGRPCCode(reason), reason, err, grpcerr.ReasonOptions{
				Message:  "provider decision request failed",
				Metadata: map[string]string{"provider_http_status": strconv.Itoa(statusCode)},
			})
		}
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		switch reason {
		case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
			runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
			runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND,
			runtimev1.ReasonCode_AI_CONNECTOR_DISABLED,
			runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING,
			runtimev1.ReasonCode_AI_CONFIG_INVALID,
			runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			runtimev1.ReasonCode_AI_INPUT_INVALID,
			runtimev1.ReasonCode_AI_OUTPUT_INVALID:
			return err
		}
	}
	switch status.Code(err) {
	case codes.Unauthenticated, codes.PermissionDenied:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, err, grpcerr.ReasonOptions{})
	case codes.ResourceExhausted:
		return grpcerr.WrapWithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, err, grpcerr.ReasonOptions{})
	case codes.DeadlineExceeded:
		return grpcerr.WrapWithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, err, grpcerr.ReasonOptions{})
	case codes.Unavailable:
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "provider decision request failed"})
	}
}

// CloudDecideReasonForHTTPStatus is the Cloud text.decide reason table. A
// provider validation rejection is AI_INPUT_INVALID and never a claimed limit.
func CloudDecideReasonForHTTPStatus(statusCode int) runtimev1.ReasonCode {
	switch {
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED
	case statusCode == http.StatusTooManyRequests || statusCode == http.StatusPaymentRequired:
		return runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED
	case statusCode == http.StatusRequestTimeout || statusCode == http.StatusGatewayTimeout:
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case statusCode == http.StatusNotFound:
		return runtimev1.ReasonCode_AI_MODEL_NOT_FOUND
	case statusCode == http.StatusBadRequest || statusCode == http.StatusConflict ||
		statusCode == http.StatusRequestEntityTooLarge || statusCode == http.StatusUnsupportedMediaType ||
		statusCode == http.StatusUnprocessableEntity:
		return runtimev1.ReasonCode_AI_INPUT_INVALID
	case statusCode >= 500 && statusCode <= 599:
		// Includes TypeSafe's 529 overload status.
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	default:
		return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
}

func cloudDecideReasonGRPCCode(reason runtimev1.ReasonCode) codes.Code {
	switch reason {
	case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED:
		return codes.FailedPrecondition
	case runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED:
		return codes.ResourceExhausted
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		return codes.DeadlineExceeded
	case runtimev1.ReasonCode_AI_MODEL_NOT_FOUND:
		return codes.NotFound
	case runtimev1.ReasonCode_AI_INPUT_INVALID:
		return codes.InvalidArgument
	case runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE:
		return codes.Unavailable
	default:
		return codes.Internal
	}
}
