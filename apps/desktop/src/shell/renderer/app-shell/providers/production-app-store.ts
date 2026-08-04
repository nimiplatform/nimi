import { createAppStore } from './app-store-factory.js';
import { createProductionAppStoreDependencies } from './production-app-store-dependencies.js';

export const productionAppStore = createAppStore(createProductionAppStoreDependencies());
