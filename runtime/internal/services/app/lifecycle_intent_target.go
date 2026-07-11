package app

import (
	"encoding/hex"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"golang.org/x/text/unicode/norm"
)

type resolvedLifecycleIntentTarget struct {
	releaseRef         string
	artifactDigest     protectedlocal.Identifier
	artifactDigestText string
	adoptionGeneration uint64
	destructiveOptions *runtimev1.AppLifecycleDestructiveOptions
}

func (s *Service) resolveLifecycleIntentTarget(req *runtimev1.PrepareAppLifecycleIntentRequest, action protectedlocal.LifecycleAction, appID string) (resolvedLifecycleIntentTarget, error) {
	target, err := s.currentLifecycleIntentTarget(action, appID, req.GetDestructiveOptions())
	if err != nil {
		return resolvedLifecycleIntentTarget{}, err
	}
	switch action {
	case protectedlocal.LifecycleActionAdoptLocalApp:
		return resolvedLifecycleIntentTarget{}, lifecycleTargetMismatch("inspect_local_app_candidate")
	case protectedlocal.LifecycleActionRemoveLocalAppAdoption:
		if req.GetExpectedReleaseRef() != "" || req.GetExpectedArtifactDigest() != "" || req.GetExpectedAdoptionGeneration() != target.adoptionGeneration {
			return resolvedLifecycleIntentTarget{}, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
	default:
		if req.GetExpectedAdoptionGeneration() != 0 || req.GetExpectedReleaseRef() != target.releaseRef || req.GetExpectedArtifactDigest() != target.artifactDigestText {
			return resolvedLifecycleIntentTarget{}, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
	}
	return target, nil
}

func (s *Service) currentLifecycleIntentTarget(action protectedlocal.LifecycleAction, appID string, requestedOptions *runtimev1.AppLifecycleDestructiveOptions) (resolvedLifecycleIntentTarget, error) {
	options := cloneLifecycleDestructiveOptions(requestedOptions)
	switch action {
	case protectedlocal.LifecycleActionAdoptLocalApp:
		// A path is intentionally not accepted by PrepareAppLifecycleIntent. Until
		// the Runtime-owned candidate-inspection surface can resolve an app_id to
		// exact local artifact bytes, caller-supplied digest material is not
		// authority and local adoption remains fail-closed.
		return resolvedLifecycleIntentTarget{}, lifecycleTargetMismatch("inspect_local_app_candidate")
	case protectedlocal.LifecycleActionRemoveLocalAppAdoption:
		if s.localAdoptions == nil {
			return resolvedLifecycleIntentTarget{}, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
		adoption, found, err := s.localAdoptions.findAdopted(appID)
		if err != nil || !found || adoption.Generation == 0 {
			return resolvedLifecycleIntentTarget{}, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
		return resolvedLifecycleIntentTarget{adoptionGeneration: adoption.Generation, destructiveOptions: options}, nil
	default:
		if s.installRuntime == nil {
			return resolvedLifecycleIntentTarget{}, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
		_, descriptor, err := s.installRuntime.resolveDescriptor(appID)
		if err != nil {
			return resolvedLifecycleIntentTarget{}, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
		releaseRef := norm.NFC.String(strings.TrimSpace(descriptor.DescriptorID))
		artifactText := strings.ToLower(strings.TrimSpace(descriptor.Artifact.SHA256))
		artifact, err := parseLifecycleIdentifier(artifactText)
		if err != nil || strings.TrimSpace(descriptor.Artifact.DigestAlgorithm) != "sha256" {
			return resolvedLifecycleIntentTarget{}, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
		if action == protectedlocal.LifecycleActionHealthRepair {
			options, err = s.resolveHealthRepairIntentOptions(appID, options)
			if err != nil {
				return resolvedLifecycleIntentTarget{}, err
			}
		}
		return resolvedLifecycleIntentTarget{
			releaseRef:         releaseRef,
			artifactDigest:     artifact,
			artifactDigestText: artifactText,
			destructiveOptions: options,
		}, nil
	}
}

func (s *Service) resolveHealthRepairIntentOptions(appID string, options *runtimev1.AppLifecycleDestructiveOptions) (*runtimev1.AppLifecycleDestructiveOptions, error) {
	if options == nil {
		return nil, lifecycleTargetMismatch("resolve_lifecycle_target")
	}
	switch options.GetHealthRepairAction() {
	case runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_CANCEL,
		runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_RETRY:
		var job *runtimev1.AppInstallJob
		if target := options.GetTargetJobId(); target != "" {
			candidate, ok := s.installJobs.getJob(target)
			if !ok || candidate.GetAppId() != appID {
				return nil, lifecycleTargetMismatch("resolve_lifecycle_target")
			}
			job = candidate
		} else {
			job = s.installJobs.recentRecoverableJobForApp(appID)
		}
		if job == nil {
			return nil, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
		if options.GetHealthRepairAction() == runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_CANCEL {
			if !s.installJobs.jobInFlight(job.GetJobId()) {
				return nil, lifecycleTargetMismatch("resolve_lifecycle_target")
			}
		} else if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_FAILED && job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_CANCELLED {
			return nil, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
		options.TargetJobId = job.GetJobId()
		return options, nil
	case runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_REPAIR,
		runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_REINSTALL:
		if options.GetTargetJobId() != "" {
			return nil, lifecycleTargetMismatch("resolve_lifecycle_target")
		}
		return options, nil
	default:
		return nil, lifecycleTargetMismatch("resolve_lifecycle_target")
	}
}

func protectedLifecycleAction(action runtimev1.AppLifecycleIntentAction) (protectedlocal.LifecycleAction, bool) {
	switch action {
	case runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_INSTALL:
		return protectedlocal.LifecycleActionInstall, true
	case runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_UNINSTALL:
		return protectedlocal.LifecycleActionUninstall, true
	case runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_UPDATE:
		return protectedlocal.LifecycleActionUpdate, true
	case runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_HEALTH_REPAIR:
		return protectedlocal.LifecycleActionHealthRepair, true
	case runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_ADOPT_LOCAL_APP:
		return protectedlocal.LifecycleActionAdoptLocalApp, true
	case runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_REMOVE_LOCAL_APP_ADOPTION:
		return protectedlocal.LifecycleActionRemoveLocalAppAdoption, true
	case runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_OPEN_APP:
		return protectedlocal.LifecycleActionOpenApp, true
	default:
		return "", false
	}
}

func lifecycleActionName(action runtimev1.AppLifecycleIntentAction) (string, bool) {
	protected, ok := protectedLifecycleAction(action)
	return string(protected), ok
}

func lifecycleDestructiveOptions(options *runtimev1.AppLifecycleDestructiveOptions) protectedlocal.LifecycleDestructiveOptions {
	if options == nil {
		return protectedlocal.LifecycleDestructiveOptions{}
	}
	return protectedlocal.LifecycleDestructiveOptions{
		DeleteDurableData:  options.GetDeleteDurableData(),
		HealthRepairAction: protectedlocal.LifecycleHealthRepairAction(options.GetHealthRepairAction()),
		TargetJobID:        strings.TrimSpace(options.GetTargetJobId()),
	}
}

func cloneLifecycleDestructiveOptions(options *runtimev1.AppLifecycleDestructiveOptions) *runtimev1.AppLifecycleDestructiveOptions {
	if options == nil {
		return &runtimev1.AppLifecycleDestructiveOptions{}
	}
	return &runtimev1.AppLifecycleDestructiveOptions{
		DeleteDurableData:  options.GetDeleteDurableData(),
		HealthRepairAction: options.GetHealthRepairAction(),
		TargetJobId:        strings.TrimSpace(options.GetTargetJobId()),
	}
}

func parseLifecycleIdentifier(value string) (protectedlocal.Identifier, error) {
	var identifier protectedlocal.Identifier
	if value == "" || value != strings.ToLower(value) || len(value) != protectedlocal.IdentifierBytes*2 {
		return identifier, fmt.Errorf("canonical lowercase identifier required")
	}
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != protectedlocal.IdentifierBytes {
		return identifier, fmt.Errorf("decode identifier")
	}
	copy(identifier[:], decoded)
	if identifier == (protectedlocal.Identifier{}) {
		return protectedlocal.Identifier{}, fmt.Errorf("nonzero identifier required")
	}
	return identifier, nil
}
