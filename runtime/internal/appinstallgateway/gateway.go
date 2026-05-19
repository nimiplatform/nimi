// Package appinstallgateway implements the Runtime-owned Nimi App install
// verification gate. It is deliberately descriptor-first: callers provide a
// parsed Platform release descriptor, and the gateway refuses to download,
// unpack, register, or execute from any source outside that descriptor.
package appinstallgateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

type Downloader interface {
	Download(ctx context.Context, descriptor appreleasecatalog.Descriptor) ([]byte, error)
}

type Unpacker interface {
	Unpack(ctx context.Context, artifact VerifiedArtifact, plan appstorage.Plan) error
}

type StoragePlanner interface {
	Plan(ctx context.Context, descriptor appreleasecatalog.Descriptor) (appstorage.Plan, error)
}

type Gateway struct {
	downloader      Downloader
	unpacker        Unpacker
	storagePlanner  StoragePlanner
	evidenceWriter  EvidenceWriter
	releaseRemover  ReleaseRemover
	materializePlan func(appstorage.Plan) error
}

type EvidenceWriter interface {
	WriteInstallEvidence(ctx context.Context, plan appstorage.Plan, descriptor appreleasecatalog.Descriptor, artifact VerifiedArtifact) (appstorage.InstallEvidence, error)
}

type ReleaseRemover interface {
	Uninstall(ctx context.Context, plan appstorage.Plan, options appstorage.UninstallOptions) error
}

type VerifiedArtifact struct {
	DescriptorID string
	AppID        string
	Version      string
	SHA256       string
	Bytes        int64
	Payload      []byte
}

type InstalledApp struct {
	Artifact VerifiedArtifact
	Plan     appstorage.Plan
	Evidence appstorage.InstallEvidence
}

type DataRootPlanner struct {
	DataRootRef string
}

type FileEvidenceWriter struct{}

type Option func(*Gateway)

var (
	ErrDownloaderRequired       = errors.New("app install gateway downloader is required")
	ErrUnpackerRequired         = errors.New("app install gateway unpacker is required")
	ErrStoragePlannerRequired   = errors.New("app install gateway storage planner is required")
	ErrEvidenceWriterRequired   = errors.New("app install gateway evidence writer is required")
	ErrDescriptorNotInstallable = errors.New("release descriptor is not externally installable")
	ErrDigestMismatch           = errors.New("release artifact sha256 mismatch")
	ErrSizeMismatch             = errors.New("release artifact size mismatch")
)

func New(downloader Downloader, unpacker Unpacker, options ...Option) *Gateway {
	gateway := &Gateway{
		downloader:      downloader,
		unpacker:        unpacker,
		materializePlan: appstorage.Materialize,
	}
	for _, option := range options {
		option(gateway)
	}
	return gateway
}

func WithStoragePlanner(planner StoragePlanner) Option {
	return func(g *Gateway) {
		g.storagePlanner = planner
	}
}

func WithEvidenceWriter(writer EvidenceWriter) Option {
	return func(g *Gateway) {
		g.evidenceWriter = writer
	}
}

func WithReleaseRemover(remover ReleaseRemover) Option {
	return func(g *Gateway) {
		g.releaseRemover = remover
	}
}

func WithMaterializePlan(fn func(appstorage.Plan) error) Option {
	return func(g *Gateway) {
		g.materializePlan = fn
	}
}

func (p DataRootPlanner) Plan(_ context.Context, descriptor appreleasecatalog.Descriptor) (appstorage.Plan, error) {
	return appstorage.Resolve(p.DataRootRef, descriptor.AppID, descriptor.Version, descriptor.StoragePolicyRef)
}

func (FileEvidenceWriter) WriteInstallEvidence(
	_ context.Context,
	plan appstorage.Plan,
	descriptor appreleasecatalog.Descriptor,
	artifact VerifiedArtifact,
) (appstorage.InstallEvidence, error) {
	evidence := appstorage.InstallEvidence{
		AppID:                artifact.AppID,
		ReleaseDescriptorRef: descriptor.DescriptorID,
		StoragePolicyRef:     descriptor.StoragePolicyRef,
		InstalledVersion:     artifact.Version,
		SHA256:               artifact.SHA256,
		VerificationState:    "digest-verified",
		ReleaseRoot:          plan.ReleaseRoot,
		DurableDataRoot:      plan.DurableDataRoot,
		CacheRoot:            plan.CacheRoot,
		TempRoot:             plan.TempRoot,
	}
	if err := appstorage.WriteInstallEvidence(plan, evidence); err != nil {
		return appstorage.InstallEvidence{}, err
	}
	return evidence, nil
}

func (g *Gateway) Verify(ctx context.Context, descriptor appreleasecatalog.Descriptor) (VerifiedArtifact, error) {
	if err := appreleasecatalog.ValidateDescriptor(descriptor); err != nil {
		return VerifiedArtifact{}, err
	}
	if descriptor.DescriptorClass != appreleasecatalog.DescriptorClassExternalImmutableArtifact {
		return VerifiedArtifact{}, fmt.Errorf("%w: %s", ErrDescriptorNotInstallable, descriptor.DescriptorClass)
	}
	if g == nil || g.downloader == nil {
		return VerifiedArtifact{}, ErrDownloaderRequired
	}
	payload, err := g.downloader.Download(ctx, descriptor)
	if err != nil {
		return VerifiedArtifact{}, err
	}
	actual := sha256.Sum256(payload)
	actualHex := hex.EncodeToString(actual[:])
	expectedHex := normalizeSHA256(descriptor.Artifact.SHA256)
	if actualHex != expectedHex {
		return VerifiedArtifact{}, fmt.Errorf("%w: expected %s got %s", ErrDigestMismatch, expectedHex, actualHex)
	}
	if expectedSize, ok := parseExpectedSize(descriptor.Artifact.Size); ok && int64(len(payload)) != expectedSize {
		return VerifiedArtifact{}, fmt.Errorf("%w: expected %d got %d", ErrSizeMismatch, expectedSize, len(payload))
	}
	return VerifiedArtifact{
		DescriptorID: descriptor.DescriptorID,
		AppID:        descriptor.AppID,
		Version:      descriptor.Version,
		SHA256:       actualHex,
		Bytes:        int64(len(payload)),
		Payload:      append([]byte(nil), payload...),
	}, nil
}

func (g *Gateway) Install(ctx context.Context, descriptor appreleasecatalog.Descriptor) (InstalledApp, error) {
	artifact, err := g.Verify(ctx, descriptor)
	if err != nil {
		return InstalledApp{}, err
	}
	if g == nil || g.storagePlanner == nil {
		return InstalledApp{}, ErrStoragePlannerRequired
	}
	plan, err := g.storagePlanner.Plan(ctx, descriptor)
	if err != nil {
		return InstalledApp{}, err
	}
	materializePlan := appstorage.Materialize
	if g.materializePlan != nil {
		materializePlan = g.materializePlan
	}
	if err := materializePlan(plan); err != nil {
		return InstalledApp{}, err
	}
	if g.unpacker == nil {
		return InstalledApp{}, ErrUnpackerRequired
	}
	if err := g.unpacker.Unpack(ctx, artifact, plan); err != nil {
		return InstalledApp{}, err
	}
	if g.evidenceWriter == nil {
		return InstalledApp{}, ErrEvidenceWriterRequired
	}
	evidence, err := g.evidenceWriter.WriteInstallEvidence(ctx, plan, descriptor, artifact)
	if err != nil {
		return InstalledApp{}, err
	}
	return InstalledApp{Artifact: artifact, Plan: plan, Evidence: evidence}, nil
}

func (g *Gateway) Uninstall(ctx context.Context, plan appstorage.Plan, options appstorage.UninstallOptions) error {
	if g == nil || g.releaseRemover == nil {
		return appstorage.Uninstall(plan, options)
	}
	return g.releaseRemover.Uninstall(ctx, plan, options)
}

func normalizeSHA256(value string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "sha256:")
}

func parseExpectedSize(value string) (int64, bool) {
	normalized := strings.TrimSpace(value)
	if normalized == "" || strings.Contains(normalized, "inherited-from") {
		return 0, false
	}
	parsed, err := strconv.ParseInt(normalized, 10, 64)
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}
