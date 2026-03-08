package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	aiReplayAppID = "nimi.gold-path"
)

type noopGoldJobUpdater struct{}

func (noopGoldJobUpdater) UpdatePollState(string, string, int32, *timestamppb.Timestamp, string) {}

type aiReplayPayload struct {
	FixtureID            string         `json:"fixtureId"`
	Capability           string         `json:"capability"`
	Layer                string         `json:"layer"`
	Status               string         `json:"status"`
	TraceID              string         `json:"traceId"`
	RequestDigest        string         `json:"requestDigest"`
	ResolvedProvider     string         `json:"resolvedProvider"`
	ResolvedModel        string         `json:"resolvedModel"`
	ResolvedTargetModel  string         `json:"resolvedTargetModel,omitempty"`
	RoutePolicy          string         `json:"routePolicy"`
	FallbackPolicy       string         `json:"fallbackPolicy"`
	JobID                string         `json:"jobId,omitempty"`
	ArtifactSummary      map[string]any `json:"artifactSummary,omitempty"`
	ReasonCode           string         `json:"reasonCode,omitempty"`
	ActionHint           string         `json:"actionHint,omitempty"`
	Error                string         `json:"error,omitempty"`
	ProviderResponseMeta map[string]any `json:"providerResponseMeta,omitempty"`
}

type aiReplayErrorDetails struct {
	ReasonCode string
	ActionHint string
	Message    string
}

func runRuntimeAIReplay(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi ai replay", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "3m", "grpc request timeout")
	fixturePath := fs.String("fixture", "", "gold fixture path")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	subjectUserID := fs.String("subject-user-id", strings.TrimSpace(os.Getenv("NIMI_LIVE_GOLD_SUBJECT_USER_ID")), "subject user id for gold replay auth context")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*subjectUserID) == "" {
		return fmt.Errorf("subject-user-id is required for gold replay auth context (or set NIMI_LIVE_GOLD_SUBJECT_USER_ID)")
	}

	fixture, err := loadAIGoldFixture(*fixturePath)
	if err != nil {
		return err
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	payload, err := executeRuntimeReplay(*grpcAddr, timeout, fixture, callerMeta, *subjectUserID)
	if err != nil {
		return err
	}
	return printJSON(payload)
}

func runRuntimeAIProviderRaw(args []string) error {
	fs := flag.NewFlagSet("nimi ai provider-raw", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	fixturePath := fs.String("fixture", "", "gold fixture path")
	timeoutRaw := fs.String("timeout", "3m", "provider request timeout")
	if err := fs.Parse(args); err != nil {
		return err
	}

	fixture, err := loadAIGoldFixture(*fixturePath)
	if err != nil {
		return err
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	payload, err := executeProviderRawReplay(timeout, fixture)
	if err != nil {
		return err
	}
	return printJSON(payload)
}
