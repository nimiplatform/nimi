import { getProductControlSelectedDataRoot } from './product-control';
import {
  projectNimiProductControlStorageDirs,
  type NimiProductControlStorageDirsProjection,
} from '@nimiplatform/sdk';

export type DesktopStorageDirs = NimiProductControlStorageDirsProjection;

export async function getDesktopStorageDirs(): Promise<DesktopStorageDirs> {
  const projection = await getProductControlSelectedDataRoot();
  return projectNimiProductControlStorageDirs(projection);
}
