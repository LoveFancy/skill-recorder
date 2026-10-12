import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { renderAnnotation } from "./annotation-image";

const base = () => sharp({create:{width:200,height:100,channels:3,background:{r:10,g:20,b:30}}}).png().toBuffer();
test("partial screenshots retain only the chosen source region, including edge selections", async () => {
  const crop = await renderAnnotation(await base(),{x:0.25,y:0.2,width:0.5,height:0.6},"crop");
  const meta = await sharp(crop).metadata();
  assert.equal(meta.width,100); assert.equal(meta.height,60);
  const edge = await renderAnnotation(await base(),{x:0.995,y:0.99,width:0.005,height:0.01},"crop");
  assert.equal((await sharp(edge).metadata()).width,1);
  await assert.rejects(renderAnnotation(await base(),{x:0.2,y:0.2},"crop"));
});
test("saved live region and click annotations paint only their intended positions", async () => {
  const source = await base();
  for (const mode of ["region","click"] as const) {
    const image = await renderAnnotation(source,mode === "region" ? {x:0.25,y:0.2,width:0.5,height:0.6} : {x:0.5,y:0.5},mode);
    const {data,info} = await sharp(image).removeAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,200); assert.equal(info.height,100);
    const pixel=(x:number,y:number)=>[...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)];
    assert.deepEqual(pixel(5,5),[10,20,30]);
    assert.notDeepEqual(pixel(mode === "region" ? 50 : 100, mode === "region" ? 20 : 50),[10,20,30]);
  }
});
