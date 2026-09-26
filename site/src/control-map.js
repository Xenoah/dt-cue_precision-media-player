export const PAD_IDS = Array.from({length: 10}, (_, i) => `pad-${i + 1}`);
export const CUE_IDS = Array.from({length: 10}, (_, i) => `cue-${i + 1}`);
export const PAD_COLORS = ['#fdac64', '#ffc765', '#c3f96b', '#6fe8b2', '#59c6da', '#70b7ff', '#a997ff', '#d495ef', '#f29abc', '#f68d7e'];
export const DJ_DEFINITIONS = {
  ...Object.fromEntries(PAD_IDS.map((id, i) => [id, [`パッド ${i + 1}`, `Digit${(i + 1) % 10}`]])),
  'beat-back': ['1ビート戻る', ''], 'beat-forward': ['1ビート進む', ''],
  'loop-1': ['1ビートループ', ''], 'loop-2': ['2ビートループ', ''],
  'loop-4': ['4ビートループ', ''], 'loop-8': ['8ビートループ', ''],
  'rate-down': ['速度 −1%', ''], 'rate-up': ['速度 ＋1%', ''], 'rate-reset': ['速度を100%に戻す', ''],
  'tap-tempo': ['タップテンポ', ''], 'bpm-half': ['BPMを半分にする', ''],
  'bpm-double': ['BPMを倍にする', ''], 'beat-grid': ['ビート線切替', ''],
  'zoom-in': ['波形を拡大', ''], 'zoom-out': ['波形を縮小', ''], 'zoom-fit': ['波形全体を表示', ''],
  'scope-osc': ['オシロ表示', ''], 'scope-fft': ['FFT表示', ''],
  'layout-premiere': ['Premiere配置', ''], 'layout-ae': ['After Effects配置', ''], 'layout-aviutl': ['AviUtl配置', ''],
  'unit-second': ['秒シークを選択', ''], 'unit-frame': ['フレームシークを選択', ''], 'unit-ms': ['1msシークを選択', ''],
  'volume-absolute': ['音量フェーダー', '', 'continuous'],
  'rate-absolute': ['速度フェーダー（50〜150%）', '', 'continuous']
};

export function keyboardCombo(event) {
  return [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : '', event.code].filter(Boolean).join('+');
}
export function keyLabel(key = '') {
  return key.replace(/Key/g, '').replace(/Digit/g, '').replace('ArrowLeft', '←').replace('ArrowRight', '→')
    .replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('Comma', ',').replace('Period', '.') || '未設定';
}
export function restoreKeys(definitions, saved = {}) {
  const result = {}, used = new Set();
  // Preserve explicit user assignments before adding defaults introduced by an update.
  for (const [id, def] of Object.entries(definitions)) {
    if (def[2] === 'continuous') { result[id] = ''; continue; }
    if (typeof saved?.[id] === 'string' && saved[id].length <= 80) {
      result[id] = used.has(saved[id]) ? '' : saved[id];
      if (result[id]) used.add(result[id]);
    }
  }
  for (const [id, def] of Object.entries(definitions)) if (!(id in result)) {
    result[id] = used.has(def[1]) ? '' : def[1];
    if (result[id]) used.add(result[id]);
  }
  return result;
}
export function validMidiBinding(value) {
  return value && ['note', 'cc'].includes(value.type) && typeof value.port === 'string' && value.port.length <= 512
    && Number.isInteger(value.channel) && value.channel >= 1 && value.channel <= 16
    && Number.isInteger(value.number) && value.number >= 0 && value.number <= 127;
}
export function midiIdentity(binding) {
  return JSON.stringify([binding.port, binding.type, binding.channel, binding.number]);
}
export function midiLabel(binding) {
  return binding ? `${binding.type === 'note' ? 'NOTE' : 'CC'} ${binding.number} · CH ${binding.channel}` : '未設定';
}
export function restoreMidi(definitions, saved = {}) {
  const result = {}, used = new Set();
  for (const id of Object.keys(definitions)) {
    const value = saved?.[id];
    if (!validMidiBinding(value) || (definitions[id][2] === 'continuous' && value.type !== 'cc')) continue;
    const identity = midiIdentity(value);
    if (used.has(identity)) continue;
    used.add(identity);
    result[id] = {port: value.port, type: value.type, channel: value.channel, number: value.number,
      device: typeof value.device === 'string' ? value.device.slice(0, 120) : ''};
  }
  return result;
}

export class MidiGate {
  constructor() { this.pressed = new Map(); }
  clear() { this.pressed.clear(); }
  clearPort(port) {
    for (const key of this.pressed.keys()) if (JSON.parse(key)[0] === port) this.pressed.delete(key);
  }
  read(data, port) {
    if (data?.length !== 3 || !Array.from(data).every(Number.isInteger)) return null;
    const [status, number, value] = data, command = status & 0xf0;
    if (status < 0x80 || status >= 0xf0 || number < 0 || number > 127 || value < 0 || value > 127
      || ![0x80, 0x90, 0xb0].includes(command)) return null;
    const binding = {port, type: command === 0xb0 ? 'cc' : 'note', channel: (status & 0xf) + 1, number};
    const key = midiIdentity(binding), previous = this.pressed.get(key) || false;
    const pressed = command === 0x90 ? value > 0 : command === 0xb0 ? value >= 64 : false;
    this.pressed.set(key, pressed);
    return {...binding, value, pressed, rising: pressed && !previous};
  }
}

export class CueBank {
  constructor() { this.files = new WeakMap(); this.file = null; }
  select(file) { this.file = file; if (file && !this.files.has(file)) this.files.set(file, Array(10).fill(null)); }
  get points() { return this.file ? this.files.get(this.file) : Array(10).fill(null); }
  set(index, time, duration) {
    if (!this.file || !Number.isInteger(index) || index < 0 || index > 9 || !Number.isFinite(time)
      || time < 0 || time >= duration - .001) return false;
    this.points[index] = time; return true;
  }
  clear(index) { if (this.file && Number.isInteger(index) && index >= 0 && index < 10) this.points[index] = null; }
}
