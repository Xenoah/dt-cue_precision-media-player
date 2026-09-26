import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePCM,estimateTempo} from '../site/src/analysis-core.js';
import {combineTempos} from '../site/src/tempo.js';
import {TempoControls} from '../site/src/tempo-controls.js';
import {makeDemo} from '../site/src/demo.js';

function softEnvelope(kind,duration=30){
  const rate=200,period=60/110;
  return Float32Array.from({length:rate*duration},(_,i)=>{
    const phase=(i/rate-.2+period)%period,pulse=Math.exp(-(((phase-.15)/.08)**2));
    return kind==='quiet'?pulse*.0001:kind==='accent'?(i/rate<1?pulse:pulse*.02):.4+pulse*.3;
  });
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1,`expected ${expected}, got ${actual}`);

test('all three engines recover soft attacks, quiet audio and a loud intro accent',()=>{
  for(const kind of ['soft','quiet','accent']){
    const result=estimateTempo(softEnvelope(kind),200);close(result.bpm,110);
    assert.equal(result.engines.length,3);assert.equal(result.tempoCandidates[0].support,3);
    for(const engine of result.engines){close(engine.candidates[0].bpm,110);assert.ok(Number.isFinite(engine.candidates[0].beatOffset));}
  }
});
test('tempo search covers slow and fast pulse trains from 40 to 240 BPM',()=>{
  for(const bpm of [40,48,80,174,210,240]){
    const env=new Float32Array(6000);
    for(let t=.2;t<30;t+=60/bpm)for(let k=0;k<10;k++)env[Math.round(t*200)+k]=Math.exp(-k/2);
    close(estimateTempo(env,200).bpm,bpm);
  }
});
test('a long silent intro does not prevent tempo detection in later windows',()=>{
  const envelope=new Float32Array(200*120);envelope.set(softEnvelope('soft',35),200*70);
  const result=estimateTempo(envelope,200);close(result.bpm,110);assert.ok(result.tempoCandidates[0].support>=2);
});
test('aperiodic noise, a single accent and short clips provide reasons, not invented BPM',()=>{
  let seed=77;const random=Float32Array.from({length:6000},()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32));
  const accent=new Float32Array(6000);for(let i=0;i<100;i++)accent[200+i]=Math.exp(-i/10);
  for(const envelope of [random,accent,new Float32Array(500)]){
    const result=estimateTempo(envelope,200);assert.equal(result.bpm,null);assert.equal(result.engines.length,3);
    assert.ok(result.reason);assert.ok(result.engines.every(e=>e.reason));
  }
});
test('PCM drum, bass and hat mix reaches the ensemble; half-time remains selectable',async()=>{
  const data=new DataView(await makeDemo().arrayBuffer());
  const pcm=Float32Array.from({length:(data.byteLength-44)/4},(_,i)=>data.getInt16(44+i*4,true)/32768);
  const updates=[],result=analyzePCM([pcm],48000,p=>updates.push(p));
  close(result.bpm,128);assert.ok(result.tempoCandidates.some(c=>Math.abs(c.bpm-64)<1));
  assert.ok(updates.every((p,i)=>!i||p>=updates[i-1]));assert.equal(updates.at(-1),1);
});
test('consensus can use two engines when one abstains and keeps half-time distinct',()=>{
  const candidate=(bpm,confidence)=>({bpm,confidence});
  const result=combineTempos([
    {id:'interval',candidates:[]},
    {id:'correlation',candidates:[candidate(128,.9),candidate(64,.7)]},
    {id:'comb',candidates:[candidate(128.3,.8),candidate(64,.6)]}
  ]);
  close(result[0].bpm,128);assert.equal(result[0].support,2);assert.equal(result[1].bpm,64);
});
test('tempo selection updates the beat phase and protects manual values from late analysis',()=>{
  const calls=[],controller=Object.create(TempoControls.prototype);
  Object.assign(controller,{confidence:{},summary:{},render(){},apply:(...args)=>calls.push(args)});
  const best={bpm:128,beatOffset:.12,support:2},half={bpm:64,beatOffset:.59,support:2};
  const result={tempoCandidates:[best,half],engines:[{id:'comb',candidates:[best,half]}]};
  controller.reset();controller.markManual();controller.show(result);assert.equal(calls.length,0);
  assert.equal(controller.confidence.textContent,'手動設定');
  controller.choose('comb',1);assert.deepEqual(calls.at(-1),[64,.59]);
  controller.choose('auto');assert.deepEqual(calls.at(-1),[128,.12]);
  controller.reset();controller.show(result);assert.equal(calls.length,3);
  controller.reset();controller.unavailable('容量上限');assert.equal(controller.confidence.textContent,'容量上限');assert.equal(controller.result,null);
});
