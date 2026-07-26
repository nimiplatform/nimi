import fs from 'node:fs';
import path from 'node:path';

export const FIRST_PARTY_PRODUCT_PRIVATE_ENV_NAMES = Object.freeze([
  'NIMI_FIRST_PARTY_ACCOUNT_EMAIL',
  'NIMI_FIRST_PARTY_ACCOUNT_PASSWORD',
  'NIMI_FIRST_PARTY_CANCEL_PROMPT',
  'NIMI_FIRST_PARTY_DIRECT_PROMPT',
  'NIMI_FIRST_PARTY_INSTALL_LEVEL',
  'NIMI_FIRST_PARTY_LOCAL_ROUTE_TESTID',
  'NIMI_FIRST_PARTY_PARTNER_PROMPT',
  'NIMI_FIRST_PARTY_PRODUCT_ROOT',
  'NIMI_FIRST_PARTY_REALM_SOURCE_ID',
  'NIMI_FIRST_PARTY_TIMEOUT_PROMPT',
  'NIMI_FIRST_PARTY_UNAVAILABLE_PROMPT',
  'NIMI_FIRST_PARTY_UNAVAILABLE_ROUTE_TESTID',
]);

export function resolveFirstPartyProductRoot(value) {
  const configured = String(value || '').trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error('Gate 0 requires an explicit absolute --product-root or NIMI_FIRST_PARTY_PRODUCT_ROOT');
  }
  const resolved = path.resolve(configured);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Gate 0 selected product root does not exist: ${resolved}`);
    throw error;
  }
  if (!stat.isDirectory()) throw new Error(`Gate 0 selected product root is not a directory: ${resolved}`);
  return resolved;
}
