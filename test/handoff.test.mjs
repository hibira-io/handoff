import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Handoff, deviceName, newPairing, pairingLink, readPairing, validCode } from '../index.js';

// An in-memory stand-in for pusher-js presence channels: client events go to
// every other member, as on a real server.
function fakeServer() {
  const channels = new Map();
  let next = 0;
  return {
    client(info) {
      const id = String(++next);
      return {
        subscribe(name) {
          const members = channels.get(name) ?? new Map();
          channels.set(name, members);
          const handlers = {};
          const ch = {
            name,
            bind: (ev, fn) => ((handlers[ev] ??= []).push(fn)),
            emit: (ev, data) => (handlers[ev] ?? []).forEach((fn) => fn(data)),
            trigger: (ev, data) => {
              for (const [mid, other] of members) if (mid !== id) setTimeout(() => other.emit(ev, structuredClone(data)));
            },
            members: {
              me: { id },
              each: (fn) => [...members.values()].forEach((m) => fn({ id: m.mid, info: m.info })),
            },
            mid: id,
            info,
          };
          for (const other of members.values()) setTimeout(() => other.emit('pusher:member_added', { id, info }));
          members.set(id, ch);
          setTimeout(() => ch.emit('pusher:subscription_succeeded'));
          return ch;
        },
        unsubscribe(name) {
          const members = channels.get(name);
          members?.delete(id);
          for (const other of members?.values() ?? []) other.emit('pusher:member_removed', { id });
        },
      };
    },
  };
}

function pair(opts = {}) {
  const server = fakeServer();
  const pairing = newPairing();
  const events = { desk: [], phone: [] };
  const make = (role) =>
    new Handoff({
      pusher: server.client({ role, device: role === 'desk' ? 'Mac · Chrome' : 'iPhone · Safari' }),
      ...pairing,
      role,
      webrtc: false,
      ...opts,
      onPeer: (p) => events[role].push(['peer', p]),
      onIncoming: (f) => events[role].push(['incoming', f]),
      onProgress: (id, r) => events[role].push(['progress', r]),
      onFile: (f) => events[role].push(['file', f]),
    });
  return { pairing, events, make };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('pairing codes and links round-trip', () => {
  const p = newPairing();
  assert.ok(validCode(p.code));
  assert.equal(p.key.length, 43);
  const link = pairingLink('https://shop.example/claim?step=2#top', p);
  assert.ok(link.includes('step=2'));
  assert.ok(!new URL(link).search.includes(p.key), 'key stays out of the query');
  assert.deepEqual(readPairing(link), p);
  assert.equal(readPairing('https://shop.example/claim'), null);
  assert.equal(readPairing(`https://x/?hh=${p.code}#hk=short`), null);
  assert.equal(readPairing('not a url'), null);
});

test('device names', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const line = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Line/14.0.0';
  assert.equal(deviceName(iphone, 5), 'iPhone · Safari');
  assert.equal(deviceName(edge, 0), 'Windows · Edge');
  assert.equal(deviceName(ipad, 5), 'iPad · Safari');
  assert.equal(deviceName(ipad, 0), 'Mac · Safari');
  assert.equal(deviceName(line, 5), 'Android · LINE');
  assert.equal(deviceName('', 0), 'Browser');
});

test('a file crosses the relay, encrypted, in chunks', async () => {
  const { events, make } = pair({ relayChunk: 1000 });
  const desk = make('desk');
  const phone = make('phone');
  await wait(20);
  assert.equal(events.desk.find((e) => e[0] === 'peer')[1].device, 'iPhone · Safari');
  assert.equal(events.phone.find((e) => e[0] === 'peer')[1].role, 'desk');

  const bytes = crypto.getRandomValues(new Uint8Array(4500));
  const id = await phone.send(new Blob([bytes], { type: 'image/jpeg' }), { name: 'receipt.jpg', preview: 'data:image/jpeg;base64,AA' });
  await wait(50);
  const incoming = events.desk.find((e) => e[0] === 'incoming')[1];
  assert.deepEqual(incoming, { id, name: 'receipt.jpg', type: 'image/jpeg', size: 4500, preview: 'data:image/jpeg;base64,AA', via: 'relay' });
  assert.equal(events.desk.filter((e) => e[0] === 'progress').length, 5);
  const file = events.desk.find((e) => e[0] === 'file')[1];
  assert.deepEqual(new Uint8Array(await file.blob.arrayBuffer()), bytes);
  assert.equal(file.blob.type, 'image/jpeg');
  desk.close();
  phone.close();
});

test('relay stays under 10 client events a second', async () => {
  const { events, make } = pair({ relayChunk: 100 });
  const desk = make('desk');
  const phone = make('phone');
  await wait(20);
  const started = Date.now();
  await phone.send(new Blob([new Uint8Array(1500)]), { name: 'a.bin' });
  assert.ok(Date.now() - started >= 900, '16 events need a second wait');
  await wait(50);
  assert.ok(events.desk.some((e) => e[0] === 'file'));
  desk.close();
  phone.close();
});

test('a wrong key or a too-large file is ignored', async () => {
  const { events, make, pairing } = pair({ maxBytes: 1000 });
  const desk = make('desk');
  const phone = make('phone');
  await wait(20);
  await phone.send(new Blob([new Uint8Array(2000)]), { name: 'big.bin' });
  await wait(30);
  assert.equal(events.desk.filter((e) => e[0] !== 'peer').length, 0);

  desk.channel.emit('client-data', { d: 'garbage' });
  const stranger = new Handoff({ pusher: phone.o.pusher, code: pairing.code, key: newPairing().key, role: 'phone', webrtc: false });
  await stranger.send(new Blob([new Uint8Array(10)]), { name: 'x.bin' });
  await wait(30);
  assert.equal(events.desk.filter((e) => e[0] !== 'peer' && e[0] !== 'progress').length, 0);
  stranger.close();
  desk.close();
  phone.close();
});

test('the peer leaving is reported', async () => {
  const { events, make } = pair();
  const desk = make('desk');
  const phone = make('phone');
  await wait(20);
  phone.close();
  assert.deepEqual(events.desk.at(-1), ['peer', null]);
  desk.close();
});
