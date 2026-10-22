import { findPath } from '../sim/nav.js';
import { isWalkableAt } from '../sim/map.js';
import { makeWaypoint, MAX_WAYPOINTS, MAX_ACTIONS, MAX_WAIT, GO_CODES } from '../sim/plan.js';

/**
 * Editing state for one team's drafts during the planning phase.
 * Pure logic (no DOM / Three.js) so it can be unit tested.
 */
export function createPlanning(map) {
  // freshHere: a "here" waypoint was just inserted for an order that hasn't been given yet (see selectHere).
  const st = {
    team: null,
    drafts: null,
    soldiers: null,
    selectedId: null,
    wpIndex: null,
    pickMode: null,
    undoStack: [],
    freshHere: false,
  };

  const wps = (id = st.selectedId) => (st.drafts[id] ??= []);
  const wp = () => (st.selectedId !== null && st.wpIndex !== null ? (wps()[st.wpIndex] ?? null) : null);
  const soldier = (id) => st.soldiers().find((s) => s.id === id);
  /** No plan, or only a turn-in-place one: Face can (re)aim the soldier without a new waypoint. */
  const canFaceHere = (id) => {
    const list = wps(id);
    const s = soldier(id);
    return !!s && (!list.length || (list.length === 1 && list[0].x === s.x && list[0].z === s.z));
  };

  /** True if waypoint i of soldier id is where the soldier stands now (orders given before moving). */
  const isHere = (id, i) => {
    const w = wps(id)[i];
    const s = soldier(id);
    return i === 0 && !!w && !!s && w.x === s.x && w.z === s.z;
  };

  function snapshot() {
    // The snapshot taken when the fresh "here" waypoint went in also covers the order it was made for.
    if (st.freshHere) {
      st.freshHere = false;
      return;
    }
    st.undoStack.push(structuredClone(st.drafts));
    if (st.undoStack.length > 60) st.undoStack.shift();
  }

  /** Drop a "here" waypoint whose order never came (e.g. the grenade pick was cancelled). */
  function discardFreshHere() {
    if (!st.freshHere) return;
    st.freshHere = false;
    wps().shift();
    st.undoStack.pop();
    st.wpIndex = null;
  }

  /** Where the leg to waypoint i starts: the previous waypoint, or the soldier. */
  function legStart(id, i) {
    const list = wps(id);
    return i > 0 ? list[i - 1] : soldier(id);
  }

  /** Apply a picked map point for pick mode `mode` to waypoint w. */
  function pickTo(w, mode, x, z) {
    if (mode === 'faceHere') {
      // Turn in place: a waypoint where the soldier stands, whose only order is to face the point.
      const s = soldier(st.selectedId);
      if (!s || !canFaceHere(s.id)) return false;
      snapshot();
      st.drafts[s.id] = [{ ...makeWaypoint(s.x, s.z), actions: [{ type: 'face', x, z }] }];
      st.wpIndex = null;
      return true;
    }
    if (!w || !mode) return false;
    if (mode === 'look') {
      snapshot();
      w.look = { x, z };
      return true;
    }
    if (mode.startsWith('grenade:')) return api.addAction({ type: 'grenade', kind: mode.slice(8), x, z });
    if (mode === 'breach') return api.addAction({ type: 'breach', x, z });
    return api.addAction({ type: mode, x, z });
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
      st.freshHere = false;
      st.wpIndex = null;
      const own = soldiers().filter((s) => s.team === team && s.alive);
      if (!own.some((s) => s.id === st.selectedId)) st.selectedId = own[0]?.id ?? null;
    },

    /** True if the selected soldier can be turned in place (see startPick('faceHere')). */
    get canFaceHere() {
      return st.selectedId !== null && canFaceHere(st.selectedId);
    },

    get selectedWaypoint() {
      return wp();
    },

    /** True if waypoint i of the selected soldier is the "here" one (orders before moving). */
    isHere(i = st.wpIndex) {
      return st.selectedId !== null && isHere(st.selectedId, i);
    },

    /**
     * Select the waypoint where the selected soldier stands, inserting it in front of the
     * plan if needed, so orders (grenades, cover, crouch…) can be given without moving first.
     * An inserted one that gets no order is dropped again on cancel / deselect.
     */
    selectHere() {
      if (st.selectedId === null) return false;
      const s = soldier(st.selectedId);
      const list = wps();
      if (!s) return false;
      if (!isHere(s.id, 0)) {
        if (list.length >= MAX_WAYPOINTS) return false;
        snapshot();
        list.unshift(makeWaypoint(s.x, s.z));
        st.freshHere = true;
      }
      st.wpIndex = 0;
      st.pickMode = null;
      return true;
    },

    selectSoldier(id) {
      const s = soldier(id);
      if (!s || s.team !== st.team || !s.alive) return false;
      discardFreshHere();
      st.selectedId = id;
      st.wpIndex = null;
      st.pickMode = null;
      return true;
    },

    selectWaypoint(id, index) {
      // Dropping a fresh "here" waypoint shifts the rest of that soldier's plan down by one.
      if (st.freshHere && id === st.selectedId) index--;
      if (!api.selectSoldier(id) || index < 0) return;
      st.wpIndex = index;
    },

    deselectWaypoint() {
      discardFreshHere();
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
      // Tapping "Go code" again cycles Alpha → Bravo → Charlie.
      else if (action.type === 'code' && last?.type === 'code')
        last.code = GO_CODES[(GO_CODES.indexOf(last.code) + 1) % GO_CODES.length];
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

    /**
     * 'face' | 'look' | 'grenade:<kind>' | 'breach' (on the selected waypoint), or
     * 'faceHere' (soldier with no plan: turn in place): the next map tap supplies the point.
     */
    startPick(mode) {
      if (mode === 'faceHere' ? st.selectedId !== null && canFaceHere(st.selectedId) : wp())
        st.pickMode = mode;
    },

    cancelPick() {
      st.pickMode = null;
      discardFreshHere();
    },

    applyPick(x, z) {
      const w = wp();
      const mode = st.pickMode;
      st.pickMode = null;
      const ok = pickTo(w, mode, x, z);
      if (!ok) discardFreshHere(); // the order never landed on the fresh "here" waypoint
      return ok;
    },

    /** Go codes some soldier of this team is (or will be) waiting on, in order. */
    get usedCodes() {
      const used = new Set();
      for (const [k, list] of Object.entries(st.drafts ?? {})) {
        if (k === 'go') continue;
        for (const w of list) for (const a of w.actions) if (a.type === 'code') used.add(a.code);
      }
      return GO_CODES.filter((c) => used.has(c));
    },

    /** Release (or hold back) a go code at the start of this turn. */
    toggleGo(code) {
      if (!GO_CODES.includes(code)) return;
      snapshot();
      const go = new Set(st.drafts.go ?? []);
      if (go.has(code)) go.delete(code);
      else go.add(code);
      st.drafts.go = GO_CODES.filter((c) => go.has(c));
    },

    undo() {
      if (st.freshHere) {
        discardFreshHere();
        return true;
      }
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
