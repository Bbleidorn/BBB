import { WebSocketServer } from 'ws';

const TICK_MS = 50; // 20 Snapshots pro Sekunde
const STALE_MS = 3000; // Zustand gilt danach als veraltet
const MAX_PER_ROOM = 32;
const COLORS = ['#ff3b3b', '#ffb000', '#2ee66b', '#00c8ff', '#b26bff', '#ff5ec4', '#ffe14d', '#ff7a1a', '#7dffea', '#9cff3b'];

function cleanName(name, fallback) {
  const n = String(name || '').trim().replace(/[^\p{L}\p{N} _\-.]/gu, '').slice(0, 16);
  return n || fallback;
}

const num = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);

export function attachMultiplayer(server, trackIds) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
  const rooms = new Map(); // trackId -> Set<client>
  let nextId = 1;

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  };

  const roomOf = (track) => {
    if (!rooms.has(track)) rooms.set(track, new Set());
    return rooms.get(track);
  };

  const broadcastRoom = (track, msg, except) => {
    const room = rooms.get(track);
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const c of room) if (c !== except) send(c.ws, data);
  };

  const sendRoster = (track) => {
    const room = rooms.get(track);
    if (!room) return;
    const players = [...room].map((c) => ({ id: c.id, name: c.name, color: c.color }));
    broadcastRoom(track, { t: 'roster', players });
  };

  const broadcastCounts = () => {
    const c = {};
    for (const [track, room] of rooms) c[track] = room.size;
    const data = JSON.stringify({ t: 'counts', c });
    for (const ws of wss.clients) send(ws, data);
  };

  const leaveRoom = (client) => {
    if (!client.track) return;
    const track = client.track;
    const room = rooms.get(track);
    client.track = null;
    client.state = null;
    if (!room) return;
    room.delete(client);
    if (room.size === 0) rooms.delete(track);
    else {
      broadcastRoom(track, { t: 'event', kind: 'leave', name: client.name });
      sendRoster(track);
    }
    broadcastCounts();
  };

  wss.on('connection', (ws) => {
    const client = {
      ws,
      id: nextId++,
      name: 'Fahrer',
      color: COLORS[(nextId - 2) % COLORS.length],
      track: null,
      state: null,
      alive: true,
      msgCount: 0,
    };
    client.name = `Fahrer-${client.id}`;
    ws.client = client;
    send(ws, { t: 'welcome', id: client.id, color: client.color });
    broadcastCounts();

    ws.on('pong', () => (client.alive = true));

    ws.on('message', (raw) => {
      // einfache Drosselung gegen Flutung
      if (++client.msgCount > 60) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.t) {
        case 'join': {
          const track = String(msg.track || '');
          if (!trackIds.has(track)) return;
          client.name = cleanName(msg.name, `Fahrer-${client.id}`);
          if (client.track === track) return sendRoster(track);
          leaveRoom(client);
          const room = roomOf(track);
          if (room.size >= MAX_PER_ROOM) return send(ws, { t: 'full' });
          room.add(client);
          client.track = track;
          broadcastRoom(track, { t: 'event', kind: 'join', name: client.name }, client);
          sendRoster(track);
          broadcastCounts();
          break;
        }
        case 'name': {
          client.name = cleanName(msg.name, `Fahrer-${client.id}`);
          if (client.track) sendRoster(client.track);
          break;
        }
        case 's': {
          if (!client.track || !Array.isArray(msg.p) || !Array.isArray(msg.q)) return;
          client.state = {
            p: msg.p.slice(0, 3).map(num),
            q: msg.q.slice(0, 4).map(num),
            sp: num(msg.sp),
            at: Date.now(),
          };
          break;
        }
        case 'idle': {
          client.state = null;
          break;
        }
        case 'fin': {
          const time = Number(msg.time);
          if (client.track && Number.isFinite(time) && time > 0) {
            broadcastRoom(client.track, { t: 'event', kind: 'finish', name: client.name, time: Math.round(time) }, client);
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      leaveRoom(client);
      broadcastCounts();
    });
    ws.on('error', () => {});
  });

  // Snapshots an alle Räume mit mindestens zwei Spielern
  setInterval(() => {
    const now = Date.now();
    for (const [track, room] of rooms) {
      if (room.size < 2) continue;
      const ps = [];
      for (const c of room) {
        const s = c.state;
        if (s && now - s.at < STALE_MS) ps.push([c.id, ...s.p, ...s.q, s.sp]);
      }
      broadcastRoom(track, { t: 'snap', ps });
    }
    for (const ws of wss.clients) if (ws.client) ws.client.msgCount = 0;
  }, TICK_MS);

  // Verbindungen am Leben halten und tote Verbindungen aufräumen
  setInterval(() => {
    for (const ws of wss.clients) {
      const c = ws.client;
      if (!c) continue;
      if (!c.alive) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      ws.ping();
    }
  }, 25000);

  return wss;
}
