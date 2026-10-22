import { sha256 } from './sha256.js';
import { sanitizeSquad } from '../sim/roles.js';

export const PROTOCOL_VERSION = 2;
/** Quick emotes: a fixed list, so nothing free-form ever crosses the wire. */
export const EMOTES = ['👍', '😂', '😮', 'GG', '😡'];

const randomToken = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36)).join('');

/**
 * Two-player online session over any transport, lockstep style: only plans
 * travel, and both peers run the deterministic sim.
 *
 *   lobby:  both send `ready {squad}` → host sends `start {seed, squads, map, mode, timer, mapDef?}`
 *   turn:   each sends `commit {turn, hash}` on GO; once a peer has both
 *           commits it sends `reveal {turn, payload, salt}`. Committing a hash
 *           first means nobody can read the other plan and then change theirs.
 *   check:  after each turn both send `state {turn, hash}` of the world.
 *   rejoin: whenever the peers (re)connect mid-match, BOTH send `sync {seed,
 *           squads, map, mode, timer, history}`. Whoever has fewer turns in
 *           its history (or no match at all, e.g. after a reload) rebuilds by
 *           re-simulating the longer one (see shouldAdopt). Then both call
 *           recommit() so a GO that was lost in the drop is sent again.
 *
 * transport: { send(msg), onMessage(cb), onPeerJoin(cb), onPeerLeave(cb), leave() }
 *   It can be replaced with useTransport() (rejoining the room after a drop)
 *   without losing the turn state.
 * onEvent receives { type: 'peerJoined' | 'peerLeft' | 'start' | 'remoteCommitted'
 *   | 'plans' | 'sync' | 'desync' | 'cheat' | 'versionMismatch', ... }
 */

/**
 * Should this client rebuild its match from a peer's `sync`? Yes if it has no
 * match, or the peer's match is the same one but further along. Histories only
 * ever grow, and both sides' histories are prefixes of the same game.
 * @param local { seed, history } | null
 */
export function shouldAdopt(local, remote) {
  return !local || remote.history.length > local.history.length;
}
export function createSession({ transport: initialTransport, isHost, onEvent }) {
  let transport = initialTransport;
  const localTeam = isHost ? 'A' : 'B';
  const remoteTeam = isHost ? 'B' : 'A';
  const turns = new Map(); // turn → { local, remote, revealed, localState, remoteState }
  let localSquad = null;
  let options = {};
  let remoteSquad = null;
  let started = false;
  let peer = false;

  const turnState = (n) => {
    if (!turns.has(n)) turns.set(n, {});
    return turns.get(n);
  };

  function maybeStart() {
    if (!isHost || started || !localSquad || !remoteSquad) return;
    started = true;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
    const squads = { A: localSquad, B: remoteSquad };
    transport.send({ t: 'start', seed, squads, ...options });
    onEvent({ type: 'start', seed, squads, localTeam, ...options });
  }

  function maybeReveal(n) {
    const ts = turnState(n);
    if (!ts.local || !ts.remote?.hash || ts.revealed) return;
    ts.revealed = true;
    transport.send({ t: 'reveal', turn: n, payload: ts.local.payload, salt: ts.local.salt });
  }

  function compareState(n) {
    const ts = turnState(n);
    if (ts.localState && ts.remoteState && ts.localState !== ts.remoteState) {
      onEvent({ type: 'desync', turn: n, local: ts.localState, remote: ts.remoteState });
    }
  }

  // Messages from a replaced transport are ignored (see useTransport).
  function bind(t) {
    t.onPeerJoin(() => {
      if (t !== transport) return;
      peer = true;
      // The peer may have reloaded and planned this turn afresh: forget commits whose plans
      // never arrived, and be ready to reveal ours again once their new commit comes in.
      for (const ts of turns.values()) {
        if (ts.remote?.plans) continue;
        ts.remote = undefined;
        ts.revealed = false;
      }
      onEvent({ type: 'peerJoined', started });
      if (localSquad && !started) transport.send({ t: 'ready', v: PROTOCOL_VERSION, squad: localSquad });
    });
    t.onPeerLeave(() => {
      if (t !== transport) return;
      peer = false;
      onEvent({ type: 'peerLeft' });
    });
    t.onMessage((msg) => t === transport && receive(msg));
  }
  bind(transport);

  function receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'ready':
        if (msg.v !== PROTOCOL_VERSION) return onEvent({ type: 'versionMismatch', remote: msg.v });
        remoteSquad = sanitizeSquad(msg.squad);
        return maybeStart();
      case 'start':
        if (isHost || started) return;
        started = true;
        return onEvent({
          type: 'start',
          seed: msg.seed >>> 0,
          squads: { A: sanitizeSquad(msg.squads?.A), B: sanitizeSquad(msg.squads?.B) },
          map: String(msg.map ?? ''),
          mode: String(msg.mode ?? ''),
          timer: Math.max(0, Math.min(600, Number(msg.timer) || 0)),
          mapDef: msg.mapDef ?? null, // custom maps travel with the start message; validated by the caller
          localTeam,
        });
      case 'commit': {
        const ts = turnState(msg.turn);
        if (ts.remote) return;
        ts.remote = { hash: String(msg.hash) };
        onEvent({ type: 'remoteCommitted', turn: msg.turn });
        return maybeReveal(msg.turn);
      }
      case 'reveal': {
        const ts = turnState(msg.turn);
        if (!ts.remote?.hash || ts.remote.plans) return;
        if (sha256(`${msg.payload}|${msg.salt}`) !== ts.remote.hash) return onEvent({ type: 'cheat', turn: msg.turn });
        let plans;
        try {
          plans = JSON.parse(msg.payload);
        } catch {
          return onEvent({ type: 'cheat', turn: msg.turn });
        }
        ts.remote.plans = plans;
        return onEvent({ type: 'plans', turn: msg.turn, team: remoteTeam, plans });
      }
      case 'emote':
        if (EMOTES.includes(msg.e)) onEvent({ type: 'emote', emote: msg.e });
        return;
      case 'state':
        turnState(msg.turn).remoteState = String(msg.hash);
        return compareState(msg.turn);
      case 'sync':
        if (msg.v !== PROTOCOL_VERSION) return onEvent({ type: 'versionMismatch', remote: msg.v });
        started = true;
        return onEvent({
          type: 'sync',
          seed: msg.seed >>> 0,
          squads: { A: sanitizeSquad(msg.squads?.A), B: sanitizeSquad(msg.squads?.B) },
          map: String(msg.map ?? ''),
          mode: String(msg.mode ?? ''),
          timer: Math.max(0, Math.min(600, Number(msg.timer) || 0)),
          history: Array.isArray(msg.history) ? msg.history : [],
          mapDef: msg.mapDef ?? null,
          localTeam,
        });
    }
  }

  return {
    localTeam,
    remoteTeam,
    get connected() {
      return peer;
    },

    /** @param opts host only: { map, mode, timer } sent to the guest with `start` */
    ready(squad, opts = {}) {
      localSquad = sanitizeSquad(squad);
      options = { map: opts.map, mode: opts.mode, timer: opts.timer, mapDef: opts.mapDef };
      if (peer) transport.send({ t: 'ready', v: PROTOCOL_VERSION, squad: localSquad });
      maybeStart();
    },

    /**
     * Commit this turn's plans. Returns the normalised plans (JSON round-trip)
     * which the caller must simulate with, so both peers use identical numbers.
     */
    commit(turn, plans) {
      const payload = JSON.stringify(plans);
      const salt = randomToken();
      const ts = turnState(turn);
      ts.local = { payload, salt };
      transport.send({ t: 'commit', turn, hash: sha256(`${payload}|${salt}`) });
      maybeReveal(turn);
      return JSON.parse(payload);
    },

    /** A match is under way (restored from storage): don't run the lobby handshake again. */
    markStarted() {
      started = true;
    },

    /** Send our view of the match so a (re)connected peer can catch up (see `rejoin` above). */
    sync({ seed, squads, map, mode, timer = 0, history, mapDef = null }) {
      transport.send({ t: 'sync', v: PROTOCOL_VERSION, seed, squads, map, mode, timer, history, mapDef });
    },

    /**
     * After a reconnect: send this turn's commit again, and the reveal if the peer's
     * commit is already known. Duplicates are ignored on the other side.
     */
    recommit(turn) {
      const ts = turns.get(turn);
      if (!ts?.local) return;
      transport.send({ t: 'commit', turn, hash: sha256(`${ts.local.payload}|${ts.local.salt}`) });
      if (ts.remote?.hash) transport.send({ t: 'reveal', turn, payload: ts.local.payload, salt: ts.local.salt });
    },

    /**
     * Rejoin through a fresh transport (e.g. after the network dropped), keeping turn state.
     * Takes a factory: the old room must be left before the new one is joined.
     */
    useTransport(makeTransport) {
      transport.leave();
      transport = makeTransport();
      peer = false;
      bind(transport);
    },

    sendState(turn, hash) {
      turnState(turn).localState = hash;
      transport.send({ t: 'state', turn, hash });
      compareState(turn);
    },

    emote(e) {
      if (EMOTES.includes(e)) transport.send({ t: 'emote', e });
    },

    leave() {
      transport.leave();
    },
  };
}

/** Two linked in-memory transports (for tests and local debugging). */
export function createLinkedTransports() {
  const make = () => ({ handlers: { msg: [], join: [], leave: [] }, other: null, open: true });
  const a = make();
  const b = make();
  a.other = b;
  b.other = a;
  const api = (me) => ({
    send(msg) {
      if (!me.open || !me.other.open) return;
      const copy = JSON.parse(JSON.stringify(msg));
      for (const cb of me.other.handlers.msg) cb(copy);
    },
    onMessage: (cb) => me.handlers.msg.push(cb),
    onPeerJoin: (cb) => me.handlers.join.push(cb),
    onPeerLeave: (cb) => me.handlers.leave.push(cb),
    leave() {
      me.open = false;
      for (const cb of me.other.handlers.leave) cb();
    },
  });
  return {
    a: api(a),
    b: api(b),
    /** Fire peer-join on both ends. */
    connect() {
      for (const cb of a.handlers.join) cb();
      for (const cb of b.handlers.join) cb();
    },
  };
}
