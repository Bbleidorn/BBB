// WebSocket-Verbindung zum Multiplayer-Server (verbindet sich bei Abbruch neu)
export class Net {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.track = null;
    this.name = '';
    this.retry = 1000;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = (this.ws = new WebSocket(`${proto}//${location.host}/ws`));
    ws.onopen = () => {
      this.connected = true;
      this.retry = 1000;
      if (this.track) this.join(this.track, this.name);
      this.handlers.status?.(true);
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'welcome') this.id = msg.id;
      this.handlers[msg.t]?.(msg);
    };
    ws.onclose = () => {
      this.connected = false;
      this.handlers.status?.(false);
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 15000);
    };
    ws.onerror = () => ws.close();
  }

  send(msg) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  join(track, name) {
    this.track = track;
    this.name = name;
    this.send({ t: 'join', track, name });
  }

  setName(name) {
    this.name = name;
    this.send({ t: 'name', name });
  }

  sendState(pos, quat, speed) {
    const r = (v) => Math.round(v * 1000) / 1000;
    this.send({ t: 's', p: [r(pos.x), r(pos.y), r(pos.z)], q: [r(quat.x), r(quat.y), r(quat.z), r(quat.w)], sp: r(speed) });
  }

  idle() {
    this.send({ t: 'idle' });
  }

  finish(time) {
    this.send({ t: 'fin', time });
  }
}
