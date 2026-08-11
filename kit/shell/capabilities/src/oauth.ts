import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_OAUTH_SHELL_COMMANDS = Object.freeze({
  openExternalUrl: NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl'],
  listenForCode: NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode'],
});
