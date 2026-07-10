package account

import (
	"encoding/json"
	"fmt"
	"strings"
)

func validateRealmUnaryRequestShape(operation realmUnaryOperation, request realmUnaryRequestJSON) error {
	for required := range operation.requiredPathParameters {
		value, exists := request.Path[required]
		if !exists || strings.TrimSpace(fmt.Sprint(value)) == "" || fmt.Sprint(value) == "<nil>" {
			return fmt.Errorf("realm operation path parameter is missing: %s", required)
		}
	}
	for name := range request.Path {
		if _, allowed := operation.allowedPathParameters[name]; !allowed {
			return fmt.Errorf("realm operation path parameter is not admitted: %s", name)
		}
	}
	for name := range request.Query {
		if _, allowed := operation.allowedQueryParameters[name]; !allowed {
			return fmt.Errorf("realm operation query parameter is not admitted: %s", name)
		}
	}
	bodyPresent := len(request.Body) > 0 && strings.TrimSpace(string(request.Body)) != "" && strings.TrimSpace(string(request.Body)) != "null"
	if bodyPresent && !operation.requestBodyAllowed {
		return fmt.Errorf("realm operation request body is not admitted")
	}
	if !bodyPresent && operation.requestBodyRequired {
		return fmt.Errorf("realm operation request body is required")
	}
	if scanRealmBrokerJSONValue(request.Path) || scanRealmBrokerJSONValue(request.Query) {
		return fmt.Errorf("credential-like Realm broker request is forbidden")
	}
	if bodyPresent {
		var body any
		if err := json.Unmarshal(request.Body, &body); err != nil {
			return fmt.Errorf("realm operation request body JSON is invalid")
		}
		if scanRealmBrokerJSONValue(body) {
			return fmt.Errorf("credential-like Realm broker request is forbidden")
		}
	}
	return nil
}
