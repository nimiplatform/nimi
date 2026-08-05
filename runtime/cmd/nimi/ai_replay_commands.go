package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	aiProviderRawAppID = "nimi.provider-raw"
)

type noopProviderRawJobUpdater struct{}

func (noopProviderRawJobUpdater) UpdatePollState(string, string, int32, *timestamppb.Timestamp, string) {
}

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

func runRuntimeAIProviderRaw(args []string) error {
	fs := flag.NewFlagSet("nimi ai provider-raw", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	fixturePath := fs.String("fixture", "", "provider fixture path")
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
