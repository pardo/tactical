import { findPath } from '../sim/nav.js';
import { isWalkableAt } from '../sim/map.js';
import { makeWaypoint, MAX_WAYPOINTS, MAX_ACTIONS, MAX_WAIT } from '../sim/plan.js';

/**
 * Editing state for one team's drafts during the planning phase.
 * Pure logic (no DOM / Three.js) so it can be unit tested.
 */
export function createPlanning(map) {
  const st = { team: null, drafts: null, soldiers: null, selectedId: null, wpIndex: null, pickMode: null, undoStack: [] };

  const wps = (id = st.selectedId) => (st.drafts[id] ??= []);
  const wp = () => (st.selectedId !== null && st.wpIndex !== null ? wps()[st.wpIndex] ?? null : null);
  const soldier = (id) => st.soldiers().find((s) => s.id === id);

  function snapshot() {
    st.undoStack.push(structuredClone(st.drafts));
    if (st.undoStack.length > 60) st.undoStack.shift();
  }

  /** Where the leg to waypoint i starts: the previous waypoint, or the soldier. */
  function legStart(id, i) {
    const list = wps(id);
    return i > 0 ? list[i - 1] : soldier(id);
  }

  const api = {
    state: st,

    /** @param soldiers () => live soldier objects of the world (for positions) */
    begin(team, drafts, soldiers) {
      st.team = team;
      st.drafts = drafts;
      st.soldiers = soldiers;
      st.undoStack = [];
      st.pickMode = null;
      st.wpIndex = null;
      const own = soldiers().filter((s) => s.team === team && s.alive);
      if (!own.some((s) => s.id === st.selectedId)) st.selectedId = own[0]?.id ?? null;
    },

    get selectedWaypoint() {
      return wp();
    },

    selectSoldier(id) {
      const s = soldier(id);
      if (!s || s.team !== st.team || !s.alive) return false;
      st.selectedId = id;
      st.wpIndex = null;
      st.pickMode = null;
      return true;
    },

    selectWaypoint(id, index) {
      if (!api.selectSoldier(id)) return;
      st.wpIndex = index;
    },

    deselectWaypoint() {
      st.wpIndex = null;
      st.pickMode = null;
    },

    /** Append a waypoint for the selected soldier. Returns false if unreachable. */
    addWaypoint(x, z, move = null) {
      if (st.selectedId === null) return false;
      const list = wps();
      if (list.length >= MAX_WAYPOINTS) return false;
      const from = list.length ? list[list.length - 1] : soldier(st.selectedId);
      if (!findPath(map, from.x, from.z, x, z)) return false;
      snapshot();
      const w = makeWaypoint(x, z, list[list.length - 1]);
      if (move) w.move = move;
      list.push(w);
      st.wpIndex = list.length - 1;
      return true;
    },

    beginDrag(id, index) {
      api.selectWaypoint(id, index);
      snapshot();
    },

    dragWaypointTo(x, z) {
      const w = wp();
      if (!w || !isWalkableAt(map, x, z)) return false;
      const from = legStart(st.selectedId, st.wpIndex);
      if (!findPath(map, from.x, from.z, x, z)) return false;
      w.x = x;
      w.z = z;
      return true;
    },

    setMove(move) {
      const w = wp();
      if (!w || w.move === move) return;
      snapshot();
      w.move = move;
    },

    setFire(fire) {
      const w = wp();
      if (!w || w.fire === fire) return;
      snapshot();
      w.fire = fire;
    },

    addAction(action) {
      const w = wp();
      if (!w || w.actions.length >= MAX_ACTIONS) return false;
      snapshot();
      const last = w.actions[w.actions.length - 1];
      // Tapping "+Wait" again extends the trailing wait instead of stacking a new one;
      // tapping "Sync" again moves the sync time later (wrapping around the turn).
      if (action.type === 'wait' && last?.type === 'wait') last.t = Math.min(MAX_WAIT, last.t + action.t);
      else if (action.type === 'until' && last?.type === 'until') last.t = last.t >= 5 ? 0.5 : last.t + 0.5;
      else w.actions.push(action);
      return true;
    },

    removeAction(k) {
      const w = wp();
      if (!w || !w.actions[k]) return;
      snapshot();
      w.actions.splice(k, 1);
    },

    clearLook() {
      const w = wp();
      if (!w?.look) return;
      snapshot();
      w.look = null;
    },

    deleteWaypoint() {
      const list = wps();
      if (st.wpIndex === null || !list[st.wpIndex]) return;
      snapshot();
      list.splice(st.wpIndex, 1);
      st.wpIndex = list.length ? Math.min(st.wpIndex, list.length - 1) : null;
    },

    clearPlan() {
      if (st.selectedId === null || !wps().length) return;
      snapshot();
      st.drafts[st.selectedId] = [];
      st.wpIndex = null;
    },

    /** 'face' | 'look' | 'grenade:<kind>': the next map tap supplies the target point. */
    startPick(mode) {
      if (wp()) st.pickMode = mode;
    },

    cancelPick() {
      st.pickMode = null;
    },

    applyPick(x, z) {
      const w = wp();
      const mode = st.pickMode;
      st.pickMode = null;
      if (!w || !mode) return false;
      if (mode === 'look') {
        snapshot();
        w.look = { x, z };
        return true;
      }
      if (mode.startsWith('grenade:')) return api.addAction({ type: 'grenade', kind: mode.slice(8), x, z });
      if (mode === 'breach') return api.addAction({ type: 'breach', x, z });
      return api.addAction({ type: mode, x, z });
    },

    undo() {
      const prev = st.undoStack.pop();
      if (!prev) return false;
      for (const k of Object.keys(st.drafts)) delete st.drafts[k];
      Object.assign(st.drafts, prev);
      if (st.wpIndex !== null && !wps()[st.wpIndex]) st.wpIndex = null;
      st.pickMode = null;
      return true;
    },
  };
  return api;
}
