import { getProductControlSelectedDataRoot } from './product-control';
import {
  projectProductControlStorageDirs,
  type ProductControlStorageDirsProjection,
} from '@nimiplatform/sdk';

export type DesktopStorageDirs = ProductControlStorageDirsProjection;

export async function getDesktopStorageDirs(): Promise<DesktopStorageDirs> {
  const projection = await getProductControlSelectedDataRoot();
  return projectProductControlStorageDirs(projection);
}
