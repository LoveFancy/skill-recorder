import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {recordingMaterials} from './materials';
test('manual bundle masks text, withholds unprotected screenshots and rejects source traversal',async t=>{
 const root=mkdtempSync(path.join(tmpdir(),'recording-materials-'));const previous=process.env.SKILL_RECORDER_SESSIONS_DIR;process.env.SKILL_RECORDER_SESSIONS_DIR=root;t.after(()=>{if(previous===undefined)delete process.env.SKILL_RECORDER_SESSIONS_DIR;else process.env.SKILL_RECORDER_SESSIONS_DIR=previous;rmSync(root,{recursive:true,force:true});});
 const dir=path.join(root,'recording');mkdirSync(path.join(dir,'frames'),{recursive:true});const secret='ghp_'+'A'.repeat(36);writeFileSync(path.join(dir,'events.jsonl'),JSON.stringify({token:secret}));writeFileSync(path.join(dir,'frames','frames.json'),JSON.stringify([{file:'frame.jpg',tMs:1000}]));writeFileSync(path.join(dir,'frames','frame.jpg'),'private screenshot');
 const packet=await recordingMaterials('recording');assert.equal(JSON.stringify(packet).includes(secret),false);assert.equal(packet.images.length,0);assert.ok(packet.omitted.some(f=>f.reason.includes('截图脱敏不可用')));assert.ok(packet.omitted.some(f=>f.name==='audio.json'));
 let calls=0;const protectedPacket=await recordingMaterials('recording',{active:true,ready:true,stats:{framesBlurred:1,regionsBlurred:1},redactFrame:async()=>{calls++;return Buffer.from('redacted screenshot');}});assert.equal(calls,1);assert.equal(protectedPacket.images.length,1);assert.equal(JSON.stringify(protectedPacket).includes('private screenshot'),false);
 const outside=path.join(root,'outside.txt');writeFileSync(outside,'private');symlinkSync(outside,path.join(dir,'bundle.json'));await assert.rejects(recordingMaterials('recording'),/超出/);
});
