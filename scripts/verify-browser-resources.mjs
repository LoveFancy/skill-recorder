import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
/** Fail packaging if extension/native helper resources are missing or mismatched. */
export async function verifyBrowserResources(resources,platform,arch){
 const extension=path.join(resources,'browser-extension');
 const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
 const identity=JSON.parse(await readFile(path.join(extension,'identity.json'),'utf8'));
 const id=Array.from(createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)).map(x=>String.fromCharCode(97+(x>>4),97+(x&15))).join('');
 if(id!==identity.id)throw new Error('Chrome extension ID does not match manifest public key');
 for(const file of ['worker.js','content.js','popup.html','popup.js'])await access(path.join(extension,file));
 const target=`${platform==='win32'?'windows':platform}-${arch==='x64'?'amd64':arch}`;
 const file=path.join(resources,'native/bin',target,platform==='win32'?'browser-host.exe':'browser-host');
 const bytes=await readFile(file);
 if(platform==='win32' && bytes.subarray(0,2).toString()!=='MZ')throw new Error('Chrome native host is not a Windows executable');
 if(platform==='darwin' && bytes.readUInt32LE(0)!==0xfeedfacf)throw new Error('Chrome native host is not a Mach-O executable');
 await access(path.join(resources,'native/bin/LICENSE-Go.txt'));
}
