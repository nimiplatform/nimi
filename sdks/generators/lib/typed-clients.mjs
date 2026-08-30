import { writeGoTypedClients } from './typed-clients-go.mjs';
import { writePythonTypedClients } from './typed-clients-python.mjs';
import { writeRustTypedClients } from './typed-clients-rust.mjs';
import { writeTypescriptTypedClients } from './typed-clients-typescript.mjs';

export function writeTypedClients(typescriptRuntime, nonHostRuntime, realm) {
  writeTypescriptTypedClients(typescriptRuntime, nonHostRuntime, realm);
  writePythonTypedClients(nonHostRuntime, realm);
  writeGoTypedClients(nonHostRuntime, realm);
  writeRustTypedClients(nonHostRuntime, realm);
}
