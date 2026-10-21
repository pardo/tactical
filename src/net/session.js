import { sha256 } from './sha256.js';
import { sanitizeSquad } from '../sim/roles.js';

export const PROTOCOL_VERSION = 1;

const randomToken = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36)).join('');

/**
 * Two-player online session over any transport, lockstep style: only plans
 * travel, and both peers run the deterministic sim.
 *
 *   lobby:  both send `ready {squad}` → host sends `start {seed, squads, map, mode}`
 *   turn:   each sends `commit {turn, hash}` on GO; once a peer has both
 *           commits it sends `reveal {turn, payload, salt}`. Committing a hash
 *           first means nobody can read the other plan and then change theirs.
 *   check:  after each turn both send `state {turn, hash}` of the world.
 *   rejoin: if the guest reconnects mid-match the host sends `resume {seed,
 *           squads, map, mode, history}` and re-sends its pending commit; the
 *           guest re-simulates the history (deterministic) and carries on.
 *
 * transport: { send(msg), onMessage(cb), onPeerJoin(cb), onPeerLeave(cb), leave() }
 * onEvent receives { type: 'peerJoined' | 'peerLeft' | 'start' | 'remoteCommitted'
 *   | 'plans' | 'desync' | 'cheat' | 'versionMismatch', ... }
 */
export function createSession({ transport, isHost, onEvent }) {
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

  transport.onPeerJoin(() => {
    peer = true;
    onEvent({ type: 'peerJoined' });
    if (localSquad) transport.send({ t: 'ready', v: PROTOCOL_VERSION, squad: localSquad });
  });
  transport.onPeerLeave(() => {
    peer = false;
    onEvent({ type: 'peerLeft' });
  });

  transport.onMessage((msg) => {
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
      case 'state':
        turnState(msg.turn).remoteState = String(msg.hash);
        return compareState(msg.turn);
      case 'resume':
        if (isHost) return;
        started = true;
        return onEvent({
          type: 'resume',
          seed: msg.seed >>> 0,
          squads: { A: sanitizeSquad(msg.squads?.A), B: sanitizeSquad(msg.squads?.B) },
          map: String(msg.map ?? ''),
          mode: String(msg.mode ?? ''),
          history: Array.isArray(msg.history) ? msg.history : [],
          localTeam,
        });
    }
  });

  return {
    localTeam,
    remoteTeam,
    get connected() {
      return peer;
    },

    /** @param opts host only: { map, mode, timer } sent to the guest with `start` */
    ready(squad, opts = {}) {
      localSquad = sanitizeSquad(squad);
      options = { map: opts.map, mode: opts.mode, timer: opts.timer };
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

    /** Host: bring a reconnected guest up to date (see `rejoin` above). */
    resume({ seed, squads, map, mode, history, turn }) {
      transport.send({ t: 'resume', seed, squads, map, mode, history });
      // Forget the old guest's commit for the current turn and re-announce ours.
      const ts = turns.get(turn);
      if (!ts) return;
      ts.remote = undefined;
      ts.revealed = false;
      if (ts.local) transport.send({ t: 'commit', turn, hash: sha256(`${ts.local.payload}|${ts.local.salt}`) });
    },

    sendState(turn, hash) {
      turnState(turn).localState = hash;
      transport.send({ t: 'state', turn, hash });
      compareState(turn);
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
