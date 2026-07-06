import { realmWorldData } from './data/realm-world-data.js';
import type {
  WorldAuditItem,
  WorldCharacter,
  WorldDetailData,
  WorldHistoryBundle,
  WorldPublicAssetsData,
  WorldSemanticData,
} from './world-detail-types.js';

export type WorldDetailWithCharactersResponse = Awaited<ReturnType<typeof realmWorldData.loadWorldDetailWithCharacters>>;
export type WorldPrimaryDetailRecord = NonNullable<WorldDetailWithCharactersResponse>;

export type WorldDisplayDetail = {
  primary: WorldPrimaryDetailRecord;
  world: WorldDetailData;
  characters: WorldCharacter[];
  history: WorldHistoryBundle;
  semantic: WorldSemanticData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
  sections: {
    history: 'success' | 'error';
    semantic: 'success' | 'error';
    audits: 'success' | 'error';
    publicAssets: 'success' | 'error';
  };
};

export type WorldPrimaryDisplayDetail = Pick<WorldDisplayDetail, 'primary' | 'world' | 'characters'>;
export type WorldSupplementalDisplayDetail = Pick<WorldDisplayDetail, 'history' | 'semantic' | 'audits' | 'publicAssets' | 'sections'>;
