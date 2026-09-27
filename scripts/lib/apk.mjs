/**
 * Minimal APK reader: pull one entry out of the zip, and read versionName and
 * versionCode out of the binary AndroidManifest.
 *
 * The SDK's aapt2 and aapt are x86-64 binaries, so on an aarch64 host they
 * cannot run at all and AGP quietly skips the steps that need them. A release
 * script that shells out to them therefore breaks on exactly the machine that
 * built the APK, and the obvious fallback is to type the version in by hand,
 * which is how a stale versionCode ships. The manifest is a small, stable
 * format and reading it directly removes the dependency entirely, which also
 * means the release works in CI without the SDK layout being predictable.
 */
import fs from "node:fs";
import zlib from "node:zlib";

const SIG_LFH = 0x04034b50;
const SIG_CDH = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const RES_XML_TYPE = 0x0003;
const CHUNK_STRING_POOL = 0x0001;
const CHUNK_START_ELEMENT = 0x0102;

const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const UTF8_FLAG = 0x100;

function findEOCD(buf) {
  const earliest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error("End of central directory not found; this is not a zip file.");
}

function centralDirectory(buf) {
  const eocd = findEOCD(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CDH) throw new Error(`Bad central directory at byte ${p}.`);
    const fnLen = buf.readUInt16LE(p + 28);
    entries.push({
      name: buf.subarray(p + 46, p + 46 + fnLen).toString(),
      method: buf.readUInt16LE(p + 10),
      csize: buf.readUInt32LE(p + 20),
      localHeader: buf.readUInt32LE(p + 42),
    });
    p += 46 + fnLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return entries;
}

/** Return one entry as a Buffer, or null when the archive has no such entry. */
export function readZipEntry(buf, name) {
  const entry = centralDirectory(buf).find((e) => e.name === name);
  if (!entry) return null;
  const lho = entry.localHeader;
  if (buf.readUInt32LE(lho) !== SIG_LFH) throw new Error(`Bad local header for ${name}.`);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const raw = buf.subarray(start, start + entry.csize);
  return entry.method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
}

function readStringPool(buf, start) {
  const headerSize = buf.readUInt16LE(start + 2);
  const stringCount = buf.readUInt32LE(start + 8);
  const flags = buf.readUInt32LE(start + 16);
  const stringsStart = buf.readUInt32LE(start + 20);
  const isUtf8 = (flags & UTF8_FLAG) !== 0;
  const pool = [];

  for (let i = 0; i < stringCount; i++) {
    let p = start + stringsStart + buf.readUInt32LE(start + headerSize + i * 4);
    if (isUtf8) {
      // The two character counts are each one byte, or two if the high bit is
      // set on the first.
      let n = buf.readUInt8(p++);
      if (n & 0x80) p++;
      let len = buf.readUInt8(p++);
      if (len & 0x80) len = ((len & 0x7f) << 8) | buf.readUInt8(p++);
      pool.push(buf.toString("utf8", p, p + len));
    } else {
      const len = buf.readUInt16LE(p);
      p += 2;
      pool.push(buf.toString("utf16le", p, p + len * 2));
    }
  }
  return pool;
}

/** { versionName, versionCode } from an APK's manifest, or throws. */
export function readManifestVersion(apkPath) {
  const buf = fs.readFileSync(apkPath);
  const xml = readZipEntry(buf, "AndroidManifest.xml");
  if (!xml) throw new Error(`${apkPath} has no AndroidManifest.xml`);
  if (xml.readUInt16LE(0) !== RES_XML_TYPE) {
    throw new Error("AndroidManifest.xml is not binary AXML.");
  }

  const total = xml.readUInt32LE(4);
  let p = 8;
  let pool = null;
  let found = null;

  while (p + 8 <= total) {
    const type = xml.readUInt16LE(p);
    const size = xml.readUInt32LE(p + 4);

    if (type === CHUNK_STRING_POOL) {
      pool = readStringPool(xml, p);
    } else if (type === CHUNK_START_ELEMENT && pool) {
      // 8 chunk header + 4 line number + 4 comment = 16, then the attrExt.
      const elementName = pool[xml.readUInt32LE(p + 20)];
      if (elementName === "manifest") {
        // attributeStart is measured from the start of attrExt, at offset 16.
        const attributeStart = xml.readUInt16LE(p + 24);
        const attributeSize = xml.readUInt16LE(p + 26);
        const attributeCount = xml.readUInt16LE(p + 28);
        const base = 16 + attributeStart;

        for (let i = 0; i < attributeCount; i++) {
          const a = p + base + i * attributeSize;
          const attrName = pool[xml.readUInt32LE(a + 4)];
          const dataType = xml.readUInt8(a + 15);
          const data = xml.readInt32LE(a + 16);
          if (attrName === "versionName" && dataType === TYPE_STRING) {
            found = { ...(found || {}), versionName: pool[data] };
          } else if (attrName === "versionCode" && dataType === TYPE_INT_DEC) {
            found = { ...(found || {}), versionCode: data };
          }
        }
      }
    }
    p += size;
  }

  if (!found || !found.versionName || found.versionCode === undefined) {
    throw new Error("Could not find versionName and versionCode on the <manifest> element.");
  }
  return found;
}
