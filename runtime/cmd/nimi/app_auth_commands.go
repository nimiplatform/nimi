package main

import (
	"encoding/json"
	"flag"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"google.golang.org/protobuf/types/known/timestamppb"
	"os"
	"strings"
	"time"
)

func runRuntimeAppAuthAuthorize(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi app-auth authorize", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	domain := fs.String("domain", "app-auth", "authorization domain")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	externalPrincipalID := fs.String("external-principal-id", "", "external principal id")
	externalTypeRaw := fs.String("external-type", "service", "external principal type: agent|app|service")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	consentID := fs.String("consent-id", "", "consent id")
	consentVersion := fs.String("consent-version", "", "consent version")
	policyVersion := fs.String("policy-version", "v1", "policy version")
	policyModeRaw := fs.String("policy-mode", "preset", "policy mode: preset|custom")
	presetRaw := fs.String("preset", "full", "authorization preset: read-only|full|delegate")
	var scopes multiStringFlag
	fs.Var(&scopes, "scope", "scope (repeatable)")
	resourceSelectorsFile := fs.String("resource-selectors-file", "", "resource selectors file (protojson)")
	canDelegate := fs.Bool("can-delegate", false, "can delegate access")
	maxDelegationDepth := fs.Int("max-delegation-depth", 0, "max delegation depth")
	ttlSeconds := fs.Int("ttl-seconds", 3600, "token ttl in seconds")
	scopeCatalogVersion := fs.String("scope-catalog-version", "sdk-v1", "scope catalog version")
	policyOverride := fs.Bool("policy-override", false, "override policy (requires protected scope)")
	accessTokenID := fs.String("access-token-id", "", "protected access token id")
	accessTokenSecret := fs.String("access-token-secret", "", "protected access token secret")
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
	subjectUserIDValue := strings.TrimSpace(*subjectUserID)
	if subjectUserIDValue == "" {
		return fmt.Errorf("subject-user-id is required")
	}
	if *ttlSeconds <= 0 {
		return fmt.Errorf("ttl-seconds must be > 0")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	externalType, err := parseExternalPrincipalType(*externalTypeRaw)
	if err != nil {
		return err
	}
	policyMode, err := parsePolicyMode(*policyModeRaw)
	if err != nil {
		return err
	}
	preset, err := parseAuthorizationPreset(*presetRaw)
	if err != nil {
		return err
	}
	resourceSelectors, err := loadResourceSelectorsFile(*resourceSelectorsFile)
	if err != nil {
		return err
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	callerMeta.Domain = strings.TrimSpace(*domain)
	callerMeta.AccessTokenID = strings.TrimSpace(*accessTokenID)
	callerMeta.AccessTokenSecret = strings.TrimSpace(*accessTokenSecret)
	resp, err := entrypoint.AuthorizeExternalPrincipalGRPC(*grpcAddr, timeout, &runtimev1.AuthorizeExternalPrincipalRequest{
		Domain:                strings.TrimSpace(*domain),
		AppId:                 appIDValue,
		ExternalPrincipalId:   externalIDValue,
		ExternalPrincipalType: externalType,
		SubjectUserId:         subjectUserIDValue,
		ConsentId:             strings.TrimSpace(*consentID),
		ConsentVersion:        strings.TrimSpace(*consentVersion),
		DecisionAt:            timestamppb.Now(),
		PolicyVersion:         strings.TrimSpace(*policyVersion),
		PolicyMode:            policyMode,
		Preset:                preset,
		Scopes:                scopes.Values(),
		ResourceSelectors:     resourceSelectors,
		CanDelegate:           *canDelegate,
		MaxDelegationDepth:    int32(*maxDelegationDepth),
		TtlSeconds:            int32(*ttlSeconds),
		ScopeCatalogVersion:   strings.TrimSpace(*scopeCatalogVersion),
		PolicyOverride:        *policyOverride,
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
			"token_id":                     resp.GetTokenId(),
			"app_id":                       resp.GetAppId(),
			"subject_user_id":              resp.GetSubjectUserId(),
			"external_principal_id":        resp.GetExternalPrincipalId(),
			"effective_scopes":             resp.GetEffectiveScopes(),
			"policy_version":               resp.GetPolicyVersion(),
			"issued_scope_catalog_version": resp.GetIssuedScopeCatalogVersion(),
			"can_delegate":                 resp.GetCanDelegate(),
			"expires_at":                   expiresAt,
			"secret":                       resp.GetSecret(),
			"resource_selectors":           selectorsAsMap(resp.GetResourceSelectors()),
			"consent_ref":                  consentAsMap(resp.GetConsentRef()),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("token_id=%s expires_at=%s can_delegate=%v policy=%s scope_catalog=%s\n",
		resp.GetTokenId(),
		expiresAt,
		resp.GetCanDelegate(),
		resp.GetPolicyVersion(),
		resp.GetIssuedScopeCatalogVersion(),
	)
	return nil
}

func runRuntimeAppAuthValidate(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi app-auth validate", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	tokenID := fs.String("token-id", "", "token id")
	subjectUserID := fs.String("subject-user-id", "", "subject user id")
	operation := fs.String("operation", "", "operation")
	var requestedScopes multiStringFlag
	fs.Var(&requestedScopes, "requested-scope", "requested scope (repeatable)")
	resourceSelectorsFile := fs.String("resource-selectors-file", "", "resource selectors file (protojson)")
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
	tokenIDValue := strings.TrimSpace(*tokenID)
	if tokenIDValue == "" {
		return fmt.Errorf("token-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	resourceSelectors, err := loadResourceSelectorsFile(*resourceSelectorsFile)
	if err != nil {
		return err
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.ValidateAppAccessTokenGRPC(*grpcAddr, timeout, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:             appIDValue,
		TokenId:           tokenIDValue,
		SubjectUserId:     strings.TrimSpace(*subjectUserID),
		Operation:         strings.TrimSpace(*operation),
		RequestedScopes:   requestedScopes.Values(),
		ResourceSelectors: resourceSelectors,
	}, callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"valid":                        resp.GetValid(),
			"reason_code":                  resp.GetReasonCode().String(),
			"effective_scopes":             resp.GetEffectiveScopes(),
			"policy_version":               resp.GetPolicyVersion(),
			"issued_scope_catalog_version": resp.GetIssuedScopeCatalogVersion(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("valid=%v reason=%s policy=%s scope_catalog=%s\n",
		resp.GetValid(),
		resp.GetReasonCode().String(),
		resp.GetPolicyVersion(),
		resp.GetIssuedScopeCatalogVersion(),
	)
	return nil
}

func runRuntimeAppAuthRevoke(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi app-auth revoke", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	tokenID := fs.String("token-id", "", "token id")
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
	tokenIDValue := strings.TrimSpace(*tokenID)
	if tokenIDValue == "" {
		return fmt.Errorf("token-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.RevokeAppAccessTokenGRPC(*grpcAddr, timeout, &runtimev1.RevokeAppAccessTokenRequest{
		AppId:   appIDValue,
		TokenId: tokenIDValue,
	}, callerMeta)
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

func runRuntimeAppAuthDelegate(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi app-auth delegate", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	parentTokenID := fs.String("parent-token-id", "", "parent token id")
	var scopes multiStringFlag
	fs.Var(&scopes, "scope", "delegated scope (repeatable)")
	resourceSelectorsFile := fs.String("resource-selectors-file", "", "resource selectors file (protojson)")
	ttlSeconds := fs.Int("ttl-seconds", 1800, "token ttl in seconds")
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
	parentTokenIDValue := strings.TrimSpace(*parentTokenID)
	if parentTokenIDValue == "" {
		return fmt.Errorf("parent-token-id is required")
	}
	if *ttlSeconds <= 0 {
		return fmt.Errorf("ttl-seconds must be > 0")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	resourceSelectors, err := loadResourceSelectorsFile(*resourceSelectorsFile)
	if err != nil {
		return err
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.IssueDelegatedAccessTokenGRPC(*grpcAddr, timeout, &runtimev1.IssueDelegatedAccessTokenRequest{
		AppId:             appIDValue,
		ParentTokenId:     parentTokenIDValue,
		Scopes:            scopes.Values(),
		ResourceSelectors: resourceSelectors,
		TtlSeconds:        int32(*ttlSeconds),
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
			"token_id":         resp.GetTokenId(),
			"parent_token_id":  resp.GetParentTokenId(),
			"effective_scopes": resp.GetEffectiveScopes(),
			"expires_at":       expiresAt,
			"secret":           resp.GetSecret(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("token_id=%s parent_token_id=%s expires_at=%s\n", resp.GetTokenId(), resp.GetParentTokenId(), expiresAt)
	return nil
}

func runRuntimeAppAuthChain(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi app-auth chain", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	rootTokenID := fs.String("root-token-id", "", "root token id")
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
	rootTokenIDValue := strings.TrimSpace(*rootTokenID)
	if rootTokenIDValue == "" {
		return fmt.Errorf("root-token-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.ListTokenChainGRPC(*grpcAddr, timeout, &runtimev1.ListTokenChainRequest{
		AppId:       appIDValue,
		RootTokenId: rootTokenIDValue,
	}, callerMeta)
	if err != nil {
		return err
	}

	nodes := make([]map[string]any, 0, len(resp.GetNodes()))
	for _, node := range resp.GetNodes() {
		issuedAt := ""
		expiresAt := ""
		if ts := node.GetIssuedAt(); ts != nil {
			issuedAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
		}
		if ts := node.GetExpiresAt(); ts != nil {
			expiresAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
		}
		nodes = append(nodes, map[string]any{
			"token_id":                     node.GetTokenId(),
			"parent_token_id":              node.GetParentTokenId(),
			"external_principal_id":        node.GetExternalPrincipalId(),
			"policy_version":               node.GetPolicyVersion(),
			"issued_scope_catalog_version": node.GetIssuedScopeCatalogVersion(),
			"issued_at":                    issuedAt,
			"expires_at":                   expiresAt,
		})
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{"nodes": nodes}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	if len(nodes) == 0 {
		fmt.Println("no token chain nodes")
		return nil
	}
	fmt.Printf("%-28s %-28s %-24s %-24s %s\n", "TOKEN_ID", "PARENT_TOKEN_ID", "ISSUED_AT", "EXPIRES_AT", "POLICY/SCOPE_CATALOG")
	for _, node := range nodes {
		fmt.Printf("%-28s %-28s %-24s %-24s %s/%s\n",
			node["token_id"],
			node["parent_token_id"],
			node["issued_at"],
			node["expires_at"],
			node["policy_version"],
			node["issued_scope_catalog_version"],
		)
	}
	return nil
}
