// @hibira-io/handoff: send a photo or file from a phone to a desktop page
// (or the other way), paired by a QR code, over one Hibira presence channel.
//
// The desktop page makes a pairing: a random code and an AES-GCM key. The
// QR code holds a link with the code in the query and the key in the
// #fragment, which browsers never send to a server, so Hibira and your auth
// route only ever see ciphertext.
//
// Files go the fastest way open at the time:
//   direct  a WebRTC data channel between the two browsers; Hibira carries
//           only the offer, answer and ICE candidates, as client events.
//   relay   encrypted chunks as client events on the channel, paced under
//           the 10-a-second client event limit. Works on every network.
//
// Nothing is stored anywhere.

export const CHANNEL_PREFIX = 'presence-handoff-';

const DIRECT_CHUNK = 15000;
const SIGNAL_EVENT = 'client-signal';
const DATA_EVENT = 'client-data';
const RATE = 9;
const DEFAULT_RELAY_CHUNK = 2700;
const DEFAULT_ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];

/** A new pairing for the desktop page: { code, key }. */
export function newPairing() {
  return {
    code: b64url(crypto.getRandomValues(new Uint8Array(16))),
    key: b64url(crypto.getRandomValues(new Uint8Array(32))),
  };
}

export function validCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{22}$/.test(code);
}

/** The link for the QR code: base URL plus ?hh=<code> and #hk=<key>. Other query parameters are kept. */
export function pairingLink(base, pairing) {
  const url = new URL(base);
  url.searchParams.set('hh', pairing.code);
  const hash = new URLSearchParams(url.hash.slice(1));
  hash.set('hk', pairing.key);
  url.hash = hash.toString();
  return url.toString();
}

/** The pairing in a link opened from the QR code, or null. */
export function readPairing(href = typeof location !== 'undefined' ? location.href : '') {
  try {
    const url = new URL(href);
    const code = url.searchParams.get('hh') ?? '';
    const key = new URLSearchParams(url.hash.slice(1)).get('hk') ?? '';
    return validCode(code) && unb64url(key).length === 32 ? { code, key } : null;
  } catch {
    return null;
  }
}

/** A short name for a device, like "iPhone · Safari" or "Windows · Edge". */
export function deviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', touch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0) {
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Line\//.test(ua)
        ? 'LINE'
        : /FBAN|FBAV|Instagram/.test(ua)
          ? 'Facebook'
          : /Firefox|FxiOS/.test(ua)
            ? 'Firefox'
            : /OPR\/|Opera/.test(ua)
              ? 'Opera'
              : /Chrome|CriOS/.test(ua)
                ? 'Chrome'
                : /Safari/.test(ua)
                  ? 'Safari'
                  : '';
  return [os, browser].filter(Boolean).join(' · ') || 'Browser';
}

/**
 * One side of a handoff. Subscribes to presence-handoff-<code> with the
 * pusher-js client you pass; your auth endpoint signs it (see ./server).
 */
export class Handoff {
  constructor(opts) {
    this.o = opts;
    this.peer = null;
    this.transport = 'relay';
    this.pc = null;
    this.dc = null;
    this.queue = [];
    this.tokens = RATE;
    this.inbox = new Map();
    this.closed = false;
    this.signals = Promise.resolve();
    this.keyPromise = importKey(opts.key);
    this.timer = setInterval(() => {
      this.tokens = RATE;
      this.drain();
    }, 1000);
    const ch = opts.pusher.subscribe(CHANNEL_PREFIX + opts.code);
    this.channel = ch;
    ch.bind('pusher:subscription_succeeded', () => {
      ch.members.each((m) => {
        if (m.id !== ch.members.me?.id) this.setPeer({ id: m.id, ...(m.info ?? {}) });
      });
    });
    ch.bind('pusher:subscription_error', (e) => opts.onRefused?.(e));
    ch.bind('pusher:member_added', (m) => this.setPeer({ id: m.id, ...(m.info ?? {}) }));
    ch.bind('pusher:member_removed', (m) => {
      if (this.peer?.id === m.id) this.setPeer(null);
    });
    ch.bind(SIGNAL_EVENT, (d) => {
      const f = this.open(d?.d);
      this.signals = this.signals
        .then(() => f)
        .then((x) => (x ? this.signal(x.head) : undefined))
        .catch(() => {});
    });
    ch.bind(DATA_EVENT, (d) => this.open(d?.d).then((f) => f && this.frame(f.head, f.body, 'relay')));
  }

  /**
   * Sends a Blob or File. `preview` is an optional tiny data: URL shown on
   * the other side while the rest arrives. Resolves when the last byte has
   * left this browser.
   */
  async send(blob, { name = blob.name ?? 'file', preview = '' } = {}) {
    const id = b64url(crypto.getRandomValues(new Uint8Array(6)));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const direct = this.dc?.readyState === 'open';
    const size = direct ? DIRECT_CHUNK : (this.o.relayChunk ?? DEFAULT_RELAY_CHUNK);
    const n = Math.max(1, Math.ceil(bytes.length / size));
    await this.post({ t: 'start', id, name, type: blob.type, size: bytes.length, n, preview });
    for (let i = 0; i < n; i++) {
      await this.post({ t: 'chunk', id, i }, bytes.subarray(i * size, (i + 1) * size));
    }
    return id;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.pc?.close();
    this.o.pusher.unsubscribe(this.channel.name);
  }

  setPeer(peer) {
    this.peer = peer;
    this.pc?.close();
    this.pc = null;
    this.dc = null;
    this.o.onPeer?.(peer);
    this.setTransport('relay');
    if (peer && this.o.role === 'desk' && this.o.webrtc !== false && typeof RTCPeerConnection !== 'undefined') this.connect(true);
  }

  setTransport(t) {
    if (this.transport === t) return;
    this.transport = t;
    this.o.onTransport?.(t);
  }

  connect(offerer) {
    const pc = new RTCPeerConnection({ iceServers: this.o.iceServers ?? DEFAULT_ICE });
    this.pc = pc;
    pc.onicecandidate = (e) => e.candidate && this.whisper({ t: 'ice', c: e.candidate.toJSON() });
    const use = (dc) => {
      dc.binaryType = 'arraybuffer';
      dc.onopen = () => {
        if (this.pc !== pc) return;
        this.dc = dc;
        this.setTransport('direct');
      };
      dc.onclose = () => {
        if (this.dc === dc) {
          this.dc = null;
          this.setTransport('relay');
        }
      };
      dc.onmessage = (e) => this.decrypt(new Uint8Array(e.data)).then((f) => f && this.frame(f.head, f.body, 'direct'));
    };
    if (offerer) {
      use(pc.createDataChannel('files', { ordered: true }));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => this.whisper({ t: 'sdp', d: pc.localDescription }))
        .catch(() => {});
    } else {
      pc.ondatachannel = (e) => use(e.channel);
    }
  }

  async signal(m) {
    if (m.t === 'sdp') {
      if (m.d?.type === 'offer') {
        if (this.o.webrtc === false || typeof RTCPeerConnection === 'undefined') return;
        this.connect(false);
      }
      const pc = this.pc;
      if (!pc) return;
      await pc.setRemoteDescription(m.d);
      if (m.d.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        this.whisper({ t: 'sdp', d: pc.localDescription });
      }
    } else if (m.t === 'ice') {
      await this.pc?.addIceCandidate(m.c).catch(() => {});
    }
  }

  frame(head, body, via) {
    const id = String(head.id ?? '');
    if (head.t === 'start') {
      const n = Number(head.n);
      const max = this.o.maxBytes ?? 25 * 1024 * 1024;
      if (!(n > 0 && n < 100000) || !(Number(head.size) <= max)) return;
      this.inbox.set(id, { n, got: 0, parts: new Array(n), type: String(head.type ?? ''), name: String(head.name ?? '') });
      this.o.onIncoming?.({ id, name: String(head.name ?? ''), type: String(head.type ?? ''), size: Number(head.size), preview: String(head.preview ?? ''), via });
    } else if (head.t === 'chunk') {
      const f = this.inbox.get(id);
      const i = Number(head.i);
      if (!f || !(i >= 0 && i < f.n) || f.parts[i]) return;
      f.parts[i] = body;
      f.got++;
      this.o.onProgress?.(id, f.got / f.n);
      if (f.got === f.n) {
        this.inbox.delete(id);
        this.o.onFile?.({ id, name: f.name, type: f.type, blob: new Blob(f.parts, { type: f.type }) });
      }
    }
  }

  async post(head, body = new Uint8Array()) {
    const sealed = await this.seal(head, body);
    const dc = this.dc;
    if (dc?.readyState === 'open') {
      while (dc.bufferedAmount > 1 << 20) await new Promise((r) => setTimeout(r, 20));
      dc.send(sealed);
      return;
    }
    await this.paced(() => this.channel.trigger(DATA_EVENT, { d: b64url(sealed) }));
  }

  whisper(head) {
    this.seal(head, new Uint8Array()).then((sealed) => this.paced(() => this.channel.trigger(SIGNAL_EVENT, { d: b64url(sealed) })));
  }

  paced(send) {
    return new Promise((resolve) => {
      this.queue.push(() => {
        if (!this.closed) send();
        resolve();
      });
      this.drain();
    });
  }

  drain() {
    while (this.tokens > 0 && this.queue.length) {
      this.tokens--;
      this.queue.shift()();
    }
  }

  // A frame is [4-byte header length][header JSON][body], sealed with
  // AES-GCM and a fresh 12-byte IV in front.
  async seal(head, body) {
    const h = new TextEncoder().encode(JSON.stringify(head));
    const plain = new Uint8Array(4 + h.length + body.length);
    new DataView(plain.buffer).setUint32(0, h.length);
    plain.set(h, 4);
    plain.set(body, 4 + h.length);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.keyPromise, plain));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }

  open(data) {
    try {
      return this.decrypt(unb64url(String(data)));
    } catch {
      return Promise.resolve(null);
    }
  }

  async decrypt(sealed) {
    try {
      const plain = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12) }, await this.keyPromise, sealed.subarray(12)),
      );
      const len = new DataView(plain.buffer).getUint32(0);
      return { head: JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + len))), body: plain.subarray(4 + len) };
    } catch {
      return null;
    }
  }
}

/** Starts one side of a handoff; see Handoff. */
export function createHandoff(opts) {
  return new Handoff(opts);
}

// Photos are shrunk before they leave the phone: a 12-megapixel shot is 3
// to 5 MB, while 1600 pixels on the long side is plenty for a receipt.
const SIZES = { full: { side: 1600, quality: 0.82 }, small: { side: 1200, quality: 0.72 } };

/** A JPEG of an image, video frame or canvas, at most `size` on the long side, with a 40-pixel preview. */
export async function shrinkImage(src, width, height, size = 'full') {
  const { side, quality } = SIZES[size] ?? SIZES.full;
  const scale = Math.min(1, side / Math.max(width, height));
  const canvas = draw(src, Math.round(width * scale), Math.round(height * scale));
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality),
  );
  const t = 40 / Math.max(width, height);
  const preview = draw(src, Math.max(1, Math.round(width * t)), Math.max(1, Math.round(height * t))).toDataURL('image/jpeg', 0.5);
  return { blob, preview };
}

/** shrinkImage for a picked image file, upright as the gallery shows it. Other files pass through. */
export async function shrinkFile(file, size = 'full') {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return { blob: file, preview: '' };
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return await shrinkImage(bitmap, bitmap.width, bitmap.height, size);
  } finally {
    bitmap.close();
  }
}

function draw(src, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(src, 0, 0, w, h);
  return canvas;
}

async function importKey(key) {
  const raw = unb64url(key);
  if (raw.length !== 32) throw new Error('handoff: bad key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
