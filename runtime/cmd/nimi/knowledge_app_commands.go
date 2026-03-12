package main

import (
	"context"
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

func runRuntimeKnowledgeBuild(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge build", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "10s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	indexID := fs.String("index-id", "", "index id")
	sourceKind := fs.String("source-kind", "documents", "source kind")
	var sourceURIs multiStringFlag
	fs.Var(&sourceURIs, "source-uri", "source uri (repeatable)")
	embeddingModelID := fs.String("embedding-model-id", "local/text-embedding-default", "embedding model id")
	overwrite := fs.Bool("overwrite", false, "overwrite existing index")
	optionsFile := fs.String("options-file", "", "options file (protojson struct)")
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
	subjectUserIDValue := strings.TrimSpace(*subjectUserID)
	if subjectUserIDValue == "" {
		return fmt.Errorf("subject-user-id is required")
	}
	indexIDValue := strings.TrimSpace(*indexID)
	if indexIDValue == "" {
		return fmt.Errorf("index-id is required")
	}
	sourceValues := sourceURIs.Values()
	if len(sourceValues) == 0 {
		return fmt.Errorf("at least one source-uri is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	options, err := loadStructFile(*optionsFile, "knowledge options")
	if err != nil {
		return err
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.BuildKnowledgeIndexGRPC(*grpcAddr, timeout, &runtimev1.BuildIndexRequest{
		AppId:            appIDValue,
		SubjectUserId:    subjectUserIDValue,
		IndexId:          indexIDValue,
		SourceKind:       strings.TrimSpace(*sourceKind),
		SourceUris:       sourceValues,
		EmbeddingModelId: strings.TrimSpace(*embeddingModelID),
		Overwrite:        *overwrite,
		Options:          options,
	}, callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"task_id":     resp.GetTaskId(),
			"accepted":    resp.GetAccepted(),
			"reason_code": resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("task_id=%s accepted=%v reason=%s\n", resp.GetTaskId(), resp.GetAccepted(), resp.GetReasonCode().String())
	return nil
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
	indexID := fs.String("index-id", "", "index id")
	query := fs.String("query", "", "search query")
	topK := fs.Int("top-k", 5, "top-k")
	filtersFile := fs.String("filters-file", "", "filters file (protojson struct)")
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
	subjectUserIDValue := strings.TrimSpace(*subjectUserID)
	if subjectUserIDValue == "" {
		return fmt.Errorf("subject-user-id is required")
	}
	indexIDValue := strings.TrimSpace(*indexID)
	if indexIDValue == "" {
		return fmt.Errorf("index-id is required")
	}
	queryValue := strings.TrimSpace(*query)
	if queryValue == "" {
		return fmt.Errorf("query is required")
	}
	if *topK <= 0 {
		return fmt.Errorf("top-k must be > 0")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	filters, err := loadStructFile(*filtersFile, "knowledge filters")
	if err != nil {
		return err
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.SearchKnowledgeIndexGRPC(*grpcAddr, timeout, &runtimev1.SearchIndexRequest{
		AppId:         appIDValue,
		SubjectUserId: subjectUserIDValue,
		IndexId:       indexIDValue,
		Query:         queryValue,
		TopK:          int32(*topK),
		Filters:       filters,
	}, callerMeta)
	if err != nil {
		return err
	}

	hits := make([]map[string]any, 0, len(resp.GetHits()))
	for _, hit := range resp.GetHits() {
		hits = append(hits, map[string]any{
			"document_id": hit.GetDocumentId(),
			"score":       hit.GetScore(),
			"snippet":     hit.GetSnippet(),
			"metadata":    structAsMap(hit.GetMetadata()),
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
		fmt.Printf("  doc=%s score=%v snippet=%s\n", hit["document_id"], hit["score"], hit["snippet"])
	}
	return nil
}

func runRuntimeKnowledgeDelete(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi knowledge delete", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	indexID := fs.String("index-id", "", "index id")
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
	subjectUserIDValue := strings.TrimSpace(*subjectUserID)
	if subjectUserIDValue == "" {
		return fmt.Errorf("subject-user-id is required")
	}
	indexIDValue := strings.TrimSpace(*indexID)
	if indexIDValue == "" {
		return fmt.Errorf("index-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.DeleteKnowledgeIndexGRPC(*grpcAddr, timeout, &runtimev1.DeleteIndexRequest{
		AppId:         appIDValue,
		SubjectUserId: subjectUserIDValue,
		IndexId:       indexIDValue,
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
