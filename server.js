// Server side of @hibira-io/handoff: sign a subscription to
// presence-handoff-<code> in your auth route, with two seats (the desktop
// page and one phone). Works with the `pusher` Node SDK pointed at Hibira.

export const CHANNEL_PREFIX = 'presence-handoff-';
const ROLES = new Set(['desk', 'phone']);

/** Whether `channel` is a handoff channel name. */
export function isHandoffChannel(channel) {
  return typeof channel === 'string' && channel.startsWith(CHANNEL_PREFIX) && /^[A-Za-z0-9_-]{22}$/.test(channel.slice(CHANNEL_PREFIX.length));
}

/**
 * Signs a handoff subscription, or returns null when it must be refused
 * (not a handoff channel, unknown role, or two members already there).
 *
 *   const auth = await authorizeHandoff(pusher, { socketId, channel, userId, role, device });
 *   return auth ? Response.json(auth) : new Response('forbidden', { status: 403 });
 *
 * `userId` should come from your session when the page has a signed-in
 * user; the phone side has none, so a random ID from the page is fine.
 */
export async function authorizeHandoff(pusher, { socketId, channel, userId, role, device = '' }) {
  if (!isHandoffChannel(channel) || !userId || !ROLES.has(role)) return null;
  const res = await pusher.get({ path: `/channels/${encodeURIComponent(channel)}`, params: { info: 'user_count' } });
  const info = res.ok ? await res.json() : {};
  if ((info.user_count ?? 0) >= 2) return null;
  const name = String(device).replace(/[^\w .·-]/g, '').trim().slice(0, 40);
  return pusher.authorizeChannel(socketId, channel, { user_id: String(userId).slice(0, 64), user_info: { role, device: name } });
}
