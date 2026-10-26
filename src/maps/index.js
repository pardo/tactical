import killhouse from './killhouse.js';
import warehouse from './warehouse.js';
import embassy from './embassy.js';
import streets from './streets.js';
import { validateMapDef } from './validate.js';

/** Built-in maps; ids are what goes over the network. */
export const MAPS = { killhouse, warehouse, embassy, streets };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'killhouse';

// Custom maps (from the editor) live in localStorage under ids "custom:<name>".
const STORAGE_KEY = 'tactical.customMaps';
export const isCustomMap = (id) => typeof id === 'string' && id.startsWith('custom:');

export function loadCustomMaps() {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return Object.fromEntries(Object.entries(all).filter(([, def]) => validateMapDef(def).ok));
  } catch {
    return {};
  }
}

export function saveCustomMap(def) {
  const all = loadCustomMaps();
  const id = `custom:${def.name}`;
  all[id] = { name: def.name, rows: def.rows, res: def.res ?? 1 };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    return null;
  }
  return id;
}

export function deleteCustomMap(id) {
  const all = loadCustomMaps();
  delete all[id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: nothing to delete
  }
}

/** Built-in ids followed by this device's custom maps. */
export function listMapIds() {
  return [...MAP_IDS, ...Object.keys(loadCustomMaps())];
}

export function getMapDef(id) {
  return MAPS[id] ?? loadCustomMaps()[id] ?? null;
}
