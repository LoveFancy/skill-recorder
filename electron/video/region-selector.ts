import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCaptureRegion, isCapturePoint, type AnnotationMode, type CapturePoint, type CaptureRegion } from "../../common/capture-region";
import type { WindowBounds } from "../recording-controls-bounds";
let active = false;

/** Select directly over live content; capture while the overlay and toolbar are hidden. */
export async function selectRegion<T>(bounds: WindowBounds, mode: AnnotationMode, capture: (selection: CaptureRegion | CapturePoint) => Promise<T>): Promise<T | null> {
  if (active) throw new Error("标注工具已打开");
  active = true;
  const owner = BrowserWindow.getAllWindows().find(w => w.isVisible() && w.webContents.getURL().includes("recording-controls"));
  let win: BrowserWindow;
  try {
    win = new BrowserWindow({
      ...bounds, show:false, frame:false, transparent:true, resizable:false, movable:false, skipTaskbar:true, alwaysOnTop:true, hasShadow:false,
      webPreferences:{preload:path.join(path.dirname(fileURLToPath(import.meta.url)),"video","region-preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true},
    });
  } catch (error) { active = false; throw error; }
  win.setContentProtection(true);
  win.setAlwaysOnTop(true,"screen-saver");
  win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  const restoreOwner = !!owner && !owner.isDestroyed() && owner.isVisible();
  return new Promise((resolve,reject) => {
    let settled = false;
    let capturing = false;
    const timeout = setTimeout(() => void finish(null),120_000);
    const finish = async (selection: CaptureRegion | CapturePoint | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ipcMain.removeListener("region:finish",listener);
      capturing = true;
      if (!win.isDestroyed()) win.destroy();
      try {
        if (error) throw error;
        // Give the compositor time to remove both UI surfaces before grabbing pixels.
        if (selection) await new Promise(r => setTimeout(r,120));
        resolve(selection ? await capture(selection) : null);
      } catch (err) { reject(err); }
      finally {
        active = false;
        if (restoreOwner && owner && !owner.isDestroyed()) owner.showInactive();
      }
    };
    const listener = (event: Electron.IpcMainEvent, selection: unknown) => {
      if (event.sender !== win.webContents) return;
      if (selection !== null && !(mode === "click" ? isCapturePoint(selection) : isCaptureRegion(selection))) return;
      void finish(selection as CaptureRegion | CapturePoint | null);
    };
    ipcMain.on("region:finish",listener);
    win.on("closed",() => { if (!capturing) void finish(null); });
    void win.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)),"video","region.html")).then(() => {
      if (settled) return;
      if (restoreOwner && owner && !owner.isDestroyed()) owner.hide();
      win.webContents.send("region:init",{mode});
      win.show(); win.focus();
    }).catch(error => void finish(null,error));
  });
}
