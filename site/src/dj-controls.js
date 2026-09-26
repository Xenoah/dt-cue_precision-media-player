import {PAD_IDS, CUE_IDS, PAD_COLORS, CueBank, MidiGate, keyboardCombo, keyLabel, restoreKeys, restoreMidi, midiIdentity, midiLabel} from './control-map.js';
import {MidiConnection} from './midi-input.js';
import {formatTime} from './analysis-core.js';

const $ = id => document.getElementById(id);
const midiUnavailable = () => !window.isSecureContext ? 'MIDIにはHTTPSまたはlocalhostが必要です。HTTPSの公開版を開いてください。' : 'このブラウザはWeb MIDIに対応していません。キーと画面のパッドは利用できます。';

export class PerformanceControls {
  constructor({engine, definitions, keymap, saved = {}, action, changed, toast, cueChanged}) {
    Object.assign(this, {engine, definitions, keymap, action, changed, toast, cueChanged});
    this.padActions = PAD_IDS.map((_, i) => {
      const id = saved?.pads?.[i];
      return CUE_IDS.includes(id) || (Object.hasOwn(definitions, id) && !PAD_IDS.includes(id) && definitions[id][2] !== 'continuous') ? id : CUE_IDS[i];
    });
    this.midiMap = restoreMidi(definitions, saved?.midi);
    this.device = typeof saved?.device === 'string' ? saved.device : '';
    this.editing = false; this.recording = null; this.target = null; this.conflict = null; this.armed = false;
    this.cues = new CueBank(); this.gate = new MidiGate(); this.flashTimers = new Map();
    this.connection = new MidiConnection({
      request: options => navigator.requestMIDIAccess(options),
      message: (data, port) => this.receiveMidi(data, port),
      changed: error => { this.gate.clear(); this.renderDevices(error); }
    });
    this.buildPads(); this.wire(); this.render(); this.renderDevices();
  }
  settings() { return {pads: this.padActions, midi: this.midiMap, device: this.device}; }
  label(id) { return CUE_IDS.includes(id) ? `HOT CUE ${CUE_IDS.indexOf(id) + 1}` : this.definitions[id]?.[0] || id; }
  save() { this.changed(); this.render(); }
  selectFile(file) { this.cues.select(file); this.armed = false; this.renderPads(); }
  buildPads() {
    this.buttons = PAD_IDS.map((id, i) => {
      const button = document.createElement('button'); button.className = 'dj-pad'; button.dataset.map = id;
      button.style.setProperty('--pad-color', PAD_COLORS[i]); button.id = id;
      button.innerHTML = '<span class="pad-top"><span class="pad-number"></span><kbd></kbd></span><strong></strong><span class="pad-time"></span><span class="pad-midi"></span>';
      button.querySelector('.pad-number').textContent = String(i + 1).padStart(2, '0');
      button.onclick = () => this.invoke(id);
      button.oncontextmenu = event => { event.preventDefault(); this.openEditor(id); };
      return button;
    });
    $('padGrid').replaceChildren(...this.buttons);
  }
  renderPads() {
    this.buttons.forEach((button, i) => {
      const id = PAD_IDS[i], assignment = this.padActions[i], cue = CUE_IDS.indexOf(assignment);
      const point = cue >= 0 ? this.cues.points[cue] : null;
      button.classList.toggle('has-cue', point !== null);
      button.querySelector('strong').textContent = this.label(assignment);
      button.querySelector('kbd').textContent = this.keymap[id] ? keyLabel(this.keymap[id]) : '—';
      button.querySelector('.pad-time').textContent = cue < 0 ? 'ACTION' : point === null ? 'クリックで記録' : formatTime(point).slice(3);
      button.querySelector('.pad-midi').textContent = this.midiMap[id] ? midiLabel(this.midiMap[id]) : 'MIDI —';
      button.setAttribute('aria-label', `パッド ${i + 1} · ${this.label(assignment)} · ${point === null ? (cue < 0 ? '操作' : '未設定') : formatTime(point)}`);
    });
    $('padRecord').setAttribute('aria-pressed', this.armed);
    $('padHint').textContent = this.armed ? '記録モード：HOT CUEパッドを押すと現在位置で上書き。' : '空のCUEは記録、設定済みCUEは再生。右クリックまたは鉛筆で編集。';
  }
  render() {
    this.renderPads();
    document.querySelectorAll('[data-map]').forEach(element => {
      const id = element.dataset.map;
      element.title = `${this.label(id)} · ${keyLabel(this.keymap[id])} · MIDI ${midiLabel(this.midiMap[id])}`;
    });
    if ($('keysDialog').open) this.renderList();
    if ($('mappingDialog').open) this.renderEditor();
  }
  async invoke(id, value) {
    try {
      const pad = PAD_IDS.indexOf(id);
      if (pad < 0) { await this.action(id, value); return; }
      this.flash(pad);
      const assignment = this.padActions[pad], cue = CUE_IDS.indexOf(assignment);
      if (cue < 0) { await this.action(assignment); return; }
      if (!this.cues.file || this.engine.file !== this.cues.file || !this.engine.duration) {
        this.toast('先に動画・音声を読み込んでください。'); return;
      }
      if (this.armed || this.cues.points[cue] === null) {
        if (!this.cues.set(cue, this.engine.currentTime, this.engine.duration)) {
          this.toast('CUEはファイルの終端より手前に設定してください。'); return;
        }
        this.armed = false; this.renderPads(); this.cueChanged();
        this.toast(`${this.label(assignment)} を ${formatTime(this.cues.points[cue])} に記録`);
      } else {
        this.engine.pause(); this.engine.setLoop(false); this.engine.seek(this.cues.points[cue]);
        await this.engine.play(); this.cueChanged();
      }
    } catch (error) { this.toast(error.message || '操作を実行できませんでした。'); }
  }
  flash(index) {
    const button = this.buttons[index]; clearTimeout(this.flashTimers.get(index));
    button.classList.add('firing'); this.flashTimers.set(index, setTimeout(() => button.classList.remove('firing'), 180));
  }
  setEditing(enabled) {
    this.editing = enabled; this.recording = null;
    document.documentElement.classList.toggle('mapping-mode', enabled);
    $('mappingBanner').hidden = !enabled;
    for (const id of ['keysButton', 'padEdit']) $(id).setAttribute('aria-pressed', enabled);
  }
  openEditor(id) {
    if (!Object.hasOwn(this.definitions, id)) return;
    this.target = id; this.recording = null; this.conflict = null;
    $('mappingMessage').textContent = 'キーを登録、またはMIDI Learnを押して機器を操作してください。';
    this.renderEditor(); $('mappingDialog').showModal();
  }
  renderEditor() {
    if (!this.target) return;
    const id = this.target, pad = PAD_IDS.indexOf(id), continuous = this.definitions[id][2] === 'continuous';
    $('mappingTitle').textContent = `${this.label(id)} の割り当て`;
    $('padActionField').hidden = pad < 0;
    if (pad >= 0) {
      const choices = [...CUE_IDS, ...Object.keys(this.definitions).filter(n => !PAD_IDS.includes(n) && this.definitions[n][2] !== 'continuous')];
      $('padAction').replaceChildren(...choices.map(value => new Option(this.label(value), value)));
      $('padAction').value = this.padActions[pad];
    }
    const cue = pad >= 0 ? CUE_IDS.indexOf(this.padActions[pad]) : -1;
    $('clearCue').hidden = cue < 0;
    $('clearCue').disabled = cue < 0 || this.cues.points[cue] === null;
    $('mapKey').textContent = this.recording === 'key' ? 'キーを押してください…' : continuous ? 'MIDI CC専用' : keyLabel(this.keymap[id]);
    $('mapKey').disabled = continuous; $('clearKey').disabled = continuous || !this.keymap[id];
    $('mapKey').classList.toggle('recording', this.recording === 'key');
    $('mapMidi').textContent = this.recording === 'midi' ? 'MIDI入力待ち…' : 'MIDI Learn';
    $('mapMidi').classList.toggle('recording', this.recording === 'midi');
    $('midiBinding').textContent = this.midiMap[id] ? `${midiLabel(this.midiMap[id])} · ${this.midiMap[id].device || 'MIDI入力'}` : '未設定';
    $('clearMidi').disabled = !this.midiMap[id];
    $('mapReassign').hidden = !this.conflict;
    $('mappingNote').textContent = continuous ? 'フェーダー／ノブのCCを登録。音量は0〜100%、速度は50〜150%。' : 'MIDIはNoteの押下、CCの64以上への立ち上がりで1回実行。Escで入力待ちを中止。';
  }
  assign(kind, value, move = false) {
    const id = this.target, map = kind === 'key' ? this.keymap : this.midiMap;
    const other = Object.keys(map).find(name => name !== id && value && (kind === 'key' ? map[name] === value : midiIdentity(map[name]) === midiIdentity(value)));
    this.recording = null;
    if (other && !move) {
      this.conflict = {kind, value}; $('mappingMessage').textContent = `「${this.label(other)}」に使用中です。移動して割り当てますか？`; this.renderEditor(); return;
    }
    if (other) { if (kind === 'key') map[other] = ''; else delete map[other]; }
    if (kind === 'midi' && !value) delete map[id]; else map[id] = value;
    this.conflict = null; $('mappingMessage').textContent = value ? '割り当てを保存しました。' : '割り当てを解除しました。'; this.save();
  }
  renderList() {
    const query = $('mappingSearch').value.trim().toLowerCase();
    $('keyList').replaceChildren(...Object.entries(this.definitions).filter(([id, [label]]) => `${id} ${label}`.toLowerCase().includes(query)).map(([id, [label, , kind]]) => {
      const row = document.createElement('button'); row.className = 'mapping-row';
      const title = document.createElement('span'), key = document.createElement('kbd'), midi = document.createElement('small');
      title.textContent = label; key.textContent = kind === 'continuous' ? 'CC' : keyLabel(this.keymap[id]); midi.textContent = midiLabel(this.midiMap[id]);
      row.append(title, key, midi); row.onclick = () => this.openEditor(id); return row;
    }));
  }
  async enableMidi() {
    if (!navigator.requestMIDIAccess) { $('midiStatus').textContent = midiUnavailable(); this.toast(midiUnavailable()); return false; }
    $('midiStatus').textContent = 'MIDIアクセスの許可を待っています…';
    try { const enabled = await this.connection.enable(); this.renderDevices(); return enabled; }
    catch (error) {
      const message = error.name === 'NotAllowedError' || error.name === 'SecurityError' ? 'MIDIが許可されていません。サイトの権限設定を確認してください。' : 'MIDIへ接続できませんでした。機器とブラウザを確認してください。';
      this.renderDevices(message); this.toast(message); return false;
    }
  }
  renderDevices(error) {
    const ports = Array.from(this.connection.ports.values(), item => item.port), enabled = !!this.connection.access;
    $('midiInput').replaceChildren(new Option('すべての入力', ''), ...ports.map(port => new Option(port.name || 'MIDI入力', port.id)));
    if (this.device && !ports.some(port => port.id === this.device)) $('midiInput').append(new Option('選択した入力（未接続）', this.device));
    $('midiInput').value = this.device; $('midiInput').disabled = !enabled;
    $('midiEnable').disabled = enabled; $('midiDisable').disabled = !enabled && !this.connection.pending;
    const supported = !!navigator.requestMIDIAccess;
    $('midiEnable').disabled = enabled || !supported;
    $('midiStatus').textContent = error || (!supported ? midiUnavailable() : enabled ? ports.length ? `${ports.length}入力を検出。鉛筆マークからMIDI Learnで割り当ててください。` : '接続済みのMIDI入力がありません。機器を接続すると自動で検出します。' : '「MIDIを有効にする」を押して、ブラウザのアクセスを許可してください。');
    $('midiDot').classList.toggle('connected', enabled && ports.length > 0);
    $('midiCount').textContent = enabled ? String(ports.length) : 'OFF';
    $('midiDevices').replaceChildren(...ports.map(port => { const li = document.createElement('li'); li.textContent = [port.manufacturer, port.name || 'MIDI入力'].filter(Boolean).join(' · '); return li; }));
  }
  receiveMidi(data, port) {
    const event = this.gate.read(data, port.id);
    if (!event || (this.device && port.id !== this.device)) return;
    $('lastMidi').textContent = `${port.name || 'MIDI'} · ${midiLabel(event)} · ${event.value}`;
    if (this.recording === 'midi' && $('mappingDialog').open) {
      if (event.type === 'note' && !event.rising) return;
      if (this.definitions[this.target][2] === 'continuous' && event.type !== 'cc') {
        $('mappingMessage').textContent = 'この操作にはノブ／フェーダーのCCを送ってください。'; return;
      }
      this.assign('midi', {port: port.id, device: port.name || '', type: event.type, channel: event.channel, number: event.number}); return;
    }
    if (this.editing || document.querySelector('dialog[open]')) return;
    const identity = midiIdentity(event), id = Object.keys(this.midiMap).find(name => midiIdentity(this.midiMap[name]) === identity);
    if (!id) return;
    const continuous = this.definitions[id][2] === 'continuous';
    if (continuous || event.rising) this.invoke(id, continuous ? event.value / 127 : undefined);
  }
  wire() {
    for (const id of ['keysButton', 'padEdit']) $(id).onclick = () => this.setEditing(!this.editing);
    $('mappingDone').onclick = () => this.setEditing(false);
    $('mappingList').onclick = () => { this.renderList(); $('keysDialog').showModal(); };
    $('mappingSearch').oninput = () => this.renderList();
    $('padRecord').onclick = () => { this.armed = !this.armed; this.renderPads(); };
    $('padAction').onchange = () => { this.padActions[PAD_IDS.indexOf(this.target)] = $('padAction').value; this.save(); };
    $('clearCue').onclick = () => { this.cues.clear(CUE_IDS.indexOf(this.padActions[PAD_IDS.indexOf(this.target)])); this.render(); this.cueChanged(); };
    $('mapKey').onclick = () => { this.recording = 'key'; this.conflict = null; $('mappingMessage').textContent = '割り当てるキーを押してください。修飾キーとの組み合わせも使えます。'; this.renderEditor(); };
    $('clearKey').onclick = () => this.assign('key', '');
    $('clearMidi').onclick = () => this.assign('midi', null);
    $('mapReassign').onclick = () => { if (this.conflict) this.assign(this.conflict.kind, this.conflict.value, true); };
    $('mapMidi').onclick = async () => {
      const target = this.target;
      const enabled = await this.enableMidi();
      if (!$('mappingDialog').open || this.target !== target) return;
      if (!enabled) { $('mappingMessage').textContent = $('midiStatus').textContent; return; }
      this.recording = 'midi'; this.conflict = null; $('mappingMessage').textContent = '割り当てるMIDIパッド／ノブを操作してください。'; this.renderEditor();
    };
    $('mappingDialog').addEventListener('close', () => { this.recording = null; this.conflict = null; this.target = null; });
    $('mappingDialog').addEventListener('cancel', event => {
      if (this.recording) { event.preventDefault(); this.recording = null; $('mappingMessage').textContent = '入力待ちを中止しました。'; this.renderEditor(); }
    });
    $('resetKeys').onclick = () => { Object.assign(this.keymap, restoreKeys(this.definitions)); this.save(); };
    $('midiButton').onclick = () => { this.renderDevices(); $('midiDialog').showModal(); };
    $('midiEnable').onclick = () => this.enableMidi();
    $('midiDisable').onclick = () => { this.recording = null; this.connection.disable(); };
    $('midiInput').onchange = () => { this.device = $('midiInput').value; this.gate.clear(); this.save(); };
    const editTarget = event => {
      const target = event.target.closest('[data-map]');
      if (!this.editing || !target) return;
      if (event.type === 'pointerdown' && target.tagName !== 'INPUT' && target.tagName !== 'SELECT') return;
      event.preventDefault(); event.stopImmediatePropagation(); this.openEditor(target.dataset.map);
    };
    document.addEventListener('click', editTarget, true);
    document.addEventListener('pointerdown', editTarget, true);
    document.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (this.recording === 'key') {
        if (event.key === 'Escape') return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
        this.assign('key', keyboardCombo(event)); return;
      }
      if (document.querySelector('dialog[open]')) return;
      if (this.editing) { if (event.key === 'Escape') this.setEditing(false); return; }
      if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      const id = Object.keys(this.keymap).find(name => this.keymap[name] && this.keymap[name] === keyboardCombo(event));
      if (!id) return;
      event.preventDefault();
      if (event.repeat && !/back|forward|volume-(up|down)|rate-(up|down)/.test(id)) return;
      this.invoke(id);
    }, true);
  }
  destroy() { this.connection.disable(); for (const timer of this.flashTimers.values()) clearTimeout(timer); }
}
