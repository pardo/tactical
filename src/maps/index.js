import killhouse from './killhouse.js';
import warehouse from './warehouse.js';
import embassy from './embassy.js';
import streets from './streets.js';

/** Map registry; ids are what goes over the network. */
export const MAPS = { killhouse, warehouse, embassy, streets };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'killhouse';
