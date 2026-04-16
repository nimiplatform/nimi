package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
)

func runRuntimeKnowledgeCreateBank(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge create-bank", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	scope := fs.String("scope", "app-private", "knowledge bank scope: app-private | workspace-private")
	workspaceID := fs.String("workspace-id", "", "workspace id for workspace-private scope")
	displayName := fs.String("display-name", "", "display name")
	metadataFile := fs.String("metadata-file", "", "metadata file (protojson struct)")
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
	metadataValue, err := loadStructFile(*metadataFile, "knowledge bank metadata")
	if err != nil {
		return err
	}

	var locator *runtimev1.PublicKnowledgeBankLocator
	switch strings.TrimSpace(*scope) {
	case "app-private":
		locator = &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: appIDValue},
			},
		}
	case "workspace-private":
		workspaceIDValue := strings.TrimSpace(*workspaceID)
		if workspaceIDValue == "" {
			return fmt.Errorf("workspace-id is required for workspace-private scope")
		}
		locator = &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_WorkspacePrivate{
				WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: workspaceIDValue},
			},
		}
	default:
		return fmt.Errorf("scope must be app-private or workspace-private")
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.CreateKnowledgeBankGRPC(*grpcAddr, timeout, &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		Locator:     locator,
		DisplayName: strings.TrimSpace(*displayName),
		Metadata:    metadataValue,
	}, callerMeta)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"bank_id":      resp.GetBank().GetBankId(),
		"display_name": resp.GetBank().GetDisplayName(),
		"scope":        resp.GetBank().GetLocator().GetScope().String(),
	}
	if resp.GetBank().GetLocator().GetAppPrivate() != nil {
		payload["app_id"] = resp.GetBank().GetLocator().GetAppPrivate().GetAppId()
	}
	if resp.GetBank().GetLocator().GetWorkspacePrivate() != nil {
		payload["workspace_id"] = resp.GetBank().GetLocator().GetWorkspacePrivate().GetWorkspaceId()
	}
	return printJSONOrKeyValues(*jsonOutput, payload, "bank_id=%s scope=%s display_name=%s\n",
		payload["bank_id"], payload["scope"], payload["display_name"])
}

func runRuntimeKnowledgeGetBank(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge get-bank", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	appIDValue := strings.TrimSpace(*appID)
	bankIDValue := strings.TrimSpace(*bankID)
	if appIDValue == "" || bankIDValue == "" {
		return fmt.Errorf("app-id and bank-id are required")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.GetKnowledgeBankGRPC(*grpcAddr, timeout, &runtimev1.GetKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId: bankIDValue,
	}, callerMeta)
	if err != nil {
		return err
	}

	payload := knowledgeBankPayload(resp.GetBank())
	return printJSONOrKeyValues(*jsonOutput, payload, "bank_id=%s scope=%s display_name=%s\n",
		payload["bank_id"], payload["scope"], payload["display_name"])
}

func runRuntimeKnowledgeListBanks(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge list-banks", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	var scopes multiStringFlag
	fs.Var(&scopes, "scope", "knowledge bank scope filter (repeatable): app-private | workspace-private")
	var ownerAppIDs multiStringFlag
	fs.Var(&ownerAppIDs, "owner-app-id", "owner app id filter for app-private banks (repeatable)")
	var workspaceIDs multiStringFlag
	fs.Var(&workspaceIDs, "workspace-id", "workspace id filter for workspace-private banks (repeatable)")
	pageSize := fs.Int("page-size", 50, "page size")
	pageToken := fs.String("page-token", "", "page token")
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
	if *pageSize <= 0 {
		return fmt.Errorf("page-size must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}

	scopeFilters := make([]runtimev1.KnowledgeBankScope, 0, len(scopes))
	for _, raw := range scopes.Values() {
		scopeValue, err := parseKnowledgeBankScope(raw)
		if err != nil {
			return err
		}
		scopeFilters = append(scopeFilters, scopeValue)
	}
	ownerFilters := make([]*runtimev1.KnowledgeBankOwnerFilter, 0, len(ownerAppIDs)+len(workspaceIDs))
	for _, appOwnerID := range ownerAppIDs.Values() {
		value := strings.TrimSpace(appOwnerID)
		if value == "" {
			continue
		}
		ownerFilters = append(ownerFilters, &runtimev1.KnowledgeBankOwnerFilter{
			Owner: &runtimev1.KnowledgeBankOwnerFilter_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: value},
			},
		})
	}
	for _, workspaceIDValue := range workspaceIDs.Values() {
		value := strings.TrimSpace(workspaceIDValue)
		if value == "" {
			continue
		}
		ownerFilters = append(ownerFilters, &runtimev1.KnowledgeBankOwnerFilter{
			Owner: &runtimev1.KnowledgeBankOwnerFilter_WorkspacePrivate{
				WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: value},
			},
		})
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.ListKnowledgeBanksGRPC(*grpcAddr, timeout, &runtimev1.ListKnowledgeBanksRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		ScopeFilters: scopeFilters,
		OwnerFilters: ownerFilters,
		PageSize:     int32(*pageSize),
		PageToken:    strings.TrimSpace(*pageToken),
	}, callerMeta)
	if err != nil {
		return err
	}

	banks := make([]map[string]any, 0, len(resp.GetBanks()))
	for _, bank := range resp.GetBanks() {
		banks = append(banks, knowledgeBankPayload(bank))
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"banks":           banks,
			"next_page_token": resp.GetNextPageToken(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("banks=%d next_page_token=%s\n", len(banks), resp.GetNextPageToken())
	for _, bank := range banks {
		fmt.Printf("  bank=%s scope=%s display_name=%s\n", bank["bank_id"], bank["scope"], bank["display_name"])
	}
	return nil
}

func runRuntimeKnowledgeDeleteBank(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge delete-bank", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	appIDValue := strings.TrimSpace(*appID)
	bankIDValue := strings.TrimSpace(*bankID)
	if appIDValue == "" || bankIDValue == "" {
		return fmt.Errorf("app-id and bank-id are required")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.DeleteKnowledgeBankGRPC(*grpcAddr, timeout, &runtimev1.DeleteKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId: bankIDValue,
	}, callerMeta)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"ok":          resp.GetAck().GetOk(),
		"reason_code": resp.GetAck().GetReasonCode().String(),
		"action_hint": resp.GetAck().GetActionHint(),
	}
	return printJSONOrKeyValues(*jsonOutput, payload, "ok=%v reason=%s action_hint=%s\n",
		payload["ok"], payload["reason_code"], payload["action_hint"])
}
