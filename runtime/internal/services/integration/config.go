package integration

import (
	"net"
	"net/url"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
)

func isNativeAdapter(id string) bool {
	return id == "weixin" || id == "feishu" || id == "qq-official" || id == "onebot-v11"
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
func validateConnectionConfig(adapter string, c *runtimev1.IntegrationConnectionConfig) error {
	invalid := func() error { return failure(codes.InvalidArgument, "INTEGRATION_CONFIGURATION_INVALID") }
	if c == nil {
		return invalid()
	}
	count := 0
	for _, present := range []bool{c.Mcp != nil, c.Telegram != nil, c.Weixin != nil, c.Feishu != nil, c.QqOfficial != nil, c.OnebotV11 != nil} {
		if present {
			count++
		}
	}
	if count != 1 {
		return invalid()
	}
	switch adapter {
	case "mcp":
		if c.Mcp == nil || len(c.Mcp.Endpoint) > 4096 {
			return invalid()
		}
		u, err := url.Parse(c.Mcp.Endpoint)
		if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
			return invalid()
		}
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback()))) {
			return invalid()
		}
	case "telegram":
		if c.Telegram == nil {
			return invalid()
		}
	case "weixin":
		if c.Weixin == nil {
			return invalid()
		}
	case "feishu":
		if c.Feishu == nil || (c.Feishu.SetupMode != "manual" && c.Feishu.SetupMode != "create") || (c.Feishu.SetupMode == "manual" && !validExternalIdentifier(c.Feishu.AppId)) || (c.Feishu.SetupMode == "create" && c.Feishu.AppId != "") {
			return invalid()
		}
	case "qq-official":
		if c.QqOfficial == nil || !validExternalIdentifier(c.QqOfficial.AppId) {
			return invalid()
		}
	case "onebot-v11":
		if c.OnebotV11 == nil || !validExternalIdentifier(c.OnebotV11.SelfId) {
			return invalid()
		}
		if _, err := onebotNumericID(c.OnebotV11.SelfId); err != nil {
			return invalid()
		}
		host, port, err := net.SplitHostPort(c.OnebotV11.Listener)
		ip := net.ParseIP(host)
		portNumber, portErr := strconv.Atoi(port)
		if err != nil || portErr != nil || portNumber < 1 || portNumber > 65535 || ip == nil || len(c.OnebotV11.Listener) > 256 {
			return invalid()
		}
	default:
		return failure(codes.InvalidArgument, "INTEGRATION_ADAPTER_UNSUPPORTED")
	}
	return nil
}

func validExternalIdentifier(id string) bool {
	return len(id) > 0 && len(id) <= 256 && strings.TrimSpace(id) == id && !strings.ContainsAny(id, "\x00\r\n")
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
func validConnectionDisplayName(adapter, name string) bool {
	return len(name) <= 256 && (adapter == "weixin" || strings.TrimSpace(name) != "")
}
