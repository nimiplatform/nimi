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
