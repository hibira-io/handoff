export declare const CHANNEL_PREFIX: 'presence-handoff-';

export declare function isHandoffChannel(channel: unknown): channel is string;

/** The parts of the `pusher` Node SDK this uses. */
export interface PusherServer {
  get(opts: { path: string; params?: Record<string, unknown> }): Promise<{ ok: boolean; json(): Promise<any> }>;
  authorizeChannel(socketId: string, channel: string, data?: { user_id: string; user_info?: Record<string, unknown> }): unknown;
}

/** Signs a handoff subscription, or resolves null when it must be refused. */
export declare function authorizeHandoff<P extends PusherServer>(
  pusher: P,
  params: { socketId: string; channel: string; userId: string; role: string; device?: string },
): Promise<ReturnType<P['authorizeChannel']> | null>;
