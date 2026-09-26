import test from 'node:test';
import assert from 'node:assert/strict';
import {DJ_DEFINITIONS, PAD_IDS, CueBank, MidiGate, restoreKeys, restoreMidi, midiIdentity} from '../site/src/control-map.js';
import {MidiConnection} from '../site/src/midi-input.js';

test('new pad defaults preserve existing custom keys without duplicate triggers', () => {
  const defs = {toggle: ['Play', 'Space'], ...DJ_DEFINITIONS};
  const keys = restoreKeys(defs, {toggle: 'Digit1', 'pad-2': '', 'pad-3': 'KeyQ'});
  assert.equal(keys.toggle, 'Digit1'); assert.equal(keys['pad-1'], ''); assert.equal(keys['pad-2'], '');
  assert.equal(keys['pad-3'], 'KeyQ'); assert.equal(keys['pad-10'], 'Digit0');
  const nonempty = Object.values(keys).filter(Boolean); assert.equal(new Set(nonempty).size, nonempty.length);
  assert.equal(PAD_IDS.length, 10);
});
test('CUE slots remain isolated per file and reject invalid or end positions', () => {
  const bank = new CueBank(), a = {}, b = {};
  bank.select(a); assert.equal(bank.set(0, 2.125, 10), true); bank.set(9, 8, 10);
  bank.select(b); assert.equal(bank.points[0], null); bank.set(0, 4, 10);
  bank.select(a); assert.equal(bank.points[0], 2.125); assert.equal(bank.points[9], 8);
  for (const t of [-1, NaN, Infinity, 10]) assert.equal(bank.set(0, t, 10), false);
  assert.equal(bank.set(10, 0, 10), false); bank.clear(0); assert.equal(bank.points[0], null);
  bank.select(null); assert.equal(bank.set(0, 1, 10), false);
});
test('MIDI note releases and zero-velocity note-on never retrigger a pad', () => {
  const gate = new MidiGate();
  assert.equal(gate.read([0x90, 36, 100], 'a').rising, true);
  assert.equal(gate.read([0x90, 36, 127], 'a').rising, false);
  assert.equal(gate.read([0x90, 36, 0], 'a').rising, false);
  assert.equal(gate.read([0x90, 36, 10], 'a').rising, true);
  assert.equal(gate.read([0x80, 36, 90], 'a').pressed, false);
  assert.equal(gate.read([0x91, 36, 90], 'a').channel, 2);
  assert.equal(gate.read([0x90, 36, 90], 'b').rising, true);
  gate.clearPort('b'); assert.equal(gate.read([0x90, 36, 90], 'b').rising, true);
});
test('CC switches trigger on a rising edge while faders preserve all values', () => {
  const gate = new MidiGate();
  const events = [0, 30, 63, 64, 90, 127, 0, 127].map(value => gate.read([0xbf, 7, value], 'a'));
  assert.deepEqual(events.map(e => e.rising), [false, false, false, true, false, false, false, true]);
  assert.deepEqual(events.map(e => e.value), [0, 30, 63, 64, 90, 127, 0, 127]);
  assert.equal(events[0].channel, 16);
  for (const data of [[], [0x90, 36], [0xf8], [0xf0, 1, 0xf7], [0xe0, 0, 0], [0x90, 128, 1], [0x90, 1, -1]]) assert.equal(gate.read(data, 'a'), null);
});
test('MIDI map restoration rejects malformed entries, collisions and notes on continuous controls', () => {
  const note = {port: 'a', type: 'note', channel: 1, number: 36, device: 'Controller'};
  const result = restoreMidi(DJ_DEFINITIONS, {'pad-1': note, 'pad-2': note, 'pad-3': {...note, channel: 17}, 'volume-absolute': note, 'rate-absolute': {...note, type: 'cc'}});
  assert.deepEqual(Object.keys(result), ['pad-1', 'rate-absolute']);
  assert.notEqual(midiIdentity(note), midiIdentity({...note, port: 'b'}));
});
class Port extends EventTarget {
  constructor(id) { super(); this.id = id; this.state = 'connected'; this.openCount = 0; this.closeCount = 0; }
  async open() { this.openCount++; }
  async close() { this.closeCount++; }
  send(data) { const event = new Event('midimessage'); event.data = data; this.dispatchEvent(event); }
}
test('MIDI connection is opt-in, hot-plugs once, and removes listeners on disconnect', async () => {
  const access = new EventTarget(), a = new Port('a'), b = new Port('b'); access.inputs = new Map([['a', a]]);
  let requests = 0; const received = [];
  const connection = new MidiConnection({request: async options => { requests++; assert.deepEqual(options, {sysex: false}); return access; }, message: (data, port) => received.push([port.id, data]), changed: () => {}});
  assert.equal(requests, 0); await connection.enable(); await connection.enable(); assert.equal(requests, 1);
  access.dispatchEvent(new Event('statechange')); assert.equal(a.openCount, 1);
  access.inputs.set('b', b); access.dispatchEvent(new Event('statechange')); b.send([0x90, 36, 127]);
  b.state = 'disconnected'; access.dispatchEvent(new Event('statechange')); b.send([0x90, 36, 127]);
  assert.equal(received.length, 1); connection.disable(); a.send([0x90, 36, 127]); assert.equal(received.length, 1); assert.equal(a.closeCount, 1);
});
test('denied and cancelled MIDI permission requests leave no active inputs', async () => {
  const connection = new MidiConnection({request: () => Promise.reject(new Error('denied')), message: () => {}, changed: () => {}});
  await assert.rejects(connection.enable(), /denied/); assert.equal(connection.access, null);
  let resolve; const access = new EventTarget(); access.inputs = new Map([['a', new Port('a')]]);
  connection.request = () => new Promise(r => resolve = r);
  const pending = connection.enable(); connection.disable(); resolve(access);
  assert.equal(await pending, false); assert.equal(connection.ports.size, 0);
});

test('MIDI Learn consumes the input; live routing filters device/channel and supports zero-valued faders', async () => {
  const {PerformanceControls} = await import('../site/src/dj-controls.js');
  const previous = globalThis.document;
  const nodes = {lastMidi: {}, mappingDialog: {open: true}, mappingMessage: {}};
  globalThis.document = {getElementById: id => nodes[id], querySelector: () => null};
  try {
    const calls = [], port = {id: 'a', name: 'Test controller'};
    const controller = {gate: new MidiGate(), device: '', recording: 'midi', target: 'pad-1', definitions: DJ_DEFINITIONS, midiMap: {}, editing: false,
      assign(kind, value) { this.midiMap[this.target] = value; this.recording = null; }, invoke: (...args) => calls.push(args)};
    const receive = (data, input = port) => PerformanceControls.prototype.receiveMidi.call(controller, data, input);
    receive([0x90, 36, 127]); assert.equal(calls.length, 0); assert.equal(controller.midiMap['pad-1'].number, 36);
    nodes.mappingDialog.open = false;
    receive([0x80, 36, 0]); receive([0x91, 36, 127]); receive([0x90, 36, 127], {id:'b'}); assert.equal(calls.length, 0);
    receive([0x90, 36, 127]); assert.deepEqual(calls, [['pad-1', undefined]]);
    controller.editing = true; receive([0x80,36,0]); receive([0x90,36,127]); assert.equal(calls.length,1); controller.editing=false;
    controller.midiMap['volume-absolute'] = {port:'a', type:'cc', channel:1, number:7};
    receive([0xb0,7,0]); receive([0xb0,7,127]); assert.deepEqual(calls.slice(-2), [['volume-absolute',0],['volume-absolute',1]]);
    controller.device = 'b'; receive([0xb0,7,64]); assert.equal(calls.length,3);
  } finally { globalThis.document = previous; }
});
test('pad records without playing, then recalls exact CUE and leaves an old loop', async () => {
  const {PerformanceControls} = await import('../site/src/dj-controls.js');
  const file = {}, cues = new CueBank(); cues.select(file);
  const events = [], engine = {file,duration:30,currentTime:6.125,pause(){events.push('pause');},setLoop(v){events.push(['loop',v]);},seek(t){events.push(['seek',t]);},async play(){events.push('play');}};
  const controller = {engine,cues,padActions:['cue-1','loop-4'],armed:false,flash(){},renderPads(){},cueChanged(){},toast(){},label:id=>id,action:id=>events.push(['action',id])};
  await PerformanceControls.prototype.invoke.call(controller,'pad-1'); assert.equal(cues.points[0],6.125); assert.equal(events.length,0);
  engine.currentTime=18; await PerformanceControls.prototype.invoke.call(controller,'pad-1');
  assert.deepEqual(events,['pause',['loop',false],['seek',6.125],'play']);
  await PerformanceControls.prototype.invoke.call(controller,'pad-2'); assert.deepEqual(events.at(-1),['action','loop-4']);
});
