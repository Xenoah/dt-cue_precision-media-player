// No host permissions. Only the tab explicitly selected by clicking the action receives commands.
export async function routeCommand(command) {
  const {targetTab}=await chrome.storage.session.get('targetTab');
  if(!Number.isInteger(targetTab))return false;
  try{
    const reply=await chrome.tabs.sendMessage(targetTab,{type:'dtcue-command',command});
    if(!reply?.ok)throw new Error('Not connected');
    return true;
  }catch{
    await chrome.storage.session.remove('targetTab');
    await chrome.action.setBadgeText({text:'!'});
    await chrome.action.setTitle({title:'dt-cueのタブで拡張アイコンをクリックして再接続してください'});
    return false;
  }
}
chrome.commands.onCommand.addListener(command=>{routeCommand(command).catch(()=>{});});
chrome.action.onClicked.addListener(async tab=>{
  if(!tab.id)return;
  try{
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id},files:['bridge.js']});
    if(!results.some(r=>r.result===true))throw new Error('Not a dt-cue page');
    const {targetTab}=await chrome.storage.session.get('targetTab');
    if(Number.isInteger(targetTab)&&targetTab!==tab.id){try{await chrome.tabs.sendMessage(targetTab,{type:'dtcue-disconnect'});}catch{}}
    await chrome.storage.session.set({targetTab:tab.id});
    await chrome.tabs.sendMessage(tab.id,{type:'dtcue-connect'});
    await chrome.action.setBadgeText({text:'ON'});await chrome.action.setBadgeBackgroundColor({color:'#719947'});
    await chrome.action.setTitle({title:'dt-cue接続中 · キー設定は拡張機能のオプションから'});
  }catch{
    await chrome.action.setBadgeText({text:'!'});await chrome.action.setTitle({title:'dt-cueを開いてからクリックしてください'});
  }
});
chrome.tabs.onRemoved.addListener(async tabId=>{const{targetTab}=await chrome.storage.session.get('targetTab');if(tabId===targetTab){await chrome.storage.session.remove('targetTab');await chrome.action.setBadgeText({text:''});}});
