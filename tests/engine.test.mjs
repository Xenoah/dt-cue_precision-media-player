import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaEngine} from '../site/src/engine.js';
class FakeNode{constructor(){this.gain={value:1,setTargetAtTime(){}};this.playbackRate={value:1};this.stopped=false;}connect(){return this;}disconnect(){}start(when,offset){this.offset=offset;}stop(time){this.stopTime=time;this.stopped=true;}}
class FakeContext{
  constructor(){this.currentTime=0;this.sampleRate=48000;this.state='running';this.destination={};this.sources=[];}
  createGain(){return new FakeNode();}createAnalyser(){return new FakeNode();}createChannelSplitter(){return new FakeNode();}createMediaElementSource(){return new FakeNode();}
  createBufferSource(){const n=new FakeNode();this.sources.push(n);return n;}resume(){this.state='running';return Promise.resolve();}close(){}
}
class FakeMedia extends EventTarget{constructor(){super();this.currentTime=0;this.duration=10;}pause(){}async play(){} }
globalThis.window={AudioContext:FakeContext};
async function fixture(){const e=new MediaEngine(new FakeMedia());await e.init();e.file={};e.buffer={duration:10,sampleRate:48000};e.mode='pcm';e.b=10;return e;}
test('PCM seeking uses sample positions and stops at the end',async()=>{
  const e=await fixture();try{
    e.seek(1);e.seek(e.currentTime+.001);assert.equal(e.currentTime,1.001);
    await e.play();assert.equal(e.source.offset,1.001);e.ctx.currentTime=.2;assert.ok(Math.abs(e.currentTime-1.201)<1e-8);
    e.seek(10);await Promise.resolve();assert.equal(e.currentTime,10);assert.equal(e.playing,false);
  }finally{e.destroy();}
});
test('1000 one-millisecond moves do not drift on a 44.1kHz clock',async()=>{
  const e=await fixture();try{e.buffer.sampleRate=44100;for(let i=0;i<1000;i++)e.seek(e.currentTime+.001);assert.ok(Math.abs(e.currentTime-1)<1e-10);}finally{e.destroy();}
});
test('PCM loops retain clock continuity when disabled',async()=>{
  const e=await fixture();try{
    e.setLoop(true,2,3);await e.play();e.ctx.currentTime=3.25;assert.equal(e.currentTime,2.25);
    e.setLoop(false);assert.equal(e.currentTime,2.25);e.ctx.currentTime+=.25;assert.equal(e.currentTime,2.5);
  }finally{e.destroy();}
});
test('pause cancels an in-flight resume and prevents duplicate sources',async()=>{
  const e=await fixture();try{
    let resume;e.ctx.state='suspended';e.ctx.resume=()=>new Promise(resolve=>resume=()=>{e.ctx.state='running';resolve();});
    const pending=e.play();e.pause();resume();await pending;
    assert.equal(e.playing,false);assert.equal(e.ctx.sources.length,0);
    await Promise.all([e.play(),e.play()]);assert.equal(e.ctx.sources.length,1);
  }finally{e.destroy();}
});
test('PCM audition schedules a half-second stop on the audio clock',async()=>{
  const e=await fixture();try{
    e.seek(2);await e.audition(.5);assert.equal(e.source.stopTime,.5);e.source.onended();assert.equal(e.currentTime,2.5);assert.equal(e.playing,false);
  }finally{e.destroy();}
});
