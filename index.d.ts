import type Pusher from 'pusher-js';

export declare const CHANNEL_PREFIX: 'presence-handoff-';

/** A random code (22 base64url characters) and a 256-bit AES-GCM key (base64url). */
export interface Pairing {
  code: string;
  key: string;
}

export type Role = 'desk' | 'phone';
export type Transport = 'direct' | 'relay';

/** The other side, from its presence user_info. */
export interface Peer {
  id: string;
  role?: Role;
  device?: string;
  [key: string]: unknown;
}

export interface Incoming {
  id: string;
  name: string;
  type: string;
  size: number;
  /** A tiny data: URL to show while the rest arrives, or ''. */
  preview: string;
  via: Transport;
}

export interface Received {
  id: string;
  name: string;
  type: string;
  blob: Blob;
}

export interface HandoffOptions {
  /** A pusher-js client pointed at Hibira, whose auth endpoint signs handoff channels (see ./server). */
  pusher: Pusher;
  code: string;
  key: string;
  /** The desk side offers WebRTC when the phone joins. */
  role: Role;
  /** Raw bytes per relayed chunk: 2700 fits a 4 KB client event limit (default), 7000 a 10 KB one. */
  relayChunk?: number;
  /** false keeps every file on the relay. */
  webrtc?: boolean;
  /** Default: Cloudflare's public STUN server. Add TURN here for networks that block peer-to-peer. */
  iceServers?: RTCIceServer[];
  /** Largest file accepted, in bytes. Default 25 MB. */
  maxBytes?: number;
  onPeer?: (peer: Peer | null) => void;
  onTransport?: (transport: Transport) => void;
  onIncoming?: (file: Incoming) => void;
  onProgress?: (id: string, ratio: number) => void;
  onFile?: (file: Received) => void;
  /** The auth endpoint refused the subscription, usually because two members are already there. */
  onRefused?: (error: unknown) => void;
}

export declare class Handoff {
  constructor(opts: HandoffOptions);
  readonly peer: Peer | null;
  readonly transport: Transport;
  /** Sends a Blob or File; resolves with its id once the last byte has left this browser. */
  send(blob: Blob, opts?: { name?: string; preview?: string }): Promise<string>;
  close(): void;
}

export declare function createHandoff(opts: HandoffOptions): Handoff;
export declare function newPairing(): Pairing;
export declare function validCode(code: unknown): code is string;
/** base plus ?hh=<code> and #hk=<key>; other query parameters are kept. */
export declare function pairingLink(base: string | URL, pairing: Pairing): string;
/** The pairing in a link opened from the QR code (default: the current page), or null. */
export declare function readPairing(href?: string): Pairing | null;
/** "iPhone · Safari", "Windows · Edge", … or "Browser". */
export declare function deviceName(userAgent?: string, maxTouchPoints?: number): string;

export type ShrinkSize = 'full' | 'small';
export interface Shrunk {
  blob: Blob;
  preview: string;
}
/** A JPEG at most 1600 ('full') or 1200 ('small') pixels on the long side, plus a 40-pixel preview. */
export declare function shrinkImage(src: CanvasImageSource, width: number, height: number, size?: ShrinkSize): Promise<Shrunk>;
/** shrinkImage for a picked image file; other files pass through with no preview. */
export declare function shrinkFile(file: File, size?: ShrinkSize): Promise<Shrunk>;
