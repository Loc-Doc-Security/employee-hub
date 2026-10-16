// File storage for uploads (cleanliness photos for now). Local disk while developing; production
// will swap this for S3 (OMST's AWS_S3_BUCKET) behind the same two functions.
//
// Local folder: UPLOADS_DIR, or ./uploads by default.
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const root = () => path.resolve(process.env.UPLOADS_DIR?.trim() || "uploads");

export async function saveFile(bytes: Buffer, ext: string): Promise<string> {
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return key;
}

export async function loadFile(key: string): Promise<Buffer> {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return readFile(full);
}

/** Recognizes the image formats phones produce, from the file's first bytes (not its claimed type). */
export function sniffImage(bytes: Buffer): { ext: string; contentType: string } | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", contentType: "image/png" };
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { ext: "webp", contentType: "image/webp" };
  return null;
}
