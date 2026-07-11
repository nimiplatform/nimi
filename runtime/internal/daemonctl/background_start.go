package daemonctl

import "fmt"

func defaultStartProcess(string, string) (int, error) {
	return 0, fmt.Errorf("background Runtime child-process launch is forbidden; use the protected NimiRuntime service")
}
