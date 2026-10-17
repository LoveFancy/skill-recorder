import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWindowRoute} from './window-route';

test('available development route loads directly',async()=>{
  const calls:unknown[]=[];
  await loadWindowRoute({loadURL:async url=>{calls.push(url);},loadFile:async()=>{assert.fail('unexpected fallback');},isDestroyed:()=>false},'/dist/index.html','http://localhost:5174/','library');
  assert.deepEqual(calls,['http://localhost:5174/#library']);
});
test('unavailable development server falls back to local build with the requested route',async()=>{
  const calls:unknown[]=[];let reported=false;
  await loadWindowRoute({loadURL:async()=>{throw new Error('ERR_CONNECTION_REFUSED');},loadFile:async(file,options)=>{calls.push({file,options});},isDestroyed:()=>false},'/dist/index.html','http://localhost:5174/','library?autoAnalyze=session',()=>{reported=true;});
  assert.equal(reported,true);assert.deepEqual(calls,[{file:'/dist/index.html',options:{hash:'library?autoAnalyze=session'}}]);
});
test('production loads local files and closed windows are not reloaded',async()=>{
  let calls=0;
  const target={loadURL:async()=>{throw new Error('closed');},loadFile:async()=>{calls++;},isDestroyed:()=>false};
  await loadWindowRoute(target,'/dist/index.html');assert.equal(calls,1);
  await loadWindowRoute({...target,isDestroyed:()=>true},'/dist/index.html','http://localhost:5174/');assert.equal(calls,1);
});
