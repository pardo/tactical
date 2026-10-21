import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { hashWorld } from '../src/sim/world.js';
import { createMatch } from '../src/game/match.js';
import { createAI } from '../src/ai/planner.js';
import { createSession, createLinkedTransports } from '../src/net/session.js';
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
