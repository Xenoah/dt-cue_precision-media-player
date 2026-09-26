document.getElementById('shortcuts').onclick=()=>chrome.tabs.create({url:'chrome://extensions/shortcuts'});
chrome.commands.getAll().then(commands=>{
  const target=document.getElementById('commands');
  for(const command of commands){const row=document.createElement('div');row.className='command';const label=document.createElement('span'),key=document.createElement('code');label.textContent=command.description;key.textContent=command.shortcut||'未設定';row.append(label,key);target.append(row);}
});
chrome.storage.session.get('targetTab').then(({targetTab})=>{document.getElementById('status').textContent=Number.isInteger(targetTab)?'接続先のタブが登録されています。':'未接続：dt-cueのタブで拡張アイコンをクリックしてください。';});
