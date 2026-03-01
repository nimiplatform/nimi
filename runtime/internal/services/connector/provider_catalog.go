package connector

// ProviderCatalogEntry defines default endpoint and requirements for a provider.
type ProviderCatalogEntry struct {
	DefaultEndpoint          string
	RequiresExplicitEndpoint bool
}

// ProviderCapability defines runtime plane and execution module for a provider.
type ProviderCapability struct {
	RuntimePlane     string // "local" or "remote"
	ExecutionModule  string // "local-model" or "nimillm"
	ManagedSupported bool
	InlineSupported  bool
}

// ProviderCatalog maps canonical provider IDs to their catalog entries.
var ProviderCatalog = map[string]ProviderCatalogEntry{
	"gemini":            {DefaultEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai", RequiresExplicitEndpoint: false},
	"openai":            {DefaultEndpoint: "https://api.openai.com/v1", RequiresExplicitEndpoint: false},
	"anthropic":         {DefaultEndpoint: "https://api.anthropic.com", RequiresExplicitEndpoint: false},
	"dashscope":         {DefaultEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", RequiresExplicitEndpoint: false},
	"volcengine":        {DefaultEndpoint: "https://ark.cn-beijing.volces.com/api/v3", RequiresExplicitEndpoint: false},
	"nimillm":           {DefaultEndpoint: "", RequiresExplicitEndpoint: true},
	"minimax":           {DefaultEndpoint: "https://api.minimax.chat/v1", RequiresExplicitEndpoint: false},
	"kimi":              {DefaultEndpoint: "https://api.moonshot.cn/v1", RequiresExplicitEndpoint: false},
	"glm":               {DefaultEndpoint: "https://open.bigmodel.cn/api/paas/v4", RequiresExplicitEndpoint: false},
	"deepseek":           {DefaultEndpoint: "https://api.deepseek.com/v1", RequiresExplicitEndpoint: false},
	"openrouter":        {DefaultEndpoint: "https://openrouter.ai/api/v1", RequiresExplicitEndpoint: false},
	"openai_compatible": {RequiresExplicitEndpoint: true},
}

// ProviderCapabilities maps canonical provider IDs to their runtime capabilities.
var ProviderCapabilities = map[string]ProviderCapability{
	"local":             {RuntimePlane: "local", ExecutionModule: "local-model", ManagedSupported: true, InlineSupported: false},
	"gemini":            {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"openai":            {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"anthropic":         {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"dashscope":         {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"volcengine":        {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"nimillm":           {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"minimax":           {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"kimi":              {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"glm":               {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"deepseek":           {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"openrouter":        {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
	"openai_compatible": {RuntimePlane: "remote", ExecutionModule: "nimillm", ManagedSupported: true, InlineSupported: true},
}

// ResolveEndpoint returns the effective endpoint for a provider and optional user endpoint.
func ResolveEndpoint(provider string, userEndpoint string) string {
	if userEndpoint != "" {
		return userEndpoint
	}
	if entry, ok := ProviderCatalog[provider]; ok {
		return entry.DefaultEndpoint
	}
	return ""
}

// IsKnownProvider returns true if provider is in the catalog.
func IsKnownProvider(provider string) bool {
	_, ok := ProviderCatalog[provider]
	if ok {
		return true
	}
	_, ok = ProviderCapabilities[provider]
	return ok
}
