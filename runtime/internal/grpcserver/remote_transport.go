package grpcserver

import (
	"context"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/remoteaccess"
	appservice "github.com/nimiplatform/nimi/runtime/internal/services/app"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

type remoteRPCMethod struct {
	service any
	unary   *grpc.MethodDesc
	stream  *grpc.StreamDesc
	input   protoreflect.MessageType
}
type remoteDispatcher struct {
	app            *appservice.Service
	ownerAdmission protectedAppOwnerAdmission
	registry       *activeRPCRegistry
	methods        map[string]remoteRPCMethod
}

func newRemoteDispatcher(app *appservice.Service, owner protectedAppOwnerAdmission, registry *activeRPCRegistry) *remoteDispatcher {
	return &remoteDispatcher{app: app, ownerAdmission: owner, registry: registry, methods: make(map[string]remoteRPCMethod)}
}
func (d *remoteDispatcher) register(service any, descriptor *grpc.ServiceDesc) {
	ref, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(descriptor.ServiceName))
	if err != nil {
		return
	}
	schema, ok := ref.(protoreflect.ServiceDescriptor)
	if !ok {
		return
	}
	for i := range descriptor.Methods {
		method := &descriptor.Methods[i]
		methodSchema := schema.Methods().ByName(protoreflect.Name(method.MethodName))
		if methodSchema == nil {
			continue
		}
		input, err := protoregistry.GlobalTypes.FindMessageByName(methodSchema.Input().FullName())
		if err != nil {
			continue
		}
		d.methods["/"+descriptor.ServiceName+"/"+method.MethodName] = remoteRPCMethod{service: service, unary: method, input: input}
	}
	for i := range descriptor.Streams {
		method := &descriptor.Streams[i]
		if method.ClientStreams && method.ServerStreams {
			continue
		}
		methodSchema := schema.Methods().ByName(protoreflect.Name(method.StreamName))
		if methodSchema == nil {
			continue
		}
		input, err := protoregistry.GlobalTypes.FindMessageByName(methodSchema.Input().FullName())
		if err != nil {
			continue
		}
		d.methods["/"+descriptor.ServiceName+"/"+method.StreamName] = remoteRPCMethod{service: service, stream: method, input: input}
	}
}

// This is the implemented carrier subset, not an App permission table. The
// normal registered declaration and exact AppOperation admission still run.
func remoteAppMethodSupported(method string) bool {
	switch method {
	case protectedPutAppActivityMethod, protectedListAppActivitiesMethod, protectedSubscribeAppActivityChangesMethod, protectedMarkAppActivityReadMethod,
		protectedReadLocalAppStorageJSONMethod, protectedWriteLocalAppStorageJSONMethod, protectedRemoveLocalAppStorageJSONMethod,
		protectedStatLocalAppAssetMethod, protectedListLocalAppAssetsMethod, protectedReadLocalAppAssetMethod, protectedWriteLocalAppAssetMethod,
		protectedRemoveLocalAppAssetMethod, protectedMoveLocalAppAssetMethod, protectedAdoptLocalAppArtifactMethod,
		protectedAgentReferenceListMethod, protectedAgentIntroductionGetMethod,
		protectedOpenConversationMethod, protectedSendConversationTurnMethod, protectedInterruptConversationTurnMethod,
		protectedSubscribeConversationMethod, protectedConversationSnapshotMethod, protectedConversationMessageReadMethod,
		protectedConversationFollowUpMethod, protectedUploadConversationAttachmentMethod, protectedReadConversationArtifactMethod,
		protectedTranscribeConversationVoiceMethod, protectedRenderConversationVoiceMethod,
		protectedEmbodimentSnapshotMethod, protectedSubscribeEmbodimentEventsMethod,
		protectedGetSharedAIConfigMethod, protectedOverwriteSharedAIConfigMethod, protectedListSharedAIConfigOptionsMethod,
		protectedAgentManagerSnapshotMethod, protectedAutonomySnapshotMethod, protectedUpdateAutonomyMethod,
		protectedUpdateConversationContextMethod, protectedPresentationSnapshotMethod, protectedPresentationAssetMethod,
		protectedCommitPresentationMethod, protectedInspectAgentMemoryMethod, protectedCorrectAgentMemoryMethod,
		protectedForgetAgentMemoryMethod, protectedSwitchAgentMemoryMethod, protectedDeleteAgentMemoryMethod:
		return true
	case "/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig", "/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig", "/nimi.runtime.v1.RuntimeAiService/ListAppAIConfigOptions",
		"/nimi.runtime.v1.RuntimeAiService/GenerateLocalAppTextCandidate", "/nimi.runtime.v1.RuntimeAiService/StreamLocalAppTextTurn", "/nimi.runtime.v1.RuntimeAiService/ExecuteLocalAppScenario",
		"/nimi.runtime.v1.RuntimeAiService/SubmitLocalAppScenarioJob", "/nimi.runtime.v1.RuntimeAiService/GetLocalAppScenarioJob", "/nimi.runtime.v1.RuntimeAiService/CancelLocalAppScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/SubscribeLocalAppScenarioJobEvents", "/nimi.runtime.v1.RuntimeAiService/ReadLocalAppArtifact", "/nimi.runtime.v1.RuntimeAiService/UploadLocalAppArtifact",
		"/nimi.runtime.v1.RuntimeAiService/ListLocalAppVoiceAssets", "/nimi.runtime.v1.RuntimeAiService/DeleteLocalAppVoiceAsset":
		return true
	default:
		return false
	}
}
func remoteManagerMethodSupported(method string) bool {
	switch method {
	case "/nimi.runtime.v1.RuntimeServiceControlService/GetRuntimeServiceState", "/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeStop",
		"/nimi.runtime.v1.RuntimeRemoteAccessService/GetRemoteAccessState", "/nimi.runtime.v1.RuntimeRemoteAccessService/SetRemoteSourcePaused",
		"/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig", "/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig", "/nimi.runtime.v1.RuntimeAiService/ListAppAIConfigOptions":
		return true
	default:
		return false
	}
}

// @nimi-authority: rule.nimi.runtime.remote-access.direct-transport
func (d *remoteDispatcher) dispatch(ctx context.Context, peer *remoteaccess.Peer, call remoteaccess.Call, emit func([]byte) error) ([]byte, bool, error) {
	info, live := peer.Snapshot()
	if !live || d.app == nil {
		return nil, false, remoteDispatchDenied()
	}
	manager := info.Source.Role == "official_manager"
	if (!manager && !remoteAppMethodSupported(call.Method)) || (manager && !remoteManagerMethodSupported(call.Method)) {
		return nil, false, grpcerr.WithReasonCode(codes.Unimplemented, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNSUPPORTED)
	}
	method, exists := d.methods[call.Method]
	if !exists {
		return nil, false, grpcerr.WithReasonCode(codes.Unimplemented, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNSUPPORTED)
	}
	if d.registry == nil {
		return nil, false, remoteDispatchDenied()
	}
	var finish func()
	var touch func()
	var admitted bool
	serverStreaming := method.stream != nil && method.stream.ServerStreams
	clientStreaming := method.stream != nil && method.stream.ClientStreams
	if method.stream != nil {
		ctx, _, finish, touch, admitted = d.registry.TrackStream(ctx, call.Method, &grpc.StreamServerInfo{FullMethod: call.Method, IsServerStream: serverStreaming, IsClientStream: clientStreaming})
	} else {
		ctx, finish, admitted = d.registry.TrackUnary(ctx, call.Method)
	}
	defer finish()
	if !admitted {
		return nil, serverStreaming, status.Error(codes.Unavailable, "Runtime is not accepting new calls.")
	}
	if clientStreaming != (call.Input != nil) {
		return nil, false, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	first := call.Payload
	request := method.input.New().Interface()
	if err := proto.Unmarshal(first, request); err != nil {
		return nil, false, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if call.TraceID != "" || call.IdempotencyKey != "" {
		controls := metadata.MD{}
		if call.TraceID != "" {
			controls.Set("x-nimi-trace-id", call.TraceID)
		}
		if call.IdempotencyKey != "" {
			controls.Set("x-nimi-idempotency-key", call.IdempotencyKey)
		}
		ctx = metadata.NewIncomingContext(ctx, controls)
	}
	var err error
	if manager {
		ctx, err = d.app.AuthorizeRemoteManager(ctx, peer)
		if err == nil {
			ctx, err = withAuthorizedAppOwnerDecision(ctx, call.Method, request, d.ownerAdmission)
		}
	} else {
		if protectedLocalAppRequestHasCallerAssertionForMethod(ctx, request, call.Method) {
			return nil, false, remoteDispatchDenied()
		}
		if remoteMediaReference(request.ProtoReflect()) {
			return nil, false, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
				grpcerr.ReasonOptions{ActionHint: "upload_app_artifact", Message: "Remote media input requires inline content or an App-owned artifact reference."})
		}
		ingress, ownerEnabled := remoteAppIngress(call.Method, request, method.stream != nil)
		ctx, err = d.app.AuthorizeRemoteAppIngress(ctx, peer, ingress)
		if err == nil && !ownerEnabled {
			err = grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
		}
	}
	if err != nil {
		return nil, serverStreaming, err
	}
	received := 0
	decode := func(target any) error {
		message, ok := target.(proto.Message)
		if !ok || message.ProtoReflect().Descriptor().FullName() != request.ProtoReflect().Descriptor().FullName() {
			return remoteDispatchDenied()
		}
		if received == 0 {
			proto.Reset(message)
			proto.Merge(message, request)
		} else if !clientStreaming {
			return io.EOF
		} else {
			payload, err := call.Input(ctx)
			if err != nil {
				return err
			}
			if err := proto.Unmarshal(payload, message); err != nil {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
		}
		received++
		if clientStreaming {
			if touch != nil {
				touch()
			}
		}
		return nil
	}
	if method.unary != nil {
		result, err := method.unary.Handler(method.service, ctx, decode, nil)
		if err != nil {
			return nil, false, err
		}
		message, ok := result.(proto.Message)
		if !ok || !message.ProtoReflect().IsValid() {
			return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		payload, err := proto.Marshal(message)
		return payload, false, err
	}
	var reply []byte
	replied := false
	stream := &remoteServerStream{ctx: ctx, decode: decode, emit: func(data []byte) error {
		if touch != nil {
			touch()
		}
		if serverStreaming {
			return emit(data)
		}
		if replied {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		reply, replied = data, true
		return nil
	}}
	err = method.stream.Handler(method.service, stream)
	if err == nil && !serverStreaming && !replied {
		err = grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return reply, serverStreaming, err
}

// Native unary and stream transports use different owner dispatch gates. Keep
// that distinction while reusing their exact AppOperation classification.
func remoteAppIngress(method string, request proto.Message, streamRPC bool) (localappop.Ingress, bool) {
	if streamRPC {
		ingress := protectedLocalAppStreamIngress(method)
		return ingress, ingress != localappop.IngressUnknown
	}
	ingress := protectedLocalAppUnaryIngress(method, request)
	return ingress, protectedLocalAppOwnerEnabled(method, request, ingress)
}

type remoteServerStream struct {
	ctx    context.Context
	decode func(any) error
	emit   func([]byte) error
}

func (stream *remoteServerStream) Context() context.Context     { return stream.ctx }
func (stream *remoteServerStream) SetHeader(metadata.MD) error  { return nil }
func (stream *remoteServerStream) SendHeader(metadata.MD) error { return nil }
func (stream *remoteServerStream) SetTrailer(metadata.MD)       {}
func (stream *remoteServerStream) RecvMsg(value any) error {
	if err := stream.ctx.Err(); err != nil {
		return status.FromContextError(err).Err()
	}
	return stream.decode(value)
}
func (stream *remoteServerStream) SendMsg(value any) error {
	message, ok := value.(proto.Message)
	if !ok {
		return remoteDispatchDenied()
	}
	data, err := proto.Marshal(message)
	if err != nil {
		return err
	}
	return stream.emit(data)
}

// URLs inside business JSON or prompt text remain content. Only actual typed
// media-reference fields are excluded until a remote-safe URL-fetch carrier
// exists; inline bytes and owner-checked artifact IDs use their normal owner.
func remoteMediaReference(message protoreflect.Message) bool {
	if strings.HasPrefix(string(message.Descriptor().FullName()), "google.protobuf.") {
		return false
	}
	found := false
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.IsMap() {
			return true
		}
		check := func(value protoreflect.Value) bool {
			if field.Kind() == protoreflect.StringKind {
				name := string(field.Name())
				return value.String() != "" && (name == "url" || name == "uri" || strings.HasSuffix(name, "_url") || strings.HasSuffix(name, "_uri"))
			}
			return field.Kind() == protoreflect.MessageKind && remoteMediaReference(value.Message())
		}
		if field.IsList() {
			list := value.List()
			for i := 0; i < list.Len(); i++ {
				if check(list.Get(i)) {
					found = true
					break
				}
			}
		} else {
			found = check(value)
		}
		return !found
	})
	return found
}
func remoteDispatchDenied() error {
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
}
