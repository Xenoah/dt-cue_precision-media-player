export class MediaEngine extends EventTarget {
  constructor(media) {
    super(); this.media = media; this.buffer = null; this.analysis = null; this.source = null;
    this.offset = 0; this.startedAt = 0; this.rate = 1; this.playing = false; this.mode = 'media';
    this.loop = false; this.a = 0; this.b = 0; this.version = 0; this.volume = .8; this.muted = false; this.playVersion = 0;
    media.addEventListener('ended',()=>{ if(this.mode==='media') {this.playing=false;this.emit('state');} });
    media.addEventListener('pause',()=>{if(this.mode==='media'&&this.playing){this.playing=false;this.emit('state');}});
    media.addEventListener('play',()=>{if(this.mode==='media'){this.playing=true;this.emit('state');}});
    media.addEventListener('error',()=>{if(media.src)this.emit('error','再生できない形式です。MP4（H.264/AAC）、WebM、WAV、MP3などをお試しください。');});
    media.addEventListener('timeupdate',()=>this.checkLoop());
    // Best-effort fallback for video loops. PCM loops use the audio rendering clock.
    this.timer = setInterval(()=>{this.checkLoop();this.emit('position');},100);
  }
  emit(type, detail) {this.dispatchEvent(new CustomEvent(type,{detail}));}
  async init() {
    if(!this.ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if(!Context) throw new Error('このブラウザはWeb Audioに対応していません。');
      this.ctx = new Context({latencyHint:'interactive'});
      this.gain = this.ctx.createGain(); this.gain.gain.value = this.volume;
      // Explicit stereo speaker mix: mono duplicates to L/R; multichannel follows Web Audio downmix rules.
      this.gain.channelCount=2;this.gain.channelCountMode='explicit';this.gain.channelInterpretation='speakers';
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize=4096; this.analyser.smoothingTimeConstant=.75;
      this.splitter=this.ctx.createChannelSplitter(2);
      this.left=this.ctx.createAnalyser();this.right=this.ctx.createAnalyser();
      this.left.fftSize=this.right.fftSize=4096;
      this.gain.connect(this.analyser);this.analyser.connect(this.ctx.destination);
      this.gain.connect(this.splitter);this.splitter.connect(this.left,0);this.splitter.connect(this.right,1);
      this.mediaSource=this.ctx.createMediaElementSource(this.media);this.mediaSource.connect(this.gain);
    }
    if(this.ctx.state==='suspended') await this.ctx.resume();
  }
  get duration(){return this.mode==='pcm'?this.buffer.duration:(Number.isFinite(this.media.duration)?this.media.duration:0);}
  get currentTime(){
    if(this.mode==='media') return this.media.currentTime || 0;
    let t=this.offset+(this.playing?(this.ctx.currentTime-this.startedAt)*this.rate:0);
    if(this.loop&&this.b>this.a&&t>=this.b)t=this.a+(t-this.a)%(this.b-this.a);
    return Math.max(0,Math.min(this.duration,t));
  }
  cancelLoad(){this.version++;this.worker?.terminate();this.worker=null;}
  async load(file) {
    this.pause();this.cancelLoad();const version=this.version;
    this.buffer=null;this.analysis=null;this.offset=0;this.loop=false;this.a=0;this.b=0;this.mode='media';
    this.emit('reset');await this.init();if(version!==this.version)return;
    if(this.url)URL.revokeObjectURL(this.url);
    this.file=file;this.url=URL.createObjectURL(file);this.media.src=this.url;this.media.load();
    const isVideo=file.type.startsWith('video/') || /\.(mp4|m4v|webm|mov|mkv|avi)$/i.test(file.name);
    this.isVideo=isVideo;this.emit('metadata');
    const metadata = new Promise(resolve=>{
      const done=()=>{clearTimeout(timeout);this.media.removeEventListener('loadedmetadata',done);this.media.removeEventListener('error',done);resolve();};
      const timeout=setTimeout(done,15000);this.media.addEventListener('loadedmetadata',done,{once:true});this.media.addEventListener('error',done,{once:true});
    });
    await metadata;if(version!==this.version)return;
    this.b=this.duration;this.emit('metadata');
    // Avoid a speculative whole-file decode of long/larger media. Playback and live scopes remain available.
    const estimate=this.duration*(this.ctx.sampleRate)*2*4;
    if(file.size>160*1024*1024 || estimate>220*1024*1024) {
      this.emit('analysisStatus','全体解析を省略（大容量）。再生とライブ解析は利用できます。');this.emit('analysisUnavailable','容量上限でBPM解析を省略。TAPまたは手動入力を使ってください。');return;
    }
    this.emit('analysisStatus','音声をデコード中…');
    try {
      const bytes=await file.arrayBuffer();if(version!==this.version)return;
      const decoded=await this.ctx.decodeAudioData(bytes);if(version!==this.version)return;
      if(decoded.length*decoded.numberOfChannels*4>240*1024*1024){this.emit('analysisStatus','全体解析を省略（PCM容量上限）。ライブ解析を利用できます。');this.emit('analysisUnavailable','PCM容量上限でBPM解析を省略。TAPまたは手動入力を使ってください。');return;}
      this.buffer=decoded;
      if(!isVideo) {
        const resume=this.playing;const t=this.media.currentTime;
        this.media.pause();this.playing=false;this.mode='pcm';this.offset=t;
        if(resume)await this.play();
      }
      this.b=this.duration;this.emit('metadata');this.emit('analysisStatus','3バンド波形・BPMを解析中…');
      const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i).slice());
      this.worker=new Worker(new URL('./analysis-worker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{
        if(version!==this.version)return;
        if(data.result){this.analysis=data.result;this.emit('analysis',data.result);this.worker.terminate();this.worker=null;}
        else if(data.error){this.emit('analysisStatus','解析できませんでした。ライブ解析を利用できます。');this.emit('analysisUnavailable','BPM解析に失敗しました。ファイルを再度開くかTAPを使ってください。');this.worker.terminate();this.worker=null;}
        else this.emit('analysisStatus',`${data.progress<.8?'波形':'BPM · 3エンジン'}解析 ${Math.round(data.progress*100)}%`);
      };
      this.worker.onerror=()=>{if(version===this.version){this.emit('analysisStatus','全体解析に失敗しました。再生とライブ解析は利用できます。');this.emit('analysisUnavailable','BPM解析に失敗しました。ファイルを再度開くかTAPを使ってください。');this.worker?.terminate();this.worker=null;}};
      this.worker.postMessage({channels,sampleRate:decoded.sampleRate},channels.map(c=>c.buffer));
    }catch(error){if(version===this.version){this.emit('analysisStatus','この形式の全体解析は利用できません。再生可能な場合はライブ解析を利用できます。');this.emit('analysisUnavailable','この形式のBPM解析は利用できません。TAPまたは手動入力を使ってください。');}}
  }
  async play() {
    if(!this.file)return;
    const playVersion=++this.playVersion;
    await this.init();if(this.playing||playVersion!==this.playVersion)return;
    if(this.currentTime>=this.duration-.001)this.seek(this.loop?this.a:0);
    if(this.loop&&(this.currentTime<this.a||this.currentTime>=this.b))this.seek(this.a);
    if(this.mode==='pcm'){
      const node=this.ctx.createBufferSource();node.buffer=this.buffer;node.playbackRate.value=this.rate;
      node.loop=this.loop;node.loopStart=this.a;node.loopEnd=this.b;node.connect(this.gain);
      this.source=node;this.startedAt=this.ctx.currentTime;this.playing=true;
      node.onended=()=>{if(this.source!==node)return;this.offset=this.duration;this.playing=false;this.source=null;node.disconnect();this.emit('state');};
      node.start(0,this.offset);
    }else{
      try{this.media.playbackRate=this.rate;await this.media.play();if(playVersion!==this.playVersion){this.media.pause();return;}this.playing=true;}
      catch(error){this.emit('error','再生を開始できません。画面の再生ボタンを押すか、対応形式のファイルを開いてください。');return;}
    }
    this.emit('state');
  }
  pause(){
    this.playVersion++;clearTimeout(this.auditionTimer);
    if(this.mode==='pcm'){
      this.offset=this.currentTime;
      if(this.source){this.source.onended=null;this.source.stop();this.source.disconnect();this.source=null;}
    }else this.media.pause();
    this.playing=false;this.emit('state');
  }
  toggle(){return this.playing?this.pause():this.play();}
  seek(time){
    if(!this.duration)return;
    time=Math.min(this.duration,Math.max(0,Number(time)||0));
    if(this.mode==='pcm'){
      // Retain the requested time, so repeated 1ms moves do not accumulate 44.1kHz rounding error.
      // AudioBufferSourceNode resolves the final offset on the audio rendering timeline.
      const resume=this.playing;this.pause();this.offset=time;
      this.offset=Math.min(this.duration,this.offset);if(resume&&this.offset<this.duration)this.play();
    }else this.media.currentTime=time;
    this.emit('position');
  }
  setRate(rate){const resume=this.playing;const t=this.currentTime;this.pause();this.rate=rate;this.seek(t);this.media.playbackRate=rate;if(resume)this.play();}
  async audition(seconds=.5){
    if(!this.duration)return;
    this.pause();this.setLoop(false);const from=this.currentTime;await this.play();
    if(this.mode==='pcm'&&this.source){
      const source=this.source;const stopAt=Math.min(this.duration,from+seconds*this.rate);
      source.loop=false;source.onended=()=>{if(this.source!==source)return;this.source=null;source.disconnect();this.offset=stopAt;this.playing=false;this.emit('state');this.emit('position');};
      source.stop(this.ctx.currentTime+Math.min(seconds,(this.duration-from)/this.rate));
    }else this.auditionTimer=setTimeout(()=>this.pause(),seconds*1000);
  }
  setVolume(value){this.volume=value;if(this.gain)this.gain.gain.setTargetAtTime(this.muted?0:value,this.ctx.currentTime,.012);}
  toggleMute(){this.muted=!this.muted;this.setVolume(this.volume);this.emit('state');}
  setLoop(enabled,a=this.a,b=this.b){
    if(this.mode==='pcm'){this.offset=this.currentTime;this.startedAt=this.ctx.currentTime;}
    this.a=Math.max(0,Math.min(a,this.duration));this.b=Math.max(this.a,Math.min(b,this.duration));
    this.loop=Boolean(enabled&&this.b-this.a>=.001);
    if(this.source){this.source.loop=this.loop;this.source.loopStart=this.a;this.source.loopEnd=this.b;}
    if(this.loop&&(this.currentTime<this.a||this.currentTime>=this.b))this.seek(this.a);
    this.emit('state');
  }
  checkLoop(){if(this.mode==='media'&&this.playing&&this.loop&&this.b>this.a&&this.media.currentTime>=this.b)this.media.currentTime=this.a;}
  destroy(){this.pause();this.cancelLoad();clearInterval(this.timer);if(this.url)URL.revokeObjectURL(this.url);this.ctx?.close();}
}
