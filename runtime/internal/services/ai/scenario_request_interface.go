package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type scenarioRequestLike interface {
	GetScenarioType() runtimev1.ScenarioType
	GetSpec() *runtimev1.ScenarioSpec
}
