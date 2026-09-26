import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
test('global commands only need explicit active-tab permissions',()=>{
  assert.equal(manifest.host_permissions,undefined);assert.equal(manifest.content_scripts,undefined);
  assert.equal(Object.values(manifest.commands).filter(c=>c.suggested_key).length,4);
  for(const command of Object.values(manifest.commands))assert.equal(command.global,true);
});
test('extension sends to the selected player tab without switching focus',async()=>{
  const handlers={},sent=[],store={targetTab:42};
  globalThis.chrome={
    storage:{session:{get:async()=>({...store}),remove:async()=>delete store.targetTab}},
    tabs:{sendMessage:async(id,payload)=>{sent.push({id,payload});return{ok:true};},onRemoved:{addListener:fn=>handlers.removed=fn}},
    action:{setBadgeText:async()=>{},setTitle:async()=>{},onClicked:{addListener:fn=>handlers.clicked=fn}},
    commands:{onCommand:{addListener:fn=>handlers.command=fn}}
  };
  const{routeCommand}=await import('../extension/background.js');
  assert.equal(await routeCommand('ms-forward'),true);
  assert.deepEqual(sent,[{id:42,payload:{type:'dtcue-command',command:'ms-forward'}}]);
  chrome.tabs.sendMessage=async()=>{throw new Error('Tab closed');};
  assert.equal(await routeCommand('toggle'),false);assert.equal(store.targetTab,undefined);
});
test('content bridge accepts only extension messages while connected',async()=>{
  const events=[],doc=new EventTarget();doc.documentElement={dataset:{dtcue:'1'}};
  doc.addEventListener('dtcue:command',e=>events.push(e.detail));let listener;
  const context={document:doc,window:{},Event,CustomEvent,chrome:{runtime:{id:'test-id',onMessage:{addListener:fn=>listener=fn}}}};
  const code=await readFile(new URL('../extension/bridge.js',import.meta.url),'utf8');
  assert.equal(vm.runInNewContext(code,context),true);
  listener({type:'dtcue-command',command:'toggle'},{id:'test-id'},()=>{});assert.equal(events.length,0);
  listener({type:'dtcue-connect'},{id:'test-id'},()=>{});
  listener({type:'dtcue-command',command:'ms-forward'},{id:'bad-id'},()=>{});assert.equal(events.length,0);
  listener({type:'dtcue-command',command:'ms-forward'},{id:'test-id'},()=>{});assert.deepEqual(events,['ms-forward']);
  listener({type:'dtcue-disconnect'},{id:'test-id'},()=>{});
  listener({type:'dtcue-command',command:'stop'},{id:'test-id'},()=>{});assert.equal(events.length,1);
});
