import { createReadStream, existsSync } from 'node:fs';
import { mkdir, copyFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { MODEL_ARTIFACTS, MODEL_REPOSITORY, REVISION, NARRATION_MODEL_ID } from '../common/sensevoice-model.ts';
export async function validArtifact(file, artifact) {
  try {
    if((await stat(file)).size!==artifact.size)return false;
    const hash=createHash('sha256');
    for await(const chunk of createReadStream(file))hash.update(chunk);
    return hash.digest('hex')===artifact.sha256;
  } catch { return false; }
}
export async function verifyModelResources(base) {
  for(const artifact of MODEL_ARTIFACTS) {
    if(!await validArtifact(path.join(base,NARRATION_MODEL_ID,artifact.file),artifact))throw new Error(`Invalid bundled SenseVoice ${artifact.file}`);
  }
  for(const file of ['SenseVoice-MODEL-LICENSE.txt','SenseVoice-CONVERSION-LICENSE.txt']) {
    const bundled=await import('node:fs/promises').then(fs=>fs.readFile(path.join(base,NARRATION_MODEL_ID,file)));
    const original=await import('node:fs/promises').then(fs=>fs.readFile(path.resolve('third_party/models',file)));
    if(!bundled.equals(original))throw new Error(`Invalid model license ${file}`);
  }
}
async function prepare() {
  const root=path.resolve('.models',NARRATION_MODEL_ID);await mkdir(root,{recursive:true});
  const cache=process.env.SKILL_RECORDER_MODELS_DIR ?? (process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support/skill-recorder/models'):path.join(process.env.APPDATA??os.homedir(),'skill-recorder/models'));
  for(const artifact of MODEL_ARTIFACTS) {
    const target=path.join(root,artifact.file);
    if(await validArtifact(target,artifact))continue;
    const cached=path.join(cache,NARRATION_MODEL_ID,artifact.file);
    if(await validArtifact(cached,artifact)){await copyFile(cached,target);continue;}
    let success=false;
    for(const host of ['https://huggingface.co','https://hf-mirror.com']) {
      const temp=target+'.tmp';
      try {
        const response=await fetch(`${host}/${MODEL_REPOSITORY}/resolve/${REVISION}/${artifact.file}`,{signal:AbortSignal.timeout(600000)});
        if(!response.ok||!response.body)throw new Error(`HTTP ${response.status}`);
        const {open}=await import('node:fs/promises');const handle=await open(temp,'w');
        try {let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>artifact.size)throw new Error('Oversized model');await handle.writeFile(chunk);}} finally{await handle.close();}
        if(!await validArtifact(temp,artifact))throw new Error('Model checksum mismatch');
        await rename(temp,target);success=true;break;
      } catch(error){console.warn(`${host}: ${error.message}`);} finally{await rm(temp,{force:true});}
    }
    if(!success)throw new Error(`Could not prepare ${artifact.file}`);
  }
  for(const file of ['SenseVoice-MODEL-LICENSE.txt','SenseVoice-CONVERSION-LICENSE.txt'])await copyFile(path.resolve('third_party/models',file),path.join(root,file));
  await writeFile(path.join(root,'PROVENANCE.json'),JSON.stringify({repository:MODEL_REPOSITORY,revision:REVISION,artifacts:MODEL_ARTIFACTS},null,2));
  await verifyModelResources(path.resolve('.models'));console.log('Verified bundled SenseVoice Small INT8 (offline).');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepare();
