package main

import "fmt"

func movedToNimiAppError(command string) error {
	return fmt.Errorf("AUTHOR_COMMAND_MOVED: actionHint=use_nimi-app_%s", command)
}
