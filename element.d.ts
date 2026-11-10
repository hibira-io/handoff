import type { Peer } from './index.js';

/**
 * <hibira-handoff for="#input" key="APP_KEY" auth="/hibira/auth">
 *
 * Attributes: for, key, auth, host, port, tls, phone-url, relay-chunk, accept, lang.
 * Events: handoff-peer (detail: Peer | null), handoff-file (detail: { file }).
 */
export declare class HibiraHandoff extends HTMLElement {}

declare global {
  interface HTMLElementTagNameMap {
    'hibira-handoff': HibiraHandoff;
  }
  interface HTMLElementEventMap {
    'handoff-peer': CustomEvent<Peer | null>;
    'handoff-file': CustomEvent<{ file: File }>;
  }
}
