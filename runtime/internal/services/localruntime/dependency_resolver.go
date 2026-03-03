package localruntime

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

type dependencyCandidateCheck struct {
	ok         bool
	check      string
	reasonCode string
	detail     string
	warnings   []string
}

func resolveDependencyPlan(req *runtimev1.ResolveDependenciesRequest) *runtimev1.LocalDependencyResolutionPlan {
	if req == nil {
		return &runtimev1.LocalDependencyResolutionPlan{
			PlanId:     "dep_plan_" + ulid.Make().String(),
			ReasonCode: "LOCAL_DEPENDENCY_REQUEST_REQUIRED",
			Warnings:   []string{"resolve request is required"},
		}
	}

	capability := strings.TrimSpace(req.GetCapability())
	profile := cloneDeviceProfile(req.GetDeviceProfile())
	if profile == nil {
		profile = collectDeviceProfile()
	}

	declaration := req.GetDependencies()
	if declaration == nil {
		declaration = &runtimev1.LocalDependenciesDeclarationDescriptor{}
	}

	preferredByCapability := make(map[string]string)
	for capName, depID := range declaration.GetPreferred() {
		capabilityKey := strings.TrimSpace(capName)
		dependencyID := strings.TrimSpace(depID)
		if capabilityKey == "" || dependencyID == "" {
			continue
		}
		preferredByCapability[capabilityKey] = dependencyID
	}

	plan := &runtimev1.LocalDependencyResolutionPlan{
		PlanId:             "dep_plan_" + ulid.Make().String(),
		ModId:              strings.TrimSpace(req.GetModId()),
		Capability:         capability,
		DeviceProfile:      profile,
		Dependencies:       make([]*runtimev1.LocalDependencyDescriptor, 0, 16),
		SelectionRationale: make([]*runtimev1.LocalDependencySelectionRationale, 0, 16),
		PreflightDecisions: make([]*runtimev1.LocalPreflightDecision, 0, 16),
		Warnings:           []string{},
	}

	appendDecision := func(opt *runtimev1.LocalDependencyOptionDescriptor, required bool, selected bool, preferred bool, check dependencyCandidateCheck) {
		if opt == nil {
			return
		}
		descriptor := &runtimev1.LocalDependencyDescriptor{
			DependencyId: strings.TrimSpace(opt.GetDependencyId()),
			Kind:         opt.GetKind(),
			Capability:   strings.TrimSpace(opt.GetCapability()),
			Required:     required,
			Selected:     selected,
			Preferred:    preferred,
			ModelId:      strings.TrimSpace(opt.GetModelId()),
			Repo:         strings.TrimSpace(opt.GetRepo()),
			Engine:       strings.TrimSpace(opt.GetEngine()),
			ServiceId:    strings.TrimSpace(opt.GetServiceId()),
			NodeId:       strings.TrimSpace(opt.GetNodeId()),
			ReasonCode:   check.reasonCode,
			Warnings:     append([]string(nil), check.warnings...),
		}

		plan.Dependencies = append(plan.Dependencies, descriptor)
		plan.SelectionRationale = append(plan.SelectionRationale, &runtimev1.LocalDependencySelectionRationale{
			DependencyId: descriptor.GetDependencyId(),
			Selected:     selected,
			ReasonCode:   check.reasonCode,
			Detail:       check.detail,
		})
		plan.PreflightDecisions = append(plan.PreflightDecisions, &runtimev1.LocalPreflightDecision{
			DependencyId: descriptor.GetDependencyId(),
			Target:       preflightTargetForDependency(descriptor),
			Check:        defaultString(check.check, "dependency-shape"),
			Ok:           check.ok,
			ReasonCode:   check.reasonCode,
			Detail:       check.detail,
		})
		if len(check.warnings) > 0 {
			plan.Warnings = append(plan.Warnings, check.warnings...)
		}
	}

	requiredFailures := 0
	for _, item := range declaration.GetRequired() {
		check := evaluateDependencyCandidate(item, profile)
		selected := check.ok
		if selected {
			check.reasonCode = "LOCAL_DEPENDENCY_REQUIRED_SELECTED"
			check.detail = "required dependency selected"
		} else {
			requiredFailures++
		}
		appendDecision(item, true, selected, selected, check)
	}

	for _, item := range declaration.GetOptional() {
		check := evaluateDependencyCandidate(item, profile)
		selected := false
		if check.ok {
			preferredID := preferredByCapability[strings.TrimSpace(item.GetCapability())]
			if preferredID != "" && preferredID == strings.TrimSpace(item.GetDependencyId()) {
				selected = true
				check.reasonCode = "LOCAL_DEPENDENCY_OPTIONAL_PREFERRED_SELECTED"
				check.detail = "optional dependency selected by preferred map"
			} else {
				check.reasonCode = "LOCAL_DEPENDENCY_OPTIONAL_SKIPPED"
				check.detail = "optional dependency not selected by default"
			}
		}
		appendDecision(item, false, selected, selected, check)
	}

	alternativeFailures := 0
	for _, alt := range declaration.GetAlternatives() {
		if alt == nil {
			continue
		}
		options := alt.GetOptions()
		checks := make([]dependencyCandidateCheck, len(options))
		selectedID := ""
		preferredAlternativeID := strings.TrimSpace(alt.GetPreferredDependencyId())
		if preferredAlternativeID == "" && capability != "" {
			preferredAlternativeID = preferredByCapability[capability]
		}

		for idx, item := range options {
			checks[idx] = evaluateDependencyCandidate(item, profile)
			if !checks[idx].ok {
				continue
			}
			dependencyID := strings.TrimSpace(item.GetDependencyId())
			if selectedID == "" {
				selectedID = dependencyID
			}
			if preferredAlternativeID != "" && dependencyID == preferredAlternativeID {
				selectedID = dependencyID
				break
			}
		}

		if selectedID == "" {
			alternativeFailures++
			plan.Warnings = append(plan.Warnings, "alternative "+strings.TrimSpace(alt.GetAlternativeId())+" has no viable option")
		}

		for idx, item := range options {
			dependencyID := strings.TrimSpace(item.GetDependencyId())
			selected := selectedID != "" && dependencyID == selectedID
			preferred := preferredAlternativeID != "" && dependencyID == preferredAlternativeID
			check := checks[idx]
			if selected {
				check.reasonCode = "LOCAL_DEPENDENCY_ALTERNATIVE_SELECTED"
				check.detail = "alternative option selected"
			} else if check.ok {
				check.reasonCode = "LOCAL_DEPENDENCY_ALTERNATIVE_NOT_SELECTED"
				check.detail = "alternative option not selected"
			}
			appendDecision(item, false, selected, preferred, check)
		}
	}

	if len(plan.Dependencies) == 0 && capability != "" {
		item := &runtimev1.LocalDependencyOptionDescriptor{
			DependencyId: "dep_" + slug(capability),
			Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_MODEL,
			Capability:   capability,
			ModelId:      "local/" + capability + "-default",
			Engine:       "localai",
		}
		check := evaluateDependencyCandidate(item, profile)
		check.reasonCode = "LOCAL_DEPENDENCY_DEFAULT_SELECTED"
		check.detail = "selected default dependency by capability"
		appendDecision(item, true, true, true, check)
	}

	switch {
	case requiredFailures > 0:
		plan.ReasonCode = "LOCAL_DEPENDENCY_REQUIRED_UNSATISFIED"
	case alternativeFailures > 0:
		plan.ReasonCode = "LOCAL_DEPENDENCY_ALTERNATIVE_UNSATISFIED"
	default:
		plan.ReasonCode = "ACTION_EXECUTED"
	}
	plan.Warnings = normalizeStringSlice(plan.Warnings)
	return plan
}

func evaluateDependencyCandidate(opt *runtimev1.LocalDependencyOptionDescriptor, profile *runtimev1.LocalDeviceProfile) dependencyCandidateCheck {
	if opt == nil {
		return dependencyCandidateCheck{
			ok:         false,
			check:      "dependency-shape",
			reasonCode: "LOCAL_DEPENDENCY_OPTION_MISSING",
			detail:     "dependency option missing",
			warnings:   []string{"dependency option missing"},
		}
	}
	dependencyID := strings.TrimSpace(opt.GetDependencyId())
	if dependencyID == "" {
		return dependencyCandidateCheck{
			ok:         false,
			check:      "dependency-shape",
			reasonCode: "LOCAL_DEPENDENCY_ID_REQUIRED",
			detail:     "dependencyId is required",
			warnings:   []string{"dependencyId is required"},
		}
	}
	if opt.GetKind() == runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_UNSPECIFIED {
		return dependencyCandidateCheck{
			ok:         false,
			check:      "dependency-shape",
			reasonCode: "LOCAL_DEPENDENCY_KIND_REQUIRED",
			detail:     dependencyID + " kind is required",
			warnings:   []string{"dependency kind is required"},
		}
	}

	switch opt.GetKind() {
	case runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_MODEL:
		if strings.TrimSpace(opt.GetModelId()) == "" {
			return dependencyCandidateCheck{
				ok:         false,
				check:      "dependency-shape",
				reasonCode: "LOCAL_DEPENDENCY_MODEL_ID_REQUIRED",
				detail:     dependencyID + " requires modelId",
				warnings:   []string{"model dependency requires modelId"},
			}
		}
	case runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_SERVICE:
		if strings.TrimSpace(opt.GetServiceId()) == "" {
			return dependencyCandidateCheck{
				ok:         false,
				check:      "dependency-shape",
				reasonCode: "LOCAL_DEPENDENCY_SERVICE_ID_REQUIRED",
				detail:     dependencyID + " requires serviceId",
				warnings:   []string{"service dependency requires serviceId"},
			}
		}
		if strings.TrimSpace(opt.GetModelId()) == "" {
			return dependencyCandidateCheck{
				ok:         false,
				check:      "dependency-shape",
				reasonCode: "LOCAL_DEPENDENCY_MODEL_ID_REQUIRED",
				detail:     dependencyID + " requires modelId",
				warnings:   []string{"service dependency requires modelId"},
			}
		}
	case runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_NODE:
		if strings.TrimSpace(opt.GetNodeId()) == "" {
			return dependencyCandidateCheck{
				ok:         false,
				check:      "dependency-shape",
				reasonCode: "LOCAL_DEPENDENCY_NODE_ID_REQUIRED",
				detail:     dependencyID + " requires nodeId",
				warnings:   []string{"node dependency requires nodeId"},
			}
		}
	default:
		return dependencyCandidateCheck{
			ok:         false,
			check:      "dependency-shape",
			reasonCode: "LOCAL_DEPENDENCY_KIND_UNSUPPORTED",
			detail:     dependencyID + " kind is unsupported",
			warnings:   []string{"dependency kind is unsupported"},
		}
	}

	engine := strings.ToLower(strings.TrimSpace(opt.GetEngine()))
	if profile != nil {
		if requiresGPU(engine) && !profile.GetGpu().GetAvailable() {
			return dependencyCandidateCheck{
				ok:         false,
				check:      "device-profile",
				reasonCode: "LOCAL_DEPENDENCY_GPU_REQUIRED",
				detail:     dependencyID + " requires GPU support",
				warnings:   []string{"required GPU is unavailable"},
			}
		}
		if requiresPython(engine) && !profile.GetPython().GetAvailable() {
			return dependencyCandidateCheck{
				ok:         false,
				check:      "device-profile",
				reasonCode: "LOCAL_DEPENDENCY_PYTHON_REQUIRED",
				detail:     dependencyID + " requires Python runtime",
				warnings:   []string{"required Python runtime is unavailable"},
			}
		}
		if requiresNPU(engine) && !profile.GetNpu().GetReady() {
			return dependencyCandidateCheck{
				ok:         false,
				check:      "device-profile",
				reasonCode: "LOCAL_DEPENDENCY_NPU_REQUIRED",
				detail:     dependencyID + " requires NPU ready state",
				warnings:   []string{"required NPU runtime is unavailable"},
			}
		}
	}

	return dependencyCandidateCheck{
		ok:         true,
		check:      "device-profile",
		reasonCode: "LOCAL_DEPENDENCY_ELIGIBLE",
		detail:     dependencyID + " passes dependency checks",
		warnings:   []string{},
	}
}

func requiresGPU(engine string) bool {
	return strings.Contains(engine, "cuda") || strings.Contains(engine, "nvidia") || strings.Contains(engine, "gpu")
}

func requiresPython(engine string) bool {
	return strings.Contains(engine, "python") || strings.Contains(engine, "py")
}

func requiresNPU(engine string) bool {
	return strings.Contains(engine, "npu")
}

func preflightTargetForDependency(dep *runtimev1.LocalDependencyDescriptor) string {
	if dep == nil {
		return ""
	}
	switch dep.GetKind() {
	case runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_MODEL:
		return defaultString(dep.GetModelId(), dep.GetDependencyId())
	case runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_SERVICE:
		return defaultString(dep.GetServiceId(), dep.GetDependencyId())
	case runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_NODE:
		return defaultString(dep.GetNodeId(), dep.GetDependencyId())
	default:
		return dep.GetDependencyId()
	}
}
