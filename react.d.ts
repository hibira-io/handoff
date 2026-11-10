import type Pusher from 'pusher-js';
import type { Incoming, Pairing, Peer, Role, Transport } from './index.js';

export interface HandoffFile extends Incoming {
  /** 0 to 1. */
  progress: number;
  /** null until the last chunk arrives. */
  blob: Blob | null;
}

export declare function useHandoff(opts: {
  pusher: Pusher | null | undefined;
  pairing: Pairing | null | undefined;
  role: Role;
  relayChunk?: number;
  webrtc?: boolean;
  iceServers?: RTCIceServer[];
  maxBytes?: number;
}): {
  peer: Peer | null;
  transport: Transport;
  refused: boolean;
  files: HandoffFile[];
  send(blob: Blob, opts?: { name?: string; preview?: string }): Promise<string>;
};
