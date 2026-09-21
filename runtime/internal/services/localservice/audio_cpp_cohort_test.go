package localservice

import (
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestAudioCppEnvironmentPlanDoesNotAdvertiseRetiredCohortAsReady(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
	req := localEnvironmentPlanRequest{PackID: "local-music-native", ConsumerScope: audioCppCUDAConsumerID, HostProfile: localEnvironmentNvidiaProfile(), RuntimeDataRoot: t.TempDir()}
	plan := svc.resolveLocalEnvironmentPlan(req)
	for _, family := range []string{localEnvironmentFamilyNativeAudioCPP, localEnvironmentFamilyCUDA} {
		dep := findLocalEnvironmentDependency(t, plan, family)
		record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
			RecordID: "retired-" + family, EnvironmentKey: dep.EnvironmentKey, DependencyFamily: family,
			DependencyID: dep.DependencyID, CanonicalRoot: filepath.Join(t.TempDir(), "old-package"),
			Version: "release-0.6.1", VerifiedArtifacts: []string{"existing-file"}, SelectedConsumers: audioCppSelectedConsumers(),
		})
		writeSelectedSourceLocalArtifactsForTest(t, record)
		svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	}
	plan = svc.resolveLocalEnvironmentPlan(req)
	for _, family := range []string{localEnvironmentFamilyNativeAudioCPP, localEnvironmentFamilyCUDA} {
		dep := findLocalEnvironmentDependency(t, plan, family)
		if dep.State != localEnvironmentStateRepairRequired || dep.SelectedSourceRecordID != "retired-"+family || dep.Detail == "" {
			t.Fatalf("retired source must remain selected but require repair: %+v", dep)
		}
		if _, ready, _ := svc.readySelectedSourceForFamilyAndConsumer(family, audioCppCUDAConsumerID); ready {
			t.Fatal("retired source satisfied execution prerequisites")
		}
	}
	if err := validateAudioCppSelectedSourceVersion(localEnvironmentSelectedSourceRecordState{DependencyFamily: localEnvironmentFamilyNativeAudioCPP, DependencyID: "audio.cpp.package", Version: engine.AudioCppSelectedSourceVersion}); err != nil {
		t.Fatal(err)
	}
	if err := validateAudioCppSelectedSourceVersion(localEnvironmentSelectedSourceRecordState{DependencyFamily: localEnvironmentFamilyCUDA, DependencyID: engine.NVIDIACUDA13UserSpaceRuntimeDependencyID, Version: engine.NVIDIACUDA13UserSpaceRuntimeVersion}); err != nil {
		t.Fatal(err)
	}
}
