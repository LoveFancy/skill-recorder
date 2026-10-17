import { createWriteStream, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ZipArchive } from "archiver";

/** Write next to the destination, then replace it only after the entire file is complete. */
export async function exportDocumentFiles(target: string, markdown: string, assets: { name: string; bytes: Buffer }[]): Promise<void> {
  if (assets.some(a => !/^assets\/[a-f0-9]{64}\.jpg$/.test(a.name))) throw new Error("无效文档资源路径。");
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    if (assets.length) await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(temp, { mode: 0o600, flags: "wx" });
      const archive = new ZipArchive({ zlib: { level: 9 } });
      const fail = (error: Error) => { archive.abort(); output.destroy(); reject(error); };
      output.once("close", resolve); output.once("error", fail); archive.once("error", fail); archive.once("warning", fail);
      archive.pipe(output);
      archive.append(markdown, { name: "document.md" });
      for (const asset of assets) archive.append(asset.bytes, { name: asset.name });
      void archive.finalize().catch(fail);
    });
    else writeFileSync(temp, markdown, { mode: 0o600, flag: "wx" });
    renameSync(temp, target);
  } finally {
    try { unlinkSync(temp); } catch { /* Already renamed, or creation failed. */ }
  }
}
