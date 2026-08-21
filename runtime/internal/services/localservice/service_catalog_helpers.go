package localservice

import (
	"strings"

	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func matchesCatalogSearch(item *runtimev1.LocalCatalogModelDescriptor, query string, capability string) bool {
	if item == nil {
		return false
	}
	if capability != "" {
		normalizedCapability := normalizeLocalCapabilityToken(capability)
		matched := false
		for _, cap := range item.GetCapabilities() {
			if normalizeLocalCapabilityToken(cap) == normalizedCapability {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if query == "" {
		return true
	}
	fields := []string{
		item.GetItemId(),
		item.GetTitle(),
		item.GetDescription(),
		item.GetModelId(),
		item.GetRepo(),
		item.GetTemplateId(),
	}
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), query) {
			return true
		}
	}
	return false
}

func mergeInferencePayload(req *runtimev1.AppendInferenceAuditRequest) *structpb.Struct {
	payload := map[string]any{
		"targetId":   strings.TrimSpace(req.GetTargetId()),
		"source":     strings.TrimSpace(req.GetSource()),
		"provider":   strings.TrimSpace(req.GetProvider()),
		"modality":   strings.TrimSpace(req.GetModality()),
		"adapter":    strings.TrimSpace(req.GetAdapter()),
		"model":      strings.TrimSpace(req.GetModel()),
		"endpoint":   strings.TrimSpace(req.GetEndpoint()),
		"reasonCode": strings.TrimSpace(req.GetReasonCode()),
		"detail":     strings.TrimSpace(req.GetDetail()),
	}
	if policy := structToMap(req.GetPolicyGate()); len(policy) > 0 {
		payload["policyGate"] = policy
	}
	if extra := structToMap(req.GetExtra()); len(extra) > 0 {
		payload["extra"] = extra
	}
	return toStruct(payload)
}

func defaultCatalogFromVerified(verified []*runtimev1.LocalVerifiedAssetDescriptor) []*runtimev1.LocalCatalogModelDescriptor {
	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(verified))
	for _, item := range verified {
		items = append(items, &runtimev1.LocalCatalogModelDescriptor{
			ItemId:            "catalog_" + slug(item.GetTemplateId()),
			Source:            "verified",
			Title:             item.GetTitle(),
			Description:       item.GetDescription(),
			ModelId:           item.GetAssetId(),
			Repo:              item.GetRepo(),
			Revision:          item.GetRevision(),
			TemplateId:        item.GetTemplateId(),
			Capabilities:      append([]string(nil), item.GetCapabilities()...),
			Engine:            "",
			EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED,
			InstallKind:       item.GetInstallKind(),
			InstallAvailable:  true,
			Endpoint:          "",
			Entry:             item.GetEntry(),
			Files:             append([]string(nil), item.GetFiles()...),
			License:           item.GetLicense(),
			Hashes:            cloneStringMap(item.GetHashes()),
			Tags:              append([]string(nil), item.GetTags()...),
			Verified:          true,
			EngineConfig:      nil,
			HostRequirements:  cloneHostRequirements(item.GetHostRequirements()),
			TotalSizeBytes:    item.GetTotalSizeBytes(),
			SourceProvenance:  item.GetMetadata().GetFields()["provenance"].GetStringValue(),
		})
	}
	return items
}
