import {TEMPO_ENGINES} from './tempo.js';

export class TempoControls{
  constructor({root,confidence,apply}){
    this.root=root;this.confidence=confidence;this.apply=apply;
    this.auto=root.querySelector('#tempoAuto');this.list=root.querySelector('#tempoEngines');
    this.select=root.querySelector('#tempoCandidate');this.summary=root.querySelector('#tempoSummary');
    this.auto.onclick=()=>this.choose('auto');
    this.select.onchange=()=>this.choose(this.selected,Number(this.select.value));
    this.reset();
  }
  reset(){this.result=null;this.selected='auto';this.manual=false;this.unavailableReason='';this.summary.textContent='3エンジン';this.confidence.textContent='解析後に表示';this.render();}
  unavailable(reason){this.result=null;this.unavailableReason=reason;this.summary.textContent='解析なし';this.render();if(!this.manual)this.confidence.textContent=reason;}
  markManual(){this.manual=true;this.confidence.textContent='手動設定';this.render();}
  show(result){
    this.result=result;this.unavailableReason='';const best=result.tempoCandidates[0];
    this.summary.textContent=best?`第一候補 ${best.primarySupport}/3一致`:'検出なし';
    if(!this.manual&&best)this.choose('auto');
    else{this.render();if(!this.manual)this.confidence.textContent=result.reason;}
  }
  candidates(){return this.selected==='auto'?this.result?.tempoCandidates||[]:this.result?.engines.find(e=>e.id===this.selected)?.candidates||[];}
  choose(id,index=0){
    this.selected=id;const candidate=this.candidates()[index];if(!candidate)return;
    this.manual=false;this.render(index);this.apply(candidate.bpm,candidate.beatOffset);
    const name=id==='auto'?`自動統合 · ${candidate.support}方式の候補`:TEMPO_ENGINES.find(e=>e.id===id).label;
    this.confidence.textContent=`${name} · 推定値`;
  }
  render(index=0){
    this.auto.disabled=!this.result?.tempoCandidates.length;
    this.auto.setAttribute('aria-pressed',!this.manual&&this.selected==='auto'&&!this.auto.disabled);
    this.list.replaceChildren(...TEMPO_ENGINES.map(def=>{
      const result=this.result?.engines.find(e=>e.id===def.id),best=result?.candidates[0];
      const button=document.createElement('button');button.type='button';button.className='tempo-engine';
      button.disabled=!best;button.setAttribute('aria-pressed',!this.manual&&this.selected===def.id&&!!best);
      button.title=result?.reason||`${def.label}の候補を使う`;
      button.setAttribute('aria-label',`${def.label} ${best?best.bpm+' BPM':'未検出'}`);
      const label=document.createElement('span');label.textContent=def.label;
      const value=document.createElement('strong');value.textContent=best?best.bpm.toFixed(1):'—';
      button.append(label,value);button.onclick=()=>this.choose(def.id);return button;
    }));
    const candidates=this.candidates();this.select.replaceChildren();
    if(this.manual||!candidates.length)this.select.add(new Option(this.manual?'手動設定中':this.result?'候補なし':this.unavailableReason?'解析を利用できません':'音声の解析を待機',''));
    candidates.forEach((c,i)=>this.select.add(new Option(`${i===0?'第一候補':'候補 '+(i+1)} · ${c.bpm.toFixed(1)} BPM${c.support?' · '+c.support+'方式の候補':''}`,String(i))));
    this.select.disabled=!candidates.length;if(!this.manual&&candidates.length)this.select.value=String(index);
  }
}
