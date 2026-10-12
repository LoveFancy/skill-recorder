const { ipcRenderer } = require("electron");
ipcRenderer.on("region:init", (_event, { mode }) => {
  const box = document.getElementById("box"), hint = document.getElementById("hint"), confirm = document.getElementById("confirm");
  hint.textContent = mode === "crop" ? "拖动选择截图范围 · 框内双击或点击保存 · Esc 取消" : "在当前界面框选重点 · 框内双击或点击确认 · Esc 取消";
  confirm.textContent = mode === "crop" ? "保存截图（Enter）" : "确认（Enter）";
  if (mode === "click") {
    hint.textContent = "点击要标记的位置，自动保存带点击图标的截图 · Esc 取消";
    confirm.hidden = true;
    let finishing = false;
    document.addEventListener("pointerdown", e => {
      if (finishing || e.button !== 0 || e.target.closest("#tools")) return;
      finishing = true;
      const click = document.getElementById("click");
      Object.assign(click.style,{display:"block",left:`${e.clientX}px`,top:`${e.clientY}px`});
      setTimeout(() => ipcRenderer.send("region:finish", { x: Math.max(0, Math.min(1, e.clientX/innerWidth)), y: Math.max(0, Math.min(1, e.clientY/innerHeight)) }), 180);
    });
    document.getElementById("cancel").onclick = () => ipcRenderer.send("region:finish", null);
    document.addEventListener("keydown", e => { if (e.key === "Escape") ipcRenderer.send("region:finish", null); });
    return;
  }
  const bounds = { x:0,y:0,width:1,height:1 };
  const limitBox = document.getElementById("limit");
  Object.assign(limitBox.style, { left:`${bounds.x*100}%`,top:`${bounds.y*100}%`,width:`${bounds.width*100}%`,height:`${bounds.height*100}%` });
  let anchor = null, selected = null;
  const point = e => ({ x:Math.max(bounds.x,Math.min(bounds.x+bounds.width,e.clientX/innerWidth)), y:Math.max(bounds.y,Math.min(bounds.y+bounds.height,e.clientY/innerHeight)) });
  const insideSelection = e => {
    if (!selected || confirm.disabled) return false;
    const p = point(e);
    return p.x >= selected.x && p.x <= selected.x+selected.width && p.y >= selected.y && p.y <= selected.y+selected.height;
  };
  document.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest("#tools")) return;
    if (insideSelection(e)) return;
    anchor = point(e); selected = null; confirm.disabled = true;
  });
  document.addEventListener("pointermove", e => {
    if (!anchor) return;
    const p = point(e);
    selected = { x:Math.min(p.x,anchor.x),y:Math.min(p.y,anchor.y),width:Math.abs(p.x-anchor.x),height:Math.abs(p.y-anchor.y) };
    Object.assign(box.style,{ display:"block",left:`${selected.x*100}%`,top:`${selected.y*100}%`,width:`${selected.width*100}%`,height:`${selected.height*100}%` });
  });
  document.addEventListener("pointerup", () => {
    anchor = null;
    confirm.disabled = !selected || selected.width*innerWidth < 16 || selected.height*innerHeight < 16;
    if (!confirm.disabled) hint.textContent = "已选择 · 框内双击或按 Enter 保存 · 框外拖动重新选择";
  });
  const accept = () => { if (!confirm.disabled) ipcRenderer.send("region:finish", selected); };
  document.addEventListener("dblclick", e => {
    if (e.button === 0 && !e.target.closest("#tools") && insideSelection(e)) accept();
  });
  confirm.onclick = accept;
  document.getElementById("cancel").onclick = () => ipcRenderer.send("region:finish", null);
  document.addEventListener("keydown", e => { if (e.key === "Escape") ipcRenderer.send("region:finish", null); if (e.key === "Enter") accept(); });
});
