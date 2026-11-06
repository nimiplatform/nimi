package bedrocktarget

import "testing"

func TestNativeEndpointAndExplicitInvocation(t *testing.T) {
	for _, suffix := range []string{"", "/", "/openai/v1/", "/anthropic", "/anthropic/v1"} {
		base, err := Endpoint("https://bedrock-runtime.us-east-1.amazonaws.com" + suffix)
		if err != nil || base != "https://bedrock-runtime.us-east-1.amazonaws.com" || ControlEndpoint(base) != "https://bedrock.us-east-1.amazonaws.com/foundation-models" {
			t.Fatal(base, err)
		}
	}
	for _, raw := range []string{"https://bedrock-mantle.us-east-1.api.aws", "https://bedrock-runtime.us-east-1.amazonaws.com.evil.test", "https://user@bedrock-runtime.us-east-1.amazonaws.com", "http://bedrock-runtime.us-east-1.amazonaws.com", "https://bedrock-runtime.us-east-1.amazonaws.com/v1", "https://bedrock-runtime.us-east-1.amazonaws.com?region=eu-west-1"} {
		if _, err := Endpoint(raw); err == nil {
			t.Fatal("invalid endpoint admitted", raw)
		}
	}
	const model = "anthropic.claude-sonnet-5-5"
	for _, id := range []string{"us." + model, "global." + model, "eu." + model} {
		if !ValidInvocation(model, id) {
			t.Fatal(id)
		}
	}
	for _, id := range []string{"", model, "xx." + model, " global." + model, "global.anthropic.claude-opus-5-5", "arn:aws:bedrock:us-east-1:123:inference-profile/name"} {
		if ValidInvocation(model, id) {
			t.Fatal("different or malformed target admitted", id)
		}
	}
	if ValidInvocation("amazon.nova-pro-v1:0", "global.amazon.nova-pro-v1:0") || ValidInvocation("amazon.nova-premier-v1:0", "us.amazon.nova-premier-v1:0") {
		t.Fatal("unreviewed or retired invocation admitted")
	}
	const opus = "anthropic.claude-opus-5-5"
	if !InvocationRegionAllowed("https://bedrock-runtime.eu-west-2.amazonaws.com", opus, opus) || InvocationRegionAllowed("https://bedrock-runtime.us-east-1.amazonaws.com", opus, opus) {
		t.Fatal("Opus in-region constraint lost")
	}
}
