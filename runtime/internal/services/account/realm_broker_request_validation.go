package account

import (
	"fmt"
	"math"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
)

func validateRealmUnaryRequestShape(operation realmUnaryOperation, request realmUnaryRequestJSON) error {
	for required := range operation.requiredPathParameters {
		value, exists := request.Path[required]
		if !exists || strings.TrimSpace(fmt.Sprint(value)) == "" || fmt.Sprint(value) == "<nil>" {
			return fmt.Errorf("realm operation path parameter is missing: %s", required)
		}
	}
	for name := range request.Path {
		kind, allowed := operation.pathParameterKinds[name]
		if !allowed {
			return fmt.Errorf("realm operation path parameter is not admitted: %s", name)
		}
		if !realmUnaryParameterValueMatches(kind, request.Path[name], true) {
			return fmt.Errorf("realm operation path parameter has invalid type or value: %s", name)
		}
	}
	for name := range request.Query {
		kind, allowed := operation.queryParameterKinds[name]
		if !allowed {
			return fmt.Errorf("realm operation query parameter is not admitted: %s", name)
		}
		if !realmUnaryParameterValueMatches(kind, request.Query[name], false) {
			return fmt.Errorf("realm operation query parameter has invalid type or value: %s", name)
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
		if err := jsonstrict.Decode(request.Body, &body); err != nil {
			return fmt.Errorf("realm operation request body JSON is invalid")
		}
		if scanRealmBrokerJSONValue(body) {
			return fmt.Errorf("credential-like Realm broker request is forbidden")
		}
	}
	return nil
}

func realmUnaryParameterValueMatches(kind realmUnaryParameterKind, value any, path bool) bool {
	switch kind {
	case realmUnaryParameterString:
		text, ok := value.(string)
		return ok && (!path || strings.TrimSpace(text) != "") && text == strings.TrimSpace(text)
	case realmUnaryParameterNumber:
		number, ok := value.(float64)
		return ok && !math.IsInf(number, 0) && !math.IsNaN(number)
	case realmUnaryParameterInteger:
		number, ok := value.(float64)
		return ok && !math.IsInf(number, 0) && !math.IsNaN(number) && math.Trunc(number) == number
	case realmUnaryParameterBoolean:
		_, ok := value.(bool)
		return ok
	default:
		return false
	}
}
