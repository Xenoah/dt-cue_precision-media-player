import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePCM,estimateTempo,frameSeek,formatTime,parseTime} from '../site/src/analysis-core.js';

test('1ms timecodes and rational frame stepping',()=>{
  assert.equal(formatTime(59.9996),'00:01:00.000');
  assert.equal(parseTime('01:02:03.125'),3723.125);
  assert.equal(parseTime('62.125'),62.125);
  assert.equal(parseTime('1:99'),null);assert.equal(parseTime('1oops'),null);
  const fps=30000/1001;
  assert.ok(Math.abs(frameSeek(100/fps,1,fps,100)-101/fps)<1e-10);
  assert.ok(Math.abs(frameSeek(100/fps,-1,fps,100)-99/fps)<1e-10);
  assert.equal(frameSeek(0,-1,fps,100),0);
  assert.equal(frameSeek(100,1,fps,100),100);
  assert.ok(Math.abs(frameSeek(.033333,1,30,10)-2/30)<1e-10);
  assert.ok(Math.abs(frameSeek(.066667,-1,30,10)-1/30)<1e-10);
});
test('silence and a steady sine are not reported as confident BPM',()=>{
  const silent=estimateTempo(new Float32Array(4000),200);
  assert.equal(silent.bpm,null);
  const nearlyConstant=Float32Array.from({length:4000},(_,i)=>.1+.0001*Math.sin(i*.71));
  assert.equal(estimateTempo(nearlyConstant,200).bpm,null);
  const sr=16000,sine=Float32Array.from({length:sr*8},(_,i)=>.5*Math.sin(2*Math.PI*1000*i/sr));
  const result=analyzePCM([sine],sr);
  assert.equal(result.bpm,null);
  assert.ok(Math.abs(result.rms-Math.SQRT1_2*.5)<.0005);
});
test('120 and 128 BPM impulses are identified within 1 BPM',()=>{
  for(const bpm of[90,120,128,160]){
    const rate=200,env=new Float32Array(rate*60),period=60/bpm;
    for(let t=.2;t<60;t+=period)for(let k=0;k<10;k++)env[Math.round(t*rate)+k]=Math.exp(-k/2);
    const result=estimateTempo(env,rate);
    assert.ok(Math.abs(result.bpm-bpm)<1,`${bpm}: got ${result.bpm}`);
    assert.ok(result.confidence>.6);
  }
});
test('3-band energy separates bass, mid and treble',()=>{
  const sr=48000;
  for(const[frequency,band]of[[70,'low'],[1000,'mid'],[10000,'high']]){
    const data=Float32Array.from({length:sr},(_,i)=>.5*Math.sin(2*Math.PI*frequency*i/sr));
    const result=analyzePCM([data],sr);const means=Object.fromEntries(['low','mid','high'].map(k=>[k,result[k].reduce((a,b)=>a+b,0)/result[k].length]));
    for(const other of['low','mid','high'].filter(x=>x!==band))assert.ok(means[band]>means[other],`${frequency}: ${JSON.stringify(means)}`);
  }
});
test('antiphase stereo remains visible; peak includes both channels',()=>{
  const sr=8000,left=Float32Array.from({length:sr},(_,i)=>.7*Math.sin(2*Math.PI*100*i/sr)),right=Float32Array.from(left,x=>-x);
  const stereo=analyzePCM([left,right],sr),mono=analyzePCM([left],sr);
  assert.ok(Math.abs(stereo.rms-mono.rms)<1e-6);
  assert.ok(stereo.samplePeak>.69);assert.ok(stereo.low.some(x=>x>.3));
});
