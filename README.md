# @hibira-io/handoff

Take a photo on your phone and it lands in the form on your computer. The
computer shows a QR code, the phone opens the camera, and the photo appears in
the page about a second later. No app, no sign-in, no upload server, and the
photo is end-to-end encrypted: the relay only ever sees ciphertext.

Works with [Hibira](https://hibira.io) and any server that speaks the Pusher
protocol and allows client events.

[Live demo](https://demos.hibira.io/examples/nextjs-handoff/) ·
[Next.js example](https://github.com/hibira-io/examples/tree/main/nextjs-handoff)

## One line: the `<hibira-handoff>` element

```html
<input type="file" id="receipt" name="receipt" accept="image/*">
<hibira-handoff for="#receipt" key="YOUR_APP_KEY" auth="/hibira/auth"></hibira-handoff>
<script src="https://cdn.jsdelivr.net/npm/@hibira-io/handoff/dist/element.js"></script>
```

On the computer it is a "Take a photo with your phone" button. Pressed, it
shows a QR code that opens the same page on the phone, where the element turns
into a full-screen camera. Each photo lands in the `<input type="file">`
named by `for` (with `input` and `change` events, so your form code sees it
like a picked file), and as a `handoff-file` event.

| Attribute | |
| --- | --- |
| `for` | CSS selector of the file input to fill. |
| `key` | Your app key. |
| `auth` | Your auth route (below). Default `/hibira/auth`. |
| `phone-url` | Open this page on the phone instead of the current one. |
| `relay-chunk` | `7000` on plans with a 10 KB client event limit (Hobby and up); default `2700` fits 4 KB. |
| `accept` | `any` lets the phone pick any file from its gallery, not only images. |
| `lang` | `en`, `zh-TW`, `zh-CN`, `ja`, `ko`, `th` or `vi`. Default: the page's language. |
| `host`, `port`, `tls` | For a self-hosted server. |

Style it with `--hh-accent`, `--hh-ok`, `--hh-border` and the `button`,
`card`, `thumbs`, `copy` and `phone` parts.

## The auth route

Both pages join `presence-handoff-<code>`. Sign it with the `pusher` Node SDK;
`authorizeHandoff` refuses a third member, so a leaked code can't be joined
once the phone is in.

```js
import Pusher from 'pusher';
import { authorizeHandoff } from '@hibira-io/handoff/server';

const pusher = new Pusher({ appId, key, secret, host: 'ws.hibira.io', useTLS: true });

export async function POST(req) {
  const f = new URLSearchParams(await req.text());
  const auth = await authorizeHandoff(pusher, {
    socketId: f.get('socket_id'),
    channel: f.get('channel_name'),
    userId: f.get('user_id'), // or the signed-in user's ID
    role: f.get('role'),
    device: f.get('device'),
  });
  return auth ? Response.json(auth) : new Response('forbidden', { status: 403 });
}
```

Turn on **Allow client events** for the app, and add your site to its
**Allowed origins**.

## Your own UI

```js
import Pusher from 'pusher-js';
import { createHandoff, newPairing, pairingLink, readPairing, deviceName, shrinkImage } from '@hibira-io/handoff';

// Computer
const pairing = newPairing();
showQrCode(pairingLink('https://example.com/claim', pairing));
createHandoff({
  pusher, ...pairing, role: 'desk',
  onPeer: (peer) => console.log(peer ? `${peer.device} connected` : 'phone left'),
  onIncoming: ({ preview }) => showBlurred(preview),
  onFile: ({ name, blob }) => attach(new File([blob], name, { type: blob.type })),
});

// Phone, on the page the QR code opens
const h = createHandoff({ pusher, ...readPairing(), role: 'phone' });
const { blob, preview } = await shrinkImage(video, video.videoWidth, video.videoHeight);
await h.send(blob, { name: 'receipt.jpg', preview });
```

Pass `channelAuthorization.params: { user_id, role, device: deviceName() }`
to pusher-js so the route above gets them.

React: `useHandoff({ pusher, pairing, role })` from `@hibira-io/handoff/react`
returns `{ peer, transport, refused, files, send }`.

## How it works

- **Pairing.** The computer makes a random 128-bit code and a 256-bit AES-GCM
  key. The QR link carries the code as `?hh=` and the key as `#hk=`: the
  `#fragment` is never sent to any server.
- **Direct when it can.** When the phone joins, the computer offers a WebRTC
  data channel; the offer, answer and ICE candidates go as encrypted client
  events. Add a TURN server with `iceServers` for networks that block
  peer-to-peer.
- **Relay always works.** Otherwise the file goes as encrypted chunks of client
  events, paced under 10 a second.
- **Feels instant.** A 40-pixel preview goes first, so the computer shows the
  photo flying in at once and sharpens it when the last chunk arrives. Photos
  are shrunk to 1600 pixels before they leave the phone.

Over WebRTC a photo costs only a dozen signaling messages; over the relay each
chunk is one message (a 150 KB photo is about 22 at 7 KB). Nothing is stored.

## 中文摘要

電腦網頁上的表單需要照片時，用手機掃 QR 碼、拍照，照片約一秒後就出現在電腦的 `<input type="file">` 裡。不用 App、不用登入、沒有上傳伺服器。金鑰放在 QR 碼網址的 `#` 後面，不會傳到伺服器，照片全程端對端加密。優先用 WebRTC 直連，連不上時改走 Hibira 頻道的 client event 分段傳送。最簡單的用法是一行 `<hibira-handoff>` 元件，加上一個呼叫 `authorizeHandoff` 的驗證路由；也提供核心 API 與 React hook。介面支援七種語言。
