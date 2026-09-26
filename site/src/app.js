import {MediaEngine} from './engine.js';
import {WaveView,ScopeView} from './views.js';
import {frameSeek,formatTime,parseTime} from './analysis-core.js';
const $=id=>document.getElementById(id);
const engine=new MediaEngine($('media'));
const wave=new WaveView($('timeline'),$('overview'),engine);
const scope=new ScopeView($('scope'),engine,$('monitorScope'));
let files=[],current=null,unit='second',stepSize=1,fps=30,recording=null,toastTimer,drawTime=0,lastPosition=0;
const definitions={
  toggle:['再生 / 一時停止','Space'],stop:['停止して先頭へ','KeyK'],start:['先頭へ','Home'],
  'step-back':['選択単位で戻る','ArrowLeft'],'step-forward':['選択単位で進む','ArrowRight'],
  'second-back':['1秒戻る','Shift+ArrowLeft'],'second-forward':['1秒進む','Shift+ArrowRight'],
  'frame-back':['1フレーム戻る','Comma'],'frame-forward':['1フレーム進む','Period'],
  'ms-back':['1ms戻る','Alt+ArrowLeft'],'ms-forward':['1ms進む','Alt+ArrowRight'],
  'set-a':['A点を設定','KeyI'],'set-b':['B点を設定','KeyO'],loop:['A–Bループ切替','KeyL'],
  audition:['0.5秒試聴','Enter'],mute:['ミュート','KeyM'],'volume-up':['音量を上げる','ArrowUp'],'volume-down':['音量を下げる','ArrowDown']
};
const defaults=Object.fromEntries(Object.entries(definitions).map(([k,v])=>[k,v[1]]));
let keymap={...defaults};
function readPrefs(){try{return JSON.parse(localStorage.getItem('dtcue.preferences.v1')||'{}');}catch{return {};}}
const prefs=readPrefs();
if(prefs.keymap&&typeof prefs.keymap==='object')for(const k in keymap)if(typeof prefs.keymap[k]==='string')keymap[k]=prefs.keymap[k];
function save(){try{localStorage.setItem('dtcue.preferences.v1',JSON.stringify({keymap,layout:document.documentElement.dataset.layout,unit,stepSize,fps,volume:engine.volume}));}catch{toast('設定を保存できません。このセッションでは利用できます。');}refreshShortcutHints();}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function short(t){return formatTime(t).slice(3);}
function db(value){return value>0?`${(20*Math.log10(value)).toFixed(1)} dBFS`:'−∞ dBFS';}
function setLayout(name){if(!['premiere','ae','aviutl'].includes(name))return;document.documentElement.dataset.layout=name;document.querySelectorAll('button[data-layout]').forEach(b=>{b.classList.toggle('selected',b.dataset.layout===name);b.setAttribute('aria-pressed',b.dataset.layout===name);});save();requestAnimationFrame(()=>{wave.draw();scope.draw();});}
function setUnit(value){if(!['second','frame','ms'].includes(value))return;unit=value;const label={second:'秒',frame:'フレーム',ms:'ms'}[unit];$('stepUnit').textContent=label;$('stepSummary').textContent=`← / →  ${stepSize} ${label}`;document.querySelectorAll('[data-unit]').forEach(b=>{b.classList.toggle('selected',b.dataset.unit===unit);b.setAttribute('aria-pressed',b.dataset.unit===unit);});save();}
function step(direction,kind=unit,amount=stepSize){
  if(!engine.duration)return;
  let t=engine.currentTime;
  if(kind==='frame'){engine.pause();for(let i=0;i<amount;i++)t=frameSeek(t,direction,fps,engine.duration);}
  else t+=direction*amount*(kind==='ms'?.001:1);
  engine.seek(t);updatePosition();wave.follow(true);wave.draw();scope.draw();
}
function setPoint(which){
  if(!engine.duration)return;
  const t=engine.currentTime;
  if(which==='a'){
    const b=t<engine.b-.001?engine.b:engine.duration;engine.setLoop(engine.loop,t,b);
  }else{
    if(t<=engine.a+.001){toast('B点はA点より後ろに設定してください。');return;}
    engine.setLoop(engine.loop,engine.a,t);
  }
  updateState();wave.draw();
}
function setVolume(value){value=Math.max(0,Math.min(1,value));engine.setVolume(value);$('volume').value=Math.round(value*100);$('volumeValue').textContent=`${Math.round(value*100)}%`;save();}
async function action(name){
  switch(name){
    case'toggle':await engine.toggle();break;case'stop':engine.pause();engine.seek(0);break;case'start':engine.seek(0);break;
    case'step-back':step(-1);break;case'step-forward':step(1);break;
    case'second-back':step(-1,'second',1);break;case'second-forward':step(1,'second',1);break;
    case'frame-back':step(-1,'frame',1);break;case'frame-forward':step(1,'frame',1);break;
    case'ms-back':step(-1,'ms',1);break;case'ms-forward':step(1,'ms',1);break;
    case'set-a':setPoint('a');break;case'set-b':setPoint('b');break;
    case'loop':if(engine.duration)engine.setLoop(!engine.loop);break;
    case'mute':engine.toggleMute();break;case'volume-up':setVolume(engine.volume+.05);break;case'volume-down':setVolume(engine.volume-.05);break;
    case'audition':await engine.audition(.5);break;
    default:return;
  }
  updateState();updatePosition();wave.follow(true);wave.draw();scope.draw();
}
function renderFiles(){
  $('fileCount').textContent=files.length;
  if(!files.length){$('fileList').innerHTML='<div class="library-empty"><p>ファイルを追加してください</p><small>動画・音声をドロップ</small></div>';return;}
  $('fileList').replaceChildren(...files.map(file=>{
    const item=document.createElement('div');item.className='file-item'+(file===current?' active':'');
    const open=document.createElement('button');open.className='file-select';open.setAttribute('aria-label',file.name+' を開く');
    const symbol=document.createElement('span');symbol.className='file-symbol';symbol.textContent=file.type.startsWith('video/')?'▷':'♫';
    const details=document.createElement('span');details.className='file-details';
    const name=document.createElement('strong');name.textContent=file.name;name.title=file.name;
    const info=document.createElement('small');info.textContent=`${file.name.split('.').pop().toUpperCase()}  ·  ${(file.size/1024/1024).toFixed(1)} MB`;
    details.append(name,info);open.append(symbol,details);open.addEventListener('click',()=>load(file));
    const remove=document.createElement('button');remove.className='file-remove';remove.textContent='×';remove.setAttribute('aria-label',file.name+' を一覧から削除');remove.onclick=()=>{
      files=files.filter(f=>f!==file);
      if(current===file){engine.pause();engine.cancelLoad();if(files.length)load(files[0]);else clearMedia();}
      renderFiles();
    };
    item.append(open,remove);return item;
  }));
}
function clearMedia(){current=null;engine.file=null;engine.buffer=null;engine.analysis=null;engine.mode='media';engine.loop=false;engine.a=engine.b=0;engine.media.removeAttribute('src');engine.media.load();if(engine.url)URL.revokeObjectURL(engine.url);engine.url=null;wave.reset();resetUI();updateMetadata();}
async function load(file){
  current=file;renderFiles();document.title=`${file.name} — dt-cue`;
  try{await engine.load(file);}catch(error){toast(error.message||'ファイルを読み込めませんでした。');}
  if(current!==file)return;updateMetadata();updateState();updatePosition();wave.draw();
}
function addFiles(input){
  const valid=[...input].filter(f=>f.type.startsWith('audio/')||f.type.startsWith('video/')||/\.(wav|mp3|flac|aac|ogg|opus|m4a|mp4|webm|m4v|mov|mkv|avi|aif|aiff)$/i.test(f.name));
  if(!valid.length){toast('動画または音声ファイルを選んでください。');return;}
  for(const file of valid)if(!files.some(f=>f.name===file.name&&f.size===file.size&&f.lastModified===file.lastModified))files.push(file);
  renderFiles();load(files.find(f=>f.name===valid[0].name&&f.size===valid[0].size)||valid[0]);
}
function resetUI(){
  wave.reset();$('zoom').value=1;$('zoomValue').textContent='1×';$('bpm').value='';$('bpmConfidence').textContent='解析後に表示';
  $('filePeak').textContent=$('fileRms').textContent=$('sampleRate').textContent='—';$('waveEmpty').hidden=false;
  $('analysisStatus').textContent='音声を読み込み中…';$('waveEmpty').textContent='音声の波形を準備中…';
}
function updateMetadata(){
  const loaded=!!engine.file,isVideo=loaded&&engine.isVideo;
  $('emptyMonitor').hidden=loaded;$('media').hidden=!isVideo;$('monitorScope').hidden=!loaded||isVideo;
  $('audioTitle').hidden=!loaded||isVideo;$('monitorOverlay').hidden=!loaded;
  $('currentFile').textContent=engine.file?.name||'ファイル未選択';$('trackName').textContent=engine.file?.name?.replace(/\.[^.]+$/,'')||'';
  $('mediaKind').textContent=loaded?(isVideo?'VIDEO':'AUDIO'):'NO MEDIA';
  $('trackInfo').textContent=engine.buffer?`${engine.buffer.numberOfChannels} ch / ${(engine.buffer.sampleRate/1000).toFixed(1)} kHz PCM`:'音声リファレンス';
  $('playbackEngine').textContent=loaded?(engine.mode==='pcm'?'PCM · PRECISE':'MEDIA · STREAM'):'LOCAL FILE';
  $('resolution').textContent=isVideo&&engine.media.videoWidth?`${engine.media.videoWidth} × ${engine.media.videoHeight}`:'';
  $('sampleRate').textContent=engine.buffer?`${(engine.buffer.sampleRate/1000).toFixed(1)}k / ${engine.buffer.numberOfChannels}ch`:'—';
  $('duration').textContent=formatTime(engine.duration);$('timeline').setAttribute('aria-valuemax',engine.duration);
  $('pipButton').disabled=!isVideo||!document.pictureInPictureEnabled;
  $('rateNote').textContent=engine.mode==='pcm'?'PCM再生では速度に応じて音程も変わります。':'メディア再生。音程保持はブラウザに依存します。';
  if('mediaSession'in navigator&&loaded){try{navigator.mediaSession.metadata=new MediaMetadata({title:engine.file.name,artist:'dt-cue',album:'Local reference'});}catch{}}
  updatePosition();
}
function updateState(){
  $('playButton').innerHTML=engine.playing?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>';
  $('playButton').setAttribute('aria-label',engine.playing?'一時停止':'再生');
  $('loopButton').setAttribute('aria-pressed',engine.loop);$('muteButton').setAttribute('aria-pressed',engine.muted);$('muteButton').textContent=engine.muted?'MUTE':'VOL';
  $('aTime').textContent=short(engine.a);$('bTime').textContent=short(engine.b);
  $('liveStatus').textContent=engine.playing?'LIVE':'IDLE';$('liveStatus').classList.toggle('active',engine.playing);
  $('scopeCaption').textContent=engine.playing?'出力信号 · ±1.0':scope.mode==='fft'?'再生中に表示':'現在位置のPCM · ±1.0';
  if('mediaSession'in navigator){try{navigator.mediaSession.playbackState=engine.playing?'playing':'paused';}catch{}}
}
function updatePosition(){
  const t=engine.currentTime,formatted=formatTime(t);
  if(document.activeElement!==$('timeInput'))$('timeInput').value=formatted;
  $('monitorTime').textContent=formatted;$('frameCounter').textContent=`${String(Math.floor(t*fps+1e-3)).padStart(6,'0')} f`;
  $('timeline').setAttribute('aria-valuenow',t.toFixed(3));$('timeline').setAttribute('aria-valuetext',formatted);
  if('mediaSession'in navigator&&engine.duration&&performance.now()-lastPosition>1000){lastPosition=performance.now();try{navigator.mediaSession.setPositionState({duration:engine.duration,playbackRate:engine.rate,position:Math.min(engine.duration,t)});}catch{}}
}
function setBpm(value,manual=true){
  value=Number(value);if(!Number.isFinite(value)||value<20||value>400){if(value!==0)toast('BPMは20〜400で入力してください。');return;}
  wave.bpm=value;$('bpm').value=Math.round(value*10)/10;if(manual)$('bpmConfidence').textContent='手動設定';wave.draw();
}
for(const id of['openButton','addButton','emptyOpen'])$(id).onclick=()=>$('fileInput').click();
$('fileInput').onchange=e=>{addFiles(e.target.files);e.target.value='';};
document.querySelectorAll('button[data-layout]').forEach(b=>b.onclick=()=>setLayout(b.dataset.layout));
document.querySelectorAll('[data-unit]').forEach(b=>b.onclick=()=>setUnit(b.dataset.unit));
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
$('stepSize').onchange=()=>{stepSize=Math.max(1,Math.min(10000,Math.floor(Number($('stepSize').value)||1)));$('stepSize').value=stepSize;setUnit(unit);};
$('fps').onchange=()=>{fps=Number($('fps').value);save();updatePosition();};
$('speed').onchange=()=>engine.setRate(Number($('speed').value));
$('volume').oninput=()=>setVolume(Number($('volume').value)/100);
$('muteButton').onclick=()=>action('mute');$('setA').onclick=()=>action('set-a');$('setB').onclick=()=>action('set-b');$('loopButton').onclick=()=>action('loop');$('auditionButton').onclick=()=>action('audition');
function commitTime(){const t=parseTime($('timeInput').value);if(t===null){toast('秒数、分:秒、時:分:秒.ミリ秒で入力してください。');$('timeInput').value=formatTime(engine.currentTime);return;}engine.seek(t);$('timeInput').value=formatTime(engine.currentTime);wave.follow(true);wave.draw();scope.draw();}
$('timeInput').onchange=commitTime;$('timeInput').onkeydown=e=>{if(e.key==='Enter'){commitTime();$('timeInput').blur();e.stopPropagation();}};
$('zoom').oninput=()=>{wave.setZoom(Number($('zoom').value));$('zoomValue').textContent=wave.zoom.toFixed(0)+'×';};
$('fitButton').onclick=()=>{wave.setZoom(1);$('zoom').value=1;$('zoomValue').textContent='1×';};
$('timeline').addEventListener('zoomchange',()=>{$('zoom').value=wave.zoom;$('zoomValue').textContent=wave.zoom.toFixed(1)+'×';});
$('bpm').onchange=()=>setBpm($('bpm').value);$('halfBpm').onclick=()=>setBpm(wave.bpm/2);$('doubleBpm').onclick=()=>setBpm(wave.bpm*2);
$('gridButton').onclick=()=>{wave.grid=!wave.grid;$('gridButton').classList.toggle('selected',wave.grid);$('gridButton').setAttribute('aria-pressed',wave.grid);wave.draw();};
let taps=[];$('tapButton').onclick=()=>{const now=performance.now();if(taps.length&&now-taps.at(-1)>2200)taps=[];taps.push(now);taps=taps.slice(-9);if(taps.length>1)setBpm(60000/((taps.at(-1)-taps[0])/(taps.length-1)));};
document.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{scope.mode=b.dataset.scope;document.querySelectorAll('[data-scope]').forEach(x=>x.classList.toggle('selected',x===b));$('scopeWindow').disabled=scope.mode==='fft';updateState();scope.draw();});
$('scopeWindow').onchange=()=>{scope.window=Number($('scopeWindow').value);scope.draw();};
$('pipButton').onclick=async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await engine.media.requestPictureInPicture();}catch{toast('この動画では小窓表示を利用できません。');}};
$('fullscreenButton').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('monitor').requestFullscreen();}catch{toast('この環境では全画面表示を利用できません。');}};
$('monitor').addEventListener('dblclick',e=>{if(!e.target.closest('button'))$('fullscreenButton').click();});
engine.addEventListener('reset',resetUI);engine.addEventListener('state',updateState);engine.addEventListener('metadata',updateMetadata);engine.addEventListener('position',updatePosition);
engine.addEventListener('error',e=>toast(e.detail));engine.addEventListener('analysisStatus',e=>{$('analysisStatus').textContent=e.detail;$('waveEmpty').textContent=e.detail;});
engine.addEventListener('analysis',({detail:d})=>{
  $('waveEmpty').hidden=true;$('filePeak').textContent=db(d.samplePeak);$('fileRms').textContent=db(d.rms);
  $('analysisStatus').textContent='LOW <250 Hz · MID 250–4k Hz · HIGH >4k Hz';
  if(d.bpm){setBpm(d.bpm,false);wave.beatOffset=d.beatOffset;$('bpmConfidence').textContent=`推定 · リズム一致 ${Math.round(d.confidence*100)}%（目安）`;}
  else $('bpmConfidence').textContent='推定できません。TAPまたは手動入力';
  wave.draw();scope.draw();
});
function combo(e){return[e.ctrlKey?'Ctrl':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.metaKey?'Meta':'',e.code].filter(Boolean).join('+');}
function keyLabel(key){return key.replace(/Key/g,'').replace(/Digit/g,'').replace('ArrowLeft','←').replace('ArrowRight','→').replace('ArrowUp','↑').replace('ArrowDown','↓').replace('Comma',',').replace('Period','.').replace('Space','Space')||'未設定';}
function refreshShortcutHints(){
  document.querySelectorAll('[data-action]').forEach(b=>{const name=b.dataset.action;b.title=`${definitions[name][0]} (${keyLabel(keymap[name])})`;});
  $('stepSummary').textContent=`${keyLabel(keymap['step-back'])} / ${keyLabel(keymap['step-forward'])}  ${stepSize} ${{second:'秒',frame:'フレーム',ms:'ms'}[unit]}`;
  for(const[id,name]of[['setA','set-a'],['setB','set-b'],['loopButton','loop'],['auditionButton','audition'],['muteButton','mute']])$(id).title=`${definitions[name][0]} (${keyLabel(keymap[name])})`;
}
function renderKeys(){
  $('keyList').replaceChildren(...Object.entries(definitions).map(([name,[label]])=>{
    const row=document.createElement('div');row.className='key-row';const text=document.createElement('span');text.textContent=label;
    const button=document.createElement('button');button.textContent=recording===name?'入力待ち…':keyLabel(keymap[name]);button.classList.toggle('recording',recording===name);button.setAttribute('aria-label',label+' のキーを変更');button.onclick=()=>{recording=name;renderKeys();};row.append(text,button);return row;
  }));
}
$('keysButton').onclick=()=>{recording=null;renderKeys();$('keysDialog').showModal();};$('remoteButton').onclick=()=>$('remoteDialog').showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('keysDialog').addEventListener('close',()=>recording=null);
$('resetKeys').onclick=()=>{keymap={...defaults};recording=null;save();renderKeys();};
document.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if(recording){e.preventDefault();e.stopPropagation();if(['Control','Alt','Shift','Meta'].includes(e.key))return;
    if(e.key==='Escape'){recording=null;renderKeys();return;}
    const key=e.key==='Backspace'?'':combo(e),conflict=Object.keys(keymap).find(n=>n!==recording&&key&&keymap[n]===key);
    if(conflict){toast(`「${definitions[conflict][0]}」に割り当て済みです。先に解除してください。`);return;}
    keymap[recording]=key;recording=null;save();renderKeys();return;
  }
  if(document.querySelector('dialog[open]')||e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  const found=Object.keys(keymap).find(k=>keymap[k]===combo(e));if(!found)return;
  e.preventDefault();if(e.repeat&&!/back|forward|volume/.test(found))return;action(found);
});
let dragDepth=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;$('dropOverlay').hidden=false;}});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('dropOverlay').hidden=true;});
document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;addFiles(e.dataTransfer.files);});
if('mediaSession'in navigator){for(const [event,handler]of Object.entries({play:()=>engine.play(),pause:()=>engine.pause(),stop:()=>action('stop'),seekbackward:()=>step(-1),seekforward:()=>step(1),previoustrack:()=>step(-1),nexttrack:()=>step(1),seekto:d=>engine.seek(d.seekTime)})){try{navigator.mediaSession.setActionHandler(event,handler);}catch{}}}
document.addEventListener('dtcue:command',e=>{if(typeof e.detail==='string'&&Object.hasOwn(definitions,e.detail))action(e.detail);});
document.addEventListener('dtcue:connected',()=>{$('remoteDot').classList.add('connected');$('remoteStatus').textContent='このタブに補助拡張が接続されています。グローバルキーで操作できます。';});
document.addEventListener('dtcue:disconnected',()=>{$('remoteDot').classList.remove('connected');$('remoteStatus').textContent='補助拡張は未接続です。拡張アイコンからこのタブを接続してください。';});
document.dispatchEvent(new Event('dtcue:ready'));
$('demoButton').onclick=async()=>{const {makeDemo}=await import('./demo.js');const file=makeDemo();addFiles([file]);};
function animate(time){if(time-drawTime>32){drawTime=time;updatePosition();wave.follow();if(engine.playing)wave.draw();const {l,r}=scope.draw();for(const[id,v]of[['meterL',l],['meterR',r]]){$(id).style.width=`${Math.max(0,Math.min(100,(20*Math.log10(v||1e-5)+60)/60*100))}%`;$(id).classList.toggle('clipping',v>=1);}$('livePeak').textContent=Math.max(l,r)>0?(20*Math.log10(Math.max(l,r))).toFixed(1)+' dB':'−∞ dB';}requestAnimationFrame(animate);}
if(Number.isFinite(prefs.stepSize))stepSize=Math.max(1,Math.min(10000,Math.floor(prefs.stepSize)));
$('stepSize').value=stepSize;if([...$('fps').options].some(o=>Number(o.value)===prefs.fps)){$('fps').value=prefs.fps;fps=prefs.fps;}
setLayout(prefs.layout||'premiere');setUnit(prefs.unit||'second');setVolume(Number.isFinite(prefs.volume)?prefs.volume:.8);updateMetadata();updateState();requestAnimationFrame(animate);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){updatePosition();wave.draw();scope.draw();}});
window.addEventListener('pagehide',e=>{if(!e.persisted)engine.destroy();});
