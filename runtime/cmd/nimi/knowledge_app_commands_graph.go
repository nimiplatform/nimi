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
