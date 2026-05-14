package delegation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/oklog/ulid/v2"
)

const (
	defaultGatewayTimeout = 15 * time.Second
	adapterSource         = "github.com/modelcontextprotocol/go-sdk"
)

type TransportFactory func(context.Context, ProviderProfile) (mcp.Transport, func(), error)

type Gateway struct {
	profiles         map[string]ProviderProfile
	transportFactory TransportFactory
	now              func() time.Time
}

type GatewayError struct {
	ReasonCode string
	Message    string
	Err        error
}

func (e GatewayError) Error() string {
	if e.Err != nil {
		return strings.TrimSpace(e.Message) + ": " + e.Err.Error()
	}
	return strings.TrimSpace(e.Message)
}

func (e GatewayError) Unwrap() error {
	return e.Err
}

type Option func(*Gateway)

func WithTransportFactory(factory TransportFactory) Option {
	return func(g *Gateway) {
		if factory != nil {
			g.transportFactory = factory
		}
	}
}

func WithClock(now func() time.Time) Option {
	return func(g *Gateway) {
		if now != nil {
			g.now = now
		}
	}
}

func NewGateway(profiles []ProviderProfile, opts ...Option) (*Gateway, error) {
	g := &Gateway{
		profiles:         map[string]ProviderProfile{},
		transportFactory: commandTransportFactory,
		now:              func() time.Time { return time.Now().UTC() },
	}
	for _, opt := range opts {
		opt(g)
	}
	for _, profile := range profiles {
		normalized, err := normalizeProfile(profile)
		if err != nil {
			return nil, err
		}
		if _, exists := g.profiles[normalized.ID]; exists {
			return nil, fmt.Errorf("delegation provider %q is duplicated", normalized.ID)
		}
		g.profiles[normalized.ID] = normalized
	}
	return g, nil
}

func (g *Gateway) DiscoverTools(ctx context.Context, providerID string) ([]ToolDescriptor, error) {
	profile, err := g.activeProfile(providerID)
	if err != nil {
		return nil, err
	}
	session, cleanup, err := g.connect(ctx, profile)
	if err != nil {
		return nil, gatewayFailure(reasonForContext(ctx, ReasonGatewayMCPConnectFailed), "mcp client connect failed for provider %q", err, profile.ID)
	}
	defer cleanup()
	defer func() { _ = session.Close() }()

	tools, err := session.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		return nil, gatewayFailure(reasonForContext(ctx, ReasonGatewayMCPDiscoveryFailed), "mcp tool discovery failed for provider %q", err, profile.ID)
	}
	descriptors, err := normalizeAllowedTools(profile, tools.Tools)
	if err != nil {
		return nil, mapGatewayAdmissionError(err)
	}
	return descriptors, nil
}

func (g *Gateway) CallTool(ctx context.Context, req ToolCallRequest) (*QuarantinedEvidence, error) {
	profile, err := g.activeProfile(req.ProviderID)
	if err != nil {
		return nil, err
	}
	toolPolicy, err := allowedTool(profile, req.ToolName)
	if err != nil {
		return nil, err
	}
	callCtx, cancel := context.WithTimeout(ctx, profile.Timeout)
	defer cancel()

	started := g.now()
	session, cleanup, err := g.connect(callCtx, profile)
	if err != nil {
		return nil, gatewayFailure(reasonForContext(callCtx, ReasonGatewayMCPConnectFailed), "mcp client connect failed for provider %q", err, profile.ID)
	}
	defer cleanup()
	defer func() { _ = session.Close() }()

	tools, err := session.ListTools(callCtx, &mcp.ListToolsParams{})
	if err != nil {
		return nil, gatewayFailure(reasonForContext(callCtx, ReasonGatewayMCPDiscoveryFailed), "mcp pre-call discovery failed for provider %q", err, profile.ID)
	}
	toolDigest, err := verifyToolVisibleAndStable(profile, toolPolicy, tools.Tools)
	if err != nil {
		return nil, mapGatewayAdmissionError(err)
	}
	arguments, err := decodeToolArguments(req.Arguments)
	if err != nil {
		return nil, err
	}
	result, err := session.CallTool(callCtx, &mcp.CallToolParams{
		Name:      toolPolicy.Name,
		Arguments: arguments,
	})
	if err != nil {
		return nil, gatewayFailure(reasonForContext(callCtx, ReasonGatewayMCPToolCallFailed), "mcp tool call failed for provider %q tool %q", err, profile.ID, toolPolicy.Name)
	}
	rawResult, err := marshalToolResult(result)
	if err != nil {
		return nil, gatewayFailure(ReasonGatewayMCPResultInvalid, "mcp tool call returned invalid result for provider %q tool %q", err, profile.ID, toolPolicy.Name)
	}
	completed := g.now()
	return &QuarantinedEvidence{
		EvidenceID:            ulid.Make().String(),
		ProviderID:            profile.ID,
		ToolName:              toolPolicy.Name,
		TraceID:               strings.TrimSpace(req.TraceID),
		State:                 EvidenceStateQuarantined,
		FirewallState:         FirewallStateNotEvaluated,
		ModelContextAdmitted:  false,
		ProjectionAdmitted:    false,
		ActionAdmitted:        false,
		ToolError:             result.IsError,
		InputSchemaDigest:     toolDigest,
		RawMCPResult:          rawResult,
		StartedAt:             started,
		CompletedAt:           completed,
		Duration:              completed.Sub(started),
		ProtocolAdapter:       "mcp_stdio_command",
		ProtocolAdapterSource: adapterSource,
	}, nil
}

func (g *Gateway) activeProfile(providerID string) (ProviderProfile, error) {
	id := strings.TrimSpace(providerID)
	if id == "" {
		return ProviderProfile{}, gatewayFailure(ReasonGatewayProviderInvalid, "delegation provider id is required", nil)
	}
	profile, ok := g.profiles[id]
	if !ok {
		return ProviderProfile{}, gatewayFailure(ReasonGatewayProviderUnavailable, "delegation provider %q is not registered", nil, id)
	}
	if profile.State != ProviderStateReady {
		return ProviderProfile{}, gatewayFailure(ReasonGatewayProviderUnavailable, "delegation provider %q is not ready", nil, id)
	}
	return profile, nil
}

func (g *Gateway) connect(ctx context.Context, profile ProviderProfile) (*mcp.ClientSession, func(), error) {
	transport, cleanup, err := g.transportFactory(ctx, profile)
	if err != nil {
		return nil, nil, err
	}
	if cleanup == nil {
		cleanup = func() {}
	}
	client := mcp.NewClient(&mcp.Implementation{
		Name:    "nimi-runtime-delegation-gateway",
		Title:   "Nimi Runtime Delegation Gateway",
		Version: "0.1.0",
	}, nil)
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	return session, cleanup, nil
}

func commandTransportFactory(ctx context.Context, profile ProviderProfile) (mcp.Transport, func(), error) {
	if profile.TransportKind != TransportKindStdioCommand {
		return nil, nil, gatewayFailure(ReasonGatewayTransportInvalid, "unsupported MCP transport kind %q", nil, profile.TransportKind)
	}
	if strings.TrimSpace(profile.Command) == "" {
		return nil, nil, gatewayFailure(ReasonGatewayTransportInvalid, "provider %q missing MCP command", nil, profile.ID)
	}
	cmd := exec.CommandContext(ctx, profile.Command, profile.Args...)
	cmd.Env = sanitizedCommandEnv(os.Environ())
	return &mcp.CommandTransport{
		Command:           cmd,
		TerminateDuration: profile.TerminateDuration,
	}, func() {}, nil
}

func normalizeProfile(profile ProviderProfile) (ProviderProfile, error) {
	profile.ID = strings.TrimSpace(profile.ID)
	profile.Name = strings.TrimSpace(profile.Name)
	profile.ProviderKind = strings.TrimSpace(profile.ProviderKind)
	profile.TransportKind = strings.TrimSpace(profile.TransportKind)
	profile.State = strings.TrimSpace(profile.State)
	profile.Command = strings.TrimSpace(profile.Command)
	if profile.ID == "" {
		return ProviderProfile{}, errors.New("delegation provider id is required")
	}
	if profile.ProviderKind != ProviderKindMCPToolProvider {
		return ProviderProfile{}, fmt.Errorf("provider %q must use kind %s", profile.ID, ProviderKindMCPToolProvider)
	}
	if profile.TransportKind != TransportKindStdioCommand {
		return ProviderProfile{}, fmt.Errorf("provider %q must use admitted transport %s", profile.ID, TransportKindStdioCommand)
	}
	if profile.State == "" {
		profile.State = ProviderStateRegistered
	}
	if len(profile.AllowedTools) == 0 {
		return ProviderProfile{}, fmt.Errorf("provider %q must define an MCP tool allowlist", profile.ID)
	}
	seenTools := map[string]struct{}{}
	for i := range profile.AllowedTools {
		profile.AllowedTools[i].Name = strings.TrimSpace(profile.AllowedTools[i].Name)
		profile.AllowedTools[i].InputSchemaDigest = strings.TrimSpace(profile.AllowedTools[i].InputSchemaDigest)
		if profile.AllowedTools[i].Name == "" {
			return ProviderProfile{}, fmt.Errorf("provider %q has an empty allowed tool name", profile.ID)
		}
		if _, exists := seenTools[profile.AllowedTools[i].Name]; exists {
			return ProviderProfile{}, fmt.Errorf("provider %q duplicates allowed tool %q", profile.ID, profile.AllowedTools[i].Name)
		}
		seenTools[profile.AllowedTools[i].Name] = struct{}{}
	}
	if profile.Timeout <= 0 {
		profile.Timeout = defaultGatewayTimeout
	}
	return profile, nil
}

func normalizeAllowedTools(profile ProviderProfile, tools []*mcp.Tool) ([]ToolDescriptor, error) {
	allowed := allowedToolSet(profile)
	seenAllowed := map[string]struct{}{}
	descriptors := make([]ToolDescriptor, 0, len(profile.AllowedTools))
	for _, tool := range tools {
		if tool == nil {
			continue
		}
		name := strings.TrimSpace(tool.Name)
		policy, ok := allowed[name]
		if !ok {
			continue
		}
		digest, err := schemaDigest(tool.InputSchema)
		if err != nil {
			return nil, fmt.Errorf("mcp tool %q schema cannot be digested: %w", name, err)
		}
		if policy.InputSchemaDigest != "" && policy.InputSchemaDigest != digest {
			return nil, fmt.Errorf("mcp tool %q schema drift: got %s want %s", name, digest, policy.InputSchemaDigest)
		}
		seenAllowed[name] = struct{}{}
		descriptors = append(descriptors, ToolDescriptor{
			Name:              name,
			Title:             strings.TrimSpace(tool.Title),
			Description:       strings.TrimSpace(tool.Description),
			InputSchemaDigest: digest,
			Allowed:           true,
		})
	}
	missing := missingAllowedTools(profile, seenAllowed)
	if len(missing) > 0 {
		return nil, fmt.Errorf("mcp provider %q missing allowlisted tools: %s", profile.ID, strings.Join(missing, ","))
	}
	sort.Slice(descriptors, func(i, j int) bool {
		return descriptors[i].Name < descriptors[j].Name
	})
	return descriptors, nil
}

func verifyToolVisibleAndStable(profile ProviderProfile, policy ToolAllowlistEntry, tools []*mcp.Tool) (string, error) {
	descriptors, err := normalizeAllowedTools(profile, tools)
	if err != nil {
		return "", err
	}
	for _, descriptor := range descriptors {
		if descriptor.Name == policy.Name {
			return descriptor.InputSchemaDigest, nil
		}
	}
	return "", fmt.Errorf("mcp provider %q tool %q is not visible", profile.ID, policy.Name)
}

func allowedTool(profile ProviderProfile, toolName string) (ToolAllowlistEntry, error) {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return ToolAllowlistEntry{}, gatewayFailure(ReasonGatewayMCPToolNotAllowlisted, "delegated MCP tool name is required", nil)
	}
	for _, tool := range profile.AllowedTools {
		if tool.Name == name {
			return tool, nil
		}
	}
	return ToolAllowlistEntry{}, gatewayFailure(ReasonGatewayMCPToolNotAllowlisted, "delegated MCP tool %q is not allowlisted for provider %q", nil, name, profile.ID)
}

func allowedToolSet(profile ProviderProfile) map[string]ToolAllowlistEntry {
	out := make(map[string]ToolAllowlistEntry, len(profile.AllowedTools))
	for _, tool := range profile.AllowedTools {
		out[tool.Name] = tool
	}
	return out
}

func missingAllowedTools(profile ProviderProfile, seen map[string]struct{}) []string {
	var missing []string
	for _, tool := range profile.AllowedTools {
		if _, ok := seen[tool.Name]; !ok {
			missing = append(missing, tool.Name)
		}
	}
	sort.Strings(missing)
	return missing
}

func decodeToolArguments(raw json.RawMessage) (map[string]json.RawMessage, error) {
	if len(raw) == 0 {
		return map[string]json.RawMessage{}, nil
	}
	if containsRawCredentialMaterial(raw) {
		return nil, gatewayFailure(ReasonGatewayMCPCredentialBlocked, "delegated MCP tool arguments contain credential material", nil)
	}
	var args map[string]json.RawMessage
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, gatewayFailure(ReasonGatewayMCPArgumentsInvalid, "delegated MCP tool arguments must be a JSON object", err)
	}
	if args == nil {
		args = map[string]json.RawMessage{}
	}
	return args, nil
}

func gatewayFailure(reasonCode string, message string, err error, args ...any) GatewayError {
	return GatewayError{
		ReasonCode: strings.TrimSpace(reasonCode),
		Message:    fmt.Sprintf(message, args...),
		Err:        err,
	}
}

func reasonForContext(ctx context.Context, fallback string) string {
	if ctx != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return ReasonGatewayMCPTimeout
	}
	return fallback
}

func mapGatewayAdmissionError(err error) error {
	var gatewayErr GatewayError
	if errors.As(err, &gatewayErr) {
		return err
	}
	message := err.Error()
	switch {
	case strings.Contains(message, "schema drift"):
		return gatewayFailure(ReasonProviderDrifted, "mcp schema drift", err)
	case strings.Contains(message, "missing allowlisted tools"):
		return gatewayFailure(ReasonProviderDrifted, "mcp allowlisted tool missing", err)
	case strings.Contains(message, "not visible"):
		return gatewayFailure(ReasonProviderDrifted, "mcp allowlisted tool not visible", err)
	default:
		return gatewayFailure(ReasonGatewayMCPDiscoveryFailed, "mcp tool admission failed", err)
	}
}

func containsRawCredentialMaterial(raw json.RawMessage) bool {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return false
	}
	return containsCredentialValue(value)
}

func containsCredentialValue(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if isCredentialKey(key) {
				return true
			}
			if containsCredentialValue(child) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if containsCredentialValue(child) {
				return true
			}
		}
	case string:
		return looksLikeBearerToken(typed)
	}
	return false
}

func isCredentialKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(key), "-", "_"))
	for _, token := range []string{
		"api_key",
		"apikey",
		"access_token",
		"refresh_token",
		"auth_token",
		"authorization",
		"bearer_token",
		"oauth_token",
		"credential",
		"credentials",
		"client_secret",
		"password",
		"secret",
	} {
		if normalized == token || strings.HasSuffix(normalized, "_"+token) {
			return true
		}
	}
	return false
}

func looksLikeBearerToken(value string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(value)), "bearer ")
}

func marshalToolResult(result *mcp.CallToolResult) (json.RawMessage, error) {
	if result == nil {
		return nil, errors.New("mcp tool call returned nil result")
	}
	content, err := json.Marshal(result.Content)
	if err != nil {
		return nil, err
	}
	structured, err := json.Marshal(result.StructuredContent)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(mcpToolCallEvidencePayload{
		Content:           content,
		StructuredContent: structured,
		IsError:           result.IsError,
	})
	if err != nil {
		return nil, err
	}
	return payload, nil
}

func schemaDigest(value interface{}) (string, error) {
	if value == nil {
		return "", nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func sanitizedCommandEnv(env []string) []string {
	allowedKeys := map[string]struct{}{
		"PATH":       {},
		"HOME":       {},
		"TMPDIR":     {},
		"TEMP":       {},
		"TMP":        {},
		"SystemRoot": {},
		"COMSPEC":    {},
	}
	out := make([]string, 0, len(allowedKeys))
	for _, item := range env {
		key, _, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		if _, allowed := allowedKeys[key]; allowed {
			out = append(out, item)
		}
	}
	sort.Strings(out)
	return out
}
