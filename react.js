// React hook for @hibira-io/handoff. React is a peer dependency.
import { useEffect, useRef, useState } from 'react';
import { createHandoff } from './index.js';

/**
 * Joins a handoff while the component is mounted. Returns the other side
 * (or null), the transport, the files arriving or arrived, and send().
 *
 *   const { peer, transport, files, send } = useHandoff({ pusher, pairing, role: 'desk' });
 */
export function useHandoff({ pusher, pairing, role, relayChunk, webrtc, iceServers, maxBytes }) {
  const [peer, setPeer] = useState(null);
  const [transport, setTransport] = useState('relay');
  const [refused, setRefused] = useState(false);
  const [files, setFiles] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    if (!pusher || !pairing) return undefined;
    setPeer(null);
    setRefused(false);
    setFiles([]);
    const h = createHandoff({
      pusher,
      code: pairing.code,
      key: pairing.key,
      role,
      relayChunk,
      webrtc,
      iceServers,
      maxBytes,
      onPeer: setPeer,
      onTransport: setTransport,
      onRefused: () => setRefused(true),
      onIncoming: (f) => setFiles((list) => [...list, { ...f, progress: 0, blob: null }]),
      onProgress: (id, progress) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, progress } : f))),
      onFile: ({ id, blob }) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, progress: 1, blob } : f))),
    });
    ref.current = h;
    return () => {
      h.close();
      ref.current = null;
    };
  }, [pusher, pairing?.code, pairing?.key, role]);

  const send = (blob, opts) => (ref.current ? ref.current.send(blob, opts) : Promise.reject(new Error('handoff: not connected')));
  return { peer, transport, refused, files, send };
}
