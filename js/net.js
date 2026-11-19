// Peer-to-peer multiplayer over WebRTC (PeerJS). One player hosts the room and is the
// authority for shared game state; everybody else connects to the host.
// Room "ABCD" lives at peer id PREFIX + "ABCD", so an invite link only needs the code.

const PREFIX = 'cellguardians-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
export function cleanCode(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

const PEER_OPTS = { debug: 0, config: undefined }; // undefined config => PeerJS defaults (Google STUN + PeerJS TURN relays)

function makePeer(id) {
  // eslint-disable-next-line no-undef
  return id ? new Peer(id, PEER_OPTS) : new Peer(PEER_OPTS);
}

export class Net {
  constructor() {
    this.peer = null;
    this.mode = 'off'; // 'host' | 'client' | 'solo' | 'off'
    this.code = null;
    this.conns = new Map(); // host: peerId -> DataConnection
    this.hostConn = null;
    this.handlers = {};
    this.lastHostMsg = 0;
    this.closing = false;
  }
  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
  }
  emit(type, ...a) {
    for (const f of this.handlers[type] || []) f(...a);
  }
  get isHost() {
    return this.mode === 'host' || this.mode === 'solo';
  }

  destroy() {
    this.closing = true;
    try {
      this.peer?.destroy();
    } catch {}
    this.peer = null;
    this.conns.clear();
    this.hostConn = null;
    this.closing = false;
  }

  // Become the host for `code`. Resolves when registered with the signalling server.
  host(code) {
    this.destroy();
    this.code = code;
    return new Promise((resolve, reject) => {
      const peer = makePeer(PREFIX + code);
      this.peer = peer;
      let opened = false;
      const timer = setTimeout(() => !opened && reject(Object.assign(new Error('timeout'), { type: 'network' })), 12000);
      peer.on('open', () => {
        opened = true;
        clearTimeout(timer);
        this.mode = 'host';
        resolve();
      });
      peer.on('connection', (conn) => this.acceptClient(conn));
      peer.on('disconnected', () => {
        if (!this.closing && this.peer === peer && !peer.destroyed) setTimeout(() => peer.reconnect(), 1000);
      });
      peer.on('error', (err) => {
        if (!opened) {
          clearTimeout(timer);
          reject(err);
        } else this.emit('neterror', err);
      });
    });
  }

  acceptClient(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      conn.lastSeen = performance.now();
    });
    conn.on('data', (msg) => {
      conn.lastSeen = performance.now();
      if (msg && typeof msg === 'object') this.emit('message', msg, conn.peer);
    });
    const gone = () => {
      if (this.conns.get(conn.peer) === conn) {
        this.conns.delete(conn.peer);
        this.emit('peerleft', conn.peer);
      }
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  // Join someone else's room. Rejects with err.type === 'peer-unavailable' if nobody hosts it.
  join(code) {
    this.destroy();
    this.code = code;
    return new Promise((resolve, reject) => {
      const peer = makePeer();
      this.peer = peer;
      let done = false;
      const fail = (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      };
      const timer = setTimeout(() => fail(Object.assign(new Error('timeout'), { type: 'timeout' })), 15000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.mode = 'client';
          this.hostConn = conn;
          this.lastHostMsg = performance.now();
          resolve();
        });
        conn.on('data', (msg) => {
          this.lastHostMsg = performance.now();
          if (msg && typeof msg === 'object') this.emit('message', msg, 'host');
        });
        const lost = () => {
          if (this.hostConn === conn && !this.closing) {
            this.hostConn = null;
            this.emit('hostlost');
          }
        };
        conn.on('close', lost);
        conn.on('error', lost);
      });
      peer.on('disconnected', () => {
        if (!this.closing && this.peer === peer && !peer.destroyed) setTimeout(() => peer.reconnect(), 1000);
      });
      peer.on('error', (err) => {
        if (!done) fail(err);
        else this.emit('neterror', err);
      });
    });
  }

  solo() {
    this.destroy();
    this.mode = 'solo';
  }

  sendToHost(msg) {
    if (this.hostConn?.open) this.hostConn.send(msg);
  }
  sendTo(peerId, msg) {
    const c = this.conns.get(peerId);
    if (c?.open) c.send(msg);
  }
  broadcast(msg) {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }
  kick(peerId) {
    const c = this.conns.get(peerId);
    if (c) {
      this.conns.delete(peerId);
      setTimeout(() => c.close(), 300);
    }
  }

  // Host: drop silent clients. Client: detect a silent host.
  watchdog() {
    const now = performance.now();
    if (this.mode === 'host') {
      for (const [id, c] of this.conns) {
        if (now - (c.lastSeen || now) > 9000) {
          this.conns.delete(id);
          try {
            c.close();
          } catch {}
          this.emit('peerleft', id);
        }
      }
    } else if (this.mode === 'client' && this.hostConn && now - this.lastHostMsg > 7000) {
      const c = this.hostConn;
      this.hostConn = null;
      try {
        c.close();
      } catch {}
      this.emit('hostlost');
    }
  }
}
