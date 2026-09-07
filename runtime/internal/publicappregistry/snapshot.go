package publicappregistry

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	goruntime "runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dlclark/regexp2"
	jsonschema "github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
)

const (
	canonicalRepository      = "nimiplatform/nimi-app-registry"
	canonicalBranch          = "main"
	canonicalGitRefsURL      = "https://github.com/" + canonicalRepository + ".git/info/refs?service=git-upload-pack"
	gitRefsMediaType         = "application/x-git-upload-pack-advertisement"
	canonicalRawContentBase  = "https://raw.githubusercontent.com/" + canonicalRepository
	canonicalSchemaDraftID   = "https://json-schema.org/draft/2020-12/schema"
	canonicalCommonSchemaID  = "https://registry.nimi.ai/schema/common.schema.json"
	canonicalIndexSchemaID   = "https://registry.nimi.ai/schema/index.schema.json"
	canonicalDescriptorID    = "https://registry.nimi.ai/schema/approved-descriptor.schema.json"
	commonSchemaPath         = "schema/common.schema.json"
	indexSchemaPath          = "schema/index.schema.json"
	descriptorSchemaPath     = "schema/approved-descriptor.schema.json"
	indexDocumentPath        = "index.json"
	maxCommitDocumentBytes   = int64(64 * 1024)
	maxSchemaDocumentBytes   = int64(512 * 1024)
	maxIndexDocumentBytes    = int64(4 * 1024 * 1024)
	maxDescriptorDocumentLen = int64(1024 * 1024)
	canonicalRequestTimeout  = 15 * time.Second
	approvedSelectorPrefix   = "nats_v1_"
)

var (
	ErrInvalidRegistrySnapshot = errors.New("invalid public App Registry snapshot")
	ErrCatalogAppNotFound      = errors.New("public App Registry entry not found")
	ErrCatalogTargetNotFound   = errors.New("public App Registry target not found")
	ErrInvalidSelector         = errors.New("invalid approved target selector")
	ErrStaleSelection          = errors.New("approved target selection is stale")
	ErrPolicyBlocked           = errors.New("public App Registry target is policy blocked")
	ErrRegistryUnavailable     = errors.New("public App Registry is unavailable")

	commitSHAPattern     = regexp.MustCompile(`^[0-9a-f]{40}$`)
	appIDPattern         = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$`)
	versionPattern       = regexp.MustCompile(`^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$`)
	targetIDPattern      = regexp.MustCompile(`^[a-z0-9]+(?:[_-][a-z0-9]+)*$`)
	descriptorPathRegexp = regexp.MustCompile(`^descriptors/([a-z][a-z0-9]*(?:[._-][a-z0-9]+)+)/([^/]+)\.json$`)
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-eco-002b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a

// Client resolves only the canonical public Registry main branch. The source
// is intentionally private so product code cannot supply a fork, local path,
// environment URL, or caller-selected Registry.
type Client struct {
	source documentSource
}

type documentSource interface {
	resolveMainRevision(context.Context) (string, error)
	readAt(context.Context, string, string, int64) ([]byte, error)
}

type canonicalGitHubSource struct {
	httpClient *http.Client
}

type denySchemaLoader struct{}

func (denySchemaLoader) Load(rawURL string) (any, error) {
	return nil, fmt.Errorf("load undeclared public App Registry schema %s: %w", rawURL, ErrInvalidRegistrySnapshot)
}

type ecmaRegexp regexp2.Regexp

func (re *ecmaRegexp) MatchString(value string) bool {
	matched, err := (*regexp2.Regexp)(re).MatchString(value)
	return err == nil && matched
}

func (re *ecmaRegexp) String() string {
	return (*regexp2.Regexp)(re).String()
}

func compileECMARegexp(expression string) (jsonschema.Regexp, error) {
	re, err := regexp2.Compile(expression, regexp2.ECMAScript)
	if err != nil {
		return nil, err
	}
	re.MatchTimeout = 100 * time.Millisecond
	return (*ecmaRegexp)(re), nil
}

// NewCanonicalClient creates the sole production Registry source. It accepts
// no repository, branch, URL, filesystem, or transport input.
func NewCanonicalClient() *Client {
	transport := http.DefaultTransport
	if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok {
		transport = defaultTransport.Clone()
	}
	return &Client{source: newCanonicalGitHubSource(transport)}
}

// ListCurrentPlatformTargets projects the canonical Registry for the exact
// package target implemented by this Runtime build. Adding a future platform
// extends this closed mapping; callers never choose a target, origin, branch,
// or Registry revision.
func (c *Client) ListCurrentPlatformTargets(ctx context.Context) ([]ResolvedApprovedTarget, error) {
	targetID, expectedOS, expectedArch, err := currentPlatformTarget(goruntime.GOOS, goruntime.GOARCH)
	if err != nil {
		return nil, err
	}
	snapshot, err := c.Load(ctx)
	if err != nil {
		return nil, err
	}
	return snapshot.ListVisible(ctx, targetID, expectedOS, expectedArch)
}

func currentPlatformTarget(goos, goarch string) (string, string, string, error) {
	if goos == "windows" && goarch == "amd64" {
		return "windows-x86_64", "windows", "x86_64", nil
	}
	return "", "", "", fmt.Errorf("public App Catalog is unavailable for %s/%s: %w", goos, goarch, ErrCatalogTargetNotFound)
}

func newCanonicalGitHubSource(transport http.RoundTripper) *canonicalGitHubSource {
	return &canonicalGitHubSource{httpClient: &http.Client{
		Transport: transport,
		Timeout:   canonicalRequestTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("public App Registry redirects are forbidden")
		},
	}}
}

// Snapshot is one immutable Registry view. Index, schemas, and descriptors are
// always read from Revision; the mutable main branch is never re-read inside a
// snapshot.
type Snapshot struct {
	source           documentSource
	revision         string
	index            registryIndexDocument
	descriptorSchema *jsonschema.Schema
}

func (s *Snapshot) Revision() string {
	if s == nil {
		return ""
	}
	return s.revision
}

// ListVisible resolves every public App that has an admitted pointer for the
// exact target. A malformed visible row fails the whole snapshot rather than
// silently disappearing from Catalog truth.
func (s *Snapshot) ListVisible(ctx context.Context, targetID, expectedOS, expectedArch string) ([]ResolvedApprovedTarget, error) {
	if s == nil || !targetIDPattern.MatchString(targetID) || !validTargetPlatform(expectedOS, expectedArch) {
		return nil, fmt.Errorf("list approved App targets: %w", ErrInvalidRegistrySnapshot)
	}
	appIDs := make([]string, 0, len(s.index.Apps))
	for appID, row := range s.index.Apps {
		if row.Visibility == "public" {
			if _, ok := row.LatestAdmittedReleaseByTarget[targetID]; ok {
				appIDs = append(appIDs, appID)
			}
		}
	}
	sort.Strings(appIDs)
	result := make([]ResolvedApprovedTarget, 0, len(appIDs))
	for _, appID := range appIDs {
		resolved, err := s.Resolve(ctx, appID, targetID, expectedOS, expectedArch)
		if err != nil {
			return nil, fmt.Errorf("list approved App target %s/%s: %w", appID, targetID, err)
		}
		result = append(result, resolved)
	}
	return result, nil
}

type ApprovedTargetSelector struct {
	descriptorID           string
	targetID               string
	observedRegistryCommit string
}

func (s ApprovedTargetSelector) DescriptorID() string           { return s.descriptorID }
func (s ApprovedTargetSelector) TargetID() string               { return s.targetID }
func (s ApprovedTargetSelector) ObservedRegistryCommit() string { return s.observedRegistryCommit }

func (s ApprovedTargetSelector) Encode() (string, error) {
	if !s.valid() {
		return "", ErrInvalidSelector
	}
	encode := base64.RawURLEncoding.EncodeToString
	return approvedSelectorPrefix + encode([]byte(s.descriptorID)) + "." + encode([]byte(s.targetID)) + "." + encode([]byte(s.observedRegistryCommit)), nil
}

func ParseApprovedTargetSelector(value string) (ApprovedTargetSelector, error) {
	if !strings.HasPrefix(value, approvedSelectorPrefix) || value != strings.TrimSpace(value) {
		return ApprovedTargetSelector{}, ErrInvalidSelector
	}
	parts := strings.Split(strings.TrimPrefix(value, approvedSelectorPrefix), ".")
	if len(parts) != 3 {
		return ApprovedTargetSelector{}, ErrInvalidSelector
	}
	decode := func(part string) (string, error) {
		raw, err := base64.RawURLEncoding.DecodeString(part)
		if err != nil || len(raw) == 0 {
			return "", ErrInvalidSelector
		}
		return string(raw), nil
	}
	descriptorID, err := decode(parts[0])
	if err != nil {
		return ApprovedTargetSelector{}, err
	}
	targetID, err := decode(parts[1])
	if err != nil {
		return ApprovedTargetSelector{}, err
	}
	revision, err := decode(parts[2])
	if err != nil {
		return ApprovedTargetSelector{}, err
	}
	selector := ApprovedTargetSelector{
		descriptorID: descriptorID, targetID: targetID, observedRegistryCommit: revision,
	}
	canonical, err := selector.Encode()
	if err != nil || canonical != value {
		return ApprovedTargetSelector{}, ErrInvalidSelector
	}
	return selector, nil
}

func (s ApprovedTargetSelector) valid() bool {
	return validDescriptorID(s.descriptorID) && targetIDPattern.MatchString(s.targetID) &&
		commitSHAPattern.MatchString(s.observedRegistryCommit)
}

type KillSwitch struct {
	Active   bool    `json:"active"`
	Reason   *string `json:"reason"`
	Revision uint64  `json:"revision"`
}

type PolicyBlockedError struct {
	Reason   string
	Revision uint64
}

func (e *PolicyBlockedError) Error() string {
	return fmt.Sprintf("%s: revision=%d reason=%s", ErrPolicyBlocked, e.Revision, e.Reason)
}

func (e *PolicyBlockedError) Unwrap() error { return ErrPolicyBlocked }

type Publisher struct {
	GitHubNamespace string  `json:"github_namespace"`
	NamespaceKind   string  `json:"namespace_kind"`
	Assurance       string  `json:"assurance"`
	VerifiedDomain  *string `json:"verified_domain_ref"`
	KYCRef          *string `json:"kyc_ref"`
}

type LicenseFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type SourceLicense struct {
	SPDXExpression string        `json:"spdx_expression"`
	Files          []LicenseFile `json:"files"`
}

type Source struct {
	Repository string        `json:"repository"`
	License    SourceLicense `json:"license"`
}

type Release struct {
	Tag              string `json:"tag"`
	TagProtectionRef string `json:"tag_protection_ref"`
	CommitSHA        string `json:"commit_sha"`
	ReleaseID        int64  `json:"release_id"`
	ReleaseURL       string `json:"release_url"`
	ReleaseNotesURL  string `json:"release_notes_url"`
	Immutable        bool   `json:"immutable"`
	Prerelease       bool   `json:"prerelease"`
}

type Package struct {
	Kind             string `json:"kind"`
	RuntimeKind      string `json:"runtime_kind"`
	RegistrationMode string `json:"registration_mode"`
	SandboxRef       string `json:"sandbox_ref"`
}

type StorageDisclosure struct {
	PathPattern string `json:"path_pattern"`
	Purpose     string `json:"purpose"`
	Retention   string `json:"retention"`
	Removal     string `json:"removal"`
}

type StoragePolicy struct {
	Kind                string              `json:"kind"`
	OSStorageDisclosure []StorageDisclosure `json:"os_storage_disclosure"`
}

type Support struct {
	DiagnosticsBundleFields []string `json:"diagnostics_bundle_fields"`
	RedactionRules          []string `json:"redaction_rules"`
	IssueCategories         []string `json:"issue_categories"`
	EscalationURL           string   `json:"escalation_url"`
	KillSwitchVisibility    string   `json:"kill_switch_visibility"`
	RecoveryInstructions    string   `json:"recovery_instructions"`
}

type NativeTrust struct {
	SigningSubject          *string `json:"signing_subject"`
	ObservedSubject         *string `json:"observed_subject"`
	EntitlementsRef         *string `json:"entitlements_ref"`
	WindowsCodeSigning      string  `json:"windows_code_signing"`
	MacOSNotarization       string  `json:"macos_notarization"`
	MacOSDeveloperIDSubject *string `json:"macos_developer_id_subject"`
}

type Target struct {
	TargetID                  string      `json:"target_id"`
	OS                        string      `json:"os"`
	Arch                      string      `json:"arch"`
	AssetID                   int64       `json:"asset_id"`
	AssetName                 string      `json:"asset_name"`
	AssetURL                  string      `json:"asset_url"`
	Size                      int64       `json:"size"`
	SHA256                    string      `json:"sha256"`
	RuntimeEntry              string      `json:"runtime_entry"`
	ProvenanceAttestationRefs []string    `json:"provenance_attestation_refs"`
	ExecutionProfileRef       string      `json:"execution_profile_ref"`
	NativeTrust               NativeTrust `json:"native_trust"`
}

type Review struct {
	Decision           string `json:"decision"`
	AdjudicatorLogin   string `json:"adjudicator_login"`
	AdjudicatorActorID int64  `json:"adjudicator_actor_id"`
	ReasonCode         string `json:"reason_code"`
	DecidedAt          string `json:"decided_at"`
}

type DependencyAssurance struct {
	LockfileReviewed bool    `json:"lockfile_reviewed"`
	SBOMRef          *string `json:"sbom_ref"`
}

type Admission struct {
	OrdinaryReleaseProof bool                `json:"ordinary_release_proof"`
	TrustTier            string              `json:"trust_tier"`
	BuildAssurance       string              `json:"build_assurance"`
	DependencyAssurance  DependencyAssurance `json:"dependency_assurance"`
	Review               Review              `json:"review"`
}

type ResolvedApprovedTarget struct {
	Selector                        ApprovedTargetSelector
	RegistryRevision                string
	DescriptorID                    string
	AppID                           string
	DisplayName                     string
	Version                         string
	Visibility                      string
	KillSwitch                      KillSwitch
	Publisher                       Publisher
	Source                          Source
	Release                         Release
	Package                         Package
	Admission                       Admission
	AppAccess                       []string
	CapabilityContractRefs          []string
	RequiredStandardizedFeatureRefs []string
	StoragePolicy                   StoragePolicy
	UpdateChannel                   string
	RollbackMarker                  string
	Support                         Support
	Target                          Target
}

type registryIndexDocument struct {
	SchemaVersion int                       `json:"schema_version"`
	Apps          map[string]registryAppRow `json:"apps"`
}

type registryAppRow struct {
	DisplayName                   string                       `json:"display_name"`
	Visibility                    string                       `json:"visibility"`
	AdmissionStatus               string                       `json:"admission_status"`
	KillSwitch                    KillSwitch                   `json:"kill_switch"`
	LatestAdmittedReleaseByTarget map[string]descriptorPointer `json:"latest_admitted_release_by_target"`
}

type descriptorPointer struct {
	DescriptorID string `json:"descriptor_id"`
	Path         string `json:"path"`
}

type publisherSubmission struct {
	PullNumber int64  `json:"pull_number"`
	Path       string `json:"path"`
	HeadSHA    string `json:"head_sha"`
}

type aggregateAsset struct {
	AssetID   int64  `json:"asset_id"`
	AssetName string `json:"asset_name"`
	AssetURL  string `json:"asset_url"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
}

type approvedCandidate struct {
	AppID                           string         `json:"app_id"`
	DisplayName                     string         `json:"display_name"`
	Version                         string         `json:"version"`
	Publisher                       Publisher      `json:"publisher"`
	Source                          Source         `json:"source"`
	Release                         Release        `json:"release"`
	Aggregate                       aggregateAsset `json:"aggregate"`
	Package                         Package        `json:"package"`
	AppAccess                       []string       `json:"app_access"`
	CapabilityContractRefs          []string       `json:"capability_contract_refs"`
	RequiredStandardizedFeatureRefs []string       `json:"required_standardized_feature_refs"`
	StoragePolicy                   StoragePolicy  `json:"storage_policy"`
	UpdateChannel                   string         `json:"update_channel"`
	RollbackMarker                  string         `json:"rollback_marker"`
	Support                         Support        `json:"support"`
	Targets                         []Target       `json:"targets"`
}

type approvedDescriptorDocument struct {
	SchemaVersion       int                 `json:"schema_version"`
	DescriptorID        string              `json:"descriptor_id"`
	PublisherSubmission publisherSubmission `json:"publisher_submission"`
	Admission           Admission           `json:"admission"`
	Candidate           approvedCandidate   `json:"candidate"`
}

type registrySchemas struct {
	index      *jsonschema.Schema
	descriptor *jsonschema.Schema
}

func (c *Client) Load(ctx context.Context) (*Snapshot, error) {
	if c == nil || c.source == nil {
		return nil, fmt.Errorf("load public App Registry snapshot: %w", ErrInvalidRegistrySnapshot)
	}
	revision, err := c.source.resolveMainRevision(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve public App Registry main revision: %w", err)
	}
	if !commitSHAPattern.MatchString(revision) {
		return nil, fmt.Errorf("resolve public App Registry main revision: %w", ErrInvalidRegistrySnapshot)
	}
	schemas, err := loadSchemas(ctx, c.source, revision)
	if err != nil {
		return nil, err
	}
	rawIndex, err := c.source.readAt(ctx, revision, indexDocumentPath, maxIndexDocumentBytes)
	if err != nil {
		return nil, fmt.Errorf("read public App Registry index: %w", err)
	}
	if err := validateSchemaDocument(schemas.index, rawIndex); err != nil {
		return nil, fmt.Errorf("validate public App Registry index schema: %w", err)
	}
	var index registryIndexDocument
	if err := jsonstrict.Decode(rawIndex, &index); err != nil {
		return nil, fmt.Errorf("decode public App Registry index: %w", errors.Join(ErrInvalidRegistrySnapshot, err))
	}
	if err := validateIndex(index); err != nil {
		return nil, err
	}
	return &Snapshot{source: c.source, revision: revision, index: index, descriptorSchema: schemas.descriptor}, nil
}

func (s *Snapshot) Resolve(ctx context.Context, appID, targetID, expectedOS, expectedArch string) (ResolvedApprovedTarget, error) {
	if !validTargetPlatform(expectedOS, expectedArch) {
		return ResolvedApprovedTarget{}, fmt.Errorf("resolve approved App target: %w", ErrCatalogTargetNotFound)
	}
	resolved, err := s.resolve(ctx, appID, targetID)
	if err != nil {
		return ResolvedApprovedTarget{}, err
	}
	if resolved.Target.OS != expectedOS || resolved.Target.Arch != expectedArch {
		return ResolvedApprovedTarget{}, fmt.Errorf("resolve approved App target: %w", ErrCatalogTargetNotFound)
	}
	return resolved, nil
}

func (s *Snapshot) resolve(ctx context.Context, appID, targetID string) (ResolvedApprovedTarget, error) {
	if s == nil || s.source == nil || s.descriptorSchema == nil || !commitSHAPattern.MatchString(s.revision) {
		return ResolvedApprovedTarget{}, fmt.Errorf("resolve approved App target: %w", ErrInvalidRegistrySnapshot)
	}
	if !appIDPattern.MatchString(appID) {
		return ResolvedApprovedTarget{}, fmt.Errorf("resolve approved App target: %w", ErrCatalogAppNotFound)
	}
	if !targetIDPattern.MatchString(targetID) {
		return ResolvedApprovedTarget{}, fmt.Errorf("resolve approved App target: %w", ErrCatalogTargetNotFound)
	}
	row, ok := s.index.Apps[appID]
	if !ok || row.Visibility != "public" {
		return ResolvedApprovedTarget{}, fmt.Errorf("resolve approved App target: %w", ErrCatalogAppNotFound)
	}
	pointer, ok := row.LatestAdmittedReleaseByTarget[targetID]
	if !ok {
		return ResolvedApprovedTarget{}, fmt.Errorf("resolve approved App target: %w", ErrCatalogTargetNotFound)
	}
	if err := validateDescriptorPointer(appID, pointer); err != nil {
		return ResolvedApprovedTarget{}, err
	}
	rawDescriptor, err := s.source.readAt(ctx, s.revision, pointer.Path, maxDescriptorDocumentLen)
	if err != nil {
		return ResolvedApprovedTarget{}, fmt.Errorf("read approved App descriptor: %w", err)
	}
	if err := validateSchemaDocument(s.descriptorSchema, rawDescriptor); err != nil {
		return ResolvedApprovedTarget{}, fmt.Errorf("validate approved App descriptor schema: %w", err)
	}
	var descriptor approvedDescriptorDocument
	if err := jsonstrict.Decode(rawDescriptor, &descriptor); err != nil {
		return ResolvedApprovedTarget{}, fmt.Errorf("decode approved App descriptor: %w", errors.Join(ErrInvalidRegistrySnapshot, err))
	}
	if descriptor.Candidate.DisplayName != row.DisplayName {
		return ResolvedApprovedTarget{}, ErrInvalidRegistrySnapshot
	}
	target, err := validateDescriptor(descriptor, pointer.Path, appID, targetID)
	if err != nil {
		return ResolvedApprovedTarget{}, err
	}
	selector := ApprovedTargetSelector{
		descriptorID: pointer.DescriptorID, targetID: targetID, observedRegistryCommit: s.revision,
	}
	return resolvedApprovedTarget(selector, descriptor, target, row, s.revision), nil
}

// Revalidate resolves a previously issued selector against the current
// canonical main snapshot. Active policy wins over staleness; a newer pointer
// is never silently substituted.
func (c *Client) Revalidate(ctx context.Context, selector ApprovedTargetSelector) (ResolvedApprovedTarget, error) {
	if !selector.valid() {
		return ResolvedApprovedTarget{}, ErrInvalidSelector
	}
	appID, ok := descriptorAppID(selector.descriptorID)
	if !ok {
		return ResolvedApprovedTarget{}, ErrInvalidSelector
	}
	snapshot, err := c.Load(ctx)
	if err != nil {
		return ResolvedApprovedTarget{}, err
	}
	row, ok := snapshot.index.Apps[appID]
	if !ok {
		return ResolvedApprovedTarget{}, ErrStaleSelection
	}
	if row.KillSwitch.Active {
		reason := ""
		if row.KillSwitch.Reason != nil {
			reason = *row.KillSwitch.Reason
		}
		return ResolvedApprovedTarget{}, &PolicyBlockedError{Reason: reason, Revision: row.KillSwitch.Revision}
	}
	if snapshot.revision != selector.observedRegistryCommit {
		return ResolvedApprovedTarget{}, ErrStaleSelection
	}
	pointer, ok := row.LatestAdmittedReleaseByTarget[selector.targetID]
	if !ok || pointer.DescriptorID != selector.descriptorID {
		return ResolvedApprovedTarget{}, ErrStaleSelection
	}
	resolved, err := snapshot.resolve(ctx, appID, selector.targetID)
	if err != nil {
		if errors.Is(err, ErrCatalogAppNotFound) || errors.Is(err, ErrCatalogTargetNotFound) {
			return ResolvedApprovedTarget{}, ErrStaleSelection
		}
		return ResolvedApprovedTarget{}, err
	}
	if resolved.DescriptorID != selector.descriptorID {
		return ResolvedApprovedTarget{}, ErrStaleSelection
	}
	return resolved, nil
}

// RevalidateInstalled keeps the installed descriptor/target frozen while
// observing current policy. A changed latest pointer is not an App update or
// permission to launch a different release. Only the package owner calls this
// after resolving an active committed registration; it does not admit installs.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (c *Client) RevalidateInstalled(ctx context.Context, selector ApprovedTargetSelector) (ResolvedApprovedTarget, error) {
	if !selector.valid() {
		return ResolvedApprovedTarget{}, ErrInvalidSelector
	}
	appID, ok := descriptorAppID(selector.descriptorID)
	if !ok {
		return ResolvedApprovedTarget{}, ErrInvalidSelector
	}
	snapshot, err := c.Load(ctx)
	if err != nil {
		return ResolvedApprovedTarget{}, err
	}
	row, ok := snapshot.index.Apps[appID]
	if !ok {
		return ResolvedApprovedTarget{}, ErrCatalogAppNotFound
	}
	if row.KillSwitch.Active {
		return ResolvedApprovedTarget{}, &PolicyBlockedError{Reason: *row.KillSwitch.Reason, Revision: row.KillSwitch.Revision}
	}
	path := expectedDescriptorPath(appID, selector.descriptorID[len(appID)+1:])
	raw, err := snapshot.source.readAt(ctx, snapshot.revision, path, maxDescriptorDocumentLen)
	if err != nil {
		return ResolvedApprovedTarget{}, err
	}
	if err := validateSchemaDocument(snapshot.descriptorSchema, raw); err != nil {
		return ResolvedApprovedTarget{}, err
	}
	var descriptor approvedDescriptorDocument
	if err := jsonstrict.Decode(raw, &descriptor); err != nil {
		return ResolvedApprovedTarget{}, errors.Join(ErrInvalidRegistrySnapshot, err)
	}
	if descriptor.DescriptorID != selector.descriptorID {
		return ResolvedApprovedTarget{}, ErrInvalidRegistrySnapshot
	}
	target, err := validateDescriptor(descriptor, path, appID, selector.targetID)
	if err != nil {
		return ResolvedApprovedTarget{}, err
	}
	return resolvedApprovedTarget(selector, descriptor, target, row, snapshot.revision), nil
}

func resolvedApprovedTarget(selector ApprovedTargetSelector, descriptor approvedDescriptorDocument, target Target, row registryAppRow, revision string) ResolvedApprovedTarget {
	candidate := descriptor.Candidate
	return ResolvedApprovedTarget{
		Selector: selector, RegistryRevision: revision, DescriptorID: descriptor.DescriptorID,
		AppID: candidate.AppID, DisplayName: candidate.DisplayName, Version: candidate.Version,
		Visibility: row.Visibility, KillSwitch: cloneKillSwitch(row.KillSwitch),
		Publisher: candidate.Publisher, Source: cloneSource(candidate.Source), Release: candidate.Release,
		Package: candidate.Package, Admission: descriptor.Admission,
		AppAccess:                       append([]string(nil), candidate.AppAccess...),
		CapabilityContractRefs:          append([]string(nil), candidate.CapabilityContractRefs...),
		RequiredStandardizedFeatureRefs: append([]string(nil), candidate.RequiredStandardizedFeatureRefs...),
		StoragePolicy:                   cloneStoragePolicy(candidate.StoragePolicy), UpdateChannel: candidate.UpdateChannel,
		RollbackMarker: candidate.RollbackMarker, Support: cloneSupport(candidate.Support), Target: cloneTarget(target),
	}
}

func cloneKillSwitch(value KillSwitch) KillSwitch {
	result := value
	if value.Reason != nil {
		reason := *value.Reason
		result.Reason = &reason
	}
	return result
}

func cloneSource(value Source) Source {
	result := value
	result.License.Files = append([]LicenseFile(nil), value.License.Files...)
	return result
}

func cloneStoragePolicy(value StoragePolicy) StoragePolicy {
	result := value
	result.OSStorageDisclosure = append([]StorageDisclosure(nil), value.OSStorageDisclosure...)
	return result
}

func cloneSupport(value Support) Support {
	result := value
	result.DiagnosticsBundleFields = append([]string(nil), value.DiagnosticsBundleFields...)
	result.RedactionRules = append([]string(nil), value.RedactionRules...)
	result.IssueCategories = append([]string(nil), value.IssueCategories...)
	return result
}

func cloneTarget(value Target) Target {
	result := value
	result.ProvenanceAttestationRefs = append([]string(nil), value.ProvenanceAttestationRefs...)
	return result
}

func loadSchemas(ctx context.Context, source documentSource, revision string) (registrySchemas, error) {
	documents := []struct {
		path string
		id   string
	}{
		{path: commonSchemaPath, id: canonicalCommonSchemaID},
		{path: indexSchemaPath, id: canonicalIndexSchemaID},
		{path: descriptorSchemaPath, id: canonicalDescriptorID},
	}
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	compiler.AssertFormat()
	compiler.UseRegexpEngine(compileECMARegexp)
	compiler.UseLoader(denySchemaLoader{})
	for _, document := range documents {
		raw, err := source.readAt(ctx, revision, document.path, maxSchemaDocumentBytes)
		if err != nil {
			return registrySchemas{}, fmt.Errorf("read public App Registry schema %s: %w", document.path, err)
		}
		value, err := decodeSchemaResource(raw, document.id)
		if err != nil {
			return registrySchemas{}, fmt.Errorf("decode public App Registry schema %s: %w", document.path, err)
		}
		if err := compiler.AddResource(document.id, value); err != nil {
			return registrySchemas{}, fmt.Errorf("add public App Registry schema %s: %w", document.path, err)
		}
	}
	indexSchema, err := compiler.Compile(canonicalIndexSchemaID)
	if err != nil {
		return registrySchemas{}, fmt.Errorf("compile public App Registry index schema: %w", errors.Join(ErrInvalidRegistrySnapshot, err))
	}
	descriptorSchema, err := compiler.Compile(canonicalDescriptorID)
	if err != nil {
		return registrySchemas{}, fmt.Errorf("compile public App Registry descriptor schema: %w", errors.Join(ErrInvalidRegistrySnapshot, err))
	}
	return registrySchemas{index: indexSchema, descriptor: descriptorSchema}, nil
}

func decodeSchemaResource(raw []byte, expectedID string) (any, error) {
	if err := jsonstrict.RejectDuplicateKeys(raw); err != nil {
		return nil, errors.Join(ErrInvalidRegistrySnapshot, err)
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.Join(ErrInvalidRegistrySnapshot, err)
	}
	object, ok := value.(map[string]any)
	if !ok || object["$schema"] != canonicalSchemaDraftID || object["$id"] != expectedID {
		return nil, ErrInvalidRegistrySnapshot
	}
	return value, nil
}

func validateSchemaDocument(schema *jsonschema.Schema, raw []byte) error {
	if schema == nil {
		return ErrInvalidRegistrySnapshot
	}
	if err := jsonstrict.RejectDuplicateKeys(raw); err != nil {
		return errors.Join(ErrInvalidRegistrySnapshot, err)
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return errors.Join(ErrInvalidRegistrySnapshot, err)
	}
	if err := schema.Validate(value); err != nil {
		return errors.Join(ErrInvalidRegistrySnapshot, err)
	}
	return nil
}

func (s *canonicalGitHubSource) resolveMainRevision(ctx context.Context) (string, error) {
	if s == nil || s.httpClient == nil {
		return "", ErrInvalidRegistrySnapshot
	}
	raw, err := s.readURL(ctx, canonicalGitRefsURL, maxCommitDocumentBytes, gitRefsMediaType)
	if err != nil {
		return "", err
	}
	return mainRevisionFromGitRefs(raw)
}

// mainRevisionFromGitRefs reads only the standard upload-pack ref advertisement.
// It needs no Git executable, API credential, clone, or alternative Registry.
func mainRevisionFromGitRefs(raw []byte) (string, error) {
	rest := raw
	packet := func() ([]byte, bool, error) {
		if len(rest) < 4 {
			return nil, false, ErrInvalidRegistrySnapshot
		}
		size, err := strconv.ParseUint(string(rest[:4]), 16, 16)
		if err != nil || (size != 0 && size < 4) || size > uint64(len(rest)) {
			return nil, false, ErrInvalidRegistrySnapshot
		}
		if size == 0 {
			rest = rest[4:]
			return nil, true, nil
		}
		payload := rest[4:size]
		rest = rest[size:]
		return payload, false, nil
	}
	header, flush, err := packet()
	if err != nil || flush || strings.TrimSuffix(string(header), "\n") != "# service=git-upload-pack" {
		return "", ErrInvalidRegistrySnapshot
	}
	if _, flush, err = packet(); err != nil || !flush {
		return "", ErrInvalidRegistrySnapshot
	}
	mainRevision := ""
	first := true
	for {
		payload, flush, err := packet()
		if err != nil {
			return "", err
		}
		if flush {
			if len(rest) != 0 || mainRevision == "" {
				return "", ErrInvalidRegistrySnapshot
			}
			return mainRevision, nil
		}
		ref, _, hasCapabilities := strings.Cut(string(payload), "\x00")
		if hasCapabilities != first {
			return "", ErrInvalidRegistrySnapshot
		}
		first = false
		revision, name, ok := strings.Cut(strings.TrimSuffix(ref, "\n"), " ")
		if !ok || !commitSHAPattern.MatchString(revision) || name == "" || strings.ContainsAny(name, " \r\n\x00") {
			return "", ErrInvalidRegistrySnapshot
		}
		if name == "refs/heads/"+canonicalBranch {
			if mainRevision != "" {
				return "", ErrInvalidRegistrySnapshot
			}
			mainRevision = revision
		}
	}
}

func (s *canonicalGitHubSource) readAt(ctx context.Context, revision, relativePath string, limit int64) ([]byte, error) {
	if s == nil || s.httpClient == nil || !commitSHAPattern.MatchString(revision) || !allowedRegistryPath(relativePath) {
		return nil, ErrInvalidRegistrySnapshot
	}
	segments := strings.Split(relativePath, "/")
	for index := range segments {
		segments[index] = url.PathEscape(segments[index])
	}
	target := canonicalRawContentBase + "/" + revision + "/" + strings.Join(segments, "/")
	return s.readURL(ctx, target, limit, "application/json")
}

func (s *canonicalGitHubSource) readURL(ctx context.Context, target string, limit int64, accept string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, fmt.Errorf("create public App Registry request: %w", err)
	}
	request.Header.Set("Accept", accept)
	request.Header.Set("User-Agent", "nimi-runtime-public-app-registry/1")
	response, err := s.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request public App Registry document: %w", errors.Join(ErrRegistryUnavailable, err))
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("request public App Registry document: %w: HTTP %d", ErrRegistryUnavailable, response.StatusCode)
	}
	if accept == gitRefsMediaType {
		mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
		if err != nil || mediaType != gitRefsMediaType {
			return nil, fmt.Errorf("read public App Registry Git refs: %w", ErrInvalidRegistrySnapshot)
		}
	}
	if response.ContentLength > limit {
		return nil, fmt.Errorf("read public App Registry document: %w", ErrInvalidRegistrySnapshot)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read public App Registry document: %w", errors.Join(ErrRegistryUnavailable, err))
	}
	if int64(len(raw)) == 0 || int64(len(raw)) > limit {
		return nil, fmt.Errorf("read public App Registry document: %w", ErrInvalidRegistrySnapshot)
	}
	return raw, nil
}

func allowedRegistryPath(value string) bool {
	if value == indexDocumentPath || value == commonSchemaPath || value == indexSchemaPath || value == descriptorSchemaPath {
		return true
	}
	return descriptorPathRegexp.MatchString(value)
}

func descriptorAppID(descriptorID string) (string, bool) {
	separator := strings.LastIndexByte(descriptorID, '@')
	if separator <= 0 || separator == len(descriptorID)-1 {
		return "", false
	}
	appID := descriptorID[:separator]
	return appID, appIDPattern.MatchString(appID)
}

func validDescriptorID(value string) bool {
	appID, ok := descriptorAppID(value)
	if !ok || len(value) > 200 {
		return false
	}
	return versionPattern.MatchString(value[len(appID)+1:])
}

func validTargetPlatform(osName, arch string) bool {
	return (osName == "windows" || osName == "macos") && (arch == "x86_64" || arch == "arm64")
}

func expectedDescriptorPath(appID, version string) string {
	return "descriptors/" + appID + "/" + version + ".json"
}
