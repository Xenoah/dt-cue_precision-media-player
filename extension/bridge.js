(()=>{
  if(document.documentElement.dataset.dtcue!=='1')return false;
  if(window.__dtCueBridge)return true;
  window.__dtCueBridge=true;
  let connected=false;
  const actions=new Set(['toggle','stop','start','step-back','step-forward','second-back','second-forward','frame-back','frame-forward','ms-back','ms-forward','set-a','set-b','loop','audition','mute','volume-up','volume-down',...Array.from({length:10},(_,i)=>`pad-${i+1}`)]);
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(message.type==='dtcue-connect'){connected=true;document.dispatchEvent(new Event('dtcue:connected'));reply({ok:true});}
    if(message.type==='dtcue-disconnect'){connected=false;document.dispatchEvent(new Event('dtcue:disconnected'));reply({ok:true});}
    if(message.type==='dtcue-command'&&connected&&actions.has(message.command)){
      document.dispatchEvent(new CustomEvent('dtcue:command',{detail:message.command}));reply({ok:true});
    }
  });
  document.addEventListener('dtcue:ready',()=>{if(connected)document.dispatchEvent(new Event('dtcue:connected'));});
  return true;
})();
