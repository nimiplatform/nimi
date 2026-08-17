package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/protobuf/types/known/structpb"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	flags := flag.NewFlagSet("local-model-recovery", flag.ContinueOnError)
	flags.SetOutput(stderr)
	modelsRoot := flags.String("models-root", "", "explicit Runtime models root to inspect")
	adopt := flags.Bool("adopt", false, "explicitly adopt reimportable resolved/ directories into ModelAsset inventory without copying payload bytes")
	migrateLegacy := flags.Bool("migrate-legacy-state-assets", false, "explicitly migrate legacy resolved LocalAsset rows into ModelAsset inventory")
	migrateConfigurations := flags.Bool("migrate-configurations", false, "report Machine Local AI Configuration rows as inactive Loadout migration drafts or explicit failures")
	commitConfiguration := flags.String("commit-configuration", "", "explicitly commit the migration draft for one configuration_id without selecting it")
	stateStore := flags.String("state-store", "", "Runtime local state path whose parent owns model-assets.json; required with a write mode")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	writeConfiguration := strings.TrimSpace(*commitConfiguration) != ""
	modeCount := 0
	for _, active := range []bool{*adopt, *migrateLegacy, *migrateConfigurations, writeConfiguration} {
		if active {
			modeCount++
		}
	}
	if modeCount > 1 {
		fmt.Fprintln(stderr, "--adopt, --migrate-legacy-state-assets, --migrate-configurations, and --commit-configuration are mutually exclusive")
		return 2
	}
	root := filepath.Clean(strings.TrimSpace(*modelsRoot))
	if root == "." || strings.TrimSpace(*modelsRoot) == "" {
		fmt.Fprintln(stderr, "--models-root is required; recovery never infers or mutates user state")
		return 2
	}
	if *migrateLegacy {
		statePath, ok := requiredStatePath(*stateStore, "--migrate-legacy-state-assets", stderr)
		if !ok {
			return 2
		}
		if err := migrateLegacyStateAssets(root, statePath, stdout, stderr); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}
	if *migrateConfigurations || writeConfiguration {
		statePath, ok := requiredStatePath(*stateStore, "configuration migration", stderr)
		if !ok {
			return 2
		}
		if err := migrateConfigurationsToLoadouts(root, statePath, strings.TrimSpace(*commitConfiguration), stdout, stderr); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}
	items, err := localservice.ReportResolvedManifestDirectories(root)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if !*adopt {
		if err := writeReport(stdout, root, items); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}
	statePath, ok := requiredStatePath(*stateStore, "--adopt", stderr)
	if !ok {
		return 2
	}
	if err := adoptResolvedDirectories(root, statePath, items, stdout, stderr); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

func requiredStatePath(value string, mode string, stderr io.Writer) (string, bool) {
	statePath := filepath.Clean(strings.TrimSpace(value))
	if statePath == "." || strings.TrimSpace(value) == "" {
		fmt.Fprintf(stderr, "--state-store is required with %s; recovery never infers the inventory owner\n", mode)
		return "", false
	}
	return statePath, true
}

func writeReport(output io.Writer, root string, items []*localservice.ResolvedManifestDirectoryReport) error {
	projected := make([]map[string]any, 0, len(items))
	for _, item := range items {
		projected = append(projected, map[string]any{
			"path": item.GetPath(), "filename": item.GetFilename(), "size_bytes": item.GetSizeBytes(),
			"recovery_status": item.GetRecoveryStatus(), "failure_reason": item.GetFailureReason(),
			"catalog_hit": item.GetCatalogHit(), "unclassified": item.GetUnclassified(),
			"content_id": item.GetContentId(), "managed_manifest_directory": item.GetManagedManifestDirectory(),
		})
	}
	return writeJSON(output, map[string]any{"mode": "report", "modelsRoot": root, "items": projected})
}

// @nimi-authority: rule.nimi.runtime.local-compute.r008
func adoptResolvedDirectories(root string, statePath string, items []*localservice.ResolvedManifestDirectoryReport, stdout io.Writer, stderr io.Writer) error {
	svc, err := localservice.NewForLocalModelRecovery(slog.New(slog.NewTextHandler(stderr, nil)), auditlog.New(5000, 5000), statePath, 5000, root)
	if err != nil {
		return fmt.Errorf("open Runtime local state: %w", err)
	}
	defer svc.Close()

	results := make([]map[string]any, 0, len(items))
	failedCount := 0
	for _, item := range items {
		directory := strings.TrimSpace(item.GetPath())
		if directory == "" || !item.GetManagedManifestDirectory() || item.GetRecoveryStatus() != "reimportable" {
			failedCount++
			results = append(results, map[string]any{
				"managed_manifest_directory": directory,
				"state":                      "failed",
				"message":                    strings.TrimSpace(item.GetFailureReason()),
			})
			continue
		}
		response, err := svc.ImportModelAsset(context.Background(), &runtimev1.ImportModelAssetRequest{
			SourcePath:  directory,
			DisplayName: strings.TrimSpace(item.GetFilename()),
		})
		if err != nil {
			failedCount++
			results = append(results, map[string]any{
				"managed_manifest_directory": directory,
				"state":                      "failed",
				"message":                    err.Error(),
			})
			continue
		}
		transfer, err := waitForTransfer(context.Background(), svc, response.GetTransfer().GetInstallSessionId(), 12*time.Hour)
		if err != nil {
			failedCount++
			results = append(results, map[string]any{
				"managed_manifest_directory": directory,
				"state":                      "failed",
				"message":                    err.Error(),
			})
			continue
		}
		results = append(results, map[string]any{
			"managed_manifest_directory": directory,
			"model_asset_id":             transfer.GetAssetId(),
			"state":                      transfer.GetState(),
			"message":                    transfer.GetMessage(),
		})
	}
	inventory, err := svc.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{PageSize: 1000})
	if err != nil {
		return fmt.Errorf("list adopted ModelAssets: %w", err)
	}
	if err := writeJSON(stdout, map[string]any{
		"mode":            "adopt",
		"modelsRoot":      root,
		"stateStore":      statePath,
		"adoptionResults": results,
		"failedCount":     failedCount,
		"modelAssetCount": len(inventory.GetAssets()),
		"nextPageToken":   inventory.GetNextPageToken(),
	}); err != nil {
		return err
	}
	if failedCount > 0 {
		return fmt.Errorf("adoption completed with %d failed item(s); inspect adoptionResults", failedCount)
	}
	return nil
}

func migrateLegacyStateAssets(root string, statePath string, stdout io.Writer, stderr io.Writer) error {
	svc, err := localservice.NewForLocalModelRecovery(slog.New(slog.NewTextHandler(stderr, nil)), auditlog.New(5000, 5000), statePath, 5000, root)
	if err != nil {
		return fmt.Errorf("open Runtime local state: %w", err)
	}
	defer svc.Close()

	report, migrationErr := svc.MigrateLegacyResolvedAssetsToModelAssetStore(context.Background())
	if err := writeJSON(stdout, map[string]any{
		"mode":       "migrate-legacy-state-assets",
		"modelsRoot": root,
		"stateStore": statePath,
		"noOp":       len(report.Items) == 0,
		"migration":  report,
	}); err != nil {
		return err
	}
	if migrationErr != nil {
		return fmt.Errorf("migrate legacy state assets: %w", migrationErr)
	}
	return nil
}

type configurationMigrationDraft struct {
	SourceRowIndex  int
	ConfigurationID string
	DisplayName     string
	Capability      string
	Recipe          *runtimev1.LoadoutRecipeDescriptor
	Options         *structpb.Struct
	Features        []string
	Axes            []*runtimev1.LoadoutModelAxisInput
	FailureReason   string
}

// legacyConfiguration is the bounded read model for the retired
// machine-local-ai-configuration.json format. The recovery tool reads this
// document directly so the retired product RPC and protobuf surface do not
// remain live merely to support the one-time migration command.
type legacyConfiguration struct {
	SourceRowIndex    int                          `json:"-"`
	ConfigurationID   string                       `json:"configuration_id"`
	Capability        string                       `json:"capability_contract"`
	Implementation    legacyImplementationIdentity `json:"implementation"`
	PortableConfig    map[string]any               `json:"portable_config"`
	ExactBindings     []legacyExactBinding         `json:"exact_bindings"`
	SupportedFeatures []string                     `json:"supported_features"`
	DisplayName       string                       `json:"display_name"`
}

type legacyImplementationIdentity struct {
	ImplementationID string `json:"implementation_id"`
	DriverID         string `json:"driver_id"`
	DriverDialect    string `json:"driver_dialect"`
}

type legacyExactBinding struct {
	RequirementID     string `json:"requirement_id"`
	VerifiedContentID string `json:"verified_content_id"`
}

func loadLegacyConfigurations(statePath string) ([]legacyConfiguration, []configurationMigrationDraft, error) {
	path := filepath.Join(filepath.Dir(statePath), "machine-local-ai-configuration.json")
	payload, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("read retired machine configuration store: %w", err)
	}
	var snapshot struct {
		SchemaVersion  int `json:"schemaVersion"`
		Configurations []struct {
			Configuration json.RawMessage `json:"configuration"`
		} `json:"configurations"`
	}
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return nil, nil, fmt.Errorf("decode retired machine configuration store: %w", err)
	}
	if snapshot.SchemaVersion != 1 {
		return nil, nil, fmt.Errorf("retired machine configuration store has unsupported schemaVersion=%d", snapshot.SchemaVersion)
	}
	configurations := make([]legacyConfiguration, 0, len(snapshot.Configurations))
	failures := make([]configurationMigrationDraft, 0)
	for index, row := range snapshot.Configurations {
		var configuration legacyConfiguration
		if err := json.Unmarshal(row.Configuration, &configuration); err != nil {
			failures = append(failures, configurationMigrationDraft{SourceRowIndex: index, FailureReason: fmt.Sprintf("decode retired machine configuration row %d: %v", index, err)})
			continue
		}
		configuration.SourceRowIndex = index
		configuration.ConfigurationID = strings.TrimSpace(configuration.ConfigurationID)
		configuration.Capability = strings.TrimSpace(configuration.Capability)
		configuration.DisplayName = strings.TrimSpace(configuration.DisplayName)
		if configuration.ConfigurationID == "" || configuration.Capability == "" {
			failures = append(failures, configurationMigrationDraft{
				SourceRowIndex: index, ConfigurationID: configuration.ConfigurationID,
				Capability: configuration.Capability, DisplayName: configuration.DisplayName,
				FailureReason: fmt.Sprintf("retired machine configuration row %d has incomplete identity", index),
			})
			continue
		}
		configurations = append(configurations, configuration)
	}
	return configurations, failures, nil
}

// migrateConfigurationsToLoadouts keeps the one-time cutover explicit. The
// report path is read-only; the commit path creates exactly one Loadout and
// deliberately does not Select it.
func migrateConfigurationsToLoadouts(root string, statePath string, commitConfigurationID string, stdout io.Writer, stderr io.Writer) error {
	svc, err := localservice.NewForLocalModelRecovery(slog.New(slog.NewTextHandler(stderr, nil)), auditlog.New(5000, 5000), statePath, 5000, root)
	if err != nil {
		return fmt.Errorf("open Runtime local state: %w", err)
	}
	defer svc.Close()

	configurations, loadFailures, err := loadLegacyConfigurations(statePath)
	if err != nil {
		return err
	}
	recipesResponse, err := svc.ListLoadoutRecipes(context.Background(), &runtimev1.ListLoadoutRecipesRequest{})
	if err != nil {
		return fmt.Errorf("list Loadout recipes: %w", err)
	}
	assetsResponse, err := svc.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{PageSize: 1000})
	if err != nil {
		return fmt.Errorf("list ModelAssets: %w", err)
	}
	drafts := buildConfigurationMigrationDrafts(
		configurations,
		recipesResponse.GetRecipes(),
		assetsResponse.GetAssets(),
	)
	drafts = append(drafts, loadFailures...)
	sort.Slice(drafts, func(i, j int) bool { return drafts[i].SourceRowIndex < drafts[j].SourceRowIndex })
	preflightConfigurationMigrationDrafts(svc, drafts)

	if commitConfigurationID == "" {
		return writeJSON(stdout, map[string]any{
			"mode": "migrate-configurations", "modelsRoot": root, "stateStore": statePath,
			"items": configurationMigrationReportItems(drafts),
		})
	}
	draft := configurationMigrationDraftByID(drafts, commitConfigurationID)
	if draft == nil {
		return fmt.Errorf("configuration %q was not found", commitConfigurationID)
	}
	if draft.FailureReason != "" || draft.Recipe == nil {
		return fmt.Errorf("configuration %q has no committable Loadout draft: %s", commitConfigurationID, draft.FailureReason)
	}
	existingResponse, err := svc.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		return fmt.Errorf("list existing Loadouts: %w", err)
	}
	if existing := migratedLoadoutForConfiguration(existingResponse.GetAggregate().GetLoadouts(), commitConfigurationID); existing != nil {
		return writeJSON(stdout, map[string]any{
			"mode": "commit-configuration", "configurationId": commitConfigurationID,
			"loadoutId": existing.GetLoadoutId(), "validationState": existing.GetValidationState().String(),
			"selected": false, "noOp": true,
		})
	}
	provenance, _ := structpb.NewStruct(map[string]any{
		"source": "machine-local-ai-configuration-migration", "legacy_configuration_id": commitConfigurationID,
	})
	prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: draft.Capability,
		RecipeId:           draft.Recipe.GetRecipeId(),
		Options:            draft.Options,
		SupportedFeatures:  append([]string(nil), draft.Features...),
		DisplayName:        draft.DisplayName,
		ModelAxes:          draft.Axes,
		Provenance:         provenance,
	})
	if err != nil {
		return fmt.Errorf("prepare Loadout for configuration %q: %w", commitConfigurationID, err)
	}
	committed, err := svc.CommitLoadout(context.Background(), &runtimev1.CommitLoadoutRequest{PrepareId: prepared.GetPrepareId()})
	if err != nil {
		return fmt.Errorf("commit Loadout for configuration %q: %w", commitConfigurationID, err)
	}
	return writeJSON(stdout, map[string]any{
		"mode": "commit-configuration", "configurationId": commitConfigurationID,
		"loadoutId": committed.GetLoadout().GetLoadoutId(), "validationState": committed.GetLoadout().GetValidationState().String(),
		"selected": false, "noOp": false,
	})
}

func buildConfigurationMigrationDrafts(
	configurations []legacyConfiguration,
	recipes []*runtimev1.LoadoutRecipeDescriptor,
	assets []*runtimev1.ModelAssetRecord,
) []configurationMigrationDraft {
	assetsByContent := make(map[string][]*runtimev1.ModelAssetRecord)
	for _, asset := range assets {
		if asset == nil || strings.TrimSpace(asset.GetContentId()) == "" {
			continue
		}
		assetsByContent[asset.GetContentId()] = append(assetsByContent[asset.GetContentId()], asset)
	}
	for contentID := range assetsByContent {
		sort.Slice(assetsByContent[contentID], func(i, j int) bool {
			return assetsByContent[contentID][i].GetModelAssetId() < assetsByContent[contentID][j].GetModelAssetId()
		})
	}
	result := make([]configurationMigrationDraft, 0, len(configurations))
	for _, configuration := range configurations {
		draft := configurationMigrationDraft{
			SourceRowIndex:  configuration.SourceRowIndex,
			ConfigurationID: configuration.ConfigurationID, DisplayName: configuration.DisplayName,
			Capability: configuration.Capability, Features: append([]string(nil), configuration.SupportedFeatures...),
		}
		draft.Recipe, draft.FailureReason = selectMigrationRecipe(&configuration, recipes)
		if draft.FailureReason == "" {
			draft.Options = migrationOptions(configuration.PortableConfig)
			slots := make(map[string]struct{}, len(draft.Recipe.GetSlots()))
			for _, slot := range draft.Recipe.GetSlots() {
				slots[slot.GetSlotId()] = struct{}{}
			}
			for _, binding := range configuration.ExactBindings {
				if _, ok := slots[binding.RequirementID]; !ok {
					draft.FailureReason = "legacy binding has no matching recipe slot: " + binding.RequirementID
					break
				}
				matches := assetsByContent[binding.VerifiedContentID]
				if len(matches) == 0 {
					draft.FailureReason = "no ModelAsset matches content identity for slot " + binding.RequirementID
					break
				}
				draft.Axes = append(draft.Axes, &runtimev1.LoadoutModelAxisInput{
					SlotId: binding.RequirementID, ModelAssetId: matches[0].GetModelAssetId(), ExpectedContentId: binding.VerifiedContentID,
				})
			}
			if draft.FailureReason == "" && len(draft.Axes) != len(draft.Recipe.GetSlots()) {
				draft.FailureReason = "legacy configuration does not bind every recipe slot"
			}
		}
		result = append(result, draft)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].SourceRowIndex < result[j].SourceRowIndex })
	return result
}

func selectMigrationRecipe(configuration *legacyConfiguration, recipes []*runtimev1.LoadoutRecipeDescriptor) (*runtimev1.LoadoutRecipeDescriptor, string) {
	candidates := make([]*runtimev1.LoadoutRecipeDescriptor, 0)
	for _, recipe := range recipes {
		if recipe != nil && recipe.GetCapabilityContract() == configuration.Capability &&
			sameImplementation(recipe.GetImplementation(), configuration.Implementation) {
			candidates = append(candidates, recipe)
		}
	}
	if len(candidates) == 0 {
		return nil, "no Loadout recipe matches the legacy capability and Driver dialect"
	}
	if recipeID := migrationRecipeID(configuration.PortableConfig); recipeID != "" {
		for _, candidate := range candidates {
			if candidate.GetRecipeId() == recipeID {
				return candidate, ""
			}
		}
		return nil, "portable recipeId is unavailable: " + recipeID
	}
	bestScore := -1
	var best *runtimev1.LoadoutRecipeDescriptor
	ambiguous := false
	for _, candidate := range candidates {
		score := 0
		for _, binding := range configuration.ExactBindings {
			for _, slot := range candidate.GetSlots() {
				if slot.GetSlotId() == binding.RequirementID && stringSliceContains(slot.GetRecommendedContentIds(), binding.VerifiedContentID) {
					score++
				}
			}
		}
		if score > bestScore {
			best, bestScore, ambiguous = candidate, score, false
		} else if score == bestScore {
			ambiguous = true
		}
	}
	if len(candidates) == 1 || (!ambiguous && bestScore > 0) {
		return best, ""
	}
	return nil, "multiple Loadout recipes match and content identity does not select one"
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func sameImplementation(left *runtimev1.CapabilityImplementationIdentity, right legacyImplementationIdentity) bool {
	return left != nil && left.GetImplementationId() == right.ImplementationID &&
		left.GetDriverId() == right.DriverID && left.GetDriverDialect() == right.DriverDialect
}

func migrationRecipeID(portable map[string]any) string {
	value, _ := portable["recipeId"].(string)
	return strings.TrimSpace(value)
}

func migrationOptions(portable map[string]any) *structpb.Struct {
	values := make(map[string]any, len(portable))
	for key, value := range portable {
		values[key] = value
	}
	for key := range values {
		normalized := strings.ToLower(strings.TrimSpace(key))
		if normalized == "modelfamily" || normalized == "recipeid" ||
			strings.HasSuffix(normalized, "requirementpolicy") || strings.HasSuffix(normalized, "verifiedcontentid") {
			delete(values, key)
		}
	}
	result, _ := structpb.NewStruct(values)
	return result
}

func preflightConfigurationMigrationDrafts(svc *localservice.Service, drafts []configurationMigrationDraft) {
	if svc == nil {
		return
	}
	for index := range drafts {
		draft := &drafts[index]
		if draft.FailureReason != "" || draft.Recipe == nil {
			continue
		}
		if _, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
			CapabilityContract: draft.Capability,
			RecipeId:           draft.Recipe.GetRecipeId(),
			Options:            draft.Options,
			SupportedFeatures:  append([]string(nil), draft.Features...),
			DisplayName:        draft.DisplayName,
			ModelAxes:          draft.Axes,
		}); err != nil {
			draft.FailureReason = "Loadout Prepare rejected migration draft: " + err.Error()
		}
	}
}

func configurationMigrationReportItems(drafts []configurationMigrationDraft) []map[string]any {
	items := make([]map[string]any, 0, len(drafts))
	for _, draft := range drafts {
		item := map[string]any{
			"row_index": draft.SourceRowIndex, "configuration_id": draft.ConfigurationID,
			"display_name": draft.DisplayName, "capability_contract": draft.Capability,
		}
		if draft.FailureReason != "" {
			item["status"], item["failure_reason"] = "failed", draft.FailureReason
		} else {
			axes := make([]map[string]string, 0, len(draft.Axes))
			for _, axis := range draft.Axes {
				axes = append(axes, map[string]string{"slot_id": axis.GetSlotId(), "model_asset_id": axis.GetModelAssetId(), "content_id": axis.GetExpectedContentId()})
			}
			item["status"], item["recipe_id"], item["recipe_revision"] = "draft", draft.Recipe.GetRecipeId(), draft.Recipe.GetRevision()
			item["driver_dialect"], item["options"], item["model_axes"] = draft.Recipe.GetImplementation().GetDriverDialect(), draft.Options.AsMap(), axes
			item["active"] = false
		}
		items = append(items, item)
	}
	return items
}

func configurationMigrationDraftByID(drafts []configurationMigrationDraft, configurationID string) *configurationMigrationDraft {
	for index := range drafts {
		if drafts[index].ConfigurationID == configurationID {
			return &drafts[index]
		}
	}
	return nil
}

func migratedLoadoutForConfiguration(loadouts []*runtimev1.Loadout, configurationID string) *runtimev1.Loadout {
	for _, loadout := range loadouts {
		if loadout != nil && loadout.GetProvenance().GetFields()["legacy_configuration_id"].GetStringValue() == configurationID {
			return loadout
		}
	}
	return nil
}

func waitForTransfer(ctx context.Context, svc *localservice.Service, sessionID string, timeout time.Duration) (*runtimev1.LocalTransferSessionSummary, error) {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		response, err := svc.ListLocalTransfers(ctx, &runtimev1.ListLocalTransfersRequest{})
		if err != nil {
			return nil, err
		}
		for _, transfer := range response.GetTransfers() {
			if transfer.GetInstallSessionId() != sessionID {
				continue
			}
			switch transfer.GetState() {
			case "completed":
				return transfer, nil
			case "failed", "cancelled":
				return nil, fmt.Errorf("transfer %s: %s", transfer.GetState(), transfer.GetMessage())
			}
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-deadline.C:
			return nil, fmt.Errorf("transfer timed out after %s", timeout)
		case <-ticker.C:
		}
	}
}

func writeJSON(output io.Writer, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintln(output, string(payload)); err != nil {
		return fmt.Errorf("write recovery report: %w", err)
	}
	return nil
}
