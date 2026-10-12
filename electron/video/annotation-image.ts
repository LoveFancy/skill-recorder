import sharp from "sharp";
import { isCaptureRegion, type AnnotationMode, type CapturePoint, type CaptureRegion } from "../../common/capture-region";

export async function renderAnnotation(raw: Buffer, selection: CaptureRegion | CapturePoint, mode: AnnotationMode) {
  const {width:w,height:h} = await sharp(raw).metadata();
  if (!w || !h) throw new Error("无法读取截图尺寸");
  if (mode === "crop") {
    if (!isCaptureRegion(selection)) throw new Error("无效的截图范围");
    const left = Math.min(w-1,Math.floor(selection.x*w));
    const top = Math.min(h-1,Math.floor(selection.y*h));
    const right = Math.min(w,Math.ceil((selection.x+selection.width)*w));
    const bottom = Math.min(h,Math.ceil((selection.y+selection.height)*h));
    return sharp(raw).extract({left,top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)}).png().toBuffer();
  }
  const shape = isCaptureRegion(selection)
    ? `<rect x="${selection.x*w}" y="${selection.y*h}" width="${selection.width*w}" height="${selection.height*h}" fill="#ff5935" fill-opacity="0.08" stroke="#ff5935" stroke-width="4"/>`
    : `<circle cx="${selection.x*w}" cy="${selection.y*h}" r="20" fill="#ff5935" fill-opacity="0.3" stroke="white" stroke-width="3"/><circle cx="${selection.x*w}" cy="${selection.y*h}" r="7" fill="#ff5935"/><path d="M ${selection.x*w-28} ${selection.y*h} h 12 M ${selection.x*w+16} ${selection.y*h} h 12 M ${selection.x*w} ${selection.y*h-28} v 12 M ${selection.x*w} ${selection.y*h+16} v 12" stroke="#ff5935" stroke-width="3"/>`;
  return sharp(raw).composite([{input:Buffer.from(`<svg width="${w}" height="${h}">${shape}</svg>`)}]).png().toBuffer();
}
