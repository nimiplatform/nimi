package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/url"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCatalogResolverErrorsRetainModelNotFoundCause(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	tests := []struct {
		name string
		run  func() error
	}{
		{
			name: "scenario capability",
			run: func() error {
				return svc.validateScenarioCapability(
					ctx,
					&runtimev1.ExecuteScenarioRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE},
					"unknown-model",
					&nimillm.RemoteTarget{ProviderType: "openai"},
					nil,
				)
			},
		},
		{
			name: "video catalog validation",
			run: func() error {
				return svc.validateVideoGenerateAgainstCatalog(
					ctx,
					"openai",
					"unknown-model",
					&runtimev1.VideoGenerateScenarioSpec{},
				)
			},
		},
		{
			name: "multimodal capability",
			run: func() error {
				return svc.validateRemoteTextGenerateInputCapabilities(
					ctx,
					"unknown-model",
					&nimillm.RemoteTarget{ProviderType: "openai"},
					nil,
					[]*runtimev1.ChatMessage{{
						Parts: []*runtimev1.ChatContentPart{{
							Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
							Content: &runtimev1.ChatContentPart_ImageUrl{
								ImageUrl: &runtimev1.ChatContentImageURL{Url: "https://example.invalid/image.png"},
							},
						}},
					}},
				)
			},
		},
		{
			name: "music iteration capability",
			run: func() error {
				return validateMusicGenerateIterationSupport(
					ctx,
					svc,
					"unknown-model",
					&nimillm.RemoteTarget{ProviderType: "stability"},
					nil,
					&nimillm.MusicIterationExtension{},
				)
			},
		},
		{
			name: "speech voice catalog",
			run: func() error {
				_, _, _, err := resolveCatalogVoicesForSubject(
					ctx,
					"unknown-model",
					"openai",
					svc.speechCatalog,
				)
				return err
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.run()
			assertCatalogResolverCause(
				t,
				err,
				aicatalog.ErrModelNotFound,
				codes.NotFound,
				runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			)
		})
	}
}

func TestInvalidArtifactFileURLRetainsParseCauseWithoutPublishingInput(t *testing.T) {
	const invalidURL = "file://%zz"

	_, err := inlineRemoteTextGenerateImageURL(invalidURL, "image/png")
	assertCatalogResolverCause(
		t,
		err,
		nil,
		codes.InvalidArgument,
		runtimev1.ReasonCode_AI_INPUT_INVALID,
	)

	var parseErr *url.Error
	if !errors.As(err, &parseErr) {
		t.Fatalf("expected URL parse cause, got %T: %v", err, err)
	}
	if message := status.Convert(err).Message(); strings.Contains(message, invalidURL) {
		t.Fatalf("public status message exposed invalid artifact URL: %q", message)
	}
}

func assertCatalogResolverCause(
	t *testing.T,
	err error,
	target error,
	wantCode codes.Code,
	wantReason runtimev1.ReasonCode,
) {
	t.Helper()
	if err == nil {
		t.Fatal("expected error")
	}
	if target != nil && !errors.Is(err, target) {
		t.Fatalf("expected errors.Is(%v), got %T: %v", target, err, err)
	}
	if got := status.Code(err); got != wantCode {
		t.Fatalf("gRPC code = %s, want %s", got, wantCode)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != wantReason {
		t.Fatalf("reason = %s, ok = %v, want %s", reason, ok, wantReason)
	}
}
