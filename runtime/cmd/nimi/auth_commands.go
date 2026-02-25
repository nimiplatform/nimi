package main

import (
	"encoding/json"
	"flag"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"os"
	"strings"
	"time"
)

func runRuntimeAuthRegisterApp(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi auth register-app", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	appInstanceID := fs.String("app-instance-id", "", "app instance id")
	deviceID := fs.String("device-id", "local-device", "device id")
	appVersion := fs.String("app-version", "0.1.0", "app version")
	appModeRaw := fs.String("app-mode", "full", "app mode: lite|core-only|full")
	runtimeRequired := fs.Bool("runtime-required", true, "runtime required by app mode manifest")
	realmRequired := fs.Bool("realm-required", true, "realm required by app mode manifest")
	worldRelationRaw := fs.String("world-relation", "none", "world relation: none|render|extension")
	var capabilities multiStringFlag
	fs.Var(&capabilities, "capability", "app capability (repeatable)")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	appIDValue := strings.TrimSpace(*appID)
	if appIDValue == "" {
		return fmt.Errorf("app-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	appMode, err := parseAppMode(*appModeRaw)
	if err != nil {
		return err
	}
	worldRelation, err := parseWorldRelation(*worldRelationRaw)
	if err != nil {
		return err
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.RegisterAppGRPC(*grpcAddr, timeout, &runtimev1.RegisterAppRequest{
		AppId:         appIDValue,
		AppInstanceId: strings.TrimSpace(*appInstanceID),
		DeviceId:      strings.TrimSpace(*deviceID),
		AppVersion:    strings.TrimSpace(*appVersion),
		Capabilities:  capabilities.Values(),
		ModeManifest: &runtimev1.AppModeManifest{
			AppMode:         appMode,
			RuntimeRequired: *runtimeRequired,
			RealmRequired:   *realmRequired,
			WorldRelation:   worldRelation,
		},
	}, callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"app_instance_id": resp.GetAppInstanceId(),
			"accepted":        resp.GetAccepted(),
			"reason_code":     resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("app_instance_id=%s accepted=%v reason=%s\n", resp.GetAppInstanceId(), resp.GetAccepted(), resp.GetReasonCode().String())
	return nil
}

func runRuntimeAuthOpenSession(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi auth open-session", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	appInstanceID := fs.String("app-instance-id", "", "app instance id")
	deviceID := fs.String("device-id", "local-device", "device id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	ttlSeconds := fs.Int("ttl-seconds", 3600, "session ttl in seconds")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	appIDValue := strings.TrimSpace(*appID)
	if appIDValue == "" {
		return fmt.Errorf("app-id is required")
	}
	if strings.TrimSpace(*appInstanceID) == "" {
		return fmt.Errorf("app-instance-id is required")
	}
	if strings.TrimSpace(*subjectUserID) == "" {
		return fmt.Errorf("subject-user-id is required")
	}
	if *ttlSeconds <= 0 {
		return fmt.Errorf("ttl-seconds must be > 0")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.OpenSessionGRPC(*grpcAddr, timeout, &runtimev1.OpenSessionRequest{
		AppId:         appIDValue,
		AppInstanceId: strings.TrimSpace(*appInstanceID),
		DeviceId:      strings.TrimSpace(*deviceID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		TtlSeconds:    int32(*ttlSeconds),
	}, callerMeta)
	if err != nil {
		return err
	}

	issuedAt := ""
	expiresAt := ""
	if ts := resp.GetIssuedAt(); ts != nil {
		issuedAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}
	if ts := resp.GetExpiresAt(); ts != nil {
		expiresAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"session_id":    resp.GetSessionId(),
			"issued_at":     issuedAt,
			"expires_at":    expiresAt,
			"session_token": resp.GetSessionToken(),
			"reason_code":   resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("session_id=%s expires_at=%s reason=%s\n", resp.GetSessionId(), expiresAt, resp.GetReasonCode().String())
	return nil
}

func runRuntimeAuthRefreshSession(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi auth refresh-session", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id (metadata)")
	sessionID := fs.String("session-id", "", "session id")
	ttlSeconds := fs.Int("ttl-seconds", 3600, "session ttl in seconds")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	sessionIDValue := strings.TrimSpace(*sessionID)
	if sessionIDValue == "" {
		return fmt.Errorf("session-id is required")
	}
	if *ttlSeconds <= 0 {
		return fmt.Errorf("ttl-seconds must be > 0")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.RefreshSessionGRPC(*grpcAddr, timeout, &runtimev1.RefreshSessionRequest{
		SessionId:  sessionIDValue,
		TtlSeconds: int32(*ttlSeconds),
	}, strings.TrimSpace(*appID), callerMeta)
	if err != nil {
		return err
	}

	expiresAt := ""
	if ts := resp.GetExpiresAt(); ts != nil {
		expiresAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"session_id":    resp.GetSessionId(),
			"expires_at":    expiresAt,
			"session_token": resp.GetSessionToken(),
			"reason_code":   resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("session_id=%s expires_at=%s reason=%s\n", resp.GetSessionId(), expiresAt, resp.GetReasonCode().String())
	return nil
}

func runRuntimeAuthRevokeSession(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi auth revoke-session", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id (metadata)")
	sessionID := fs.String("session-id", "", "session id")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	sessionIDValue := strings.TrimSpace(*sessionID)
	if sessionIDValue == "" {
		return fmt.Errorf("session-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.RevokeSessionGRPC(*grpcAddr, timeout, &runtimev1.RevokeSessionRequest{
		SessionId: sessionIDValue,
	}, strings.TrimSpace(*appID), callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"ok":          resp.GetOk(),
			"reason_code": resp.GetReasonCode().String(),
			"action_hint": resp.GetActionHint(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("ok=%v reason=%s action_hint=%s\n", resp.GetOk(), resp.GetReasonCode().String(), resp.GetActionHint())
	return nil
}

func runRuntimeAuthRegisterExternal(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi auth register-external", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	externalPrincipalID := fs.String("external-principal-id", "", "external principal id")
	externalTypeRaw := fs.String("external-type", "service", "external principal type: agent|app|service")
	issuer := fs.String("issuer", "", "issuer")
	clientID := fs.String("client-id", "", "client id")
	signatureKeyID := fs.String("signature-key-id", "", "signature key id")
	proofTypeRaw := fs.String("proof-type", "ed25519", "proof type: ed25519|hmac-sha256")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	appIDValue := strings.TrimSpace(*appID)
	if appIDValue == "" {
		return fmt.Errorf("app-id is required")
	}
	externalIDValue := strings.TrimSpace(*externalPrincipalID)
	if externalIDValue == "" {
		return fmt.Errorf("external-principal-id is required")
	}
	externalType, err := parseExternalPrincipalType(*externalTypeRaw)
	if err != nil {
		return err
	}
	proofType, err := parseExternalProofType(*proofTypeRaw)
	if err != nil {
		return err
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.RegisterExternalPrincipalGRPC(*grpcAddr, timeout, &runtimev1.RegisterExternalPrincipalRequest{
		AppId:                 appIDValue,
		ExternalPrincipalId:   externalIDValue,
		ExternalPrincipalType: externalType,
		Issuer:                strings.TrimSpace(*issuer),
		ClientId:              strings.TrimSpace(*clientID),
		SignatureKeyId:        strings.TrimSpace(*signatureKeyID),
		ProofType:             proofType,
	}, callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"accepted":    resp.GetAccepted(),
			"reason_code": resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("accepted=%v reason=%s\n", resp.GetAccepted(), resp.GetReasonCode().String())
	return nil
}

func runRuntimeAuthOpenExternalSession(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi auth open-external-session", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	externalPrincipalID := fs.String("external-principal-id", "", "external principal id")
	proof := fs.String("proof", "", "external proof")
	ttlSeconds := fs.Int("ttl-seconds", 3600, "session ttl in seconds")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	appIDValue := strings.TrimSpace(*appID)
	if appIDValue == "" {
		return fmt.Errorf("app-id is required")
	}
	externalIDValue := strings.TrimSpace(*externalPrincipalID)
	if externalIDValue == "" {
		return fmt.Errorf("external-principal-id is required")
	}
	proofValue := strings.TrimSpace(*proof)
	if proofValue == "" {
		return fmt.Errorf("proof is required")
	}
	if *ttlSeconds <= 0 {
		return fmt.Errorf("ttl-seconds must be > 0")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.OpenExternalPrincipalSessionGRPC(*grpcAddr, timeout, &runtimev1.OpenExternalPrincipalSessionRequest{
		AppId:               appIDValue,
		ExternalPrincipalId: externalIDValue,
		Proof:               proofValue,
		TtlSeconds:          int32(*ttlSeconds),
	}, callerMeta)
	if err != nil {
		return err
	}

	expiresAt := ""
	if ts := resp.GetExpiresAt(); ts != nil {
		expiresAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"external_session_id": resp.GetExternalSessionId(),
			"expires_at":          expiresAt,
			"session_token":       resp.GetSessionToken(),
			"reason_code":         resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("external_session_id=%s expires_at=%s reason=%s\n", resp.GetExternalSessionId(), expiresAt, resp.GetReasonCode().String())
	return nil
}

func runRuntimeAuthRevokeExternalSession(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi auth revoke-external-session", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id (metadata)")
	externalSessionID := fs.String("external-session-id", "", "external session id")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	externalSessionIDValue := strings.TrimSpace(*externalSessionID)
	if externalSessionIDValue == "" {
		return fmt.Errorf("external-session-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.RevokeExternalPrincipalSessionGRPC(*grpcAddr, timeout, &runtimev1.RevokeExternalPrincipalSessionRequest{
		ExternalSessionId: externalSessionIDValue,
	}, strings.TrimSpace(*appID), callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"ok":          resp.GetOk(),
			"reason_code": resp.GetReasonCode().String(),
			"action_hint": resp.GetActionHint(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("ok=%v reason=%s action_hint=%s\n", resp.GetOk(), resp.GetReasonCode().String(), resp.GetActionHint())
	return nil
}
