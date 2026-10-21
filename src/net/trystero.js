import { joinRoom } from 'trystero';

const APP_ID = 'tactical-squad-game-v1';

/** Adapt a Trystero room to the session transport interface (2-player rooms). */
export function createTrysteroTransport(roomCode) {
  const room = joinRoom({ appId: APP_ID }, roomCode);
  const action = room.makeAction('msg');
  const handlers = { msg: [], join: [], leave: [] };
  action.onMessage = (data) => handlers.msg.forEach((cb) => cb(data));
  room.onPeerJoin = (id) => handlers.join.forEach((cb) => cb(id));
  room.onPeerLeave = (id) => handlers.leave.forEach((cb) => cb(id));
  return {
    send: (msg) => action.send(msg),
    onMessage: (cb) => handlers.msg.push(cb),
    onPeerJoin: (cb) => handlers.join.push(cb),
    onPeerLeave: (cb) => handlers.leave.push(cb),
    leave: () => room.leave(),
  };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomRoomCode(n = 5) {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % ALPHABET.length]).join('');
}
