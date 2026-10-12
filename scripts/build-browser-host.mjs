import { mkdirSync,existsSync,copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const cachedGo=path.join(os.homedir(),'.cache/skill-recorder/toolchains/go/bin',process.platform==='win32'?'go.exe':'go');
const go=process.env.SKILL_RECORDER_GO || (existsSync(cachedGo)?cachedGo:'go');
const root=path.resolve(import.meta.dirname,'..');
mkdirSync(path.join(root,'native/bin'),{recursive:true});
copyFileSync(path.join(root,'third_party/package-licenses/go-BSD-3-Clause.txt'),path.join(root,'native/bin/LICENSE-Go.txt'));
const targets=process.argv.includes('--all')?[['darwin','arm64'],['darwin','amd64'],['windows','amd64']]:[[process.platform==='win32'?'windows':process.platform,process.arch==='x64'?'amd64':process.arch]];
for(const [os,arch] of targets){
 const out=path.join(root,'native/bin',`${os}-${arch}`);mkdirSync(out,{recursive:true});
 const r=spawnSync(go,['build','-trimpath','-ldflags=-s -w','-o',path.join(out,os==='windows'?'browser-host.exe':'browser-host'),'.'],{cwd:path.join(root,'native/browser-host'),env:{...process.env,GOOS:os,GOARCH:arch,CGO_ENABLED:'0'},stdio:'inherit'});
 if(r.error || r.status!==0) throw r.error || new Error('Native host build failed; install Go >=1.23 or set SKILL_RECORDER_GO.');
}
