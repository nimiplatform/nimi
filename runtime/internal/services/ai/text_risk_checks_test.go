package ai

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"log/slog"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func syntheticRiskToken() string { return "ghp_" + strings.Repeat("aB3", 12) }
func syntheticRiskPEM(t *testing.T) string {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

type riskRemoteHost struct {
	fn func(context.Context, func(textbehavior.OrderedDelta) error) (capabilitydriver.CloudTextTransportResponse, error)
}

func (h riskRemoteHost) ExecuteText(ctx context.Context, _ connector.ConnectorRecord, _ capabilitydriver.CloudTextTarget, _ *capabilitydriver.CloudTextMappedRequest, _ remoteexecution.TextDispatchAudit) (capabilitydriver.CloudTextTransportResponse, error) {
	return h.fn(ctx, nil)
}
func (h riskRemoteHost) StreamText(ctx context.Context, _ connector.ConnectorRecord, _ capabilitydriver.CloudTextTarget, _ *capabilitydriver.CloudTextMappedRequest, emit func(textbehavior.OrderedDelta) error, _ remoteexecution.TextDispatchAudit) (capabilitydriver.CloudTextTransportResponse, error) {
	return h.fn(ctx, emit)
}

func riskService(t *testing.T, cloud bool) (*Service, context.Context, *runtimev1.ExecuteScenarioRequest) {
	t.Helper()
	req := localTextExecuteRequestForTest()
	if !cloud {
		s := newTestService(nil)
		s.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "risk-test", "risk.gguf")})
		return s, localTextIntentContext(context.Background(), nil), req
	}
	f := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", "https://api.openai.com/v1", Config{})
	req.Head = &runtimev1.ScenarioRequestHead{AppId: "app.risk", SubjectUserId: "user-001"}
	return f.service, withCloudScenarioTestIntent(scenarioJobUserContext("app.risk", "user-001"), "text.generate", f.targetRef), req
}

func riskStreamRequest(req *runtimev1.ExecuteScenarioRequest) *runtimev1.StreamScenarioRequest {
	return &runtimev1.StreamScenarioRequest{Head: req.Head, Spec: req.Spec, ScenarioType: req.ScenarioType, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
}

func assertContentRefusal(t *testing.T, err error) {
	t.Helper()
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED || status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("content refusal = %v", err)
	}
}

func assertRiskJob(t *testing.T, s *Service) {
	t.Helper()
	s.scenarioJobs.mu.RLock()
	defer s.scenarioJobs.mu.RUnlock()
	if len(s.scenarioJobs.jobs) != 1 {
		t.Fatalf("jobs = %d", len(s.scenarioJobs.jobs))
	}
	for _, r := range s.scenarioJobs.jobs {
		j := r.job
		if j.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || j.GetReasonCode() != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
			t.Fatalf("job = %s / %s", j.Status, j.ReasonCode)
		}
		if j.ReasonDetail != "content filtering blocked this request or response" || j.GetReasonMetadata().GetFields()["retryable"].GetBoolValue() {
			t.Fatalf("misleading failure = %v", j)
		}
	}
}

func TestTextRiskInputBeforeJobDispatchAndMaterialization(t *testing.T) {
	for _, cloud := range []bool{false, true} {
		for _, streaming := range []bool{false, true} {
			t.Run(map[bool]string{false: "local", true: "cloud"}[cloud]+map[bool]string{false: "Sync", true: "Stream"}[streaming], func(t *testing.T) {
				s, ctx, req := riskService(t, cloud)
				called := false
				s.SetLocalTextExecutionHost(&localTextHostStub{streamFn: func(context.Context, func(localexecution.TextDelta) error) (localexecution.TextResult, error) {
					called = true
					return localexecution.TextResult{}, errors.New("unexpected dispatch")
				}})
				s.SetRemoteTextExecutionHost(riskRemoteHost{fn: func(context.Context, func(textbehavior.OrderedDelta) error) (capabilitydriver.CloudTextTransportResponse, error) {
					called = true
					return capabilitydriver.CloudTextTransportResponse{}, errors.New("unexpected dispatch")
				}})
				spec := req.Spec.GetTextGenerate()
				spec.Input = []*runtimev1.ChatMessage{{Role: "user", Content: "analyze locally " + syntheticRiskPEM(t)}}
				var err error
				if streaming {
					out := &mockScenarioEventStream{ctx: ctx}
					err = s.StreamScenario(riskStreamRequest(req), out)
					if len(out.events) != 0 {
						t.Fatal("input refusal fabricated stream")
					}
				} else {
					_, err = s.ExecuteScenario(ctx, req)
				}
				assertContentRefusal(t, err)
				if called || len(s.scenarioJobs.jobs) != 0 {
					t.Fatal("input refusal created execution")
				}
				// A missing Artifact would fail differently if materialization ran first.
				spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "user", Parts: []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: "not-present", MimeType: "image/png"}}}}})
				if cloud {
					_, err = s.captureCloudTextEffectiveInputs(ctx, req.Head, req, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC)
				} else {
					_, err = s.captureLocalTextEffectiveInputs(ctx, req.Head, spec, false)
				}
				assertContentRefusal(t, err)
			})
		}
	}
}

func TestTextRiskBusinessValuesAndSafeDiagnostics(t *testing.T) {
	s := newTestService(nil)
	var logs bytes.Buffer
	s.logger = slog.New(slog.NewTextHandler(&logs, nil))
	token := syntheticRiskToken()
	value := structpb.NewStringValue(token)
	for _, spec := range []*runtimev1.TextGenerateScenarioSpec{
		{SystemPrompt: token},
		{Input: []*runtimev1.ChatMessage{{Role: "assistant", Content: token}}},
		{Input: []*runtimev1.ChatMessage{{Role: "tool", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{Result: value}}}}}}},
		{Tools: []*runtimev1.ToolSpec{{Description: token}}},
		{Tools: []*runtimev1.ToolSpec{{InputSchema: &structpb.Struct{Fields: map[string]*structpb.Value{"description": value}}}}},
		{ResponseFormat: &runtimev1.ResponseFormat{JsonSchema: &structpb.Struct{Fields: map[string]*structpb.Value{"description": value}}}},
	} {
		before := proto.Clone(spec)
		err := s.checkTextInputRisk(spec)
		assertContentRefusal(t, err)
		if !proto.Equal(before, spec) || strings.Contains(err.Error(), token) {
			t.Fatal("modified input or leaked match")
		}
	}
	if strings.Contains(logs.String(), token) || !strings.Contains(logs.String(), "github-classic-pat") {
		t.Fatal("unsafe or missing rule diagnostic")
	}
	// Escaped JSON is inspected after decoding, not as its raw wire spelling.
	call := &runtimev1.ToolCall{Name: "lookup", ArgumentsJson: `{"value":"\u0067hp_` + token[4:] + `"}`}
	assertContentRefusal(t, s.checkToolCallRisk(call, "output"))
	if err := s.checkToolCallRisk(&runtimev1.ToolCall{ArgumentsJson: `{"incomplete":`}, "output"); err == nil {
		t.Fatal("invalid JSON silently accepted")
	}
	allowed := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "system", Content: "token: string"}, {Role: "user", Content: "password: <redacted>"}}, Tools: []*runtimev1.ToolSpec{{InputSchema: &structpb.Struct{Fields: map[string]*structpb.Value{token: structpb.NewStringValue("string")}}}}}
	before := proto.Clone(allowed)
	if err := s.checkTextInputRisk(allowed); err != nil || !proto.Equal(before, allowed) {
		t.Fatalf("normal input changed: %v", err)
	}
}

func TestTextRiskOutputOwners(t *testing.T) {
	for _, cloud := range []bool{false, true} {
		for _, mode := range []string{"sync", "incremental", "empty-completion", "final-pem", "final-token", "tool", "normal"} {
			t.Run(map[bool]string{false: "local", true: "cloud"}[cloud]+"/"+mode, func(t *testing.T) {
				s, ctx, req := riskService(t, cloud)
				out := &mockScenarioEventStream{ctx: ctx}
				token := syntheticRiskToken()
				text := token
				var backendCanceled bool
				fn := func(backend context.Context, emit func(textbehavior.OrderedDelta) error) (capabilitydriver.CloudTextTransportResponse, error) {
					if mode == "final-pem" {
						text = syntheticRiskPEM(t)
					}
					if mode == "normal" {
						text = strings.Repeat("normal 中文 ", 8) + token + "long_identifier"
					}
					result := capabilitydriver.CloudTextTransportResponse{Items: []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: text}}, FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: &runtimev1.UsageStats{InputTokens: 4, OutputTokens: 7}}
					if emit == nil {
						return result, nil
					}
					var deltas []textbehavior.OrderedDelta
					switch mode {
					case "tool":
						args, _ := json.Marshal(map[string]string{"value": token})
						deltas = []textbehavior.OrderedDelta{{Kind: textbehavior.OrderedItemToolCall, ToolCall: &runtimev1.ToolCall{Id: "c1", Name: "lookup", ArgumentsJson: string(args)}, ItemCompleted: true}}
					case "final-pem":
						deltas = []textbehavior.OrderedDelta{{Kind: textbehavior.OrderedItemText, Text: text[:len(text)-16]}, {Kind: textbehavior.OrderedItemText, Text: text[len(text)-16:]}}
					case "normal":
						deltas = []textbehavior.OrderedDelta{{Kind: textbehavior.OrderedItemText, Text: text[:len(text)-15]}, {Kind: textbehavior.OrderedItemText, Text: text[len(text)-15:], ItemCompleted: true}}
					default:
						deltas = []textbehavior.OrderedDelta{{Kind: textbehavior.OrderedItemText, Text: token[:32]}, {Kind: textbehavior.OrderedItemText, Text: token[32:]}}
						if mode == "incremental" {
							deltas = append(deltas, textbehavior.OrderedDelta{Kind: textbehavior.OrderedItemText, Text: " "})
						}
						if mode == "empty-completion" {
							deltas = append(deltas, textbehavior.OrderedDelta{Kind: textbehavior.OrderedItemText, ItemCompleted: true})
						}
					}
					for i, d := range deltas {
						if err := emit(d); err != nil {
							backendCanceled = backend.Err() != nil
							// Exercise a Host that rewrites callback errors after cancellation.
							return capabilitydriver.CloudTextTransportResponse{}, context.Canceled
						}
						if i == 0 && mode != "tool" && len(out.events) < 2 {
							t.Fatal("normal first delta waited for backend completion")
						}
					}
					if backend.Err() != nil {
						t.Fatal("backend canceled before successful return")
					}
					return result, nil
				}
				s.SetRemoteTextExecutionHost(riskRemoteHost{fn: fn})
				s.SetLocalTextExecutionHost(&localTextHostStub{
					result: localexecution.TextResult{Text: token, FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, InputTokens: 4, OutputTokens: 7},
					streamFn: func(c context.Context, emit func(localexecution.TextDelta) error) (localexecution.TextResult, error) {
						r, e := fn(c, func(d textbehavior.OrderedDelta) error {
							if mode == "tool" || mode == "empty-completion" || mode == "normal" {
								return emit(localexecution.TextDelta{Ordered: &d})
							}
							return emit(localexecution.TextDelta{Text: d.Text})
						})
						if e != nil {
							return localexecution.TextResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: e}
						}
						return localexecution.TextResult{Text: text, Items: r.Items, FinishReason: r.FinishReason, InputTokens: r.Usage.GetInputTokens(), OutputTokens: r.Usage.GetOutputTokens()}, nil
					},
				})
				if mode == "sync" {
					_, err := s.ExecuteScenario(ctx, req)
					assertContentRefusal(t, err)
					assertRiskJob(t, s)
					if onlyScenarioJobForRestartTest(t, s).GetUsage().GetOutputTokens() != 7 {
						t.Fatal("known sync usage lost")
					}
					return
				}
				if err := s.StreamScenario(riskStreamRequest(req), out); err != nil {
					t.Fatal(err)
				}
				last := out.events[len(out.events)-1]
				if mode == "normal" {
					if last.GetCompleted() == nil {
						t.Fatalf("normal stream failed: %v", last)
					}
					var delivered strings.Builder
					for _, event := range out.events {
						delivered.WriteString(event.GetDelta().GetTextOutputItem().GetText().GetText())
					}
					if delivered.String() != text {
						t.Fatal("normal chunks lost or duplicated")
					}
					return
				}
				if last.GetFailed().GetReasonCode() != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
					t.Fatalf("terminal = %v", last)
				}
				for _, event := range out.events {
					if event.GetCompleted() != nil || event.GetDelta().GetTextOutputItem().GetToolCall() != nil {
						t.Fatal("risk produced successful output or tool")
					}
				}
				assertRiskJob(t, s)
				known := mode == "final-pem" || mode == "final-token"
				if usage := onlyScenarioJobForRestartTest(t, s).GetUsage(); known && usage.GetOutputTokens() != 7 || !known && usage != nil {
					t.Fatalf("failure usage = %v known=%v", usage, known)
				}
				if (mode == "incremental" || mode == "empty-completion" || mode == "tool") && !backendCanceled {
					t.Fatal("incremental rejection did not stop backend")
				}
				if mode == "final-pem" || mode == "final-token" {
					var delivered strings.Builder
					for _, event := range out.events {
						delivered.WriteString(event.GetDelta().GetTextOutputItem().GetText().GetText())
					}
					if delivered.String() == text || backendCanceled {
						t.Fatal("final rejection flushed withheld tail or canceled finished backend")
					}
				}
			})
		}
	}
}

func BenchmarkRiskJSON(b *testing.B) {
	s := newTestService(nil)
	v, _ := structpb.NewValue(map[string]any{"description": strings.Repeat("normal JSON value ", 4096), "array": []any{"password: <redacted>", 42}})
	b.SetBytes(int64(proto.Size(v)))
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if err := s.checkJSONValueRisk(v, "input", "tool_result"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkRiskToolArguments(b *testing.B) {
	s := newTestService(nil)
	arguments, err := json.Marshal(map[string]any{"value": strings.Repeat("ordinary JSON tool data 中文 ", 2048)})
	if err != nil {
		b.Fatal(err)
	}
	call := &runtimev1.ToolCall{Name: "lookup", ArgumentsJson: string(arguments)}
	b.SetBytes(int64(len(arguments)))
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if err := s.checkToolCallRisk(call, "output"); err != nil {
			b.Fatal(err)
		}
	}
}

func TestTextRiskLogicalItemsRemainIndependentAndReleaseState(t *testing.T) {
	s := newTestService(nil)
	r := textRiskStream{s: s}
	token := syntheticRiskToken()
	for _, d := range []textbehavior.OrderedDelta{
		{Kind: textbehavior.OrderedItemText, ItemIndex: 0, Text: token[:20]},
		{Kind: textbehavior.OrderedItemReasoningSummary, ItemIndex: 1, Text: token[20:], ItemCompleted: true},
		{Kind: textbehavior.OrderedItemText, ItemIndex: 0, Text: " ordinary", ItemCompleted: true},
	} {
		if err := r.delta(d); err != nil {
			t.Fatal(err)
		}
	}
	for i := uint32(2); i < 10000; i++ {
		if err := r.delta(textbehavior.OrderedDelta{Kind: textbehavior.OrderedItemText, ItemIndex: i, Text: "normal", ItemCompleted: true}); err != nil {
			t.Fatal(err)
		}
	}
	if len(r.items) != 0 {
		t.Fatal("completed items retained")
	}
	if err := s.checkTextResultRisk(token, []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: token[:20]}, {Kind: textbehavior.OrderedItemText, Text: token[20:]}}); err != nil {
		t.Fatal("convenience projection joined distinct values")
	}
}

func TestTextRiskExternalCancelAndBackendFailureDoNotBecomeContentRefusal(t *testing.T) {
	for _, cloud := range []bool{false, true} {
		for _, external := range []bool{false, true} {
			t.Run(map[bool]string{false: "local", true: "cloud"}[cloud]+map[bool]string{false: "Failure", true: "Cancel"}[external], func(t *testing.T) {
				s, ctx, req := riskService(t, cloud)
				ctx, cancel := context.WithCancel(ctx)
				defer cancel()
				fn := func(_ context.Context, emit func(textbehavior.OrderedDelta) error) (capabilitydriver.CloudTextTransportResponse, error) {
					text := syntheticRiskToken()
					if external {
						text += " "
					}
					err := emit(textbehavior.OrderedDelta{Kind: textbehavior.OrderedItemText, Text: text})
					if external {
						if err == nil {
							t.Fatal("expected content hit before external race")
						}
						cancel()
						return capabilitydriver.CloudTextTransportResponse{}, context.Canceled
					}
					if err != nil {
						t.Fatal("open block tail incorrectly completed")
					}
					return capabilitydriver.CloudTextTransportResponse{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
				}
				s.SetRemoteTextExecutionHost(riskRemoteHost{fn: fn})
				s.SetLocalTextExecutionHost(&localTextHostStub{streamFn: func(c context.Context, emit func(localexecution.TextDelta) error) (localexecution.TextResult, error) {
					_, err := fn(c, func(d textbehavior.OrderedDelta) error { return emit(localexecution.TextDelta{Text: d.Text}) })
					return localexecution.TextResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: err}
				}})
				out := &mockScenarioEventStream{ctx: ctx}
				_ = s.StreamScenario(riskStreamRequest(req), out)
				j := onlyScenarioJobForRestartTest(t, s)
				if j.ReasonCode == runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
					t.Fatal("external stop or failed backend became a normal content boundary")
				}
				if external && j.Status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
					t.Fatalf("external cancel = %v", j.Status)
				}
				for _, e := range out.events {
					if e.GetCompleted() != nil || e.GetFailed().GetReasonCode() == runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
						t.Fatal("false terminal")
					}
				}
			})
		}
	}
}

func TestTextRiskFormalAppInputErrorAndOutputFailed(t *testing.T) {
	for _, input := range []bool{false, true} {
		s := newTestService(nil)
		if err := overwriteAIConfigStoreForTest(context.Background(), s.aiConfigStore, "account-1", &runtimev1.AIConfig{Owner: derivedAppAIConfigOwner("nimi.realm-persona-studio"), Capabilities: []*runtimev1.AIConfigCapabilityIntent{{CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}}}}}); err != nil {
			t.Fatal(err)
		}
		s.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "risk-app", "risk-app.gguf")})
		s.SetLocalTextExecutionHost(&localTextHostStub{streamDeltas: []localexecution.TextDelta{{Text: syntheticRiskToken() + " "}}})
		req := validLocalAppTextTurnRequest()
		if input {
			req.Messages[0].Text = syntheticRiskToken()
		}
		out := &mockLocalAppTextTurnStream{ctx: localAppTextTurnContext()}
		err := s.StreamLocalAppTextTurn(req, out)
		if input {
			assertContentRefusal(t, err)
			if len(out.events) != 0 || len(s.scenarioJobs.jobs) != 0 {
				t.Fatal("input refusal opened execution")
			}
		} else {
			if err != nil || len(out.events) != 1 || out.events[0].GetFailed().GetReasonCode() != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
				t.Fatalf("App output refusal = %v %v", err, out.events)
			}
			assertRiskJob(t, s)
		}
	}
}
