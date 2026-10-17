import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

function connect(mode, extra={}, mock=false) {
  const child=spawn(process.execPath,[...(mock?['--import',path.resolve('scripts/builtin-mail-mock.mjs')]:[]),path.resolve('dist-electron/builtin-mcp.js')],{env:{...process.env,SKILL_RECORDER_BUILTIN:mode,...extra},stdio:['pipe','pipe','pipe']});
  const pending=new Map();let seq=0,buffer='',errors='';
  child.stderr.on('data',chunk=>errors+=chunk);
  child.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);const response=JSON.parse(line);const request=pending.get(response.id);if(request){pending.delete(response.id);clearTimeout(request.timer);response.error?request.reject(new Error(JSON.stringify(response.error))):request.resolve(response.result);}}});
  child.on('close',()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('MCP exited: '+errors));}pending.clear();});
  return {
    request(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('MCP timeout: '+errors));},40000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});},
    async close(){child.stdin.end();if(child.exitCode!==null)return;await once(child,'close');},
  };
}
const account={address:'user@example.com',username:'user@example.com',password:'synthetic-test-password',imapHost:'imap.example.com',imapPort:993,smtpHost:'smtp.example.com',smtpPort:465};
const mail=connect('recorder-mail',{SKILL_RECORDER_MAIL_ACCOUNT:JSON.stringify(account)},true);
try {
  assert.equal((await mail.request('initialize')).serverInfo.name,'recorder-mail');
  assert.deepEqual((await mail.request('tools/list')).tools.map(t=>t.name),['mail_search','mail_read','mail_send']);
  const search=await mail.request('tools/call',{name:'mail_search',arguments:{query:'invoice'}});
  assert.equal(JSON.parse(search.content[0].text).messages[0].uid,12);
  const read=await mail.request('tools/call',{name:'mail_read',arguments:{uid:12}});
  assert.match(JSON.parse(read.content[0].text).text,/Invoice amount: 1200/);
  const send=await mail.request('tools/call',{name:'mail_send',arguments:{to:['recipient@example.com'],subject:'Test',text:'A test message'}});
  assert.equal(JSON.parse(send.content[0].text).messageId,'mock-message');
}finally{await mail.close();}
const restricted=connect('recorder-mail',{SKILL_RECORDER_MAIL_ACCOUNT:JSON.stringify(account),SKILL_RECORDER_BUILTIN_ALLOWED_TOOLS:'["mail_search","mail_read"]'},true);
try {
  assert.deepEqual((await restricted.request('tools/list')).tools.map(t=>t.name),['mail_search','mail_read']);
  const denied=await restricted.request('tools/call',{name:'mail_send',arguments:{to:['recipient@example.com'],subject:'Test',text:'A test message'}});
  assert.equal(denied.isError,true);
  assert.doesNotMatch(JSON.stringify(denied),/synthetic-test-password/);
}finally{await restricted.close();}
const http=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><title>Recorder browser smoke</title><body><h1>Invoice review</h1><p>Recorded order 1200</p><button>Confirm</button></body></html>');});
http.listen(0,'127.0.0.1');await once(http,'listening');
const profile=await mkdtemp(path.join(os.tmpdir(),'recorder-browser-smoke-'));
const browser=connect('recorder-browser',{SKILL_RECORDER_BROWSER_PROFILE:profile,SKILL_RECORDER_BUILTIN_ALLOWED_TOOLS:'["browser_navigate","browser_snapshot","browser_screenshot"]'});
try {
  const names=(await browser.request('tools/list')).tools.map(t=>t.name);assert.equal(names.includes('browser_click'),false);
  const navigated=await browser.request('tools/call',{name:'browser_navigate',arguments:{url:`http://127.0.0.1:${http.address().port}`}});
  assert.equal(navigated.isError,undefined,JSON.stringify(navigated));
  assert.match(navigated.content[0].text,/Invoice review/);
  assert.match((await browser.request('tools/call',{name:'browser_snapshot'})).content[0].text,/Recorded order 1200/);
  const screenshot=await browser.request('tools/call',{name:'browser_screenshot'});
  assert.equal(screenshot.content[0].mimeType,'image/png');assert.ok(Buffer.from(screenshot.content[0].data,'base64').length>1000);
  assert.equal((await browser.request('tools/call',{name:'browser_click',arguments:{selector:'button'}})).isError,true);
} finally {await browser.close();http.close();await rm(profile,{recursive:true,force:true});}
console.log('PASS: real Playwright navigation/snapshot/screenshot; IMAP/SMTP adapter and MIME parsing with mocked transport; deep-analysis write tools excluded.');
