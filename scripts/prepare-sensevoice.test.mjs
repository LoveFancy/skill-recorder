import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validArtifact} from './prepare-sensevoice.mjs';
test('model validation rejects same-size corrupt weights',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'model-check-'));
 try{const file=path.join(root,'model');const expected=Buffer.from('valid');
 const artifact={size:expected.length,sha256:createHash('sha256').update(expected).digest('hex')};
 await writeFile(file,expected);assert.equal(await validArtifact(file,artifact),true);
 await writeFile(file,'wrong');assert.equal(await validArtifact(file,artifact),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
