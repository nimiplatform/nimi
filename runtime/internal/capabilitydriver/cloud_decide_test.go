package capabilitydriver

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func decideText(value string) *runtimev1.TextDecisionContent {
	return &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: value}}
}

func decideJSON(value string) *runtimev1.TextDecisionContent {
	return &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Json{Json: value}}
}

func decideBoolean(id string, instructions *runtimev1.TextDecisionContent, trueCriterion *runtimev1.TextDecisionContent, falseCriterion *runtimev1.TextDecisionContent) *runtimev1.TextDecisionQuestion {
	return &runtimev1.TextDecisionQuestion{Id: id, Instructions: instructions, Kind: &runtimev1.TextDecisionQuestion_Boolean{
		Boolean: &runtimev1.TextDecisionBoolean{TrueCriterion: trueCriterion, FalseCriterion: falseCriterion},
	}}
}

func decideChoice(id string, instructions *runtimev1.TextDecisionContent, candidates ...*runtimev1.TextDecisionCandidate) *runtimev1.TextDecisionQuestion {
	return &runtimev1.TextDecisionQuestion{Id: id, Instructions: instructions, Kind: &runtimev1.TextDecisionQuestion_Choice{
		Choice: &runtimev1.TextDecisionChoice{Candidates: candidates},
	}}
}

func decideCandidate(id string, description *runtimev1.TextDecisionContent) *runtimev1.TextDecisionCandidate {
	return &runtimev1.TextDecisionCandidate{Id: id, Description: description}
}

func typeSafeTestTarget(t *testing.T, model string) (CloudDecideDriver, CloudDecideTarget) {
	t.Helper()
	raw, err := structpb.NewStruct(map[string]any{
		"provider": TypeSafeProviderID, "providerModelId": model, "remoteModelCatalogId": "catalog-" + model,
	})
	if err != nil {
		t.Fatal(err)
	}
	driver, target, err := NewProductionCloudDecideRegistry().Resolve(Identity{
		ImplementationID: TypeSafeProviderID, DriverID: "nimillm", DriverDialect: TypeSafeProviderID,
	}, raw)
	if err != nil {
		t.Fatalf("resolve TypeSafe decision Driver: %v", err)
	}
	return driver, target
}

// supportTicketSpec submits a boolean before a choice, with IDs whose
// lexical order differs from submission order.
func supportTicketSpec() *runtimev1.TextDecideScenarioSpec {
	return &runtimev1.TextDecideScenarioSpec{
		State: decideText(`Help! My payouts <have> been "failing" & stuck 3 days — 紧急.`),
		Questions: []*runtimev1.TextDecisionQuestion{
			decideBoolean("z_urgent", decideText("Does this convey urgency?"), decideText("Explicitly time-sensitive"), decideText("No urgency expressed")),
			decideChoice("a_department", decideText("Which team should handle this?"),
				decideCandidate("technical", decideText("Bugs, outages, integrations")),
				decideCandidate("billing", decideJSON(`{"scope": ["payments", "refunds"], "weight": 1.50}`)),
				decideCandidate("销售", nil),
			),
		},
	}
}

func TestCloudDecideRegistryAdmitsOnlyExactTypeSafeTargets(t *testing.T) {
	registry := NewProductionCloudDecideRegistry()
	identity := Identity{ImplementationID: TypeSafeProviderID, DriverID: "nimillm", DriverDialect: TypeSafeProviderID}
	for name, fields := range map[string]map[string]any{
		"unadmitted provider":   {"provider": "openai", "providerModelId": "gpt-4o-mini", "remoteModelCatalogId": "catalog"},
		"missing model":         {"provider": TypeSafeProviderID, "remoteModelCatalogId": "catalog"},
		"missing catalog":       {"provider": TypeSafeProviderID, "providerModelId": "jev-1.13.0"},
		"unsupported field":     {"provider": TypeSafeProviderID, "providerModelId": "jev-1.13.0", "remoteModelCatalogId": "catalog", "region": "us"},
		"untrimmed model":       {"provider": TypeSafeProviderID, "providerModelId": " jev-1.13.0", "remoteModelCatalogId": "catalog"},
		"non-string provider":   {"provider": 7, "providerModelId": "jev-1.13.0", "remoteModelCatalogId": "catalog"},
		"empty target":          {},
		"missing provider only": {"providerModelId": "jev-1.13.0", "remoteModelCatalogId": "catalog"},
	} {
		raw, err := structpb.NewStruct(fields)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := registry.Resolve(identity, raw); cloudInvocationKind(err) != CloudInvocationFailureTarget {
			t.Fatalf("%s: Resolve error = %v, want target failure", name, err)
		}
	}
	raw, _ := structpb.NewStruct(map[string]any{"provider": TypeSafeProviderID, "providerModelId": "jev-1.13.0", "remoteModelCatalogId": "catalog"})
	if _, _, err := registry.Resolve(Identity{ImplementationID: TypeSafeProviderID, DriverID: "nimillm"}, raw); cloudInvocationKind(err) != CloudInvocationFailureTarget {
		t.Fatalf("incomplete identity error = %v", err)
	}
	driver, target := typeSafeTestTarget(t, "jev-1.13.0")
	if driver == nil || target.Provider() != TypeSafeProviderID || target.ProviderModelID() != "jev-1.13.0" || target.RemoteModelCatalogID() != "catalog-jev-1.13.0" {
		t.Fatalf("resolved target = %+v", target)
	}
}

func TestTypeSafeSystemOneRequestBodyTextStatePreservesSubmittedOrder(t *testing.T) {
	driver, target := typeSafeTestTarget(t, "jev-1.13.0")
	spec := supportTicketSpec()
	before := proto.Clone(spec)
	mapped, err := driver.MapRequest(target, spec, nil)
	if err != nil {
		t.Fatalf("MapRequest: %v", err)
	}
	want := `{"state":"Help! My payouts <have> been \"failing\" & stuck 3 days — 紧急.","model":"jev-1.13.0","questions":{` +
		`"z_urgent":{"type":"noul","instructions":"Does this convey urgency?","criteria":{"true":"Explicitly time-sensitive","false":"No urgency expressed"}},` +
		`"a_department":{"type":"choice","instructions":"Which team should handle this?","criteria":{"technical":"Bugs, outages, integrations","billing":{"scope": ["payments", "refunds"], "weight": 1.50},"销售":null}}}}`
	if got := string(mapped.Body()); got != want {
		t.Fatalf("System One body mismatch:\n got=%s\nwant=%s", got, want)
	}
	if mapped.ProviderModelID() != "jev-1.13.0" || mapped.Dialect() != TypeSafeSystemOneDialect {
		t.Fatalf("mapped identity = %q/%q", mapped.ProviderModelID(), mapped.Dialect())
	}
	if !proto.Equal(before, spec) {
		t.Fatal("request mapping mutated the submitted spec")
	}
	body := mapped.Body()
	body[0] = 'X'
	if mapped.Body()[0] != '{' {
		t.Fatal("mapped body is not immutable")
	}
}

func TestTypeSafeSystemOneRequestBodyEmbedsJSONVerbatimAndOmitsAbsentCriteria(t *testing.T) {
	driver, target := typeSafeTestTarget(t, "jev-latest")
	spec := &runtimev1.TextDecideScenarioSpec{
		State: decideJSON(`{"z": 1, "a": [1.50, 2e3, -0.0], "nested": {"b": true, "a": null}, "text": "<tag>&amp;é"}`),
		Questions: []*runtimev1.TextDecisionQuestion{
			decideBoolean("has_refund", decideJSON("[\"Is a refund requested?\",\n {\"strict\": true}]"), nil, decideJSON(`{"means":"no refund"}`)),
			decideBoolean("is_spam", decideText("Is this spam?"), nil, nil),
			decideBoolean("is_polite", decideText("Is the tone polite?"), decideJSON(`["courteous"]`), nil),
			decideChoice("tier", decideJSON(`{"ask":"tier"}`), decideCandidate("free", nil), decideCandidate("pro", decideText("Paid plan"))),
		},
	}
	mapped, err := driver.MapRequest(target, spec, &structpb.Struct{})
	if err != nil {
		t.Fatalf("MapRequest: %v", err)
	}
	want := `{"state":{"z": 1, "a": [1.50, 2e3, -0.0], "nested": {"b": true, "a": null}, "text": "<tag>&amp;é"},"model":"jev-latest","questions":{` +
		`"has_refund":{"type":"noul","instructions":["Is a refund requested?",` + "\n" + ` {"strict": true}],"criteria":{"false":{"means":"no refund"}}},` +
		`"is_spam":{"type":"noul","instructions":"Is this spam?"},` +
		`"is_polite":{"type":"noul","instructions":"Is the tone polite?","criteria":{"true":["courteous"]}},` +
		`"tier":{"type":"choice","instructions":{"ask":"tier"},"criteria":{"free":null,"pro":"Paid plan"}}}}`
	if got := string(mapped.Body()); got != want {
		t.Fatalf("System One body mismatch:\n got=%s\nwant=%s", got, want)
	}
}

func TestTypeSafeSystemOneRequestMappingRejectsUnmappableInput(t *testing.T) {
	driver, target := typeSafeTestTarget(t, "jev-1.13.0")
	defaults, _ := structpb.NewStruct(map[string]any{"temperature": 0.5})
	if _, err := driver.MapRequest(target, supportTicketSpec(), defaults); cloudInvocationKind(err) != CloudInvocationFailureTarget {
		t.Fatalf("defaults error = %v", err)
	}
	tooMany := make([]*runtimev1.TextDecisionCandidate, 0, 256)
	for index := 0; index < 256; index++ {
		tooMany = append(tooMany, decideCandidate(fmt.Sprintf("c%d", index), nil))
	}
	for name, spec := range map[string]*runtimev1.TextDecideScenarioSpec{
		"no questions":        {State: decideText("state")},
		"missing state":       {Questions: []*runtimev1.TextDecisionQuestion{decideBoolean("q", decideText("i"), nil, nil)}},
		"object JSON invalid": {State: decideJSON(`{"a":`), Questions: []*runtimev1.TextDecisionQuestion{decideBoolean("q", decideText("i"), nil, nil)}},
		"scalar JSON state":   {State: decideJSON(`"just a string"`), Questions: []*runtimev1.TextDecisionQuestion{decideBoolean("q", decideText("i"), nil, nil)}},
		"duplicate question": {State: decideText("state"), Questions: []*runtimev1.TextDecisionQuestion{
			decideBoolean("q", decideText("i"), nil, nil), decideBoolean("q", decideText("i"), nil, nil),
		}},
		"duplicate candidate": {State: decideText("state"), Questions: []*runtimev1.TextDecisionQuestion{
			decideChoice("q", decideText("i"), decideCandidate("a", nil), decideCandidate("a", nil)),
		}},
		"too many options": {State: decideText("state"), Questions: []*runtimev1.TextDecisionQuestion{decideChoice("q", decideText("i"), tooMany...)}},
		"missing instructions": {State: decideText("state"), Questions: []*runtimev1.TextDecisionQuestion{
			decideBoolean("q", nil, nil, nil),
		}},
	} {
		if _, err := driver.MapRequest(target, spec, nil); cloudInvocationKind(err) != CloudInvocationFailureRequest {
			t.Fatalf("%s: MapRequest error = %v, want request failure", name, err)
		}
	}
}

func TestTypeSafeSystemOneNormalizesAnswersIntoSubmittedOrder(t *testing.T) {
	driver, target := typeSafeTestTarget(t, "jev-1.13.0")
	mapped, err := driver.MapRequest(target, supportTicketSpec(), nil)
	if err != nil {
		t.Fatal(err)
	}
	response := `{"model":"jev-1.13.0","answers":{` +
		`"a_department":{"type":"choice","choice":"billing","probabilities":{"销售":0.0,"billing":0.88,"technical":0.12},"confidence":0.81},` +
		`"z_urgent":{"type":"noul","noul":0.95}},` +
		`"usage":{"input_tokens":318,"output_tokens":34},"legend":{"0":"ignored"}}`
	result, err := driver.NormalizeResponse(mapped, CloudDecideTransportResponse{Body: []byte(response)})
	if err != nil {
		t.Fatalf("NormalizeResponse: %v", err)
	}
	want := &runtimev1.TextDecisionResult{Answers: []*runtimev1.TextDecisionAnswer{
		{QuestionId: "z_urgent", Result: &runtimev1.TextDecisionAnswer_Boolean{Boolean: &runtimev1.TextDecisionBooleanAnswer{TrueProbability: 0.95}}},
		{QuestionId: "a_department", Result: &runtimev1.TextDecisionAnswer_Choice{Choice: &runtimev1.TextDecisionChoiceAnswer{
			SelectedCandidateId: "billing",
			Probabilities: []*runtimev1.TextDecisionCandidateProbability{
				{CandidateId: "technical", Probability: 0.12},
				{CandidateId: "billing", Probability: 0.88},
				{CandidateId: "销售", Probability: 0},
			},
		}}},
	}}
	if !proto.Equal(result.Result, want) {
		t.Fatalf("normalized result = %v\nwant %v", result.Result, want)
	}
	if result.Usage.GetInputTokens() != 318 || result.Usage.GetOutputTokens() != 34 {
		t.Fatalf("usage = %+v", result.Usage)
	}
	for name, usage := range map[string]string{
		"absent":    ``,
		"malformed": `,"usage":{"input_tokens":"many"}`,
		"negative":  `,"usage":{"input_tokens":-1,"output_tokens":0}`,
	} {
		body := `{"answers":{"z_urgent":{"type":"noul","noul":1},"a_department":{"type":"choice","choice":"technical","probabilities":{"technical":1,"billing":0,"销售":0}}}` + usage + `}`
		result, err := driver.NormalizeResponse(mapped, CloudDecideTransportResponse{Body: []byte(body)})
		if err != nil || result.Usage != nil || len(result.Result.GetAnswers()) != 2 {
			t.Fatalf("%s usage: result=%+v err=%v", name, result, err)
		}
	}
}

func TestTypeSafeSystemOneRejectsIncompleteOrInconsistentAnswers(t *testing.T) {
	driver, target := typeSafeTestTarget(t, "jev-1.13.0")
	mapped, err := driver.MapRequest(target, supportTicketSpec(), nil)
	if err != nil {
		t.Fatal(err)
	}
	const noul = `"z_urgent":{"type":"noul","noul":0.4}`
	const choice = `"a_department":{"type":"choice","choice":"billing","probabilities":{"technical":0.1,"billing":0.8,"销售":0.1}}`
	answers := func(members ...string) string {
		body := `{"answers":{`
		for index, member := range members {
			if index > 0 {
				body += ","
			}
			body += member
		}
		return body + `}}`
	}
	for name, body := range map[string]string{
		"not JSON":                   `not json`,
		"top-level array":            `[` + answers(noul, choice) + `]`,
		"trailing data":              answers(noul, choice) + `{}`,
		"missing answers":            `{"model":"jev-1.13.0"}`,
		"answers array":              `{"answers":[]}`,
		"missing question":           answers(choice),
		"extra question":             answers(noul, choice, `"unknown":{"type":"noul","noul":0.5}`),
		"duplicate question":         answers(noul, noul, choice),
		"boolean as choice":          answers(`"z_urgent":{"type":"choice","choice":"true","probabilities":{"true":1}}`, choice),
		"choice as noul":             answers(noul, `"a_department":{"type":"noul","noul":0.5}`),
		"score answer":               answers(noul, `"a_department":{"type":"score","score":1.0,"legend":{"0":"x"},"probabilities":{"0":1}}`),
		"missing type":               answers(`"z_urgent":{"noul":0.4}`, choice),
		"noul above one":             answers(`"z_urgent":{"type":"noul","noul":1.5}`, choice),
		"noul negative":              answers(`"z_urgent":{"type":"noul","noul":-0.1}`, choice),
		"noul string":                answers(`"z_urgent":{"type":"noul","noul":"0.4"}`, choice),
		"noul null":                  answers(`"z_urgent":{"type":"noul","noul":null}`, choice),
		"noul overflow":              answers(`"z_urgent":{"type":"noul","noul":1e400}`, choice),
		"noul missing":               answers(`"z_urgent":{"type":"noul"}`, choice),
		"unknown selection":          answers(noul, `"a_department":{"type":"choice","choice":"sales","probabilities":{"technical":0.1,"billing":0.8,"销售":0.1}}`),
		"selection not string":       answers(noul, `"a_department":{"type":"choice","choice":1,"probabilities":{"technical":0.1,"billing":0.8,"销售":0.1}}`),
		"missing candidate":          answers(noul, `"a_department":{"type":"choice","choice":"billing","probabilities":{"technical":0.2,"billing":0.8}}`),
		"extra candidate":            answers(noul, `"a_department":{"type":"choice","choice":"billing","probabilities":{"technical":0.1,"billing":0.8,"销售":0.1,"other":0}}`),
		"renamed candidate":          answers(noul, `"a_department":{"type":"choice","choice":"billing","probabilities":{"technical":0.1,"billing":0.8,"sales":0.1}}`),
		"duplicate candidate":        answers(noul, `"a_department":{"type":"choice","choice":"billing","probabilities":{"technical":0.1,"billing":0.8,"billing":0.1}}`),
		"candidate probability bool": answers(noul, `"a_department":{"type":"choice","choice":"billing","probabilities":{"technical":true,"billing":0.8,"销售":0.1}}`),
		"probabilities array":        answers(noul, `"a_department":{"type":"choice","choice":"billing","probabilities":[0.1,0.8,0.1]}`),
	} {
		if _, err := driver.NormalizeResponse(mapped, CloudDecideTransportResponse{Body: []byte(body)}); cloudInvocationKind(err) != CloudInvocationFailureResponse {
			t.Fatalf("%s: NormalizeResponse error = %v, want response failure", name, err)
		}
	}
	if _, err := driver.NormalizeResponse(nil, CloudDecideTransportResponse{Body: []byte(answers(noul, choice))}); cloudInvocationKind(err) != CloudInvocationFailureResponse {
		t.Fatalf("missing layout error = %v", err)
	}
}

func TestCloudDecideReasonNormalization(t *testing.T) {
	driver := typeSafeSystemOneDriver{provider: TypeSafeProviderID}
	for statusCode, expected := range map[int]struct {
		reason runtimev1.ReasonCode
		code   codes.Code
	}{
		http.StatusUnauthorized:        {runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.FailedPrecondition},
		http.StatusForbidden:           {runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.FailedPrecondition},
		http.StatusUnprocessableEntity: {runtimev1.ReasonCode_AI_INPUT_INVALID, codes.InvalidArgument},
		http.StatusBadRequest:          {runtimev1.ReasonCode_AI_INPUT_INVALID, codes.InvalidArgument},
		http.StatusTooManyRequests:     {runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, codes.ResourceExhausted},
		529:                            {runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable},
		http.StatusServiceUnavailable:  {runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable},
		http.StatusInternalServerError: {runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable},
		http.StatusBadGateway:          {runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable},
		http.StatusGatewayTimeout:      {runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, codes.DeadlineExceeded},
		http.StatusRequestTimeout:      {runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, codes.DeadlineExceeded},
		http.StatusNotFound:            {runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, codes.NotFound},
	} {
		// The transport's own classification is not trusted: only the status
		// selects the decision reason.
		transport := grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, grpcerr.ReasonOptions{
			Metadata: map[string]string{"provider_http_status": strconv.Itoa(statusCode)},
		})
		err := driver.NormalizeReason(transport)
		reason, _ := grpcerr.ExtractReasonCode(err)
		if reason != expected.reason || status.Code(err) != expected.code {
			t.Fatalf("status %d: reason=%s code=%s, want %s/%s", statusCode, reason, status.Code(err), expected.reason, expected.code)
		}
		if metadata, _ := grpcerr.ExtractReasonMetadata(err); metadata["provider_http_status"] != strconv.Itoa(statusCode) {
			t.Fatalf("status %d metadata = %v", statusCode, metadata)
		}
	}
	canceled := grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, context.Canceled, grpcerr.ReasonOptions{})
	if err := driver.NormalizeReason(canceled); status.Code(err) != codes.Canceled {
		t.Fatalf("canceled transport = %v", err)
	}
	if err := driver.NormalizeReason(context.DeadlineExceeded); status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("deadline = %v", err)
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("deadline reason = %s", reason)
	}
	for _, preserved := range []runtimev1.ReasonCode{
		runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
		runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING,
		runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
		runtimev1.ReasonCode_AI_OUTPUT_INVALID,
	} {
		err := driver.NormalizeReason(grpcerr.WithReasonCode(codes.Unavailable, preserved))
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != preserved {
			t.Fatalf("typed transport reason %s became %s", preserved, reason)
		}
	}
	if err := driver.NormalizeReason(fmt.Errorf("opaque")); status.Code(err) != codes.Internal {
		t.Fatalf("opaque error = %v", err)
	}
	if driver.NormalizeReason(nil) != nil {
		t.Fatal("nil error must stay nil")
	}
}
