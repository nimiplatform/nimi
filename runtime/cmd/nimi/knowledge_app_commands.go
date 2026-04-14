package main

import (
	"context"
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

func runRuntimeKnowledgePutPage(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge put-page", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	pageID := fs.String("page-id", "", "page id (optional for update/create)")
	slug := fs.String("slug", "", "page slug")
	title := fs.String("title", "", "page title")
	content := fs.String("content", "", "page content")
	entityType := fs.String("entity-type", "", "entity type")
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
	bankIDValue := strings.TrimSpace(*bankID)
	slugValue := strings.TrimSpace(*slug)
	if appIDValue == "" || bankIDValue == "" || slugValue == "" {
		return fmt.Errorf("app-id, bank-id, and slug are required")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	metadataValue, err := loadStructFile(*metadataFile, "knowledge page metadata")
	if err != nil {
		return err
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.PutKnowledgePageGRPC(*grpcAddr, timeout, &runtimev1.PutPageRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId:     bankIDValue,
		PageId:     strings.TrimSpace(*pageID),
		Slug:       slugValue,
		Title:      strings.TrimSpace(*title),
		Content:    *content,
		EntityType: strings.TrimSpace(*entityType),
		Metadata:   metadataValue,
	}, callerMeta)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"page_id":     resp.GetPage().GetPageId(),
		"bank_id":     resp.GetPage().GetBankId(),
		"slug":        resp.GetPage().GetSlug(),
		"title":       resp.GetPage().GetTitle(),
		"entity_type": resp.GetPage().GetEntityType(),
	}
	return printJSONOrKeyValues(*jsonOutput, payload, "page_id=%s bank_id=%s slug=%s title=%s\n",
		payload["page_id"], payload["bank_id"], payload["slug"], payload["title"])
}

func runRuntimeKnowledgeIngestDocument(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge ingest-document", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	pageID := fs.String("page-id", "", "page id (optional for update)")
	slug := fs.String("slug", "", "page slug")
	title := fs.String("title", "", "page title")
	content := fs.String("content", "", "document content")
	entityType := fs.String("entity-type", "", "entity type")
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
	bankIDValue := strings.TrimSpace(*bankID)
	slugValue := strings.TrimSpace(*slug)
	contentValue := strings.TrimSpace(*content)
	if appIDValue == "" || bankIDValue == "" || slugValue == "" || contentValue == "" {
		return fmt.Errorf("app-id, bank-id, slug, and content are required")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	metadataValue, err := loadStructFile(*metadataFile, "knowledge ingest metadata")
	if err != nil {
		return err
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.IngestKnowledgeDocumentGRPC(*grpcAddr, timeout, &runtimev1.IngestDocumentRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId:     bankIDValue,
		PageId:     strings.TrimSpace(*pageID),
		Slug:       slugValue,
		Title:      strings.TrimSpace(*title),
		Content:    *content,
		EntityType: strings.TrimSpace(*entityType),
		Metadata:   metadataValue,
	}, callerMeta)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"task_id":     resp.GetTaskId(),
		"accepted":    resp.GetAccepted(),
		"reason_code": resp.GetReasonCode().String(),
	}
	return printJSONOrKeyValues(*jsonOutput, payload, "task_id=%s accepted=%v reason=%s\n",
		payload["task_id"], payload["accepted"], payload["reason_code"])
}

func runRuntimeKnowledgeGetIngestTask(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge get-ingest-task", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	taskID := fs.String("task-id", "", "ingest task id")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	appIDValue := strings.TrimSpace(*appID)
	taskIDValue := strings.TrimSpace(*taskID)
	if appIDValue == "" || taskIDValue == "" {
		return fmt.Errorf("app-id and task-id are required")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.GetKnowledgeIngestTaskGRPC(*grpcAddr, timeout, &runtimev1.GetIngestTaskRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		TaskId: taskIDValue,
	}, callerMeta)
	if err != nil {
		return err
	}

	payload := knowledgeIngestTaskPayload(resp.GetTask())
	return printJSONOrKeyValues(*jsonOutput, payload, "task_id=%s status=%s progress=%v reason=%s\n",
		payload["task_id"], payload["status"], payload["progress_percent"], payload["reason_code"])
}

func runRuntimeKnowledgeGetPage(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge get-page", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	pageID := fs.String("page-id", "", "page id")
	slug := fs.String("slug", "", "page slug")
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
	pageIDValue := strings.TrimSpace(*pageID)
	slugValue := strings.TrimSpace(*slug)
	if appIDValue == "" || bankIDValue == "" {
		return fmt.Errorf("app-id and bank-id are required")
	}
	req, err := knowledgeGetPageRequest(appIDValue, strings.TrimSpace(*subjectUserID), bankIDValue, pageIDValue, slugValue)
	if err != nil {
		return err
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.GetKnowledgePageGRPC(*grpcAddr, timeout, req, callerMeta)
	if err != nil {
		return err
	}

	payload := knowledgePagePayload(resp.GetPage())
	return printJSONOrKeyValues(*jsonOutput, payload, "page_id=%s bank_id=%s slug=%s title=%s\n",
		payload["page_id"], payload["bank_id"], payload["slug"], payload["title"])
}

func runRuntimeKnowledgeListPages(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge list-pages", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	var entityTypes multiStringFlag
	fs.Var(&entityTypes, "entity-type", "entity type filter (repeatable)")
	slugPrefix := fs.String("slug-prefix", "", "slug prefix filter")
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
	bankIDValue := strings.TrimSpace(*bankID)
	if appIDValue == "" || bankIDValue == "" {
		return fmt.Errorf("app-id and bank-id are required")
	}
	if *pageSize <= 0 {
		return fmt.Errorf("page-size must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.ListKnowledgePagesGRPC(*grpcAddr, timeout, &runtimev1.ListPagesRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId:            bankIDValue,
		EntityTypeFilters: entityTypes.Values(),
		SlugPrefix:        strings.TrimSpace(*slugPrefix),
		PageSize:          int32(*pageSize),
		PageToken:         strings.TrimSpace(*pageToken),
	}, callerMeta)
	if err != nil {
		return err
	}

	pages := make([]map[string]any, 0, len(resp.GetPages()))
	for _, page := range resp.GetPages() {
		pages = append(pages, knowledgePagePayload(page))
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"pages":           pages,
			"next_page_token": resp.GetNextPageToken(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("pages=%d next_page_token=%s\n", len(pages), resp.GetNextPageToken())
	for _, page := range pages {
		fmt.Printf("  page=%s slug=%s title=%s entity_type=%s\n", page["page_id"], page["slug"], page["title"], page["entity_type"])
	}
	return nil
}

func runRuntimeKnowledgeDeletePage(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge delete-page", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	pageID := fs.String("page-id", "", "page id")
	slug := fs.String("slug", "", "page slug")
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
	pageIDValue := strings.TrimSpace(*pageID)
	slugValue := strings.TrimSpace(*slug)
	if appIDValue == "" || bankIDValue == "" {
		return fmt.Errorf("app-id and bank-id are required")
	}
	req, err := knowledgeDeletePageRequest(appIDValue, strings.TrimSpace(*subjectUserID), bankIDValue, pageIDValue, slugValue)
	if err != nil {
		return err
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.DeleteKnowledgePageGRPC(*grpcAddr, timeout, req, callerMeta)
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

func runRuntimeKnowledgeSearch(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge search", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	var bankIDs multiStringFlag
	fs.Var(&bankIDs, "bank-id", "bank id filter (repeatable)")
	query := fs.String("query", "", "search query")
	topK := fs.Int("top-k", 5, "top-k")
	var entityTypes multiStringFlag
	fs.Var(&entityTypes, "entity-type", "entity type filter (repeatable)")
	slugPrefix := fs.String("slug-prefix", "", "slug prefix filter")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	appIDValue := strings.TrimSpace(*appID)
	queryValue := strings.TrimSpace(*query)
	if appIDValue == "" || queryValue == "" {
		return fmt.Errorf("app-id and query are required")
	}
	if *topK <= 0 {
		return fmt.Errorf("top-k must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.SearchKnowledgeKeywordGRPC(*grpcAddr, timeout, &runtimev1.SearchKeywordRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankIds:           bankIDs.Values(),
		Query:             queryValue,
		TopK:              int32(*topK),
		EntityTypeFilters: entityTypes.Values(),
		SlugPrefix:        strings.TrimSpace(*slugPrefix),
	}, callerMeta)
	if err != nil {
		return err
	}

	hits := make([]map[string]any, 0, len(resp.GetHits()))
	for _, hit := range resp.GetHits() {
		hits = append(hits, map[string]any{
			"bank_id":  hit.GetBankId(),
			"page_id":  hit.GetPageId(),
			"slug":     hit.GetSlug(),
			"title":    hit.GetTitle(),
			"score":    hit.GetScore(),
			"snippet":  hit.GetSnippet(),
			"metadata": structAsMap(hit.GetMetadata()),
		})
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"hits":        hits,
			"reason_code": resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("reason=%s hits=%d\n", resp.GetReasonCode().String(), len(hits))
	for _, hit := range hits {
		fmt.Printf("  bank=%s page=%s slug=%s score=%v snippet=%s\n", hit["bank_id"], hit["page_id"], hit["slug"], hit["score"], hit["snippet"])
	}
	return nil
}

func runRuntimeKnowledgeSearchHybrid(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge search-hybrid", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	query := fs.String("query", "", "search query")
	var entityTypes multiStringFlag
	fs.Var(&entityTypes, "entity-type", "entity type filter (repeatable)")
	pageSize := fs.Int("page-size", 10, "page size")
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
	bankIDValue := strings.TrimSpace(*bankID)
	queryValue := strings.TrimSpace(*query)
	if appIDValue == "" || bankIDValue == "" || queryValue == "" {
		return fmt.Errorf("app-id, bank-id, and query are required")
	}
	if *pageSize <= 0 {
		return fmt.Errorf("page-size must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.SearchKnowledgeHybridGRPC(*grpcAddr, timeout, &runtimev1.SearchHybridRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId:            bankIDValue,
		Query:             queryValue,
		EntityTypeFilters: entityTypes.Values(),
		PageSize:          int32(*pageSize),
		PageToken:         strings.TrimSpace(*pageToken),
	}, callerMeta)
	if err != nil {
		return err
	}

	hits := make([]map[string]any, 0, len(resp.GetHits()))
	for _, hit := range resp.GetHits() {
		hits = append(hits, map[string]any{
			"bank_id":  hit.GetBankId(),
			"page_id":  hit.GetPageId(),
			"slug":     hit.GetSlug(),
			"title":    hit.GetTitle(),
			"score":    hit.GetScore(),
			"snippet":  hit.GetSnippet(),
			"metadata": structAsMap(hit.GetMetadata()),
		})
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"hits":            hits,
			"next_page_token": resp.GetNextPageToken(),
			"reason_code":     resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("reason=%s hits=%d next_page_token=%s\n", resp.GetReasonCode().String(), len(hits), resp.GetNextPageToken())
	for _, hit := range hits {
		fmt.Printf("  bank=%s page=%s slug=%s score=%v snippet=%s\n", hit["bank_id"], hit["page_id"], hit["slug"], hit["score"], hit["snippet"])
	}
	return nil
}

func runRuntimeKnowledgeAddLink(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge add-link", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	fromPageID := fs.String("from-page-id", "", "source page id")
	toPageID := fs.String("to-page-id", "", "target page id")
	linkType := fs.String("link-type", "", "typed relation")
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
	bankIDValue := strings.TrimSpace(*bankID)
	fromPageIDValue := strings.TrimSpace(*fromPageID)
	toPageIDValue := strings.TrimSpace(*toPageID)
	linkTypeValue := strings.TrimSpace(*linkType)
	if appIDValue == "" || bankIDValue == "" || fromPageIDValue == "" || toPageIDValue == "" || linkTypeValue == "" {
		return fmt.Errorf("app-id, bank-id, from-page-id, to-page-id, and link-type are required")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	metadataValue, err := loadStructFile(*metadataFile, "knowledge link metadata")
	if err != nil {
		return err
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.AddKnowledgeLinkGRPC(*grpcAddr, timeout, &runtimev1.AddLinkRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId:     bankIDValue,
		FromPageId: fromPageIDValue,
		ToPageId:   toPageIDValue,
		LinkType:   linkTypeValue,
		Metadata:   metadataValue,
	}, callerMeta)
	if err != nil {
		return err
	}

	payload := knowledgeLinkPayload(resp.GetLink())
	return printJSONOrKeyValues(*jsonOutput, payload, "link_id=%s bank_id=%s from_page_id=%s to_page_id=%s link_type=%s\n",
		payload["link_id"], payload["bank_id"], payload["from_page_id"], payload["to_page_id"], payload["link_type"])
}

func runRuntimeKnowledgeRemoveLink(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge remove-link", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	linkID := fs.String("link-id", "", "link id")
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
	linkIDValue := strings.TrimSpace(*linkID)
	if appIDValue == "" || bankIDValue == "" || linkIDValue == "" {
		return fmt.Errorf("app-id, bank-id, and link-id are required")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.RemoveKnowledgeLinkGRPC(*grpcAddr, timeout, &runtimev1.RemoveLinkRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId: bankIDValue,
		LinkId: linkIDValue,
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

func runRuntimeKnowledgeListLinks(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge list-links", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	fromPageID := fs.String("from-page-id", "", "source page id")
	var linkTypes multiStringFlag
	fs.Var(&linkTypes, "link-type", "link type filter (repeatable)")
	pageSize := fs.Int("page-size", 25, "page size")
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
	bankIDValue := strings.TrimSpace(*bankID)
	fromPageIDValue := strings.TrimSpace(*fromPageID)
	if appIDValue == "" || bankIDValue == "" || fromPageIDValue == "" {
		return fmt.Errorf("app-id, bank-id, and from-page-id are required")
	}
	if *pageSize <= 0 {
		return fmt.Errorf("page-size must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.ListKnowledgeLinksGRPC(*grpcAddr, timeout, &runtimev1.ListLinksRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId:          bankIDValue,
		FromPageId:      fromPageIDValue,
		LinkTypeFilters: linkTypes.Values(),
		PageSize:        int32(*pageSize),
		PageToken:       strings.TrimSpace(*pageToken),
	}, callerMeta)
	if err != nil {
		return err
	}
	items := make([]map[string]any, 0, len(resp.GetLinks()))
	for _, item := range resp.GetLinks() {
		items = append(items, knowledgeGraphEdgePayload(item))
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{"links": items, "next_page_token": resp.GetNextPageToken()}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}
	fmt.Printf("links=%d next_page_token=%s\n", len(items), resp.GetNextPageToken())
	for _, item := range items {
		fmt.Printf("  link=%s from=%s to=%s type=%s\n", item["link_id"], item["from_slug"], item["to_slug"], item["link_type"])
	}
	return nil
}

func runRuntimeKnowledgeListBacklinks(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge list-backlinks", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	toPageID := fs.String("to-page-id", "", "target page id")
	var linkTypes multiStringFlag
	fs.Var(&linkTypes, "link-type", "link type filter (repeatable)")
	pageSize := fs.Int("page-size", 25, "page size")
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
	bankIDValue := strings.TrimSpace(*bankID)
	toPageIDValue := strings.TrimSpace(*toPageID)
	if appIDValue == "" || bankIDValue == "" || toPageIDValue == "" {
		return fmt.Errorf("app-id, bank-id, and to-page-id are required")
	}
	if *pageSize <= 0 {
		return fmt.Errorf("page-size must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.ListKnowledgeBacklinksGRPC(*grpcAddr, timeout, &runtimev1.ListBacklinksRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId:          bankIDValue,
		ToPageId:        toPageIDValue,
		LinkTypeFilters: linkTypes.Values(),
		PageSize:        int32(*pageSize),
		PageToken:       strings.TrimSpace(*pageToken),
	}, callerMeta)
	if err != nil {
		return err
	}
	items := make([]map[string]any, 0, len(resp.GetBacklinks()))
	for _, item := range resp.GetBacklinks() {
		items = append(items, knowledgeGraphEdgePayload(item))
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{"backlinks": items, "next_page_token": resp.GetNextPageToken()}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}
	fmt.Printf("backlinks=%d next_page_token=%s\n", len(items), resp.GetNextPageToken())
	for _, item := range items {
		fmt.Printf("  link=%s from=%s to=%s type=%s\n", item["link_id"], item["from_slug"], item["to_slug"], item["link_type"])
	}
	return nil
}

func runRuntimeKnowledgeTraverseGraph(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge traverse-graph", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	bankID := fs.String("bank-id", "", "bank id")
	rootPageID := fs.String("root-page-id", "", "root page id")
	var linkTypes multiStringFlag
	fs.Var(&linkTypes, "link-type", "link type filter (repeatable)")
	maxDepth := fs.Int("max-depth", 2, "graph traversal max depth")
	pageSize := fs.Int("page-size", 25, "page size")
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
	bankIDValue := strings.TrimSpace(*bankID)
	rootPageIDValue := strings.TrimSpace(*rootPageID)
	if appIDValue == "" || bankIDValue == "" || rootPageIDValue == "" {
		return fmt.Errorf("app-id, bank-id, and root-page-id are required")
	}
	if *pageSize <= 0 || *maxDepth <= 0 {
		return fmt.Errorf("page-size and max-depth must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.TraverseKnowledgeGraphGRPC(*grpcAddr, timeout, &runtimev1.TraverseGraphRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         appIDValue,
			SubjectUserId: strings.TrimSpace(*subjectUserID),
		},
		BankId:          bankIDValue,
		RootPageId:      rootPageIDValue,
		LinkTypeFilters: linkTypes.Values(),
		MaxDepth:        int32(*maxDepth),
		PageSize:        int32(*pageSize),
		PageToken:       strings.TrimSpace(*pageToken),
	}, callerMeta)
	if err != nil {
		return err
	}
	items := make([]map[string]any, 0, len(resp.GetNodes()))
	for _, item := range resp.GetNodes() {
		items = append(items, knowledgeGraphNodePayload(item))
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{"nodes": items, "next_page_token": resp.GetNextPageToken()}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}
	fmt.Printf("nodes=%d next_page_token=%s\n", len(items), resp.GetNextPageToken())
	for _, item := range items {
		fmt.Printf("  page=%s slug=%s depth=%v\n", item["page_id"], item["slug"], item["depth"])
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

func printJSONOrKeyValues(jsonOutput bool, payload map[string]any, format string, args ...any) error {
	if jsonOutput {
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}
	fmt.Printf(format, args...)
	return nil
}

func knowledgeLinkPayload(link *runtimev1.KnowledgeLink) map[string]any {
	if link == nil {
		return map[string]any{}
	}
	return map[string]any{
		"link_id":      link.GetLinkId(),
		"bank_id":      link.GetBankId(),
		"from_page_id": link.GetFromPageId(),
		"to_page_id":   link.GetToPageId(),
		"link_type":    link.GetLinkType(),
		"metadata":     structAsMap(link.GetMetadata()),
	}
}

func knowledgeGraphEdgePayload(edge *runtimev1.KnowledgeGraphEdge) map[string]any {
	payload := knowledgeLinkPayload(edge.GetLink())
	payload["from_slug"] = edge.GetFromSlug()
	payload["from_title"] = edge.GetFromTitle()
	payload["from_entity_type"] = edge.GetFromEntityType()
	payload["to_slug"] = edge.GetToSlug()
	payload["to_title"] = edge.GetToTitle()
	payload["to_entity_type"] = edge.GetToEntityType()
	return payload
}

func knowledgeGraphNodePayload(node *runtimev1.KnowledgeGraphNode) map[string]any {
	if node == nil {
		return map[string]any{}
	}
	return map[string]any{
		"bank_id":     node.GetBankId(),
		"page_id":     node.GetPageId(),
		"slug":        node.GetSlug(),
		"title":       node.GetTitle(),
		"entity_type": node.GetEntityType(),
		"metadata":    structAsMap(node.GetMetadata()),
		"depth":       node.GetDepth(),
	}
}

func knowledgeIngestTaskPayload(task *runtimev1.KnowledgeIngestTask) map[string]any {
	if task == nil {
		return map[string]any{}
	}
	payload := map[string]any{
		"task_id":          task.GetTaskId(),
		"bank_id":          task.GetBankId(),
		"page_id":          task.GetPageId(),
		"slug":             task.GetSlug(),
		"title":            task.GetTitle(),
		"status":           task.GetStatus().String(),
		"progress_percent": task.GetProgressPercent(),
		"reason_code":      task.GetReasonCode().String(),
		"action_hint":      task.GetActionHint(),
	}
	if createdAt := task.GetCreatedAt(); createdAt != nil {
		payload["created_at"] = createdAt.AsTime().UTC().Format(time.RFC3339Nano)
	}
	if updatedAt := task.GetUpdatedAt(); updatedAt != nil {
		payload["updated_at"] = updatedAt.AsTime().UTC().Format(time.RFC3339Nano)
	}
	return payload
}

func parseKnowledgeBankScope(raw string) (runtimev1.KnowledgeBankScope, error) {
	switch strings.TrimSpace(raw) {
	case "app-private":
		return runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE, nil
	case "workspace-private":
		return runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE, nil
	default:
		return runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_UNSPECIFIED, fmt.Errorf("scope must be app-private or workspace-private")
	}
}

func knowledgeBankPayload(bank *runtimev1.KnowledgeBank) map[string]any {
	payload := map[string]any{
		"bank_id":       bank.GetBankId(),
		"display_name":  bank.GetDisplayName(),
		"scope":         bank.GetLocator().GetScope().String(),
		"metadata":      structAsMap(bank.GetMetadata()),
		"created_at":    bank.GetCreatedAt().AsTime().UTC().Format(time.RFC3339Nano),
		"updated_at":    bank.GetUpdatedAt().AsTime().UTC().Format(time.RFC3339Nano),
		"owner_locator": map[string]any{},
	}
	if bank.GetLocator().GetAppPrivate() != nil {
		payload["app_id"] = bank.GetLocator().GetAppPrivate().GetAppId()
		payload["owner_locator"] = map[string]any{"app_id": bank.GetLocator().GetAppPrivate().GetAppId()}
	}
	if bank.GetLocator().GetWorkspacePrivate() != nil {
		payload["workspace_id"] = bank.GetLocator().GetWorkspacePrivate().GetWorkspaceId()
		payload["owner_locator"] = map[string]any{"workspace_id": bank.GetLocator().GetWorkspacePrivate().GetWorkspaceId()}
	}
	return payload
}

func knowledgePagePayload(page *runtimev1.KnowledgePage) map[string]any {
	return map[string]any{
		"page_id":     page.GetPageId(),
		"bank_id":     page.GetBankId(),
		"slug":        page.GetSlug(),
		"title":       page.GetTitle(),
		"content":     page.GetContent(),
		"entity_type": page.GetEntityType(),
		"metadata":    structAsMap(page.GetMetadata()),
		"created_at":  page.GetCreatedAt().AsTime().UTC().Format(time.RFC3339Nano),
		"updated_at":  page.GetUpdatedAt().AsTime().UTC().Format(time.RFC3339Nano),
	}
}

func knowledgeGetPageRequest(appID string, subjectUserID string, bankID string, pageID string, slug string) (*runtimev1.GetPageRequest, error) {
	switch {
	case pageID != "" && slug != "":
		return nil, fmt.Errorf("choose exactly one of page-id or slug")
	case pageID != "":
		return &runtimev1.GetPageRequest{
			Context: &runtimev1.KnowledgeRequestContext{
				AppId:         appID,
				SubjectUserId: subjectUserID,
			},
			BankId: bankID,
			Lookup: &runtimev1.GetPageRequest_PageId{PageId: pageID},
		}, nil
	case slug != "":
		return &runtimev1.GetPageRequest{
			Context: &runtimev1.KnowledgeRequestContext{
				AppId:         appID,
				SubjectUserId: subjectUserID,
			},
			BankId: bankID,
			Lookup: &runtimev1.GetPageRequest_Slug{Slug: slug},
		}, nil
	default:
		return nil, fmt.Errorf("one of page-id or slug is required")
	}
}

func knowledgeDeletePageRequest(appID string, subjectUserID string, bankID string, pageID string, slug string) (*runtimev1.DeletePageRequest, error) {
	switch {
	case pageID != "" && slug != "":
		return nil, fmt.Errorf("choose exactly one of page-id or slug")
	case pageID != "":
		return &runtimev1.DeletePageRequest{
			Context: &runtimev1.KnowledgeRequestContext{
				AppId:         appID,
				SubjectUserId: subjectUserID,
			},
			BankId: bankID,
			Lookup: &runtimev1.DeletePageRequest_PageId{PageId: pageID},
		}, nil
	case slug != "":
		return &runtimev1.DeletePageRequest{
			Context: &runtimev1.KnowledgeRequestContext{
				AppId:         appID,
				SubjectUserId: subjectUserID,
			},
			BankId: bankID,
			Lookup: &runtimev1.DeletePageRequest_Slug{Slug: slug},
		}, nil
	default:
		return nil, fmt.Errorf("one of page-id or slug is required")
	}
}

func runRuntimeAppSend(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi app send", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	fromAppID := fs.String("from-app-id", "", "source app id")
	toAppID := fs.String("to-app-id", "", "target app id")
	subjectUserID := fs.String("subject-user-id", "", "subject user id")
	messageType := fs.String("message-type", "", "message type")
	payloadFile := fs.String("payload-file", "", "payload file (protojson struct)")
	requireAck := fs.Bool("require-ack", true, "require ack")
	accessTokenID := fs.String("access-token-id", "", "protected access token id")
	accessTokenSecret := fs.String("access-token-secret", "", "protected access token secret")
	sessionID := fs.String("session-id", "", "app session id")
	sessionToken := fs.String("session-token", "", "app session token")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	fromAppIDValue := strings.TrimSpace(*fromAppID)
	if fromAppIDValue == "" {
		return fmt.Errorf("from-app-id is required")
	}
	toAppIDValue := strings.TrimSpace(*toAppID)
	if toAppIDValue == "" {
		return fmt.Errorf("to-app-id is required")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	payload, err := loadStructFile(*payloadFile, "app payload")
	if err != nil {
		return err
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	callerMeta.AccessTokenID = strings.TrimSpace(*accessTokenID)
	callerMeta.AccessTokenSecret = strings.TrimSpace(*accessTokenSecret)
	callerMeta.SessionID = strings.TrimSpace(*sessionID)
	callerMeta.SessionToken = strings.TrimSpace(*sessionToken)
	resp, err := entrypoint.SendAppMessageGRPC(*grpcAddr, timeout, &runtimev1.SendAppMessageRequest{
		FromAppId:     fromAppIDValue,
		ToAppId:       toAppIDValue,
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		MessageType:   strings.TrimSpace(*messageType),
		Payload:       payload,
		RequireAck:    *requireAck,
	}, callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"message_id":  resp.GetMessageId(),
			"accepted":    resp.GetAccepted(),
			"reason_code": resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("message_id=%s accepted=%v reason=%s\n", resp.GetMessageId(), resp.GetAccepted(), resp.GetReasonCode().String())
	return nil
}

func runRuntimeAppWatch(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi app watch", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "10m", "stream timeout")
	appID := fs.String("app-id", "", "target app id")
	subjectUserID := fs.String("subject-user-id", "", "subject user id")
	cursor := fs.String("cursor", "", "cursor")
	var fromAppIDs multiStringFlag
	fs.Var(&fromAppIDs, "from-app-id", "filter from app id (repeatable)")
	jsonOutput := fs.Bool("json", false, "output ndjson events")
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

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	events, errCh, err := entrypoint.SubscribeAppMessagesGRPC(ctx, *grpcAddr, &runtimev1.SubscribeAppMessagesRequest{
		AppId:         appIDValue,
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		Cursor:        strings.TrimSpace(*cursor),
		FromAppIds:    fromAppIDs.Values(),
	}, callerMeta)
	if err != nil {
		return err
	}

	sawEvent := false
	for events != nil || errCh != nil {
		select {
		case streamErr, ok := <-errCh:
			if !ok {
				errCh = nil
				continue
			}
			if streamErr != nil {
				return streamErr
			}
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			if event == nil {
				continue
			}
			sawEvent = true
			if *jsonOutput {
				out, marshalErr := json.Marshal(appMessageEventJSON(event))
				if marshalErr != nil {
					return marshalErr
				}
				fmt.Println(string(out))
				continue
			}
			fmt.Println(appMessageEventLine(event))
		}
	}

	if !sawEvent {
		return fmt.Errorf("app watch ended without events")
	}
	return nil
}
