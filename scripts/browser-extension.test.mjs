import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function harness(stalled=false,userAgent="Chrome/140.0"){
  const posted=[],notified=[],badges=[];
  const timers=new Map();let timerId=0;
  let nativeMessage,runtimeMessage,disconnect;
  const port={disconnect:()=>disconnect(),postMessage:m=>posted.push(m),onMessage:{addListener:f=>nativeMessage=f},onDisconnect:{addListener:f=>disconnect=f}};
  const chrome={
    storage:{local:{get:async()=>({queue:[],boundTab:99}),set:async()=>{}}},
    action:{setTitle:()=>{},setBadgeText:m=>badges.push(m.text),setBadgeBackgroundColor:()=>{}},
    tabs:{query:async()=>[{id:1,url:'https://one.test/'},{id:2,url:'https://two.test/'},{id:3,url:'chrome://settings'}],sendMessage:async(id,m)=>{notified.push({id,...m});if(stalled)return new Promise(()=>{});},onRemoved:{addListener:()=>{}}},
    scripting:{executeScript:async()=>{}},
    runtime:{getManifest:()=>({version:"0.7.0"}),connectNative:()=>port,onMessage:{addListener:f=>runtimeMessage=f}},
    alarms:{create:()=>{},onAlarm:{addListener:()=>{}}}
  };
  vm.runInNewContext(readFileSync('browser-extension/worker.js','utf8'),{chrome,navigator:{userAgent},TextEncoder,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  const settle=()=>new Promise(r=>setImmediate(r));
  return {posted,notified,badges,settle,expire:ms=>{for(const [id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);timer.fn();}},native:m=>nativeMessage(m),disconnect:()=>disconnect(),send:(m,tabId)=>new Promise(resolve=>runtimeMessage(m,tabId===undefined?{}:{tab:{id:tabId},frameId:0},resolve))};
}

test('desktop recording automatically covers multiple tabs and stops with the session',async()=>{
  const h=harness();await h.settle();
  for(const id of [1,2])assert.equal((await h.send({kind:'content-ready'},id)).session,null);
  h.native({kind:'session',session:{id:'recording'}});await h.settle();
  assert.equal(h.badges.at(-1),'REC');
  assert.deepEqual(h.notified.filter(m=>m.kind==='session').map(m=>m.id),[1,2]);
  for(const id of [1,2]){
    assert.equal((await h.send({kind:'capture',event:{eventId:String(id),sessionId:'recording'},focusedAtCapture:true},id)).ok,true);
  }
  // ACK the first batch so the second tab's queued event is sent.
  h.native({kind:'ack',ids:['1']});await h.settle();
  assert.deepEqual(h.posted.filter(m=>m.kind==='events').flatMap(m=>m.events.map(e=>e.tabId)),[1,2]);
  assert.equal((await h.send({kind:'capture',event:{sessionId:'recording'},focusedAtCapture:false},2)).ok,false);
  assert.equal((await h.send({kind:'content-ready'},4)).session.id,'recording');
  h.native({kind:'drain'});await h.settle();
  assert.deepEqual(h.notified.filter(m=>m.kind==='drain').map(m=>m.id),[1,2,4]);
  h.native({kind:'session',session:null});await h.settle();
  assert.equal(h.badges.at(-1),'ON');
  assert.equal((await h.send({kind:'capture',event:{sessionId:'recording'},focusedAtCapture:true},1)).ok,false);
});

test('disconnect clears recording indicator and document sessions',async()=>{
  const h=harness();await h.settle();await h.send({kind:'content-ready'},1);
  h.native({kind:'session',session:{id:'recording'}});await h.settle();h.disconnect();await h.settle();
  assert.equal(h.badges.at(-1),'');assert.equal(h.notified.at(-1).session,null);
});

test('status remains responsive while a page is stalled',async()=>{
  const h=harness(true);await h.settle();
  await h.send({kind:'content-ready'},1);
  assert.equal((await h.send({kind:'status'})).connected,false);
  h.native({kind:'session',session:null});await h.settle();
  assert.equal((await h.send({kind:'status'})).connected,true);
  h.expire(800);await h.settle();
  h.native({kind:'session',session:{id:'recording'}});await h.settle();
  assert.equal((await h.send({kind:'status'})).captureReady,false);
  h.expire(800);await h.settle();
  assert.equal((await h.send({kind:'status'})).captureReady,true);
});

test('manual reconnect resets stale connection and accepts a fresh handshake',async()=>{
  const h=harness();await h.settle();
  h.native({kind:'session',session:{id:'recording'}});await h.settle();
  assert.equal((await h.send({kind:'reconnect'})).ok,true);
  assert.equal((await h.send({kind:'status'})).connected,false);
  h.native({kind:'session',session:{id:'recording'}});await h.settle();
  assert.equal((await h.send({kind:'status'})).connected,true);
  assert.equal(h.badges.at(-1),'REC');
});

test('lost ACK resends the same event; duplicate ACK cannot release a later batch',async()=>{
  const h=harness();await h.settle();
  h.native({kind:'session',session:{id:'recording'}});await h.settle();
  for(const eventId of ['first','second'])await h.send({kind:'capture',event:{eventId,sessionId:'recording'},focusedAtCapture:true},1);
  const batches=()=>h.posted.filter(m=>m.kind==='events');
  assert.equal(batches().length,1);
  h.expire(5000);await h.settle();
  assert.equal(batches().length,2);
  assert.deepEqual(batches()[0].events,batches()[1].events);
  h.native({kind:'ack',ids:['first']});await h.settle();
  assert.equal(batches().length,3);assert.equal(batches()[2].events[0].eventId,'second');
  h.native({kind:'ack',ids:['first']});await h.settle();
  await h.send({kind:'capture',event:{eventId:'third',sessionId:'recording'},focusedAtCapture:true},1);
  assert.equal(batches().length,3);
  h.native({kind:'ack',ids:['second']});await h.settle();
  assert.equal(batches().at(-1).events[0].eventId,'third');
  h.native({kind:'session',session:null});await h.settle();
  h.expire(5000);await h.settle();assert.equal(batches().length,4);
});

test('browser identity distinguishes Edge from Chrome without disrupting session capture',async()=>{
  for(const [userAgent,browser]of [["Chrome/140.0","chrome"],["Chrome/140.0 Edg/140.0","edge"]]){
    const h=harness(false,userAgent);await h.settle();h.native({kind:'session',session:{id:'recording'}});await h.settle();
    assert.equal(h.posted.find(m=>m.kind==='client-info').browser,browser);
    assert.equal(h.posted.find(m=>m.kind==='client-info').version,'0.7.0');
    assert.equal((await h.send({kind:'status'})).captureReady,true);
  }
});
