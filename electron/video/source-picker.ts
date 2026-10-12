import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScreenSource } from "../../common/screen";
let active = false;
export async function pickRecordingSource(sources: ScreenSource[], selectedId: string): Promise<string | null> {
  if (active) throw new Error("录制来源选择窗口已打开");
  const owner = BrowserWindow.getFocusedWindow();
  const win = new BrowserWindow({ width:1040,height:720,minWidth:680,minHeight:480,show:false,title:"选择录制内容",parent:owner ?? undefined,modal:!!owner,webPreferences:{ preload:path.join(path.dirname(fileURLToPath(import.meta.url)),"video","source-picker-preload.cjs"),sandbox:true,contextIsolation:true,nodeIntegration:false } });
  active = true;
  win.setContentProtection(true);
  return new Promise((resolve,reject) => {
    let settled=false;
    const finish=(id:string|null,error?:unknown) => {
      if(settled)return;
      settled=true;active=false;
      ipcMain.removeListener("source-picker:finish",listener);
      if(!win.isDestroyed())win.destroy();
      if(owner && !owner.isDestroyed())owner.focus();
      if(error)reject(error);else resolve(id);
    };
    const listener=(event:Electron.IpcMainEvent,id:unknown) => {
      if(event.sender!==win.webContents)return;
      if(id===null || (typeof id==="string" && sources.some(s=>s.id===id)))finish(id);
    };
    ipcMain.on("source-picker:finish",listener);
    win.on("closed",()=>finish(null));
    void win.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)),"video","source-picker.html")).then(()=>{
      if(settled)return;
      win.webContents.send("source-picker:init",{sources,selectedId});win.show();
    }).catch(error=>finish(null,error));
  });
}
