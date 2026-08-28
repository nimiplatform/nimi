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
