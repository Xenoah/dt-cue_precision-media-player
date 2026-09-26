// Original generated test loop. No external assets or network requests.
export function makeDemo(){
  const rate=48000,bpm=128,beat=60/bpm,duration=beat*64,length=Math.floor(duration*rate);
  const raw=new ArrayBuffer(44+length*4),v=new DataView(raw);let seed=7113;
  const text=(at,str)=>[...str].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  text(0,'RIFF');v.setUint32(4,36+length*4,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,length*4,true);
  for(let i=0;i<length;i++){
    const t=i/rate,phase=t%beat,eighth=t%(beat/2),bar=Math.floor(t/beat/4),note=[55,65.406,73.416,49][bar%4];
    seed=(seed*1664525+1013904223)>>>0;const noise=seed/4294967296*2-1;
    const kick=Math.sin(2*Math.PI*(48*phase+5*(1-Math.exp(-phase*50))))*Math.exp(-phase*25)*.65;
    const hat=noise*Math.exp(-eighth*190)*.15;
    const bass=Math.sin(2*Math.PI*note*t)*(.15+.06*Math.sin(t*3))*Math.min(1,phase*15);
    const snare=Math.floor(t/beat)%2?noise*Math.exp(-phase*38)*.21:0;
    const pad=Math.sin(2*Math.PI*note*4*t)*Math.sin(Math.PI*(t%(beat*4))/(beat*4))*.045;
    const fade=Math.min(1,t*30,(duration-t)*30);
    for(let ch=0;ch<2;ch++){const s=(kick+hat+bass+snare+pad*(ch?1:-1))*fade;v.setInt16(44+i*4+ch*2,Math.max(-32768,Math.min(32767,Math.round(s*32767))),true);}
  }
  return new File([raw],'Midnight Circuit · 128 BPM.wav',{type:'audio/wav',lastModified:1});
}
