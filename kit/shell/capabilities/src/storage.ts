import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_STORAGE_SHELL_COMMANDS = Object.freeze({
  readJson: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
  writeJson: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
  removeJson: NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'],
  assetStat: NIMI_STANDARD_SHELL_COMMANDS['storage.assetStat'],
  assetList: NIMI_STANDARD_SHELL_COMMANDS['storage.assetList'],
  assetWriteOpen: NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteOpen'],
  assetWriteChunk: NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteChunk'],
  assetWriteCommit: NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteCommit'],
  assetWriteAbort: NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteAbort'],
  assetReadOpen: NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadOpen'],
  assetReadNext: NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadNext'],
  assetReadClose: NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadClose'],
  assetRemove: NIMI_STANDARD_SHELL_COMMANDS['storage.assetRemove'],
  assetMove: NIMI_STANDARD_SHELL_COMMANDS['storage.assetMove'],
  assetAdopt: NIMI_STANDARD_SHELL_COMMANDS['storage.assetAdopt'],
  assetMediaOpen: NIMI_STANDARD_SHELL_COMMANDS['storage.assetMediaOpen'],
  assetMediaRevoke: NIMI_STANDARD_SHELL_COMMANDS['storage.assetMediaRevoke'],
});
