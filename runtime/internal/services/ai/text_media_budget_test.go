package ai

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func mediaBudgetTestWAV() []byte {
	body := make([]byte, 76)
	copy(body, "RIFF")
	binary.LittleEndian.PutUint32(body[4:], 68)
	copy(body[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(body[16:], 16)
	binary.LittleEndian.PutUint16(body[20:], 1)
	binary.LittleEndian.PutUint16(body[22:], 1)
	binary.LittleEndian.PutUint32(body[24:], 16000)
	binary.LittleEndian.PutUint32(body[28:], 32000)
	binary.LittleEndian.PutUint16(body[32:], 2)
	binary.LittleEndian.PutUint16(body[34:], 16)
	copy(body[36:], "data")
	binary.LittleEndian.PutUint32(body[40:], 32)
	return body
}

type trackedBudgetArtifactStore struct {
	runtimeartifact.Store
	opened []string
}

func (s *trackedBudgetArtifactStore) Open(ctx context.Context, id string) (*runtimeartifact.ArtifactSource, bool) {
	s.opened = append(s.opened, id)
	return s.Store.Open(ctx, id)
}

func TestOwnedMediaBudgetStopsBeforeNextBodyOpenAndCleansMaterializedFiles(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TMP", dir)
	t.Setenv("TEMP", dir)
	t.Setenv("TMPDIR", dir)
	svc := newTestService(nil)
	store := &trackedBudgetArtifactStore{Store: runtimeartifact.NewMemoryStore()}
	svc.runtimeArtifacts = store
	owner := &runtimeartifact.ArtifactOwner{AppID: "nimi.lab", SubjectUserID: "account-1", RegisteredAppSubject: "principal-1"}
	for _, id := range []string{"first", "second", "third"} {
		if err := store.Put(id, runtimeartifact.ArtifactRecord{Bytes: mediaBudgetTestWAV(), MimeType: "audio/wav", Owner: owner}); err != nil {
			t.Fatal(err)
		}
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(200, 96)
	if err != nil {
		t.Fatal(err)
	}
	ctx := textbehavior.WithOwnedMediaInputBudget(localAppArtifactContextForOwner("nimi.lab", "principal-1"), budget)
	parts := []*runtimev1.ChatContentPart{}
	for _, id := range []string{"first", "second", "third"} {
		parts = append(parts, artifactRefPart(&runtimev1.ChatContentArtifactRef{ArtifactId: id, MimeType: "audio/wav"}))
	}
	_, err = svc.resolveTextGenerateScenarioForRoute(ctx, &runtimev1.ScenarioRequestHead{AppId: "nimi.lab", SubjectUserId: "account-1"}, &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Parts: parts}}}, false)
	if err == nil || len(store.opened) != 1 || store.opened[0] != "first" {
		t.Fatalf("budget did not stop body materialization: opened=%v err=%v", store.opened, err)
	}
	files, readErr := os.ReadDir(dir)
	if readErr != nil || len(files) != 0 {
		t.Fatalf("temporary input survived failed budget: %v %v", files, readErr)
	}
}

func TestNativeMediaBudgetCaptureFailureDispatchesNothing(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.WriteString(w, `{"candidates":[]}`)
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-3.8-flash", server.URL, Config{AllowLoopbackEndpoint: true})
	for i := range f.service.textBehaviorAdapters {
		if f.service.textBehaviorAdapters[i].AdapterID == "gemini.38-flash.chat" {
			f.service.textBehaviorAdapters[i].MaterializationPlanner = func(_ context.Context, spec *runtimev1.TextGenerateScenarioSpec, _ bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
				b, err := textbehavior.NewOwnedMediaInputBudget(200, 96)
				return spec, b, err
			}
		}
	}
	head := &runtimev1.ScenarioRequestHead{AppId: "app.media-budget", SubjectUserId: "user-001"}
	f.service.scenarioJobs.create(&runtimev1.ScenarioJob{JobId: "inputs", Head: head, CreatedAt: timestamppb.Now(), UpdatedAt: timestamppb.Now(), Artifacts: []*runtimev1.ScenarioArtifact{{ArtifactId: "small-wave", MimeType: "audio/wav", Bytes: mediaBudgetTestWAV()}}}, func() {})
	parts := []*runtimev1.ChatContentPart{artifactRefPart(&runtimev1.ChatContentArtifactRef{ArtifactId: "small-wave", MimeType: "audio/wav"}), artifactRefPart(&runtimev1.ChatContentArtifactRef{ArtifactId: "small-wave", MimeType: "audio/wav"})}
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext(head.AppId, head.SubjectUserId), "text.generate", f.targetRef)
	providerTarget, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": "gemini-3.8-flash", "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
	ctx = executionintent.WithIntent(ctx, executionintent.Intent{CapabilityContract: "text.generate", Route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ConnectorRef: f.connectorID, CloudImplementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "gemini", DriverId: "nimillm", DriverDialect: "gemini"}, ProviderModelTarget: providerTarget})
	_, err := f.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Parts: parts}}}}}})
	if err == nil || calls.Load() != 0 {
		t.Fatalf("budget failure dispatched provider request: calls=%d err=%v", calls.Load(), err)
	}
	metadata, _ := grpcerr.ExtractReasonMetadata(err)
	if metadata["action_hint"] != "use_smaller_owned_media_inputs" {
		t.Fatalf("test stopped for a different reason: %v metadata=%v", err, metadata)
	}
}

func TestOwnedMediaBudgetBase64Boundary(t *testing.T) {
	for _, size := range []int64{1, 2, 3, 4, 76} {
		encoded := int64(base64.StdEncoding.EncodedLen(int(size)))
		b, err := textbehavior.NewOwnedMediaInputBudget(encoded, 0)
		if err != nil || b.Reserve(size) != nil {
			t.Fatalf("exact encoding boundary rejected size=%d", size)
		}
		if b.Reserve(1) == nil {
			t.Fatal("exhausted budget kept accepting inputs")
		}
	}
}

func TestGeminiAdvancedMediaRejectedBeforeOwnedBodyAndDispatch(t *testing.T) {
	schema, err := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean"}}, "required": []any{"ok"}, "additionalProperties": false})
	if err != nil {
		t.Fatal(err)
	}
	for _, behavior := range []string{"schema", "tools"} {
		for _, mime := range []string{"audio/wav", "audio/mpeg", "video/mp4"} {
			t.Run(behavior+"/"+mime, func(t *testing.T) {
				var calls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
				}))
				defer server.Close()
				f := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-3.8-flash", server.URL, Config{AllowLoopbackEndpoint: true})
				store := &trackedBudgetArtifactStore{Store: runtimeartifact.NewMemoryStore()}
				f.service.runtimeArtifacts = store
				if err := store.Put("owned-media", runtimeartifact.ArtifactRecord{Bytes: mediaBudgetTestWAV(), MimeType: mime,
					Owner: &runtimeartifact.ArtifactOwner{AppID: "nimi.lab", SubjectUserID: "account-1", RegisteredAppSubject: "principal-1"}}); err != nil {
					t.Fatal(err)
				}
				spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return a result."}}}
				if behavior == "schema" {
					spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, Strict: true}
				} else {
					spec.Tools = []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}
					spec.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
				}
				identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "gemini", DriverId: "nimillm", DriverDialect: "gemini"}
				adapter, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "gemini", "gemini-3.8-flash", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
				if err != nil {
					t.Fatal(err)
				}
				// The corresponding pure-text advanced request still plans and serializes.
				prepared, budget, err := adapter.registration.MaterializationPlanner(context.Background(), spec, false)
				if err != nil || budget != nil {
					t.Fatalf("advanced text planning changed: %v", err)
				}
				if _, err := capabilitydriver.Gemini38FlashRequestSerializer(prepared, false); err != nil {
					t.Fatalf("advanced text serialization changed: %v", err)
				}
				spec.Input[0].Parts = []*runtimev1.ChatContentPart{artifactRefPart(&runtimev1.ChatContentArtifactRef{ArtifactId: "owned-media", MimeType: mime})}
				adapter, err = resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "gemini", "gemini-3.8-flash", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
				if err != nil {
					t.Fatal(err)
				}
				ctx := localAppArtifactContextForOwner("nimi.lab", "principal-1")
				prepared, budget, err = adapter.registration.MaterializationPlanner(ctx, spec, false)
				if err == nil {
					resolved, resolveErr := f.service.resolveTextGenerateScenarioForRoute(textbehavior.WithOwnedMediaInputBudget(ctx, budget), &runtimev1.ScenarioRequestHead{AppId: "nimi.lab", SubjectUserId: "account-1"}, prepared, false)
					resolved.release()
					t.Fatalf("advanced media reached owned resolver: opened=%v err=%v", store.opened, resolveErr)
				}
				if textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || len(store.opened) != 0 {
					t.Fatalf("wrong admission: opened=%v err=%v", store.opened, err)
				}
				// Exercise the production call ordering as well, without a test planner.
				head := &runtimev1.ScenarioRequestHead{AppId: "app.media-budget", SubjectUserId: "user-001"}
				providerTarget, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": "gemini-3.8-flash", "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
				callCtx := executionintent.WithIntent(scenarioJobUserContext(head.AppId, head.SubjectUserId), executionintent.Intent{CapabilityContract: "text.generate", Route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ConnectorRef: f.connectorID, CloudImplementation: identity, ProviderModelTarget: providerTarget})
				_, err = f.service.ExecuteScenario(callCtx, &runtimev1.ExecuteScenarioRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: spec}}})
				if textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || len(store.opened) != 0 || calls.Load() != 0 {
					t.Fatalf("unsupported request materialized or dispatched: opened=%v calls=%d err=%v", store.opened, calls.Load(), err)
				}
			})
		}
	}
}
