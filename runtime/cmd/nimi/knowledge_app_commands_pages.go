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
