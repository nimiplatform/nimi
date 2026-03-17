package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func requiredLiveEnv(t *testing.T, key string) string {
	t.Helper()
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		t.Skipf("skip live smoke: missing %s", key)
	}
	return value
}

func liveEnvOrDefault(_ *testing.T, key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value != "" {
		return value
	}
	return strings.TrimSpace(fallback)
}

func runLiveSmokeLocalGenerateText(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_BASE_URL")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_MODEL_ID")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY"))

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"llama": {BaseURL: baseURL, APIKey: apiKey},
			"media": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	runLiveSmokeScenarioGenerateText(t, svc, modelID, runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL)
}

func runLiveSmokeCloudGenerateText(t *testing.T, providerID string, envPrefix string, fallbackBaseURL string) {
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_"+envPrefix+"_BASE_URL", fallbackBaseURL)
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_"+envPrefix+"_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_"+envPrefix+"_MODEL_ID")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			providerID: {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	runLiveSmokeScenarioGenerateText(t, svc, modelID, runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD)
}

func runLiveSmokeScenarioGenerateText(t *testing.T, svc *Service, modelID string, route runtimev1.RoutePolicy) {
	t.Helper()
	text, err := executeLiveSmokeScenarioGenerateText(svc, modelID, route)
	if err != nil {
		t.Fatalf("live generate failed: %v", err)
	}
	if text == "" {
		t.Fatalf("live generate returned empty output")
	}
}

func executeLiveSmokeScenarioGenerateText(svc *Service, modelID string, route runtimev1.RoutePolicy) (string, error) {
	resp, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			RoutePolicy:   route,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     45_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Say hello from Nimi live smoke test."}},
				},
			},
		},
	})
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	return text, nil
}

func TestLiveSmokeLocalGenerateText(t *testing.T) { runLiveSmokeLocalGenerateText(t) }

func TestLiveSmokeNimiLLMGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "nimillm", "NIMILLM", "")
}

func TestLiveSmokeOpenAIGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "openai", "OPENAI", "https://api.openai.com/v1")
}

func TestLiveSmokeAnthropicGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "anthropic", "ANTHROPIC", "https://api.anthropic.com")
}

func TestLiveSmokeDashScopeGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "dashscope", "DASHSCOPE", "https://dashscope.aliyuncs.com/compatible-mode/v1")
}

func TestLiveSmokeVolcengineGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "volcengine", "VOLCENGINE", "https://ark.cn-beijing.volces.com/api/v3")
}

func TestLiveSmokeVolcengineOpenSpeechGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "volcengine_openspeech", "VOLCENGINE_OPENSPEECH", "https://openspeech.bytedance.com/api/v1")
}

func TestLiveSmokeGeminiGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "gemini", "GEMINI", "https://generativelanguage.googleapis.com/v1beta/openai")
}

func TestLiveSmokeMiniMaxGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "minimax", "MINIMAX", "https://api.minimax.chat/v1")
}

func TestLiveSmokeKimiGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "kimi", "KIMI", "https://api.moonshot.cn/v1")
}

func TestLiveSmokeGLMGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "glm", "GLM", "https://open.bigmodel.cn/api/paas/v4")
}

func TestLiveSmokeDeepSeekGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "deepseek", "DEEPSEEK", "https://api.deepseek.com/v1")
}

func TestLiveSmokeOpenRouterGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "openrouter", "OPENROUTER", "https://openrouter.ai/api/v1")
}

func TestLiveSmokeAzureGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "azure", "AZURE", "")
}

func TestLiveSmokeMistralGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "mistral", "MISTRAL", "https://api.mistral.ai/v1")
}

func TestLiveSmokeGroqGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "groq", "GROQ", "https://api.groq.com/openai/v1")
}

func TestLiveSmokeXAIGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "xai", "XAI", "https://api.x.ai/v1")
}

func TestLiveSmokeQianfanGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "qianfan", "QIANFAN", "https://qianfan.baidubce.com/v2")
}

func TestLiveSmokeHunyuanGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "hunyuan", "HUNYUAN", "https://api.hunyuan.cloud.tencent.com/v1")
}

func TestLiveSmokeSparkGenerateText(t *testing.T) {
	runLiveSmokeCloudGenerateText(t, "spark", "SPARK", "https://spark-api-open.xf-yun.com/v1")
}
