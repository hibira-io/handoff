import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeHandoff, isHandoffChannel } from '../server.js';

const CODE = 'AAAAAAAAAAAAAAAAAAAAAA';

function fakePusher(userCount) {
  const calls = [];
  return {
    calls,
    async get(opts) {
      calls.push(opts);
      return { ok: true, json: async () => ({ user_count: userCount }) };
    },
    authorizeChannel: (socketId, channel, data) => ({ auth: `${socketId}:${channel}`, channel_data: JSON.stringify(data) }),
  };
}

test('channel names', () => {
  assert.ok(isHandoffChannel(`presence-handoff-${CODE}`));
  assert.ok(!isHandoffChannel(`presence-handoff-${CODE}x`));
  assert.ok(!isHandoffChannel(`presence-chat-${CODE}`));
  assert.ok(!isHandoffChannel(undefined));
});

test('signs the first two members with role and a clean device name', async () => {
  const p = fakePusher(1);
  const auth = await authorizeHandoff(p, { socketId: '1.2', channel: `presence-handoff-${CODE}`, userId: 'u1', role: 'phone', device: 'iPhone · Safari<script>' });
  assert.deepEqual(JSON.parse(auth.channel_data), { user_id: 'u1', user_info: { role: 'phone', device: 'iPhone · Safariscript' } });
  assert.equal(p.calls[0].params.info, 'user_count');
});

test('refuses a third member, a bad role or a bad channel', async () => {
  const base = { socketId: '1.2', channel: `presence-handoff-${CODE}`, userId: 'u1', role: 'desk' };
  assert.equal(await authorizeHandoff(fakePusher(2), base), null);
  assert.equal(await authorizeHandoff(fakePusher(0), { ...base, role: 'admin' }), null);
  assert.equal(await authorizeHandoff(fakePusher(0), { ...base, channel: 'presence-other' }), null);
  assert.equal(await authorizeHandoff(fakePusher(0), { ...base, userId: '' }), null);
});
