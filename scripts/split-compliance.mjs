import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { sha256File, verifyComplianceDirectory } from './compliance.mjs';
const companionUrl='https://github.com/LoveFancy/skill-recorder/actions/workflows/windows.yml';
/** Full source bundle remains a separately distributed CI artifact. Retain all notices. */
export async function splitInstalledCompliance(directory, companion=path.resolve('.compliance')) {
  await verifyComplianceDirectory(companion,{requireSources:true,requireElectronNotices:true});
  const manifestPath=path.join(directory,'SOURCE-MANIFEST.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const full=JSON.parse(await readFile(path.join(companion,'SOURCE-MANIFEST.json'),'utf8'));
  if(JSON.stringify(manifest)!==JSON.stringify(full))throw new Error('Source companion differs from installed manifest');
  for(const source of manifest.sources)await rm(path.join(directory,source.file),{force:true});
  await rm(path.join(directory,'sources'),{recursive:true,force:true});
  await writeFile(manifestPath,JSON.stringify({...manifest,mode:'external',sources:[],companion:{artifact:'skill-recorder-windows-x64-compliance',url:companionUrl,manifestSha256:await sha256File(path.join(companion,'SOURCE-MANIFEST.json'))}},null,2));
  await writeFile(path.join(directory,'README.md'),`# Licenses and source materials\n\nKeep this directory with the application. Corresponding sources and relinking instructions are provided in the separate skill-recorder-windows-x64-compliance attachment from the same build.\n\nDownload: ${companionUrl}\n\nWhen redistributing, provide that attachment alongside the installer. See SOURCE-MANIFEST.json for the matching manifest checksum.\n`);
  await verifyInstalledCompliance(directory,companion);
}
export async function verifyInstalledCompliance(directory,companion=path.resolve('.compliance')) {
  await verifyComplianceDirectory(directory,{requireSources:false,requireElectronNotices:true});
  await verifyComplianceDirectory(companion,{requireSources:true,requireElectronNotices:true});
  const manifest=JSON.parse(await readFile(path.join(directory,'SOURCE-MANIFEST.json'),'utf8'));
  if(manifest.mode!=='external'||manifest.sources.length!==0||manifest.companion?.manifestSha256!==await sha256File(path.join(companion,'SOURCE-MANIFEST.json')))throw new Error('Missing or mismatched source companion');
}
