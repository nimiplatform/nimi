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
	plan := resolveEnvironmentPlanForTest(t, svc, req)
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
	plan = resolveEnvironmentPlanForTest(t, svc, req)
	for _, family := range []string{localEnvironmentFamilyNativeAudioCPP, localEnvironmentFamilyCUDA} {
		dep := findLocalEnvironmentDependency(t, plan, family)
		if dep.State != localEnvironmentStateRepairRequired || dep.SelectedSourceRecordID != "retired-"+family || dep.Detail == "" {
			t.Fatalf("retired source must remain selected but require repair: %+v", dep)
		}
		if _, ready, _ := svc.readySelectedSourceForFamilyAndConsumer(family, audioCppCUDAConsumerID); ready {
			t.Fatal("retired source satisfied execution prerequisites")
		}
	}
	if err := validateNativeSelectedSourceVersion(localEnvironmentSelectedSourceRecordState{DependencyFamily: localEnvironmentFamilyNativeAudioCPP, DependencyID: "audio.cpp.package", Version: engine.AudioCppSelectedSourceVersion}, audioCppCUDAConsumerID); err != nil {
		t.Fatal(err)
	}
	if err := validateNativeSelectedSourceVersion(localEnvironmentSelectedSourceRecordState{DependencyFamily: localEnvironmentFamilyCUDA, DependencyID: engine.NVIDIACUDA13UserSpaceRuntimeDependencyID, Version: engine.NVIDIACUDA13UserSpaceRuntimeVersion}, audioCppCUDAConsumerID); err != nil {
		t.Fatal(err)
	}
}

func TestCUDA12SelectedSourceRejectsRetiredRuntimeBeforeDispatch(t *testing.T) {
	for _, consumer := range []string{"llama.cpp.cuda", stableDiffusionCUDAConsumerID} {
		t.Run(consumer, func(t *testing.T) {
			svc := newLocalEnvironmentTestService(t)
			defer svc.Close()
			record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
				RecordID: "old-cuda12", EnvironmentKey: "accelerator.cuda.runtime|old-cuda12",
				DependencyFamily: localEnvironmentFamilyCUDA, DependencyID: engine.NVIDIACUDAUserSpaceRuntimeDependencyID,
				CanonicalRoot: t.TempDir(), Version: "cuda_major=12", VerifiedArtifacts: []string{"cudart64_12.dll"},
				SelectedConsumers: []string{consumer},
			})
			writeSelectedSourceLocalArtifactsForTest(t, record)
			svc.upsertLocalEnvironmentSelectedSourceRecord(record)
			if _, ready, detail := svc.readySelectedSourceForFamilyAndConsumer(localEnvironmentFamilyCUDA, consumer); ready || detail == "" {
				t.Fatal("retired CUDA 12 source satisfied current execution prerequisites")
			}
			record.Version = engine.NVIDIACUDAUserSpaceRuntimeVersion
			if err := validateNativeSelectedSourceVersion(record, consumer); err != nil {
				t.Fatal(err)
			}
		})
	}
}
