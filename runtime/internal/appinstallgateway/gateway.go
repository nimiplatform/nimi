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
	"time"

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

// BundledSource resolves and materializes a bundled-with-nimi app artifact
// from the atomic Nimi release bundle. It is the no-network install path: a
// bundled descriptor never downloads or unpacks an external byte payload.
type BundledSource interface {
	Resolve(ctx context.Context, descriptor appreleasecatalog.Descriptor) (VerifiedArtifact, error)
	MaterializeInto(ctx context.Context, descriptor appreleasecatalog.Descriptor, plan appstorage.Plan) error
}

type Gateway struct {
	downloader      Downloader
	unpacker        Unpacker
	storagePlanner  StoragePlanner
	evidenceWriter  EvidenceWriter
	releaseRemover  ReleaseRemover
	bundledSource   BundledSource
	materializePlan func(appstorage.Plan) error
	now             func() time.Time
}

// VerificationState classifies how a release artifact was verified before it
// was materialized into the release root.
type VerificationState string

const (
	// VerificationStateDigestVerified marks an external artifact whose
	// downloaded bytes matched the descriptor sha256.
	VerificationStateDigestVerified VerificationState = "digest-verified"
	// VerificationStateBundledSource marks a bundled artifact materialized
	// from the atomic Nimi release bundle with a deterministic tree digest.
	VerificationStateBundledSource VerificationState = "bundled-source"
)

type EvidenceWriter interface {
	WriteInstallEvidence(ctx context.Context, plan appstorage.Plan, descriptor appreleasecatalog.Descriptor, artifact VerifiedArtifact, verificationState VerificationState) (appstorage.InstallEvidence, error)
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

// InstallPhase is the typed install/update pipeline phase reported to an
// InstallObserver as the gateway progresses. It lets a caller surface the
// concrete step without reimplementing the pipeline.
type InstallPhase string

const (
	InstallPhaseResolveDescriptor InstallPhase = "resolve-descriptor"
	InstallPhaseDownload          InstallPhase = "download"
	InstallPhaseVerify            InstallPhase = "verify"
	InstallPhaseMaterialize       InstallPhase = "materialize"
	InstallPhaseUnpack            InstallPhase = "unpack"
	// InstallPhaseSwap is the atomic active-release pointer swap of an update.
	// It runs only after the new release is materialized and digest-verified.
	InstallPhaseSwap     InstallPhase = "swap"
	InstallPhaseEvidence InstallPhase = "evidence"
)

// InstallObserver receives typed install pipeline progress. Phase reports the
// step the gateway is about to run. ArtifactVerified reports the verified
// artifact digest/size once the verify phase succeeds. An observer is purely
// observational: returning from a callback must not change install behavior.
type InstallObserver interface {
	Phase(phase InstallPhase)
	ArtifactVerified(artifact VerifiedArtifact)
}

type noopObserver struct{}

func (noopObserver) Phase(InstallPhase)                {}
func (noopObserver) ArtifactVerified(VerifiedArtifact) {}

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
	ErrBundledSourceRequired    = errors.New("app install gateway bundled source is required for bundled descriptors")
	ErrDescriptorNotInstallable = errors.New("release descriptor is not externally installable")
	ErrDigestMismatch           = errors.New("release artifact sha256 mismatch")
	ErrSizeMismatch             = errors.New("release artifact size mismatch")
	ErrActiveReleaseSwapFailed  = errors.New("app active release pointer swap failed")
)

func New(downloader Downloader, unpacker Unpacker, options ...Option) *Gateway {
	gateway := &Gateway{
		downloader:      downloader,
		unpacker:        unpacker,
		materializePlan: appstorage.Materialize,
		now:             time.Now,
	}
	for _, option := range options {
		option(gateway)
	}
	if gateway.now == nil {
		gateway.now = time.Now
	}
	return gateway
}

// WithClock overrides the gateway clock used to stamp the active release
// pointer.
func WithClock(now func() time.Time) Option {
	return func(g *Gateway) {
		if now != nil {
			g.now = now
		}
	}
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

func WithBundledSource(source BundledSource) Option {
	return func(g *Gateway) {
		g.bundledSource = source
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
	verificationState VerificationState,
) (appstorage.InstallEvidence, error) {
	state := strings.TrimSpace(string(verificationState))
	if state == "" {
		state = string(VerificationStateDigestVerified)
	}
	evidence := appstorage.InstallEvidence{
		AppID:                artifact.AppID,
		ReleaseDescriptorRef: descriptor.DescriptorID,
		StoragePolicyRef:     descriptor.StoragePolicyRef,
		InstalledVersion:     artifact.Version,
		SHA256:               artifact.SHA256,
		VerificationState:    state,
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

// Install routes a descriptor to the bundled-source path (no network) or the
// external immutable artifact path (download + sha256 verify) based on the
// descriptor class. It fails closed for any descriptor class outside the two
// admitted classes.
func (g *Gateway) Install(ctx context.Context, descriptor appreleasecatalog.Descriptor) (InstalledApp, error) {
	return g.InstallWithObserver(ctx, descriptor, nil)
}

// InstallWithObserver is Install with typed pipeline phase reporting. The
// observer receives each phase before it runs and the verified artifact after
// the verify phase succeeds. A nil observer is equivalent to Install.
func (g *Gateway) InstallWithObserver(ctx context.Context, descriptor appreleasecatalog.Descriptor, observer InstallObserver) (InstalledApp, error) {
	if observer == nil {
		observer = noopObserver{}
	}
	observer.Phase(InstallPhaseResolveDescriptor)
	if err := appreleasecatalog.ValidateDescriptor(descriptor); err != nil {
		return InstalledApp{}, err
	}
	switch descriptor.DescriptorClass {
	case appreleasecatalog.DescriptorClassBundledWithNimi:
		return g.installBundled(ctx, descriptor, observer)
	case appreleasecatalog.DescriptorClassExternalImmutableArtifact:
		return g.installExternal(ctx, descriptor, observer)
	default:
		return InstalledApp{}, fmt.Errorf("%w: %s", ErrDescriptorNotInstallable, descriptor.DescriptorClass)
	}
}

// UpdateApp materializes a NEW release for an already-installed app and
// atomically swaps the active release pointer to it. It is the descriptor-first
// update path: it downloads + sha256-verifies the new release the same way
// install does (P-NAPP-014), materializes it under
// <nimi_data>/apps/<app-id>/releases/<new-version>, then commits the swap.
//
// Atomicity (K-APP-015): the new release is fully materialized, verified, and
// has its evidence written BEFORE the active release pointer is swapped. The
// pointer swap (appstorage.WriteActiveRelease) is a single atomic rename. A
// failure before the swap leaves the previous release and pointer intact and
// removes the partially materialized new release. Durable data under
// <nimi_data>/apps/<app-id>/data is never touched (P-NAPP-015).
func (g *Gateway) UpdateApp(ctx context.Context, descriptor appreleasecatalog.Descriptor, observer InstallObserver) (InstalledApp, error) {
	if observer == nil {
		observer = noopObserver{}
	}
	observer.Phase(InstallPhaseResolveDescriptor)
	if err := appreleasecatalog.ValidateDescriptor(descriptor); err != nil {
		return InstalledApp{}, err
	}
	installed, err := g.materializeRelease(ctx, descriptor, observer)
	if err != nil {
		// Fail closed: drop the partially materialized new release so a
		// retry starts clean. The old release and pointer are untouched.
		if !installed.Plan.IsZero() {
			_ = appstorage.RemoveRelease(installed.Plan)
		}
		return InstalledApp{}, err
	}
	observer.Phase(InstallPhaseSwap)
	if err := g.commitActiveRelease(installed.Plan, installed.Artifact); err != nil {
		_ = appstorage.RemoveRelease(installed.Plan)
		return InstalledApp{}, fmt.Errorf("%w: %v", ErrActiveReleaseSwapFailed, err)
	}
	return installed, nil
}

// installExternal / installBundled materialize a release through
// materializeRelease and commit the active release pointer.
func (g *Gateway) installExternal(ctx context.Context, descriptor appreleasecatalog.Descriptor, observer InstallObserver) (InstalledApp, error) {
	installed, err := g.materializeRelease(ctx, descriptor, observer)
	if err != nil {
		return InstalledApp{}, err
	}
	if err := g.commitActiveRelease(installed.Plan, installed.Artifact); err != nil {
		return InstalledApp{}, fmt.Errorf("%w: %v", ErrActiveReleaseSwapFailed, err)
	}
	return installed, nil
}

func (g *Gateway) installBundled(ctx context.Context, descriptor appreleasecatalog.Descriptor, observer InstallObserver) (InstalledApp, error) {
	installed, err := g.materializeRelease(ctx, descriptor, observer)
	if err != nil {
		return InstalledApp{}, err
	}
	if err := g.commitActiveRelease(installed.Plan, installed.Artifact); err != nil {
		return InstalledApp{}, fmt.Errorf("%w: %v", ErrActiveReleaseSwapFailed, err)
	}
	return installed, nil
}

// materializeRelease runs the descriptor-first download/verify/materialize/
// unpack/evidence pipeline for a single release version. It does NOT swap the
// active release pointer; the caller commits the release. It routes by
// descriptor class and fails closed for any class outside the two admitted
// classes.
func (g *Gateway) materializeRelease(ctx context.Context, descriptor appreleasecatalog.Descriptor, observer InstallObserver) (InstalledApp, error) {
	switch descriptor.DescriptorClass {
	case appreleasecatalog.DescriptorClassExternalImmutableArtifact:
		observer.Phase(InstallPhaseDownload)
		observer.Phase(InstallPhaseVerify)
		artifact, err := g.Verify(ctx, descriptor)
		if err != nil {
			return InstalledApp{}, err
		}
		observer.ArtifactVerified(artifact)
		observer.Phase(InstallPhaseMaterialize)
		plan, err := g.planAndMaterialize(ctx, descriptor)
		if err != nil {
			return InstalledApp{}, err
		}
		if g.unpacker == nil {
			return InstalledApp{Plan: plan}, ErrUnpackerRequired
		}
		observer.Phase(InstallPhaseUnpack)
		if err := g.unpacker.Unpack(ctx, artifact, plan); err != nil {
			return InstalledApp{Plan: plan}, err
		}
		observer.Phase(InstallPhaseEvidence)
		return g.writeEvidence(ctx, plan, descriptor, artifact, VerificationStateDigestVerified)
	case appreleasecatalog.DescriptorClassBundledWithNimi:
		if g == nil || g.bundledSource == nil {
			return InstalledApp{}, ErrBundledSourceRequired
		}
		observer.Phase(InstallPhaseVerify)
		artifact, err := g.bundledSource.Resolve(ctx, descriptor)
		if err != nil {
			return InstalledApp{}, err
		}
		observer.ArtifactVerified(artifact)
		observer.Phase(InstallPhaseMaterialize)
		plan, err := g.planAndMaterialize(ctx, descriptor)
		if err != nil {
			return InstalledApp{}, err
		}
		observer.Phase(InstallPhaseUnpack)
		if err := g.bundledSource.MaterializeInto(ctx, descriptor, plan); err != nil {
			return InstalledApp{Plan: plan}, err
		}
		observer.Phase(InstallPhaseEvidence)
		return g.writeEvidence(ctx, plan, descriptor, artifact, VerificationStateBundledSource)
	default:
		return InstalledApp{}, fmt.Errorf("%w: %s", ErrDescriptorNotInstallable, descriptor.DescriptorClass)
	}
}

// RepairApp re-verifies and re-materializes a damaged release for the SAME
// descriptor version without losing durable data (K-APP-016). It removes the
// (possibly damaged) release payload directory, re-runs the descriptor-first
// download/verify/materialize/unpack/evidence pipeline, and re-commits the
// active release pointer. Durable data under <nimi_data>/apps/<app-id>/data,
// cache, and tmp are never touched. A failed repair drops the partial release
// and leaves a recoverable state; it is never projected as success.
func (g *Gateway) RepairApp(ctx context.Context, descriptor appreleasecatalog.Descriptor, observer InstallObserver) (InstalledApp, error) {
	if observer == nil {
		observer = noopObserver{}
	}
	observer.Phase(InstallPhaseResolveDescriptor)
	if err := appreleasecatalog.ValidateDescriptor(descriptor); err != nil {
		return InstalledApp{}, err
	}
	if g == nil || g.storagePlanner == nil {
		return InstalledApp{}, ErrStoragePlannerRequired
	}
	plan, err := g.storagePlanner.Plan(ctx, descriptor)
	if err != nil {
		return InstalledApp{}, err
	}
	// Drop the damaged release payload so the re-materialization starts clean.
	// RemoveRelease only removes the release root; durable data is preserved.
	if err := appstorage.RemoveRelease(plan); err != nil {
		return InstalledApp{}, err
	}
	installed, err := g.materializeRelease(ctx, descriptor, observer)
	if err != nil {
		if !installed.Plan.IsZero() {
			_ = appstorage.RemoveRelease(installed.Plan)
		}
		return InstalledApp{}, err
	}
	observer.Phase(InstallPhaseSwap)
	if err := g.commitActiveRelease(installed.Plan, installed.Artifact); err != nil {
		_ = appstorage.RemoveRelease(installed.Plan)
		return InstalledApp{}, fmt.Errorf("%w: %v", ErrActiveReleaseSwapFailed, err)
	}
	return installed, nil
}

// commitActiveRelease atomically swaps the app-root active release pointer to
// the materialized release. This is the single commit point of an install or
// update: the rename inside appstorage.WriteActiveRelease is atomic.
func (g *Gateway) commitActiveRelease(plan appstorage.Plan, artifact VerifiedArtifact) error {
	now := time.Now
	if g != nil && g.now != nil {
		now = g.now
	}
	return appstorage.WriteActiveRelease(plan, appstorage.ActiveReleasePointer{
		AppID:         plan.AppID,
		ActiveVersion: artifact.Version,
		ReleaseRoot:   plan.ReleaseRoot,
		UpdatedAt:     now().UTC().Format(time.RFC3339Nano),
	})
}

func (g *Gateway) planAndMaterialize(ctx context.Context, descriptor appreleasecatalog.Descriptor) (appstorage.Plan, error) {
	if g == nil || g.storagePlanner == nil {
		return appstorage.Plan{}, ErrStoragePlannerRequired
	}
	plan, err := g.storagePlanner.Plan(ctx, descriptor)
	if err != nil {
		return appstorage.Plan{}, err
	}
	materializePlan := appstorage.Materialize
	if g.materializePlan != nil {
		materializePlan = g.materializePlan
	}
	if err := materializePlan(plan); err != nil {
		return appstorage.Plan{}, err
	}
	return plan, nil
}

func (g *Gateway) writeEvidence(
	ctx context.Context,
	plan appstorage.Plan,
	descriptor appreleasecatalog.Descriptor,
	artifact VerifiedArtifact,
	state VerificationState,
) (InstalledApp, error) {
	if g.evidenceWriter == nil {
		return InstalledApp{}, ErrEvidenceWriterRequired
	}
	evidence, err := g.evidenceWriter.WriteInstallEvidence(ctx, plan, descriptor, artifact, state)
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
