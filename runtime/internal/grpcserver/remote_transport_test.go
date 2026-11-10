package grpcserver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestRemoteStreamOwnersUseTheNativeStreamAdmissionBoundary(t *testing.T) {
	for _, item := range []struct {
		method  string
		request proto.Message
		ingress localappop.Ingress
	}{
		{protectedStreamTextTurnMethod, &runtimev1.StreamLocalAppTextTurnRequest{}, localappop.IngressTextTurnStream},
		{protectedSubscribeScenarioJobMethod, &runtimev1.SubscribeLocalAppScenarioJobEventsRequest{}, localappop.IngressScenarioJobSubscribe},
		{protectedSubscribeConversationMethod, &runtimev1.SubscribeLocalAppConversationEventsRequest{}, localappop.IngressConversationEventsSubscribe},
		{protectedReadLocalAppAssetMethod, &runtimev1.ReadLocalAppAssetRequest{}, localappop.IngressStorageAssetRead},
		{protectedWriteLocalAppAssetMethod, &runtimev1.WriteLocalAppAssetRequest{}, localappop.IngressStorageAssetWrite},
		{protectedSubscribeAppActivityChangesMethod, &runtimev1.SubscribeAppActivityChangesRequest{}, localappop.IngressAppActivitySubscribe},
	} {
		classified, enabled := remoteAppIngress(item.method, item.request, true)
		if !enabled || classified != item.ingress {
			t.Fatalf("stream %s did not reach its existing operation owner", item.method)
		}
		if _, enabled := remoteAppIngress(item.method, item.request, false); enabled {
			t.Fatal("stream was admitted as a unary operation")
		}
	}
	if _, enabled := remoteAppIngress("/unknown/stream", &runtimev1.StreamLocalAppTextTurnRequest{}, true); enabled {
		t.Fatal("unknown stream owner was admitted")
	}
}

func TestRemoteAssetWriteUsesOriginalStreamingOwner(t *testing.T) {
	dispatcher := newRemoteDispatcher(nil, nil, nil)
	dispatcher.register(nil, &runtimev1.RuntimeAppService_ServiceDesc)
	method, ok := dispatcher.methods[protectedWriteLocalAppAssetMethod]
	if !ok || method.stream == nil || !method.stream.ClientStreams || method.stream.ServerStreams || !remoteAppMethodSupported(protectedWriteLocalAppAssetMethod) {
		t.Fatal("the existing App asset client-stream owner is unavailable")
	}
}

func TestRemoteActivityPublicationUsesExistingAdmissionAndCannotLaunch(t *testing.T) {
	ingress, ok := remoteAppIngress(protectedPutAppActivityMethod, &runtimev1.PutAppActivityRequest{}, false)
	if !ok || ingress != localappop.IngressAppActivityPut {
		t.Fatal("remote activity publication did not reach its existing owner")
	}
	if _, ok := remoteAppIngress(protectedPutAppActivityMethod, &runtimev1.PutAppActivityRequest{}, true); ok {
		t.Fatal("publication was admitted as a stream")
	}
	for _, method := range []string{"/nimi.runtime.v1.RuntimeAppActivityService/ResolveAppActivityOpenLaunch", "/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeStop"} {
		if remoteAppMethodSupported(method) {
			t.Fatal("publication implied Host launch authority")
		}
	}
}

func TestRemoteRealmCarrierAdmitsOnlyImplementedResourceOperations(t *testing.T) {
	for method, expected := range map[string]localappop.Ingress{
		"WorldCoreController_getWorldCreationEligibility": localappop.IngressRealmWorldCreationEligibilityGet,
		"WorldCoreController_createWorldCore":             localappop.IngressRealmWorldCoreCreate,
		"WorldCoreController_replaceWorldCore":            localappop.IngressRealmWorldCoreReplace,
		"WorldCoreController_listWorldCharacters":         localappop.IngressRealmWorldCharacterList,
		"WorldCoreController_getWorldCharacter":           localappop.IngressRealmWorldCharacterGet,
		"WorldCoreController_createWorldCharacter":        localappop.IngressRealmWorldCharacterCreate,
		"WorldCoreController_replaceWorldCharacter":       localappop.IngressRealmWorldCharacterReplace,
		"WorldCoreController_listWorldEntities":           localappop.IngressRealmWorldEntityList,
		"WorldCoreController_getWorldEntity":              localappop.IngressRealmWorldEntityGet,
		"WorldCoreController_createWorldEntity":           localappop.IngressRealmWorldEntityCreate,
		"WorldCoreController_listWorldRelationships":      localappop.IngressRealmWorldRelationshipList,
		"WorldCoreController_getWorldRelationship":        localappop.IngressRealmWorldRelationshipGet,
		"WorldCoreController_listWorldCores":              localappop.IngressRealmWorldCoreList,
		"WorldCoreController_getWorldCore":                localappop.IngressRealmWorldCoreGet,
		"WorldCoreController_listPersonaCharacters":       localappop.IngressRealmPersonaCharacterListOwned,
		"WorldCoreController_getPersonaCharacter":         localappop.IngressRealmPersonaCharacterGetOwned,
		"WorldCoreController_createPersonaCharacter":      localappop.IngressRealmPersonaCharacterCreate,
		"WorldCoreController_replacePersonaCharacter":     localappop.IngressRealmPersonaCharacterReplace,
		"WorldCoreController_deletePersonaCharacter":      localappop.IngressRealmPersonaCharacterDelete,
	} {
		ingress, enabled := remoteAppIngress(protectedInvokeRealmUnaryMethod, &runtimev1.InvokeRealmUnaryRequest{MethodId: method}, false)
		if !enabled || ingress != expected {
			t.Fatalf("resource method %s lost its original admission", method)
		}
	}
	for _, method := range []string{"AuthController_login", "PostsController_createPost", "not-a-method"} {
		if _, enabled := remoteAppIngress(protectedInvokeRealmUnaryMethod, &runtimev1.InvokeRealmUnaryRequest{MethodId: method}, false); enabled {
			t.Fatalf("unimplemented Realm operation exposed remotely: %s", method)
		}
	}
	if _, enabled := remoteAppIngress(protectedInvokeRealmUnaryMethod, &runtimev1.InvokeRealmUnaryRequest{MethodId: "WorldCoreController_listWorldCores"}, true); enabled {
		t.Fatal("Realm unary acquired a stream carrier")
	}
}

func TestRemoteLabCarrierDoesNotExposeNativeOrManagerAuthority(t *testing.T) {
	for _, method := range []string{protectedAgentReferenceListMethod, protectedOpenConversationMethod, protectedReadLocalAppStorageJSONMethod, protectedAgentManagerSnapshotMethod} {
		if !remoteAppMethodSupported(method) {
			t.Fatalf("implemented App operation unavailable: %s", method)
		}
	}
	for _, method := range []string{protectedOpenLocalAppSessionMethod, protectedDesktopAgentReferenceResolveMethod, protectedRevealLocalAppAssetMethod,
		"/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeStop", "/nimi.runtime.v1.RuntimeConnectorService/CreateConnector"} {
		if remoteAppMethodSupported(method) {
			t.Fatalf("native or manager authority exposed: %s", method)
		}
	}
}

func TestRemoteMediaBoundaryPreservesBusinessContentAndOwnedArtifacts(t *testing.T) {
	business, err := structpb.NewStruct(map[string]any{"url": "http://192.168.1.1/private", "nested": map[string]any{"image_url": "https://business.example"}})
	if err != nil {
		t.Fatal(err)
	}
	request := &runtimev1.StreamLocalAppTextTurnRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Explain http://192.168.1.1/private without fetching it"}},
		Tools:    []*runtimev1.ToolSpec{{Name: "store_link", InputSchema: business}},
	}
	if remoteMediaReference(request.ProtoReflect()) {
		t.Fatal("business text or tool JSON became a media locator")
	}
	part := &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF,
		Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: "owned-artifact"}}}
	if remoteMediaReference(part.ProtoReflect()) {
		t.Fatal("scoped artifact was rejected")
	}
	part = &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
		Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "http://192.168.1.1/private"}}}
	if !remoteMediaReference(part.ProtoReflect()) {
		t.Fatal("typed PC-network media locator was accepted")
	}
}
