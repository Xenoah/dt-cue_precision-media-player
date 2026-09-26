import {PAD_COLORS} from './control-map.js';
const C={grid:'#27343e',muted:'#78909f',accent:'#c3f96b',low:'#fdac64',mid:'#59c6da',high:'#b49cff'};
function setup(canvas){
  const r=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);
  const w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);return {ctx,w,h};
}
export class WaveView{
  constructor(canvas,overview,engine){
    this.canvas=canvas;this.overview=overview;this.engine=engine;this.zoom=1;this.start=0;this.bpm=0;this.beatOffset=0;this.grid=true;this.scrubbing=false;
    const seek=e=>{const r=canvas.getBoundingClientRect();engine.seek(this.start+Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*this.span);this.draw();};
    canvas.addEventListener('pointerdown',e=>{if(!engine.duration)return;canvas.setPointerCapture(e.pointerId);this.scrubbing=true;seek(e);});
    canvas.addEventListener('pointermove',e=>{if(this.scrubbing)seek(e);});
    canvas.addEventListener('pointerup',()=>this.scrubbing=false);canvas.addEventListener('pointercancel',()=>this.scrubbing=false);
    let dragging=false;
    const pan=e=>{const r=overview.getBoundingClientRect(),t=(e.clientX-r.left)/r.width*engine.duration;
      if(this.zoom===1)engine.seek(t);else this.start=Math.max(0,Math.min(engine.duration-this.span,t-this.span/2));this.draw();};
    overview.addEventListener('pointerdown',e=>{overview.setPointerCapture(e.pointerId);dragging=true;pan(e);});
    overview.addEventListener('pointermove',e=>{if(dragging)pan(e);});
    overview.addEventListener('pointerup',()=>dragging=false);overview.addEventListener('pointercancel',()=>dragging=false);
    canvas.addEventListener('wheel',e=>{if(!engine.duration)return;e.preventDefault();
      if(e.ctrlKey){this.setZoom(Math.max(1,Math.min(64,this.zoom*(e.deltaY<0?1.2:1/1.2))));canvas.dispatchEvent(new Event('zoomchange'));}
      else this.start=Math.max(0,Math.min(engine.duration-this.span,this.start+(e.deltaX||e.deltaY)/canvas.clientWidth*this.span));this.draw();},{passive:false});
    this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(canvas);this.resize.observe(overview);
  }
  get span(){return (this.engine.duration||30)/this.zoom;}
  setZoom(zoom){this.zoom=Math.max(1,Math.min(64,Number(zoom)||1));this.start=Math.max(0,Math.min(this.engine.duration-this.span,this.engine.currentTime-this.span/2));this.draw();}
  reset(){this.zoom=1;this.start=0;this.bpm=0;this.beatOffset=0;this.draw();}
  follow(force=false){const t=this.engine.currentTime;if((force||this.engine.playing)&&!this.scrubbing&&(t>this.start+this.span||t<this.start))this.start=Math.max(0,Math.min(this.engine.duration-this.span,t-this.span*.15));}
  draw(){
    const {ctx,w,h}=setup(this.canvas),d=this.engine.analysis,span=this.span;
    this.start=Math.max(0,Math.min(Math.max(0,this.engine.duration-span),this.start));
    const x=t=>(t-this.start)/span*w;
    ctx.lineWidth=1;ctx.font='11px Consolas, monospace';ctx.fillStyle=C.muted;ctx.strokeStyle=C.grid;
    const desired=span/Math.max(2,w/100),ticks=[.001,.005,.01,.025,.05,.1,.25,.5,1,2,5,10,15,30,60,120,300,600,1200,3600];
    const interval=ticks.find(v=>v>=desired)||3600;
    for(let t=Math.ceil(this.start/interval)*interval;t<=this.start+span;t+=interval){const px=x(t);ctx.beginPath();ctx.moveTo(px,24);ctx.lineTo(px,h);ctx.stroke();const label=t>=60?`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`:t.toFixed(interval<1?(interval<.01?3:2):0)+'s';ctx.fillText(label,px+5,16);}
    const cy=24+(h-24)/2;
    ctx.beginPath();ctx.moveTo(0,cy);ctx.lineTo(w,cy);ctx.stroke();
    if(this.grid&&this.bpm>0){const beat=60/this.bpm;const skip=Math.max(1,Math.ceil(span/beat/150));ctx.strokeStyle='#3c4533';for(let t=this.beatOffset+Math.ceil((this.start-this.beatOffset)/beat/skip)*beat*skip;t<=this.start+span;t+=beat*skip){ctx.beginPath();ctx.moveTo(x(t),24);ctx.lineTo(x(t),h);ctx.stroke();}}
    if(this.engine.loop&&this.engine.b>this.engine.a){ctx.fillStyle='#c3f96b10';ctx.fillRect(x(this.engine.a),24,x(this.engine.b)-x(this.engine.a),h-24);}
    if(d){
      const scale=(h-40)*.46;
      for(let px=0;px<w;px++){
        const i0=Math.max(0,Math.floor((this.start+px/w*span)*d.sampleRate/d.bucketSize));
        const i1=Math.min(d.peak.length,Math.max(i0+1,Math.ceil((this.start+(px+1)/w*span)*d.sampleRate/d.bucketSize)));
        let lo=0,mi=0,hi=0,pk=0;for(let i=i0;i<i1;i++){lo=Math.max(lo,d.low[i]);mi=Math.max(mi,d.mid[i]);hi=Math.max(hi,d.high[i]);pk=Math.max(pk,d.peak[i]);}
        const sum=lo+mi+hi||1,total=Math.pow(pk,.65)*scale,l=total*lo/sum,m=total*mi/sum,hh=total*hi/sum;
        ctx.fillStyle=C.low;ctx.fillRect(px,cy-l,1,l*2);
        ctx.fillStyle=C.mid;ctx.fillRect(px,cy-l-m,1,m);ctx.fillRect(px,cy+l,1,m);
        ctx.fillStyle=C.high;ctx.fillRect(px,cy-l-m-hh,1,hh);ctx.fillRect(px,cy+l+m,1,hh);
      }
    }
    if(this.engine.duration){
      (this.cuePoints?.()||[]).forEach((t,i)=>{if(t===null||t<this.start||t>this.start+span)return;const px=x(t);ctx.fillStyle=PAD_COLORS[i];ctx.globalAlpha=.7;ctx.fillRect(px,24,1,h-24);ctx.globalAlpha=1;ctx.fillRect(Math.min(w-20,Math.max(0,px)),25,19,15);ctx.fillStyle='#111820';ctx.fillText(String(i+1),Math.min(w-17,Math.max(3,px+3)),36);});
      for(const [label,t]of[['A',this.engine.a],['B',this.engine.b]]){if(t>=this.start&&t<=this.start+span){ctx.fillStyle='#c3f96b';ctx.globalAlpha=.65;ctx.fillRect(x(t),24,1,h-24);ctx.fillText(label,Math.min(w-12,Math.max(2,x(t)+3)),h-7);ctx.globalAlpha=1;}}
      const px=x(this.engine.currentTime);ctx.fillStyle=C.accent;ctx.fillRect(px-1,22,2,h-22);ctx.beginPath();ctx.moveTo(px-5,23);ctx.lineTo(px+5,23);ctx.lineTo(px,29);ctx.fill();
    }
    this.drawOverview();
  }
  drawOverview(){
    const {ctx,w,h}=setup(this.overview),d=this.engine.analysis;
    if(d){for(let x=0;x<w;x++){const a=Math.floor(x/w*d.peak.length),b=Math.max(a+1,Math.floor((x+1)/w*d.peak.length));let v=0;for(let i=a;i<b;i++)v=Math.max(v,d.peak[i]);ctx.fillStyle='#506777';const amp=Math.pow(v,.6)*(h*.45);ctx.fillRect(x,h/2-amp,1,amp*2);}}
    const duration=this.engine.duration||1;ctx.fillStyle='#c3f96b0d';ctx.fillRect(this.start/duration*w,0,this.span/duration*w,h);ctx.strokeStyle='#94b963';ctx.strokeRect(this.start/duration*w+.5,.5,Math.min(w-1,this.span/duration*w),h-1);ctx.fillStyle=C.accent;ctx.fillRect(this.engine.currentTime/duration*w,0,2,h);
  }
}
export class ScopeView{
  constructor(canvas,engine,monitor){this.canvas=canvas;this.engine=engine;this.monitor=monitor;this.mode='osc';this.window=.02;this.left=new Float32Array(4096);this.right=new Float32Array(4096);this.freq=new Float32Array(2048);}
  samples(){
    const e=this.engine;this.left.fill(0);this.right.fill(0);
    if(e.playing&&e.left){e.left.getFloatTimeDomainData(this.left);e.right.getFloatTimeDomainData(this.right);}
    else if(e.buffer){const index=Math.floor(e.currentTime*e.buffer.sampleRate);const l=e.buffer.getChannelData(0),r=e.buffer.getChannelData(Math.min(1,e.buffer.numberOfChannels-1));
      for(let i=0;i<4096;i++){this.left[i]=l[index+i]||0;this.right[i]=r[index+i]||0;}}
  }
  grid(ctx,w,h){ctx.lineWidth=1;ctx.strokeStyle='#24333d';ctx.beginPath();for(let i=1;i<8;i++){ctx.moveTo(w*i/8,0);ctx.lineTo(w*i/8,h);}for(let j=1;j<4;j++){ctx.moveTo(0,h*j/4);ctx.lineTo(w,h*j/4);}ctx.stroke();ctx.strokeStyle='#3a4a56';ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();}
  trace(ctx,w,h,data,color,count,offset=0){ctx.strokeStyle=color;ctx.lineWidth=1.3;ctx.beginPath();for(let x=0;x<w;x++){const i=Math.min(data.length-1,offset+Math.floor(x/w*count));const y=h/2-data[i]*h*.4;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}
  draw(){
    this.samples();const {ctx,w,h}=setup(this.canvas);this.grid(ctx,w,h);
    const e=this.engine;
    if(this.mode==='osc'){
      const n=Math.min(3000,Math.floor((e.ctx?.sampleRate||48000)*this.window));let offset=0;
      if(e.playing){for(let i=1;i<Math.min(900,4096-n);i++)if(this.left[i-1]<=0&&this.left[i]>.005){offset=i;break;}}
      this.trace(ctx,w,h,this.right,C.high,n,offset);this.trace(ctx,w,h,this.left,C.mid,n,offset);
    }else{
      this.freq.fill(-100);if(e.playing)e.analyser?.getFloatFrequencyData(this.freq);
      ctx.fillStyle=C.mid;for(let i=0;i<70;i++){const hz=20*Math.pow(1000,i/70),hz2=20*Math.pow(1000,(i+1)/70),sr=e.ctx?.sampleRate||48000;
        const lo=Math.max(1,Math.floor(hz/sr*4096)),hi=Math.min(this.freq.length-1,Math.ceil(hz2/sr*4096));let value=-100;for(let j=lo;j<=hi;j++)value=Math.max(value,this.freq[j]);const amp=Math.max(0,(value+100)/100)*(h-22);ctx.fillRect(i/70*w,h-18-amp,Math.max(1,w/70-2),amp);}
      ctx.font='10px Consolas';ctx.fillStyle=C.muted;for(const hz of[20,100,1000,10000])ctx.fillText(hz>=1000?`${hz/1000}k`:hz,Math.log(hz/20)/Math.log(1000)*w+2,h-5);
    }
    if(!e.isVideo&&e.file){const main=setup(this.monitor);this.trace(main.ctx,main.w,main.h,this.left,C.accent,Math.min(4096,Math.floor((e.ctx?.sampleRate||48000)*.04)));}
    let l=0,r=0;if(e.playing)for(let i=0;i<4096;i++){l=Math.max(l,Math.abs(this.left[i]));r=Math.max(r,Math.abs(this.right[i]));}return {l,r};
  }
}
