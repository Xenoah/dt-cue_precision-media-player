// Three independent periodicity estimators; all processing stays in the worker.
// Scores are heuristic rhythm strengths, not probabilities of a correct tempo.
export const TEMPO_ENGINES = [
  {id:'interval', label:'発音間隔', short:'IOI'},
  {id:'correlation', label:'自己相関', short:'ACF'},
  {id:'comb', label:'周期グリッド', short:'COMB'}
];
const MIN=40, MAX=240, STEP=.25, SIZE=(MAX-MIN)/STEP+1;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const similar=(a,b)=>Math.abs(a-b)<Math.max(.7,Math.min(a,b)*.012);

function average(data,radius){
  const out=new Float32Array(data.length);let sum=0,end=0;
  for(let i=0;i<data.length;i++){
    while(end<Math.min(data.length,i+radius+1))sum+=data[end++];
    if(i>radius)sum-=data[i-radius-1];
    out[i]=sum/(end-Math.max(0,i-radius));
  }
  return out;
}
function features(input,rate){
  const smooth=average(input,Math.max(1,Math.round(rate*.01)));
  const local=average(smooth,Math.round(rate*.5));
  let energy=0,variation=0,maximum=0;
  for(let i=0;i<input.length;i++){
    energy+=smooth[i]*smooth[i];variation+=(smooth[i]-local[i])**2;maximum=Math.max(maximum,local[i]);
  }
  // Relative modulation, so quiet tracks get the same treatment as loud ones.
  if(!energy||variation/energy<.0004)return null;
  const pulse=new Float32Array(input.length),onset=new Float32Array(input.length);
  const distance=Math.max(1,Math.round(rate*.015));
  for(let i=distance;i<input.length;i++){
    const scale=Math.max(local[i],maximum*.005,1e-20);
    pulse[i]=clamp((smooth[i]-local[i])/scale,0,4);
    onset[i]=clamp((smooth[i]-smooth[i-distance])/scale,0,4);
  }
  return {pulse,onset};
}
function eventsFrom(onset,rate){
  const threshold=average(onset,Math.round(rate*.2)),events=[];
  const gap=Math.round(rate*.1);
  for(let i=1;i<onset.length-1;i++){
    if(onset[i]<.02||onset[i]<threshold[i]*1.3||onset[i]<onset[i-1]||onset[i]<onset[i+1])continue;
    const event={index:i,strength:onset[i]};
    if(events.length&&i-events.at(-1).index<gap){if(event.strength>events.at(-1).strength)events[events.length-1]=event;}
    else events.push(event);
  }
  return events;
}
function intervalScores(onset,rate){
  const scores=new Float64Array(SIZE),events=eventsFrom(onset,rate);
  if(events.length<5)return {scores,quality:0};
  for(let i=0;i<events.length;i++)for(let j=i+1;j<Math.min(events.length,i+10);j++){
    const seconds=(events[j].index-events[i].index)/rate;if(seconds>4)break;
    for(let beats=1;beats<=4;beats++){
      const bpm=60*beats/seconds;if(bpm<MIN||bpm>MAX)continue;
      const weight=Math.sqrt(events[i].strength*events[j].strength)/Math.sqrt(j-i)/Math.sqrt(beats);
      const center=(bpm-MIN)/STEP,spread=Math.max(2,bpm*.004/STEP);
      for(let k=Math.max(0,Math.floor(center-spread*3));k<=Math.min(SIZE-1,Math.ceil(center+spread*3));k++)scores[k]+=weight*Math.exp(-.5*((k-center)/spread)**2);
    }
  }
  const max=Math.max(...scores),mean=scores.reduce((a,b)=>a+b,0)/SIZE;
  return {scores,quality:max?clamp((max/Math.max(mean,1e-20)-2)/6):0};
}
function correlationScores(pulse,rate){
  const scores=new Float64Array(SIZE),signal=Float32Array.from(pulse);
  const mean=signal.reduce((a,b)=>a+b,0)/signal.length;
  for(let i=0;i<signal.length;i++)signal[i]-=mean;
  const maxLag=Math.ceil(rate*60/MIN)+2,acf=new Float64Array(maxLag+1);
  for(let lag=Math.floor(rate*60/MAX)-1;lag<=maxLag;lag++){
    let xy=0,xx=0,yy=0;
    for(let i=lag;i<signal.length;i++){const x=signal[i],y=signal[i-lag];xy+=x*y;xx+=x*x;yy+=y*y;}
    acf[lag]=xy/Math.sqrt(xx*yy||1);
  }
  for(let k=0;k<SIZE;k++){
    const lag=rate*60/(MIN+k*STEP),i=Math.floor(lag),fraction=lag-i;
    // A mild short-lag preference resolves submultiples of a clear repeated beat.
    scores[k]=Math.max(0,acf[i]*(1-fraction)+acf[i+1]*fraction)*Math.pow((MIN+k*STEP)/120,.12);
  }
  return {scores,quality:clamp((Math.max(...acf)-.12)/.7)};
}
function combScores(onset,rate){
  const scores=new Float64Array(SIZE),bins=new Float64Array(96);
  let total=0;for(const x of onset)total+=x;
  if(total<1e-10)return {scores,quality:0};
  // A single transient matches every phase grid. Require energy in several
  // separated time bins before treating phase concentration as periodicity.
  const blocks=new Float64Array(Math.ceil(onset.length/(rate*.5)));
  for(let i=0;i<onset.length;i++)blocks[Math.floor(i/(rate*.5))]+=onset[i];
  const effective=total*total/blocks.reduce((sum,x)=>sum+x*x,0);
  if(effective<3)return {scores,quality:0};
  let bestContrast=0;
  for(let k=0;k<SIZE;k++){
    const bpm=MIN+k*STEP,period=rate*60/bpm;bins.fill(0);
    for(let i=0;i<onset.length;i++){
      const phase=(i%period)/period*bins.length,index=Math.floor(phase),fraction=phase-index;
      bins[index]+=onset[i]*(1-fraction);bins[(index+1)%bins.length]+=onset[i]*fraction;
    }
    const radius=Math.max(1,Math.round(.035*rate/period*bins.length));
    let best=0;
    for(let i=0;i<bins.length;i++){
      let sum=0;for(let d=-radius;d<=radius;d++)sum+=bins[(i+d+bins.length)%bins.length];
      best=Math.max(best,sum);
    }
    const baseline=(radius*2+1)/bins.length;
    const contrast=clamp((best/total-baseline)/(1-baseline));
    // Penalise a grid with twice as many empty beats or half the observed hits.
    scores[k]=contrast/Math.sqrt(bpm/120);
    bestContrast=Math.max(bestContrast,contrast);
  }
  return {scores,quality:clamp((bestContrast-.12)/.6)};
}
function peaks(scores,quality){
  const best=Math.max(...scores),found=[];
  if(!best||quality<.18)return found;
  for(let i=0;i<SIZE;i++)if(scores[i]>best*.4&&(!i||scores[i]>=scores[i-1])&&(i===SIZE-1||scores[i]>=scores[i+1])){
    found.push({bpm:Math.round((MIN+i*STEP)*10)/10,score:scores[i]/best,confidence:Math.min(.95,quality*scores[i]/best)});
  }
  found.sort((a,b)=>b.score-a.score);
  return found.filter((c,i)=>!found.slice(0,i).some(p=>similar(c.bpm,p.bpm))).slice(0,5);
}
function offsetFor(bpm,windows,rate){
  const period=60/bpm,bins=new Float64Array(128);
  for(const w of windows)for(const e of w.events){
    const phase=((w.start+e.index)/rate%period)/period*bins.length;
    bins[Math.round(phase)%bins.length]+=e.strength;
  }
  let best=0,index=0;
  for(let i=0;i<bins.length;i++){
    let sum=0;for(let d=-3;d<=3;d++)sum+=bins[(i+d+bins.length)%bins.length];
    if(sum>best){best=sum;index=i;}
  }
  let weighted=0,weight=0;
  for(let d=-3;d<=3;d++){const v=bins[(index+d+bins.length)%bins.length];weighted+=(index+d)*v;weight+=v;}
  return weight?((weighted/weight+bins.length)%bins.length)/bins.length*period:0;
}

export function combineTempos(engines){
  const groups=[];
  for(const engine of engines)for(const [rank,c] of engine.candidates.entries()){
    if(c.confidence<.18)continue;
    let group=groups.find(g=>similar(g.bpm,c.bpm));
    if(!group){group={bpm:c.bpm,weight:0,sum:0,votes:new Map(),members:[]};groups.push(group);}
    const weight=c.confidence/(1+rank*.55);
    if(group.votes.has(engine.id))continue;
    group.votes.set(engine.id,{weight,primary:rank===0});group.members.push({bpm:c.bpm,weight});group.weight+=weight;group.sum+=c.bpm*weight;group.bpm=group.sum/group.weight;
  }
  return groups.map(g=>{
    // A weighted median lets two agreeing detectors resist one shifted peak.
    let sum=0;const median=g.members.sort((a,b)=>a.bpm-b.bpm).find(c=>(sum+=c.weight)>=g.weight/2);
    return {bpm:median.bpm,engines:[...g.votes.keys()],support:g.votes.size,primarySupport:[...g.votes.values()].filter(v=>v.primary).length,
      confidence:Math.min(.95,g.weight/3),score:g.weight*(1+(g.votes.size-1)*.2)};
  })
    .sort((a,b)=>b.score-a.score).slice(0,5);
}

export function estimateTempo(envelope,envelopeRate,progress=()=>{}){
  const engines=TEMPO_ENGINES.map(e=>({...e,candidates:[],reason:''}));
  const empty=reason=>({bpm:null,confidence:0,beatOffset:0,candidates:[],tempoCandidates:[],engines:engines.map(e=>({...e,reason:e.reason||reason})),reason});
  if(!Number.isFinite(envelopeRate)||envelopeRate<=0||envelope.length<envelopeRate*4)return empty('4秒以上の音声が必要です');
  // Evenly distributed windows prevent a silent intro from deciding the result,
  // while bounding the cost for long tracks. Window starts retain absolute phase.
  const size=Math.min(envelope.length,Math.round(envelopeRate*24));
  const count=Math.min(8,Math.max(1,Math.ceil(envelope.length/size))),windows=[];
  for(let i=0;i<count;i++){
    const start=count===1?0:Math.round(i*(envelope.length-size)/(count-1));
    const f=features(envelope.subarray(start,start+size),envelopeRate);
    if(f)windows.push({...f,start,events:eventsFrom(f.onset,envelopeRate)});
  }
  if(!windows.length)return empty('周期的な音量変化を検出できません');
  const detectors=[intervalScores,correlationScores,combScores];
  for(let e=0;e<engines.length;e++){
    const combined=new Float64Array(SIZE);let quality=0,accepted=0;
    for(const w of windows){
      const result=detectors[e](e===1?w.pulse:w.onset,envelopeRate),max=Math.max(...result.scores);
      if(result.quality>=.18&&max){for(let k=0;k<SIZE;k++)combined[k]+=result.scores[k]/max*result.quality;quality+=result.quality;accepted++;}
    }
    engines[e].candidates=peaks(combined,accepted?quality/accepted:0);
    if(!engines[e].candidates.length)engines[e].reason='安定した周期を検出できません';
    progress((e+1)/engines.length);
  }
  const tempoCandidates=combineTempos(engines);
  if(!tempoCandidates.length)return empty('安定したBPMを検出できません。TAPまたは手動入力を使ってください');
  for(const c of [...tempoCandidates,...engines.flatMap(e=>e.candidates)])c.beatOffset=offsetFor(c.bpm,windows,envelopeRate);
  const best=tempoCandidates[0];
  return {bpm:best.bpm,confidence:best.confidence,beatOffset:best.beatOffset,
    candidates:tempoCandidates.map(c=>c.bpm),tempoCandidates,engines,reason:''};
}
