package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

// Exercises real Memory lifecycle owners and Work continuations with an isolated
// model executor. No App business effect is manufactured by this regression.
func TestLocalAppWorkStopsAfterRecalledMemoryLifecycleChange(t *testing.T) {
	for _, action := range []string{"disable", "delete-all", "forget", "correct"} {
		t.Run(action, func(t *testing.T) {
			f := newAppWorkFixture(t)
			ref := testRuntimeAgentLocalRef("agent-alpha")
			seedCognitionMemoryForTerminationTest(t, f.svc, ref, "请记住：这轮开发验收项目的代号是银桥青叶。")
			f.svc.cognitionMemoryWG.Wait()
			var steps atomic.Int32
			f.svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
				n := steps.Add(1)
				if !strings.Contains(fmt.Sprint(req.Messages), "银桥青叶") {
					t.Errorf("step %d lacks expected fixture Memory", n)
				}
				if n == 1 {
					if err := emitWorkTool(emit, 0, "call", "save_document"); err != nil {
						return err
					}
					return emitWorkCompleted(emit, runtimev1.FinishReason_FINISH_REASON_TOOL_CALL)
				}
				return emitWorkText(emit, "Diagnostic continuation observed.", runtimev1.FinishReason_FINISH_REASON_STOP)
			}})
			req := f.request()
			req.Prompt = "请从获准的长期记忆中找出本次开发验收项目代号并保存简报，不读取聊天历史，不猜测。"
			start, err := f.svc.StartLocalAppAgentWork(f.ctx(localappop.OperationAgentWorkStart), req)
			if err != nil {
				t.Fatal(err)
			}
			call := f.tool(t, start.ExecutionId)
			var mutationErr error
			switch action {
			case "disable":
				d, ctx := localAppConfigureContext(accountservice.LocalAppOperationMemorySwitch, 0x71, "user-1")
				_, mutationErr = f.svc.SetLocalAppAgentMemoryEnabled(ctx, &runtimev1.SetLocalAppAgentMemoryEnabledRequest{AgentHandle: mintLocalAppAgentHandle(d, ref), Enabled: false})
			case "delete-all":
				d, ctx := localAppConfigureContext(accountservice.LocalAppOperationMemoryDelete, 0x72, "user-1")
				_, mutationErr = f.svc.DeleteAllLocalAppAgentMemory(ctx, &runtimev1.DeleteAllLocalAppAgentMemoryRequest{AgentHandle: mintLocalAppAgentHandle(d, ref), Confirmed: true})
			case "forget", "correct":
				d, ctx := localAppConfigureContext(accountservice.LocalAppOperationMemoryInspect, 0x73, "user-1")
				inspected, inspectErr := f.svc.InspectLocalAppAgentMemory(ctx, &runtimev1.InspectLocalAppAgentMemoryRequest{AgentHandle: mintLocalAppAgentHandle(d, ref), Limit: 10})
				if inspectErr != nil || len(inspected.GetProjection().GetItems()) != 1 {
					t.Fatalf("inspect: %v %v", inspected, inspectErr)
				}
				if action == "correct" {
					d, ctx = localAppConfigureContext(accountservice.LocalAppOperationMemoryCorrect, 0x75, "user-1")
					_, mutationErr = f.svc.CorrectLocalAppAgentMemory(ctx, &runtimev1.CorrectLocalAppAgentMemoryRequest{AgentHandle: mintLocalAppAgentHandle(d, ref), MemoryId: inspected.Projection.Items[0].MemoryId, CorrectedContent: "项目代号已改为白鸥。"})
				} else {
					d, ctx = localAppConfigureContext(accountservice.LocalAppOperationMemoryForget, 0x74, "user-1")
					_, mutationErr = f.svc.ForgetLocalAppAgentMemory(ctx, &runtimev1.ForgetLocalAppAgentMemoryRequest{AgentHandle: mintLocalAppAgentHandle(d, ref), MemoryIds: []string{inspected.Projection.Items[0].MemoryId}, Confirmed: true})
				}
			}
			if mutationErr != nil {
				t.Fatalf("Memory lifecycle operation failed: %v", mutationErr)
			}
			_, err = f.svc.SubmitLocalAppAgentWorkToolResult(f.ctx(localappop.OperationAgentWorkToolResultSubmit), &runtimev1.SubmitLocalAppAgentWorkToolResultRequest{AgentHandle: f.handle, ExecutionId: start.ExecutionId, CallId: call.CallId, ResultJson: `{"diagnostic":true}`, IsError: true})
			if err == nil {
				t.Fatal("late tool result was accepted after Memory changed")
			}
			terminal := f.wait(t, start.ExecutionId, func(x *runtimev1.LocalAppAgentWorkExecution) bool { return localAppWorkTerminal(x.State) })
			if terminal.State != runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_CANCELLED || steps.Load() != 1 || !strings.Contains(terminal.Message, "Memory") {
				t.Fatalf("unexpected terminal: %v steps=%d", terminal, steps.Load())
			}
		})
	}
}

func TestLocalAppWorkWithoutMemoryInputSurvivesMemoryDisable(t *testing.T) {
	f := newAppWorkFixture(t)
	var steps atomic.Int32
	f.svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		if steps.Add(1) == 1 {
			if err := emitWorkTool(emit, 0, "call", "save_document"); err != nil {
				return err
			}
			return emitWorkCompleted(emit, runtimev1.FinishReason_FINISH_REASON_TOOL_CALL)
		}
		return emitWorkText(emit, "Completed without any recalled Memory.", runtimev1.FinishReason_FINISH_REASON_STOP)
	}})
	id := f.start(t)
	call := f.tool(t, id)
	d, ctx := localAppConfigureContext(accountservice.LocalAppOperationMemorySwitch, 0x76, "user-1")
	_, err := f.svc.SetLocalAppAgentMemoryEnabled(ctx, &runtimev1.SetLocalAppAgentMemoryEnabledRequest{AgentHandle: mintLocalAppAgentHandle(d, testRuntimeAgentLocalRef("agent-alpha")), Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.SubmitLocalAppAgentWorkToolResult(f.ctx(localappop.OperationAgentWorkToolResultSubmit), &runtimev1.SubmitLocalAppAgentWorkToolResultRequest{AgentHandle: f.handle, ExecutionId: id, CallId: call.CallId, ResultJson: `{"result":"test tool returned"}`})
	if err != nil {
		t.Fatal(err)
	}
	terminal := f.wait(t, id, func(x *runtimev1.LocalAppAgentWorkExecution) bool { return localAppWorkTerminal(x.State) })
	if terminal.State != runtimev1.LocalAppAgentWorkState_LOCAL_APP_AGENT_WORK_STATE_SUCCEEDED || steps.Load() != 2 {
		t.Fatalf("unrelated Work interrupted: %v", terminal)
	}
}
