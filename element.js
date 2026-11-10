// <hibira-handoff>: a drop-in "take a photo with your phone" button for any
// form. On the computer it shows a QR code; the phone that scans it opens
// the same page (or `phone-url`), where the element turns into a full-screen
// camera. Photos land back in the <input type="file"> named by `for`.
//
//   <input type="file" id="receipt" accept="image/*">
//   <hibira-handoff for="#receipt" key="APP_KEY" auth="/hibira/auth"></hibira-handoff>
//   <script src="https://cdn.jsdelivr.net/npm/@hibira-io/handoff/dist/element.js"></script>
import Pusher from 'pusher-js';
import QRCode from 'qrcode';
import { createHandoff, deviceName, newPairing, pairingLink, readPairing, shrinkFile, shrinkImage } from './index.js';
import { strings } from './strings.js';

const CSS = `
:host { display: block; font: inherit; color: inherit; --hh-accent: #5b4bff; --hh-ok: #12a46b; --hh-border: rgba(127,127,127,.3); }
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
.open { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--hh-border); background: transparent; color: inherit; }
.open svg, .icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.card { margin-top: 8px; padding: 14px; border: 1px solid var(--hh-border); border-radius: 12px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.qr { width: 148px; height: 148px; background: #fff; padding: 6px; border-radius: 8px; flex: none; }
.qr svg { width: 100%; height: 100%; display: block; }
.text { flex: 1; min-width: 180px; }
.text p { margin: 4px 0; }
.muted { opacity: .7; font-size: .9em; }
.badge { display: inline-block; font-size: .75em; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--hh-border); margin-right: 4px; cursor: help; }
.direct { color: var(--hh-ok); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--hh-ok); margin-right: 6px; }
.thumbs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.thumbs img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; animation: in .6s cubic-bezier(.2,.9,.25,1.15) both; }
.thumbs img.blur { filter: blur(4px); }
@keyframes in { from { opacity: 0; transform: translateY(-30px) scale(.4) rotate(10deg); } to { transform: none; } }
.phone { position: fixed; inset: 0; z-index: 2147483647; background: #000; color: #fff; display: flex; flex-direction: column; }
.status { display: flex; align-items: center; gap: 8px; padding: 12px 16px; font-size: .9rem; flex-wrap: wrap; }
.status .dot.off { background: #c98a00; }
.view { position: relative; flex: 1; overflow: hidden; display: grid; place-items: center; }
.view video { width: 100%; height: 100%; object-fit: cover; }
.view p { padding: 24px; text-align: center; opacity: .8; }
.flash { position: absolute; inset: 0; background: #fff; animation: flash .35s ease-out forwards; pointer-events: none; }
@keyframes flash { from { opacity: .85; } to { opacity: 0; } }
.fly { position: absolute; inset: 12%; width: 76%; height: 76%; object-fit: cover; border-radius: 14px; animation: fly .85s cubic-bezier(.5,0,.75,0) forwards; pointer-events: none; }
@keyframes fly { 25% { transform: scale(.82) translateY(4%); } 100% { transform: scale(.3) translateY(-260%) rotate(-10deg); opacity: .2; } }
.controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 18px 24px calc(18px + env(safe-area-inset-bottom)); gap: 12px; }
.icon { width: 46px; height: 46px; border-radius: 50%; border: none; background: rgba(255,255,255,.14); color: #fff; display: grid; place-items: center; padding: 0; -webkit-tap-highlight-color: transparent; }
.shutter { width: 74px; height: 74px; border-radius: 50%; border: 4px solid #fff; background: #fff; box-shadow: inset 0 0 0 3px #000; padding: 0; -webkit-tap-highlight-color: transparent; }
.shutter:active:not(:disabled) { transform: scale(.92); }
button:disabled { opacity: .45; cursor: default; }
.card .copy { display: inline-grid; width: 28px; height: 28px; vertical-align: middle; background: transparent; color: inherit; border: 1px solid var(--hh-border); }
.card .copy svg { width: 14px; height: 14px; }
.card .copy.done { color: var(--hh-ok); border-color: var(--hh-ok); }
.sent { justify-self: end; text-align: right; font-size: .85rem; opacity: .8; }
@media (prefers-reduced-motion: reduce) { .thumbs img, .fly { animation-duration: .01s; } }
`;

const PHONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const GALLERY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>';

let phoneTaken = false;

export class HibiraHandoff extends HTMLElement {
  connectedCallback() {
    this.t = strings(this.getAttribute('lang') || document.documentElement.lang || navigator.language);
    this.root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const pairing = readPairing();
    if (pairing && !phoneTaken) {
      phoneTaken = true;
      this.phone(pairing);
    } else {
      this.desk();
    }
  }

  disconnectedCallback() {
    this.handoff?.close();
    this.pusher?.disconnect();
    this.stream?.getTracks().forEach((tr) => tr.stop());
  }

  client(role) {
    const host = this.getAttribute('host') || 'ws.hibira.io';
    const port = Number(this.getAttribute('port') || 443);
    const tls = this.getAttribute('tls') !== 'false';
    this.pusher = new Pusher(this.getAttribute('key') || '', {
      cluster: 'hkg',
      wsHost: host,
      wsPort: port,
      wssPort: port,
      forceTLS: tls,
      enabledTransports: ['ws', 'wss'],
      channelAuthorization: {
        endpoint: this.getAttribute('auth') || '/hibira/auth',
        transport: 'ajax',
        params: { user_id: crypto.randomUUID(), role, device: deviceName() },
      },
    });
    return this.pusher;
  }

  start(pairing, role, events) {
    this.handoff?.close();
    this.pusher?.disconnect();
    this.handoff = createHandoff({
      pusher: this.client(role),
      code: pairing.code,
      key: pairing.key,
      role,
      relayChunk: Number(this.getAttribute('relay-chunk')) || undefined,
      ...events,
    });
  }

  // The computer: a button, then a QR code, then the photos as they land.
  desk() {
    const t = this.t;
    this.root.innerHTML = `<style>${CSS}</style><button class="open" part="button">${PHONE_ICON}<span>${t.open}</span></button><div class="card" part="card" hidden></div><div class="thumbs" part="thumbs"></div>`;
    const card = this.root.querySelector('.card');
    const thumbs = this.root.querySelector('.thumbs');
    const items = new Map();
    let peer = null;
    let transport = 'relay';
    let qr = '';
    let link = '';
    const render = () => {
      card.innerHTML = peer
        ? `<div class="text"><p><span class="dot"></span><strong>${esc(t.connected(peer.device || ''))}</strong></p><p class="muted">${esc(t.shoot)}</p><p><span class="badge ${transport}" title="${esc(transport === 'direct' ? t.directTip : t.relayTip)}">${esc(transport === 'direct' ? t.direct : t.relay)}</span><span class="badge" title="${esc(t.e2eTip)}">🔒 ${esc(t.e2e)}</span></p></div>`
        : `<div class="qr">${qr}</div><div class="text"><p><strong>${esc(t.scan)}</strong></p><p class="muted">${esc(t.scanHint)}</p><p><span class="badge" title="${esc(t.e2eTip)}">🔒 ${esc(t.e2e)}</span><button class="icon copy" part="copy" title="${esc(t.copy)}" aria-label="${esc(t.copy)}">${COPY_ICON}</button></p></div>`;
      card.querySelector('.copy')?.addEventListener('click', (e) => {
        const b = e.currentTarget;
        navigator.clipboard?.writeText(link).then(() => {
          b.title = t.copied;
          b.setAttribute('aria-label', t.copied);
          b.classList.add('done');
        });
      });
    };
    this.root.querySelector('.open').addEventListener('click', async () => {
      if (!card.hidden) return;
      const pairing = newPairing();
      const base = this.getAttribute('phone-url') ? new URL(this.getAttribute('phone-url'), location.href).href : location.href.split('#')[0];
      link = pairingLink(base, pairing);
      this.link = link;
      qr = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      card.hidden = false;
      render();
      this.start(pairing, 'desk', {
        onPeer: (p) => {
          peer = p;
          render();
          this.dispatchEvent(new CustomEvent('handoff-peer', { detail: p, bubbles: true }));
        },
        onTransport: (tr) => {
          transport = tr;
          render();
        },
        onRefused: () => {
          card.innerHTML = `<p class="muted">${esc(t.refused)}</p>`;
        },
        onIncoming: (f) => {
          const img = document.createElement('img');
          img.alt = f.name;
          if (f.preview) {
            img.src = f.preview;
            img.className = 'blur';
          }
          items.set(f.id, img);
          thumbs.append(img);
        },
        onFile: (f) => {
          const file = new File([f.blob], f.name || 'photo.jpg', { type: f.type });
          const img = items.get(f.id);
          if (img) {
            img.src = URL.createObjectURL(file);
            img.className = '';
          }
          this.fill(file);
          this.dispatchEvent(new CustomEvent('handoff-file', { detail: { file }, bubbles: true }));
        },
      });
    });
  }

  // Puts the file into the <input type="file"> named by `for`, keeping the
  // ones already there when it takes several.
  fill(file) {
    const sel = this.getAttribute('for');
    const input = sel ? document.querySelector(sel) : null;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || typeof DataTransfer === 'undefined') return;
    const dt = new DataTransfer();
    if (input.multiple) for (const f of input.files ?? []) dt.items.add(f);
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // The phone: a full-screen camera over the page.
  phone(pairing) {
    const t = this.t;
    this.root.innerHTML = `<style>${CSS}</style><div class="phone" part="phone"><div class="status"><span class="dot off"></span><span class="who">${esc(t.waiting)}</span><span class="badge" hidden></span></div><div class="view"><video playsinline muted autoplay hidden></video><p hidden>${esc(t.cameraOff)}</p></div><div class="controls"><button class="icon" title="${esc(t.choose)}" aria-label="${esc(t.choose)}" disabled>${GALLERY_ICON}</button><button class="shutter" title="${esc(t.shutter)}" aria-label="${esc(t.shutter)}" disabled></button><span class="sent"></span></div><input type="file" accept="image/*" capture="environment" hidden><input type="file" multiple hidden></div>`;
    const $ = (s) => this.root.querySelector(s);
    const video = $('video');
    const view = $('.view');
    const [take, pick] = this.root.querySelectorAll('input');
    const shutter = $('.shutter');
    const gallery = $('.icon');
    const sentLabel = $('.sent');
    let transport = 'relay';
    let seen = false;
    let sent = 0;
    let sending = 0;
    let camera = false;
    if (this.getAttribute('accept') !== 'any') pick.accept = 'image/*';
    const label = () => (sentLabel.textContent = sending ? t.sending : sent ? t.sent(sent) : '');
    const status = (peer) => {
      $('.dot').className = `dot${peer ? '' : ' off'}`;
      $('.who').textContent = peer ? t.toDevice(peer.device || '') : seen ? t.gone : t.waiting;
      const badge = $('.badge');
      badge.hidden = !peer;
      badge.className = `badge ${transport}`;
      badge.textContent = transport === 'direct' ? t.direct : t.relay;
      shutter.disabled = gallery.disabled = !peer;
    };
    let peer = null;
    this.start(pairing, 'phone', {
      onPeer: (p) => {
        peer = p;
        if (p) seen = true;
        status(p);
      },
      onTransport: (tr) => {
        transport = tr;
        status(peer);
      },
      onRefused: () => ($('.who').textContent = t.refused),
    });
    const send = async ({ blob, preview }, name) => {
      if (preview || blob.type.startsWith('image/')) {
        const fly = document.createElement('img');
        fly.className = 'fly';
        fly.src = URL.createObjectURL(blob);
        view.append(fly);
        setTimeout(() => {
          fly.remove();
          URL.revokeObjectURL(fly.src);
        }, 900);
      }
      sending++;
      label();
      try {
        await this.handoff.send(blob, { name, preview });
        sent++;
      } finally {
        sending--;
        label();
      }
    };
    const size = () => (transport === 'direct' ? 'full' : 'small');
    shutter.addEventListener('click', async () => {
      if (!camera) return take.click();
      if (!video.videoWidth) return;
      const flash = document.createElement('div');
      flash.className = 'flash';
      view.append(flash);
      setTimeout(() => flash.remove(), 400);
      send(await shrinkImage(video, video.videoWidth, video.videoHeight, size()), `photo-${stamp()}.jpg`);
    });
    gallery.addEventListener('click', () => pick.click());
    const picked = async (e) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      for (const f of files) {
        const out = await shrinkFile(f, size());
        await send(out, out.blob === f ? f.name : `${f.name.replace(/\.[^.]+$/, '')}.jpg`);
      }
    };
    take.addEventListener('change', picked);
    pick.addEventListener('change', picked);
    if (!navigator.mediaDevices?.getUserMedia) {
      $('.view p').hidden = false;
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        this.stream = s;
        video.srcObject = s;
        video.hidden = false;
        video.play().catch(() => {});
        camera = true;
      })
      .catch(() => ($('.view p').hidden = false));
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

if (typeof customElements !== 'undefined' && !customElements.get('hibira-handoff')) {
  customElements.define('hibira-handoff', HibiraHandoff);
}
