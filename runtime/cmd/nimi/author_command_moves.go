package main

import "fmt"

func movedToNimiModError(command string) error {
	return fmt.Errorf("AUTHOR_COMMAND_REMOVED: actionHint=runtime_mod_authoring_removed command=%s", command)
}

func movedToNimiAppError(command string) error {
	return fmt.Errorf("AUTHOR_COMMAND_MOVED: actionHint=use_nimi-app_%s", command)
}
