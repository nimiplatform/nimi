package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"testing"
)

func TestSelectedMusicResourceProjectsExactLegalInputCombinations(t *testing.T) {
	svc := &Service{capabilityDrivers: capabilitydriver.NewProductionRegistry()}
	option := localexecution.LoadoutOption{CapabilityContract: "music.generate", Implementation: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.YuE2ImplementationID, DriverID: capabilitydriver.YuE2DriverID, DriverDialect: capabilitydriver.YuE2DriverDialect}).Proto()}
	input := svc.projectLocalResourceProjection(option).GetMusicInput()
	if input == nil || len(input.Generation) != 2 {
		t.Fatalf("YuE2 input support lost: %v", input)
	}
	text, score := input.Generation[0], input.Generation[1]
	if text.ScoreMode != "unsupported" || !text.SupportsGeneratedScore || score.ScoreMode != "required" || score.SupportsGeneratedScore || len(score.ScoreFormats) != 1 || score.ScoreFormats[0] != "abc" || text.SupportsAudioReference || text.SupportsInstrumental {
		t.Fatalf("invalid combination promises: %v", input)
	}
	option.Implementation = (&capabilitydriver.Identity{ImplementationID: capabilitydriver.MiniMaxMusic3ImplementationID, DriverID: capabilitydriver.MiniMaxMusic3DriverID, DriverDialect: capabilitydriver.MiniMaxMusic3DriverDialect}).Proto()
	music3 := svc.projectLocalResourceProjection(option).GetMusicInput()
	if music3 == nil || len(music3.Generation) != 1 || music3.Generation[0].MaxDurationSeconds != 180 || music3.Generation[0].ScoreMode != "unsupported" {
		t.Fatal("Music3 inherited another model's inputs")
	}
	option.Implementation.DriverDialect = "unknown"
	if svc.projectLocalResourceProjection(option).GetMusicInput() != nil {
		t.Fatal("unknown dialect invented capabilities")
	}
	option.CapabilityContract = "audio.synthesize"
	option.Implementation = &runtimev1.CapabilityImplementationIdentity{}
	if svc.projectLocalResourceProjection(option).GetMusicInput() != nil {
		t.Fatal("music capabilities leaked into speech")
	}
}
