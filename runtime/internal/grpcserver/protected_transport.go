package grpcserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
)

const protectedOpenDesktopSessionMethod = "/nimi.runtime.v1.RuntimeAuthService/OpenDesktopSession"
const protectedRequestRuntimeRestartMethod = "/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeRestart"
const protectedDesktopAuditProjectionMethod = "/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents"
const protectedBundledProfileMetadata = "x-nimi-protected-bundled-profile"
const protectedFirstPartyProfileMetadata = "x-nimi-protected-first-party-profile"

func protectedDesktopUnaryMethodAllowed(method string) bool {
	_, allowed := protectedDesktopMethodRole(method)
	return allowed
}

func protectedDesktopStreamMethodAllowed(method string) bool {
	return method == "/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents"
}

func protectedDesktopMethodRole(method string) (protectedlocal.OriginRole, bool) {
	if kind, ok := protectedlocal.FirstPartyProfileMethod(protectedlocal.DesktopMachineProductProfileID, method); ok && kind == protectedlocal.FirstPartyMethodUnary {
		return protectedlocal.RoleVerifiedDesktopProcess, true
	}
	if kind, ok := protectedlocal.FirstPartyProfileMethod(protectedlocal.DesktopAccountProductProfileID, method); ok && kind == protectedlocal.FirstPartyMethodUnary {
		return protectedlocal.RoleDesktopAccountHost, true
	}
	switch method {
	case protectedOpenDesktopSessionMethod, protectedRequestRuntimeRestartMethod:
		return protectedlocal.RoleVerifiedDesktopProcess, true
	case "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus",
		"/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents",
		"/nimi.runtime.v1.RuntimeAccountService/BeginLogin",
		"/nimi.runtime.v1.RuntimeAccountService/CompleteLogin",
		"/nimi.runtime.v1.RuntimeAccountService/RequestPresenceVerification",
		"/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary",
		"/nimi.runtime.v1.RuntimeAccountService/Logout",
		"/nimi.runtime.v1.RuntimeAccountService/SwitchAccount":
		return protectedlocal.RoleDesktopAccountHost, true
	case "/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch",
		"/nimi.runtime.v1.RuntimeAppService/BindLocalAppProcess",
		"/nimi.runtime.v1.RuntimeDevelopmentService/GetDeveloperModeStatus",
		"/nimi.runtime.v1.RuntimeDevelopmentService/GetLocalDevelopmentAuthoritySummary",
		"/nimi.runtime.v1.RuntimeDevelopmentService/SetDeveloperMode",
		"/nimi.runtime.v1.RuntimeDevelopmentService/EvaluateLocalDevelopmentProject",
		"/nimi.runtime.v1.RuntimeDevelopmentService/DecideLocalDevelopmentProject",
		"/nimi.runtime.v1.RuntimeDevelopmentService/ListLocalDevelopmentAuthorizations",
		"/nimi.runtime.v1.RuntimeDevelopmentService/RevokeLocalDevelopmentAuthorization",
		"/nimi.runtime.v1.RuntimeDevelopmentService/EndLocalDevelopmentRun":
		return protectedlocal.RoleLocalAppControl, true
	default:
		return "", false
	}
}

func protectedDesktopProductProfileMethod(method string) bool {
	if _, ok := protectedlocal.FirstPartyProfileMethod(protectedlocal.DesktopMachineProductProfileID, method); ok {
		return true
	}
	_, ok := protectedlocal.FirstPartyProfileMethod(protectedlocal.DesktopAccountProductProfileID, method)
	return ok
}

type protectedFirstPartyProfile struct {
	profileID string
	role      protectedlocal.OriginRole
	kind      protectedlocal.FirstPartyMethodKind
	account   bool
}

// protectedDesktopNetConn is minted only after the native listener has
// completed OS peer verification and established a protected-local Connection.
// The private concrete type prevents an ordinary listener from supplying the
// capability to the gRPC handshake.
type protectedDesktopNetConn struct {
	net.Conn
	desktopConnection *protectedlocal.Connection
	closeOnce         sync.Once
	closeErr          error
}

func wrapProtectedDesktopNetConn(raw net.Conn, connection *protectedlocal.Connection) net.Conn {
	return &protectedDesktopNetConn{Conn: raw, desktopConnection: connection}
}

// nativeVerifiedDesktopListener accepts only the opaque connection carrier
// minted by protectedlocal after Windows peer verification. The capability is
// extracted through a package-private carrier method, so an ordinary listener
// cannot promote a raw net.Conn into protected gRPC transport authority.
type nativeVerifiedDesktopListener struct {
	net.Listener
}

func (listener *nativeVerifiedDesktopListener) Accept() (net.Conn, error) {
	if listener == nil || listener.Listener == nil {
		return nil, fmt.Errorf("verified native Desktop listener is required")
	}
	raw, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	connection, ok := protectedlocal.NativeDesktopConnectionFromNetConn(raw)
	if !ok {
		_ = raw.Close()
		return nil, fmt.Errorf("native Desktop listener returned an unverified connection")
	}
	return wrapProtectedDesktopNetConn(raw, connection), nil
}

func (connection *protectedDesktopNetConn) Close() error {
	if connection == nil {
		return nil
	}
	connection.closeOnce.Do(func() {
		var transportErr error
		if connection.Conn != nil {
			transportErr = connection.Conn.Close()
		}
		if connection.desktopConnection != nil {
			connection.desktopConnection.Revoke()
		}
		connection.closeErr = transportErr
	})
	return connection.closeErr
}

type protectedDesktopAuthInfo struct {
	connection *protectedlocal.Connection
}

func (*protectedDesktopAuthInfo) AuthType() string { return "nimi-protected-local-v1" }

type protectedDesktopTransportCredentials struct{}

func newProtectedDesktopTransportCredentials() credentials.TransportCredentials {
	return protectedDesktopTransportCredentials{}
}

func (protectedDesktopTransportCredentials) ClientHandshake(context.Context, string, net.Conn) (net.Conn, credentials.AuthInfo, error) {
	return nil, nil, fmt.Errorf("protected Desktop transport credentials are server-only")
}

func (protectedDesktopTransportCredentials) ServerHandshake(raw net.Conn) (net.Conn, credentials.AuthInfo, error) {
	connection, ok := raw.(*protectedDesktopNetConn)
	if !ok || connection == nil || connection.Conn == nil || connection.desktopConnection == nil {
		return nil, nil, fmt.Errorf("protected Desktop transport requires a native verified connection")
	}
	origin := connection.desktopConnection.Origin()
	if origin.TransportClass != protectedlocal.TransportDesktopControl || !origin.HasRole(protectedlocal.RoleVerifiedDesktopProcess) {
		return nil, nil, fmt.Errorf("protected Desktop transport requires the verified Desktop role")
	}
	return raw, &protectedDesktopAuthInfo{connection: connection.desktopConnection}, nil
}

func (protectedDesktopTransportCredentials) Info() credentials.ProtocolInfo {
	return credentials.ProtocolInfo{
		SecurityProtocol: "nimi-protected-local",
		SecurityVersion:  "1",
	}
}

func (protectedDesktopTransportCredentials) Clone() credentials.TransportCredentials {
	return protectedDesktopTransportCredentials{}
}

func (protectedDesktopTransportCredentials) OverrideServerName(string) error {
	return fmt.Errorf("protected Desktop transport has no portable server name")
}

type protectedAccountPrincipalProvider interface {
	BindAuthenticatedRuntimeGeneration(context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool)
}

func newProtectedDesktopRPCServer(
	runtimeControlService runtimev1.RuntimeServiceControlServiceServer,
	authService runtimev1.RuntimeAuthServiceServer,
	accountService runtimev1.RuntimeAccountServiceServer,
	auditService runtimev1.RuntimeAuditServiceServer,
	localService runtimev1.RuntimeLocalServiceServer,
	aiService runtimev1.RuntimeAiServiceServer,
	agentService runtimev1.RuntimeAgentServiceServer,
	connectorService runtimev1.RuntimeConnectorServiceServer,
	externalAgentService runtimev1.RuntimeExternalAgentServiceServer,
	appService runtimev1.RuntimeAppServiceServer,
	developmentService runtimev1.RuntimeDevelopmentServiceServer,
	artifactService runtimev1.RuntimeArtifactServiceServer,
	desktopSessions *protectedlocal.DesktopSessionManager,
	accountPrincipalProvider protectedAccountPrincipalProvider,
) *grpc.Server {
	server := grpc.NewServer(
		grpc.Creds(newProtectedDesktopTransportCredentials()),
		grpc.MaxRecvMsgSize(maxGRPCRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes),
		grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.ReadBufferSize(grpcIOBufferBytes),
		grpc.WriteBufferSize(grpcIOBufferBytes),
		grpc.UnaryInterceptor(newUnaryProtectedDesktopTransportInterceptor(desktopSessions, accountPrincipalProvider)),
		grpc.StreamInterceptor(newStreamProtectedDesktopTransportInterceptor(desktopSessions, accountPrincipalProvider)),
	)
	runtimev1.RegisterRuntimeServiceControlServiceServer(server, runtimeControlService)
	runtimev1.RegisterRuntimeAuthServiceServer(server, authService)
	runtimev1.RegisterRuntimeAccountServiceServer(server, accountService)
	runtimev1.RegisterRuntimeAuditServiceServer(server, auditService)
	runtimev1.RegisterRuntimeLocalServiceServer(server, localService)
	runtimev1.RegisterRuntimeAiServiceServer(server, aiService)
	runtimev1.RegisterRuntimeAgentServiceServer(server, agentService)
	runtimev1.RegisterRuntimeConnectorServiceServer(server, connectorService)
	runtimev1.RegisterRuntimeExternalAgentServiceServer(server, externalAgentService)
	runtimev1.RegisterRuntimeAppServiceServer(server, appService)
	runtimev1.RegisterRuntimeDevelopmentServiceServer(server, developmentService)
	runtimev1.RegisterRuntimeArtifactServiceServer(server, artifactService)
	return server
}

func newUnaryProtectedDesktopTransportInterceptor(desktopSessions *protectedlocal.DesktopSessionManager, accountPrincipalProvider protectedAccountPrincipalProvider) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if info == nil {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		bundledProfile, bundled, bundledErr := resolveProtectedBundledAvatarProfile(ctx, info.FullMethod, bundledavatar.MethodUnary)
		if bundledErr != nil {
			return nil, bundledErr
		}
		firstPartyProfile, firstParty, firstPartyErr := resolveProtectedFirstPartyProfile(ctx, info.FullMethod, protectedlocal.FirstPartyMethodUnary)
		if firstPartyErr != nil || (bundled && firstParty) {
			if firstPartyErr != nil {
				return nil, firstPartyErr
			}
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		if !bundled && !firstParty && protectedDesktopProductProfileMethod(info.FullMethod) {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		if !bundled && !firstParty && !protectedDesktopUnaryMethodAllowed(info.FullMethod) {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		connection, err := protectedDesktopConnectionFromPeer(ctx)
		if err != nil {
			return nil, err
		}
		protectedContext := protectedlocal.ContextWithDesktopConnection(ctx, connection)
		if err := authorizeProtectedDesktopMethodForProfile(protectedContext, info.FullMethod, desktopSessions, bundled, firstPartyProfile, firstParty); err != nil {
			return nil, err
		}
		var cancel context.CancelFunc
		if bundled {
			principal, err := bindBundledAvatarPrincipal(protectedContext, bundledProfile.Capability, desktopSessions, accountPrincipalProvider)
			if err != nil {
				return nil, err
			}
			protectedContext, cancel = context.WithCancel(protectedContext)
			protectedContext = bindProtectedPrincipalContext(protectedContext, principal, cancel)
			protectedContext = envelope.WithValidatedProtectedCapability(
				protectedContext,
				bundledavatar.AppID,
				bundledProfile.Capability,
			)
		} else if firstPartyProfile.account {
			principal, err := bindDesktopAccountProductPrincipal(protectedContext, firstPartyProfile.profileID, desktopSessions, accountPrincipalProvider)
			if err != nil {
				return nil, err
			}
			protectedContext, err = bindDesktopAccountHandlerIdentity(protectedContext, principal)
			if err != nil {
				return nil, err
			}
			protectedContext, cancel = context.WithCancel(protectedContext)
			protectedContext = bindProtectedPrincipalContext(protectedContext, principal, cancel)
			protectedContext = withDesktopAccountProductAuthorizationDecision(protectedContext, info.FullMethod)
		} else {
			if firstParty && authn.IdentityFromContext(protectedContext) != nil {
				return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
			}
			protectedContext = withProtectedDesktopAuthorizationDecision(protectedContext, info.FullMethod)
		}
		if cancel != nil {
			defer cancel()
		}
		return handler(protectedContext, req)
	}
}

func withDesktopAccountProductAuthorizationDecision(ctx context.Context, method string) context.Context {
	switch method {
	case "/nimi.runtime.v1.RuntimeAppService/SendAppMessage":
		return envelope.WithValidatedProtectedCapability(ctx, envelope.ProtectedDesktopAppID, "runtime.agent.turn.write")
	case "/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages":
		return envelope.WithValidatedProtectedCapability(ctx, envelope.ProtectedDesktopAppID, "runtime.agent.turn.read")
	default:
		return ctx
	}
}

func withProtectedDesktopAuthorizationDecision(ctx context.Context, method string) context.Context {
	if method != protectedDesktopAuditProjectionMethod {
		return ctx
	}
	return envelope.WithValidatedProtectedCapability(
		ctx,
		envelope.ProtectedDesktopAppID,
		envelope.ProtectedDesktopAuditReadCapability,
	)
}

type protectedDesktopServerStream struct {
	grpc.ServerStream
	ctx       context.Context
	principal *protectedprincipal.Principal
}

func (stream *protectedDesktopServerStream) Context() context.Context {
	return stream.ctx
}

func (stream *protectedDesktopServerStream) SendMsg(message any) error {
	if stream.principal != nil && !stream.principal.Valid() {
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return stream.ServerStream.SendMsg(message)
}

func newStreamProtectedDesktopTransportInterceptor(desktopSessions *protectedlocal.DesktopSessionManager, accountPrincipalProvider protectedAccountPrincipalProvider) grpc.StreamServerInterceptor {
	return func(srv any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if info == nil {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		bundledProfile, bundled, bundledErr := resolveProtectedBundledAvatarProfile(stream.Context(), info.FullMethod, bundledavatar.MethodServerStream)
		if bundledErr != nil {
			return bundledErr
		}
		firstPartyProfile, firstParty, firstPartyErr := resolveProtectedFirstPartyProfile(stream.Context(), info.FullMethod, protectedlocal.FirstPartyMethodServerStream)
		if firstPartyErr != nil || (bundled && firstParty) {
			if firstPartyErr != nil {
				return firstPartyErr
			}
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		if !bundled && !firstParty && protectedDesktopProductProfileMethod(info.FullMethod) {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		if !bundled && !firstParty && !protectedDesktopStreamMethodAllowed(info.FullMethod) {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		connection, err := protectedDesktopConnectionFromPeer(stream.Context())
		if err != nil {
			return err
		}
		protectedContext := protectedlocal.ContextWithDesktopConnection(stream.Context(), connection)
		if err := authorizeProtectedDesktopMethodForProfile(protectedContext, info.FullMethod, desktopSessions, bundled, firstPartyProfile, firstParty); err != nil {
			return err
		}
		var principal *protectedprincipal.Principal
		var cancel context.CancelFunc
		if bundled {
			bound, err := bindBundledAvatarPrincipal(protectedContext, bundledProfile.Capability, desktopSessions, accountPrincipalProvider)
			if err != nil {
				return err
			}
			protectedContext, cancel = context.WithCancel(protectedContext)
			protectedContext = bindProtectedPrincipalContext(protectedContext, bound, cancel)
			protectedContext = envelope.WithValidatedProtectedCapability(
				protectedContext,
				bundledavatar.AppID,
				bundledProfile.Capability,
			)
			principal = &bound
		} else if firstPartyProfile.account {
			bound, err := bindDesktopAccountProductPrincipal(protectedContext, firstPartyProfile.profileID, desktopSessions, accountPrincipalProvider)
			if err != nil {
				return err
			}
			protectedContext, err = bindDesktopAccountHandlerIdentity(protectedContext, bound)
			if err != nil {
				return err
			}
			protectedContext, cancel = context.WithCancel(protectedContext)
			protectedContext = bindProtectedPrincipalContext(protectedContext, bound, cancel)
			protectedContext = withDesktopAccountProductAuthorizationDecision(protectedContext, info.FullMethod)
			principal = &bound
		} else if firstParty && authn.IdentityFromContext(protectedContext) != nil {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		if cancel != nil {
			defer cancel()
		}
		return handler(srv, &protectedDesktopServerStream{ServerStream: stream, ctx: protectedContext, principal: principal})
	}
}

func bindProtectedPrincipalContext(ctx context.Context, principal protectedprincipal.Principal, cancel context.CancelFunc) context.Context {
	go func() {
		select {
		case <-principal.Done():
			cancel()
		case <-ctx.Done():
		}
	}()
	return protectedprincipal.With(ctx, principal)
}

func bindBundledAvatarPrincipal(
	ctx context.Context,
	capability string,
	desktopSessions *protectedlocal.DesktopSessionManager,
	provider protectedAccountPrincipalProvider,
) (protectedprincipal.Principal, error) {
	if desktopSessions == nil || provider == nil {
		return protectedprincipal.Principal{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	}
	projection, generation, invalidated, ok := provider.BindAuthenticatedRuntimeGeneration(ctx)
	principal := protectedprincipal.New(
		bundledavatar.AppID, bundledavatar.ProfileID, capability, projection,
		generation, desktopSessions.BootEpoch(), invalidated,
	)
	if !ok || !principal.Valid() {
		return protectedprincipal.Principal{}, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return principal, nil
}

func bindDesktopAccountProductPrincipal(
	ctx context.Context,
	profileID string,
	desktopSessions *protectedlocal.DesktopSessionManager,
	provider protectedAccountPrincipalProvider,
) (protectedprincipal.Principal, error) {
	if desktopSessions == nil || provider == nil || profileID != protectedlocal.DesktopAccountProductProfileID {
		return protectedprincipal.Principal{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	}
	projection, generation, invalidated, ok := provider.BindAuthenticatedRuntimeGeneration(ctx)
	principal := protectedprincipal.NewDesktopAccountProduct(
		projection, generation, desktopSessions.BootEpoch(), invalidated,
	)
	if !ok || !principal.Valid() {
		return protectedprincipal.Principal{}, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return principal, nil
}

func bindDesktopAccountHandlerIdentity(ctx context.Context, principal protectedprincipal.Principal) (context.Context, error) {
	if !principal.Valid() {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if existing := authn.IdentityFromContext(ctx); existing != nil && strings.TrimSpace(existing.SubjectUserID) != principal.AccountID {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: principal.AccountID}), nil
}

func resolveProtectedFirstPartyProfile(ctx context.Context, method string, expectedKind protectedlocal.FirstPartyMethodKind) (protectedFirstPartyProfile, bool, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok || len(md.Get(protectedFirstPartyProfileMetadata)) == 0 {
		return protectedFirstPartyProfile{}, false, nil
	}
	markers := md.Get(protectedFirstPartyProfileMetadata)
	appIDs := md.Get("x-nimi-app-id")
	if len(markers) != 1 || len(appIDs) != 1 || appIDs[0] != envelope.ProtectedDesktopAppID {
		return protectedFirstPartyProfile{}, false, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	profile := protectedFirstPartyProfile{kind: expectedKind}
	switch markers[0] {
	case protectedlocal.DesktopMachineProductNativeMarker:
		profile.profileID = protectedlocal.DesktopMachineProductProfileID
		profile.role = protectedlocal.RoleVerifiedDesktopProcess
	case protectedlocal.DesktopAccountProductNativeMarker:
		profile.profileID = protectedlocal.DesktopAccountProductProfileID
		profile.role = protectedlocal.RoleDesktopAccountHost
		profile.account = true
	default:
		return protectedFirstPartyProfile{}, false, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	kind, admitted := protectedlocal.FirstPartyProfileMethod(profile.profileID, method)
	if !admitted || kind != expectedKind {
		return protectedFirstPartyProfile{}, false, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	return profile, true, nil
}

func resolveProtectedBundledAvatarProfile(ctx context.Context, method string, expectedKind bundledavatar.MethodKind) (bundledavatar.MethodProfile, bool, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok || len(md.Get(protectedBundledProfileMetadata)) == 0 {
		return bundledavatar.MethodProfile{}, false, nil
	}
	profiles := md.Get(protectedBundledProfileMetadata)
	appIDs := md.Get("x-nimi-app-id")
	if len(profiles) != 1 || profiles[0] != bundledavatar.NativeProfileMarker ||
		len(appIDs) != 1 || appIDs[0] != bundledavatar.AppID {
		return bundledavatar.MethodProfile{}, false, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	profile, admitted := bundledavatar.Method(method)
	if !admitted || profile.Kind != expectedKind {
		return bundledavatar.MethodProfile{}, false, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	return profile, true, nil
}

func authorizeProtectedDesktopMethodForProfile(
	ctx context.Context,
	method string,
	desktopSessions *protectedlocal.DesktopSessionManager,
	bundledAvatar bool,
	firstParty protectedFirstPartyProfile,
	hasFirstParty bool,
) error {
	if bundledAvatar {
		if desktopSessions == nil {
			return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
		}
		if err := desktopSessions.AuthorizeContext(ctx, protectedlocal.RoleBundledAvatarHost); err != nil {
			return protectedDesktopSessionAuthorizationError(err)
		}
		return nil
	}
	if hasFirstParty {
		if desktopSessions == nil {
			return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
		}
		if err := desktopSessions.AuthorizeContext(ctx, firstParty.role); err != nil {
			return protectedDesktopSessionAuthorizationError(err)
		}
		return nil
	}
	return authorizeProtectedDesktopMethod(ctx, method, desktopSessions)
}

func authorizeProtectedDesktopMethod(ctx context.Context, method string, desktopSessions *protectedlocal.DesktopSessionManager) error {
	role, allowed := protectedDesktopMethodRole(method)
	if !allowed {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	if method == protectedOpenDesktopSessionMethod {
		return nil
	}
	if desktopSessions == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	}
	if err := desktopSessions.AuthorizeContext(ctx, role); err != nil {
		return protectedDesktopSessionAuthorizationError(err)
	}
	return nil
}

func protectedDesktopSessionAuthorizationError(err error) error {
	var failure *protectedlocal.Failure
	if !errors.As(err, &failure) {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	}
	reasonValue, ok := runtimev1.ReasonCode_value[string(failure.Reason())]
	if !ok {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	}
	retryable := failure.Retryable()
	return grpcerr.WithReasonCodeOptions(protectedDesktopSessionAuthorizationCode(failure.Reason()), runtimev1.ReasonCode(reasonValue), grpcerr.ReasonOptions{
		ActionHint: failure.ActionHint(),
		Retryable:  &retryable,
	})
}

func protectedDesktopSessionAuthorizationCode(reason protectedlocal.Reason) codes.Code {
	switch reason {
	case protectedlocal.ReasonDesktopControlTransportRequired,
		protectedlocal.ReasonDesktopExecutableTrustFailed,
		protectedlocal.ReasonProtectedOriginRoleMismatch,
		protectedlocal.ReasonProtectedLocalRuntimePrincipalRequired:
		return codes.PermissionDenied
	case protectedlocal.ReasonDesktopProcessVerificationUnavailable:
		return codes.Unauthenticated
	case protectedlocal.ReasonProtectedLocalBootEpochMismatch:
		return codes.FailedPrecondition
	case protectedlocal.ReasonProtectedLocalLedgerRollbackDetected:
		return codes.DataLoss
	default:
		return codes.Unavailable
	}
}

func protectedDesktopConnectionFromPeer(ctx context.Context) (*protectedlocal.Connection, error) {
	peerInfo, ok := peer.FromContext(ctx)
	if !ok || peerInfo == nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED)
	}
	authInfo, ok := peerInfo.AuthInfo.(*protectedDesktopAuthInfo)
	if !ok || authInfo == nil || authInfo.connection == nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED)
	}
	origin := authInfo.connection.Origin()
	if origin.TransportClass != protectedlocal.TransportDesktopControl || !origin.HasRole(protectedlocal.RoleVerifiedDesktopProcess) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	return authInfo.connection, nil
}

var _ credentials.AuthInfo = (*protectedDesktopAuthInfo)(nil)
var _ credentials.TransportCredentials = protectedDesktopTransportCredentials{}
