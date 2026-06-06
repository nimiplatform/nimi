import { writeGoTypedClients } from './typed-clients-go.mjs';
import { writePythonTypedClients } from './typed-clients-python.mjs';
import { writeRustTypedClients } from './typed-clients-rust.mjs';
import { writeTypescriptTypedClients } from './typed-clients-typescript.mjs';

export function writeTypedClients(runtime, realm) {
  writeTypescriptTypedClients(runtime, realm);
  writePythonTypedClients(runtime, realm);
  writeGoTypedClients(runtime, realm);
  writeRustTypedClients(runtime, realm);
}
