import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { hashWorld } from '../src/sim/world.js';
import { createMatch } from '../src/game/match.js';
import { createAI } from '../src/ai/planner.js';
import { createSession, createLinkedTransports, shouldAdopt } from '../src/net/session.js';
import { sha256 } from '../src/net/sha256.js';
import killhouse from '../src/maps/killhouse.js';

beforeAll(() => initPhysics());

describe('sha256', () => {
  it('matches known vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

/** Two full clients talking through linked in-memory transports, each "player" driven by an AI. */
function playOnline({ tamper = false } = {}) {
  const link = createLinkedTransports();
  const peers = {};
  const events = [];
  for (const [side, transport, isHost] of [
    ['host', link.a, true],
    ['guest', link.b, false],
  ]) {
    const p = { side, match: null, ai: null };
    p.session = createSession({
      transport,
      isHost,
      onEvent: (e) => {
        events.push({ side, ...e });
        if (e.type === 'start') {
          p.match = createMatch({ mode: 'online', mapDef: killhouse, seed: e.seed, squads: e.squads, localTeam: e.localTeam });
          p.ai = createAI(e.localTeam, 7);
        } else if (e.type === 'plans') p.match.setRemotePlans(e.team, e.plans);
      },
    });
    peers[side] = p;
  }
  link.connect();
  peers.host.session.ready(['breacher', 'rifleman', 'lmg', 'sniper']);
  peers.guest.session.ready(['sniper', 'lmg', 'rifleman', 'rifleman']);

  if (tamper) {
    // Guest's outgoing reveal gets altered in flight → host must flag it.
    const send = link.b.send;
    link.b.send = (msg) => send(msg.t === 'reveal' ? { ...msg, payload: msg.payload.replace(/"walk"/, '"run"') } : msg);
  }

  const hashes = [];
  let turns = 0;
  while (peers.host.match.phase !== 'over' && turns < 40) {
    turns++;
    for (const p of Object.values(peers)) p.match.beginTurn();
    // Both plan (AI stands in for the human), commit and confirm.
    for (const p of Object.values(peers)) {
      const team = p.session.localTeam;
      const { plans } = p.ai.plan(p.match.world);
      p.match.drafts[team] = p.session.commit(p.match.turn, plans);
      p.match.confirm();
    }
    for (const p of Object.values(peers)) {
      if (p.match.phase !== 'simulating') break;
      while (p.match.stepSim()) {
        p.ai.observe(p.match.world);
        if (p.match.phase !== 'simulating') break;
      }
      p.session.sendState(p.match.turn, hashWorld(p.match.world));
    }
    if (peers.host.match.phase === 'waiting') break;
    hashes.push([hashWorld(peers.host.match.world), hashWorld(peers.guest.match.world)]);
  }
  return { peers, events, hashes, turns };
}

describe('online lockstep', () => {
  it('two peers simulate identical games from exchanged plans', () => {
    const { peers, events, hashes } = playOnline();
    expect(events.filter((e) => e.type === 'start')).toHaveLength(2);
    expect(events.some((e) => e.type === 'desync' || e.type === 'cheat')).toBe(false);
    expect(hashes.length).toBeGreaterThan(1);
    for (const [h, g] of hashes) expect(g).toBe(h);
    expect(peers.host.match.world.winner).toBe(peers.guest.match.world.winner);
    expect(peers.host.match.world.winner).not.toBeNull();
  });

  it('host and guest use the agreed squads on the right teams', () => {
    const { peers } = playOnline();
    const roles = (m, t) => m.world.soldiers.filter((s) => s.team === t).map((s) => s.role);
    for (const p of Object.values(peers)) {
      expect(roles(p.match, 'A')).toEqual(['breacher', 'rifleman', 'lmg', 'sniper']);
      expect(roles(p.match, 'B')).toEqual(['sniper', 'lmg', 'rifleman', 'rifleman']);
    }
    expect(peers.host.session.localTeam).toBe('A');
    expect(peers.guest.session.localTeam).toBe('B');
  });

  it('a reveal that does not match its commit is rejected', () => {
    const { events, peers } = playOnline({ tamper: true });
    expect(events.some((e) => e.type === 'cheat' && e.side === 'host')).toBe(true);
    expect(peers.host.match.phase).toBe('waiting'); // host never accepts the forged plan
  });
});

/** Hub whose guest end can be replaced, to simulate a guest reloading the page. */
function createHub() {
  const ends = {};
  const other = (role) => ends[role === 'host' ? 'guest' : 'host'];
  const endpoint = (role) => {
    const h = { msg: [], join: [], leave: [] };
    const ep = {
      h,
      open: true,
      api: {
        send(msg) {
          const o = other(role);
          if (!ep.open || !o?.open) return;
          const copy = JSON.parse(JSON.stringify(msg));
          for (const cb of o.h.msg) cb(copy);
        },
        onMessage: (cb) => h.msg.push(cb),
        onPeerJoin: (cb) => h.join.push(cb),
        onPeerLeave: (cb) => h.leave.push(cb),
        leave() {
          ep.open = false;
          for (const cb of other(role)?.h.leave ?? []) cb();
        },
      },
    };
    ends[role] = ep;
    return ep.api;
  };
  return {
    ends,
    host: () => endpoint('host'),
    guest: () => endpoint('guest'),
    /** The link dies: both sides see the peer leave. */
    drop() {
      for (const role of ['host', 'guest']) ends[role].open = false;
      for (const role of ['host', 'guest']) for (const cb of ends[role].h.leave) cb();
    },
    connect() {
      for (const cb of ends.host.h.join) cb();
      for (const cb of ends.guest.h.join) cb();
    },
  };
}

/**
 * A client that reacts to session events the way main.js does: start / plans,
 * `sync` on (re)connect, adopt the longer history, then recommit.
 */
function mkClient(name, transport, isHost, { fastForward, saved = null } = {}) {
  const p = { name, match: null, ai: null };
  const rebuild = (info, localTeam) => {
    p.match = createMatch({ mode: 'online', mapDef: killhouse, mapId: 'killhouse', seed: info.seed, squads: info.squads, localTeam });
    p.ai = createAI(localTeam, 3);
    fastForward(p.match, info.history);
  };
  p.info = () => ({ seed: p.match.seed, squads: p.match.squads, map: 'killhouse', mode: 'elimination', history: p.match.history });
  p.session = createSession({
    transport,
    isHost,
    onEvent: (e) => {
      if (e.type === 'start') rebuild({ ...e, history: [] }, e.localTeam);
      else if (e.type === 'plans') p.match.setRemotePlans(e.team, e.plans);
      else if (e.type === 'peerJoined' && p.match) p.session.sync(p.info());
      else if (e.type === 'sync') {
        if (shouldAdopt(p.match && { seed: p.match.seed, history: p.match.history }, e)) {
          rebuild(e, e.localTeam);
          p.adopted = (p.adopted ?? 0) + 1;
        }
        p.session.recommit(p.match.turn);
      } else if (e.type === 'desync') p.desync = e;
      else if (e.type === 'cheat') p.cheat = e;
    },
  });
  if (saved) {
    // Reloaded page: restore from storage before the peer is back.
    p.session.markStarted();
    rebuild(saved, isHost ? 'A' : 'B');
  }
  return p;
}

const planAndCommit = (p) => {
  if (p.match.phase !== 'planning') return;
  const { plans } = p.ai.plan(p.match.world);
  p.match.drafts[p.session.localTeam] = p.session.commit(p.match.turn, plans);
  p.match.confirm();
};
const finishTurn = (p) => {
  while (p.match.stepSim()) {
    p.ai.observe(p.match.world);
    if (p.match.phase !== 'simulating') break;
  }
  if (p.match.phase === 'turnEnd' || p.match.phase === 'over') p.session.sendState(p.match.turn, hashWorld(p.match.world));
};
/** Next turn for anyone between turns (a freshly rebuilt client ends in turnEnd). */
const nextTurn = (p) => {
  if (p.match.phase === 'turnEnd' || p.match.phase === 'idle') p.match.beginTurn();
};
function playToEnd(host, guest) {
  while (host.match.phase !== 'over' && host.match.turn < 40) {
    for (const p of [host, guest]) nextTurn(p);
    for (const p of [host, guest]) planAndCommit(p);
    for (const p of [host, guest]) finishTurn(p);
    expect(hashWorld(guest.match.world)).toBe(hashWorld(host.match.world));
  }
  expect(host.desync ?? guest.desync ?? host.cheat ?? guest.cheat).toBeUndefined();
  expect(guest.match.world.winner).toBe(host.match.world.winner);
}

describe('online reconnect', () => {
  let fastForward;
  beforeAll(async () => {
    ({ fastForward } = await import('../src/game/replay.js'));
  });

  function startPair() {
    const hub = createHub();
    const host = mkClient('host', hub.host(), true, { fastForward });
    const guest = mkClient('guest', hub.guest(), false, { fastForward });
    hub.connect();
    host.session.ready(['breacher', 'rifleman', 'lmg', 'sniper']);
    guest.session.ready(['breacher', 'rifleman', 'lmg', 'sniper']);
    for (let t = 0; t < 3; t++) {
      for (const p of [host, guest]) nextTurn(p);
      for (const p of [host, guest]) planAndCommit(p);
      for (const p of [host, guest]) finishTurn(p);
    }
    expect(host.match.phase).not.toBe('over');
    return { hub, host, guest };
  }

  it('a guest whose page dies mid-turn rejoins with nothing and is caught up by the host', () => {
    const { hub, host, guest: oldGuest } = startPair();
    // Turn 4: host commits, then the guest's page dies before it commits.
    for (const p of [host, oldGuest]) nextTurn(p);
    planAndCommit(host);
    expect(host.match.phase).toBe('waiting');
    oldGuest.session.leave();

    const guest = mkClient('guest2', hub.guest(), false, { fastForward });
    hub.connect();
    expect(guest.adopted).toBe(1);
    expect(hashWorld(guest.match.world)).toBe(hashWorld(host.match.world));
    nextTurn(guest);
    expect(guest.match.turn).toBe(4);
    planAndCommit(guest);
    expect(host.match.phase).toBe('simulating');
    for (const p of [host, guest]) finishTurn(p);
    playToEnd(host, guest);
  });

  it('a host that reloads restores its saved match and both carry on', () => {
    const { hub, host: oldHost, guest } = startPair();
    for (const p of [oldHost, guest]) nextTurn(p);
    planAndCommit(guest); // guest already pressed GO for turn 4
    const saved = structuredClone(oldHost.info()); // what main.js keeps in localStorage
    oldHost.session.leave();

    const host = mkClient('host2', hub.host(), true, { fastForward, saved });
    hub.connect();
    expect(host.adopted ?? 0).toBe(0); // same history length: nothing to adopt
    expect(guest.adopted ?? 0).toBe(0);
    nextTurn(host);
    expect(host.match.turn).toBe(4);
    planAndCommit(host); // guest's GO was re-sent on reconnect, so this starts the turn
    expect(host.match.phase).toBe('simulating');
    expect(guest.match.phase).toBe('simulating');
    for (const p of [host, guest]) finishTurn(p);
    playToEnd(host, guest);
  });

  it('a dropped connection that swallowed a reveal recovers when both rejoin', () => {
    const { hub, host, guest } = startPair();
    for (const p of [host, guest]) nextTurn(p);
    // The guest's reveal never reaches the host, then the link drops.
    const realGuestEnd = hub.ends.guest;
    const origSend = realGuestEnd.api.send;
    realGuestEnd.api.send = (msg) => msg.t !== 'reveal' && origSend(msg);
    planAndCommit(host);
    planAndCommit(guest);
    expect(guest.match.phase).toBe('simulating'); // guest got the host's plans
    expect(host.match.phase).toBe('waiting'); // host never got the guest's
    finishTurn(guest);
    hub.drop();

    // Both sides rejoin the room through fresh connections.
    host.session.useTransport(() => hub.host());
    guest.session.useTransport(() => hub.guest());
    hub.connect();
    // The guest's re-sent GO (commit + reveal) gives the host the missing plan: it plays turn 4.
    expect(host.match.phase).toBe('simulating');
    finishTurn(host);
    expect(hashWorld(host.match.world)).toBe(hashWorld(guest.match.world));
    playToEnd(host, guest);
  });
});
