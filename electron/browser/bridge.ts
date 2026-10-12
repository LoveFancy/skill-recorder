import { createServer, connect, type Server, type Socket } from "node:net";
import { randomBytes, createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { Collector, CollectorContext } from "../recorder/collector";
import type { BrowserStatus } from "../../common/browser";
import { validateBrowserEvent } from "./protocol";

/** One authenticated local connection; ACK only after the session write callback. */
export class BrowserBridge implements Collector {
  readonly name="chrome-extension";
  private server:Server|null=null;
  private socket:Socket|null=null;
  private ctx:CollectorContext|null=null;
  private session:{id:string;startedAt:number}|null=null;
  private seen=new Set<string>();
  private count=0;
  private bound=false;
  private error:string|null=null;
  private token="";
  private endpoint="";
  private pending=Promise.resolve();
  private drained:(()=>void)|null=null;
  readonly extensionDir:string;
  constructor(private userData:string,private resources:string){this.extensionDir=path.join(userData,"chrome-extension");}
  status():BrowserStatus{return {connected:!!this.socket,sessionId:this.session?.id??null,bound:this.bound,eventCount:this.count,extensionDir:this.extensionDir,error:this.error};}
  async initialize(registerNative=true):Promise<void>{
    const home=path.join(this.userData,"browser-companion");mkdirSync(home,{recursive:true,mode:0o700});
    const extension=path.join(this.resources,"browser-extension");
    const native=path.join(this.resources,"native","bin",`${process.platform==='win32'?'windows':process.platform}-${process.arch==='x64'?'amd64':process.arch}`,process.platform==='win32'?'browser-host.exe':'browser-host');
    if(!existsSync(native)) throw new Error("浏览器原生桥未构建，请运行 npm run build:browser-host");
    cpSync(extension,this.extensionDir,{recursive:true});
    const nativeHash=createHash("sha256").update(readFileSync(native)).digest("hex").slice(0,12);
    const helper=path.join(home,`${nativeHash}-${path.basename(native)}`);if(!existsSync(helper))copyFileSync(native,helper);if(process.platform!=='win32')chmodSync(helper,0o700);
    const hash=createHash('sha256').update(this.userData).digest('hex').slice(0,20);
    this.endpoint=process.platform==='win32'?`\\\\.\\pipe\\skill-recorder-${hash}`:path.join(os.tmpdir(),`skill-recorder-${hash}.sock`);
    // Do not replace another running recorder's endpoint or pairing secret.
    const existing = await new Promise<boolean>((resolve,reject)=>{
      const probe=connect(this.endpoint);
      const timer=setTimeout(()=>{probe.destroy();reject(new Error("本机浏览器桥状态未知，请关闭另一个录制器实例"));},1000);
      probe.once("connect",()=>{clearTimeout(timer);probe.destroy();resolve(true);});
      probe.once("error",(err:NodeJS.ErrnoException)=>{clearTimeout(timer);probe.destroy();if(err.code==="ENOENT"||err.code==="ECONNREFUSED")resolve(false);else reject(err);});
    });
    if(existing)throw new Error("另一个录制器实例正在提供浏览器连接，请关闭重复实例");
    // Secret survives neither restart nor a helper copied from another profile.
    this.token=randomBytes(32).toString('hex');
    writeFileSync(path.join(home,'bridge.json'),JSON.stringify({endpoint:this.endpoint,token:this.token}),{mode:0o600});
    const identity=JSON.parse(readFileSync(path.join(extension,'identity.json'),'utf8')) as {id:string};
    const manifest={name:'com.skillrecorder.browser',description:'Skill Recorder offline browser bridge',path:helper,type:'stdio',allowed_origins:[`chrome-extension://${identity.id}/`]};
    const hostManifest=process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.skillrecorder.browser.json'):path.join(home,'com.skillrecorder.browser.json');
    if(registerNative){
    mkdirSync(path.dirname(hostManifest),{recursive:true});writeFileSync(hostManifest,JSON.stringify(manifest,null,2));
    if(process.platform==='win32')execFileSync('reg.exe',['add','HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.skillrecorder.browser','/ve','/t','REG_SZ','/d',hostManifest,'/f'],{windowsHide:true});
    }
    if(process.platform!=='win32' && existsSync(this.endpoint))rmSync(this.endpoint);
    this.server=createServer(socket=>this.accept(socket));
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(this.endpoint,()=>{this.server!.off('error',reject);resolve();});});
    this.server.on('error',e=>{this.error=e.message;});
    if(process.platform!=='win32')chmodSync(this.endpoint,0o600);
  }
  private send(value:unknown,socket=this.socket):void {if(socket && !socket.destroyed)socket.write(JSON.stringify(value)+'\n');}
  private accept(socket:Socket):void {
    socket.setEncoding('utf8');
    let buffer='';let authenticated=false;let queued=0;
    const authTimer=setTimeout(()=>socket.destroy(),3000);
    socket.on('error',()=>{});
    socket.on('close',()=>{clearTimeout(authTimer);if(this.socket===socket){this.socket=null;this.bound=false;}});
    socket.on('data',chunk=>{
      buffer+=chunk.toString();if(buffer.length>256*1024){socket.destroy();return;}
      for(let newline;(newline=buffer.indexOf('\n'))>=0;){
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
        let message:any;try{message=JSON.parse(line);}catch{socket.destroy();return;}
        if(!authenticated){
          if(message.kind!=='hello'||message.token!==this.token){socket.destroy();return;}
          authenticated=true;clearTimeout(authTimer);this.socket?.destroy();this.socket=socket;
          this.send({kind:'session',session:this.session},socket);continue;
        }
        if(++queued>100){socket.destroy();return;}
        this.pending=this.pending.then(()=>this.receive(message,socket)).catch(e=>{this.error=String(e);this.send({kind:'error',error:this.error},socket);}).finally(()=>{queued--;});
      }
    });
  }
  private async receive(message:any,socket:Socket):Promise<void>{
    if(socket!==this.socket)return;
    if(message.kind==='bound'){this.bound=message.bound===true;return;}
    if(message.kind==='drained'){this.drained?.();return;}
    if(message.kind==='capture-error'){this.error=String(message.error).slice(0,512);return;}
    if(message.kind!=='events'||!Array.isArray(message.events)||message.events.length>50)throw new Error('invalid batch');
    if(!this.ctx||!this.session){this.send({kind:'session',session:null},socket);return;}
    const ack:string[]=[];
    for(const raw of message.events){
      const event=validateBrowserEvent(raw,this.session.id,this.session.startedAt);
      if(!this.seen.has(event.eventId)){
        if(this.seen.size>=100000)throw new Error('浏览器事件超过单次录制上限，请结束录制');
        if(!this.ctx.publishDurable)throw new Error('durable event publisher missing');
        await this.ctx.publishDurable('browser.action',event);
        this.seen.add(event.eventId);this.count++;
      }
      ack.push(event.eventId);
    }
    this.send({kind:'ack',ids:ack},socket);
  }
  start(ctx:CollectorContext):void {
    const meta=JSON.parse(readFileSync(path.join(ctx.sessionDir,'session.json'),'utf8'));
    this.ctx=ctx;this.session={id:meta.id,startedAt:meta.startedAt};this.seen.clear();this.count=0;this.error=null;
    this.send({kind:'session',session:this.session});
  }
  async stop():Promise<void>{
    if(this.socket){await new Promise<void>(resolve=>{
      const timer=setTimeout(()=>{this.error='浏览器结束同步超时；请检查最后的操作是否已采集';this.drained=null;resolve();},2500);
      this.drained=()=>{clearTimeout(timer);this.drained=null;resolve();};this.send({kind:'drain'});
    });}
    await this.pending;this.ctx=null;this.session=null;this.send({kind:'session',session:null});
  }
  close():void{this.socket?.destroy();this.server?.close();}
}
