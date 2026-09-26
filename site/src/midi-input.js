// The request function is injected so permission, hot-plug and shutdown can be tested without hardware.
export class MidiConnection {
  constructor({request, message, changed}) {
    this.request = request; this.message = message; this.changed = changed;
    this.access = null; this.ports = new Map(); this.generation = 0; this.pending = null;
    this.stateChange = () => this.sync();
  }
  async enable() {
    if (this.access) return true;
    if (this.pending) return this.pending;
    const generation = ++this.generation;
    const pending = (async () => {
      const access = await this.request({sysex: false});
      if (generation !== this.generation) return false;
      this.access = access; access.addEventListener('statechange', this.stateChange);
      this.sync(); return true;
    })();
    this.pending = pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = null; }
  }
  sync() {
    const connected = new Map(Array.from(this.access?.inputs.values() || []).filter(p => p.state === 'connected').map(p => [p.id, p]));
    for (const [id, {port, handler}] of this.ports) if (connected.get(id) !== port) {
      port.removeEventListener('midimessage', handler); this.ports.delete(id);
    }
    for (const [id, port] of connected) if (!this.ports.has(id)) {
      const handler = event => this.message(event.data, port);
      this.ports.set(id, {port, handler}); port.addEventListener('midimessage', handler);
      Promise.resolve(port.open()).catch(() => this.changed('MIDI入力を開けません。DAW側の占有設定を確認してください。'));
    }
    this.changed();
  }
  disable() {
    this.generation++; this.pending = null;
    this.access?.removeEventListener('statechange', this.stateChange); this.access = null;
    for (const {port, handler} of this.ports.values()) {
      port.removeEventListener('midimessage', handler); Promise.resolve(port.close()).catch(() => {});
    }
    this.ports.clear(); this.changed();
  }
}
