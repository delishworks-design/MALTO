#!/usr/bin/env node
/**
 * Align an APK's zip entries to 4 bytes.
 *
 * The `zipalign` tool in the Android SDK is an x86-64 binary and cannot run on
 * this aarch64 build host. AGP invokes it without checking the exit status, so
 * a release APK can come out of the build completely unaligned: 201 of 258
 * stored entries start on an arbitrary byte offset. It still installs, but
 * uncompressed resources are mapped straight out of the archive and are slower
 * to read, so this is not something worth publishing.
 *
 * This does the same thing `zipalign 4` does: the payload of every entry starts
 * on a 4-byte boundary, and the padding is written into the local header's
 * extra field. Android expects that padding to be a well formed extra field
 * carrying the id 0xd935 rather than arbitrary bytes, so this writes that too.
 *
 * Rewriting the archive destroys any existing signature, and the correct order
 * is build, align, then sign. This script only aligns; sign afterwards with
 * apksigner.
 *
 *   node scripts/align-apk.mjs <in.apk> <out.apk>
 *   node scripts/align-apk.mjs --check <in.apk>
 */
import fs from "node:fs";

const SIG_LFH = 0x04034b50;
const SIG_CDH = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_DATA_DESCRIPTOR = 0x08074b50;
const ALIGNMENT_MARKER = 0xd935; // the extra field id aapt2 uses for padding

function findEOCD(buf) {
  // The comment can follow the record, so the signature is not at a fixed
  // offset from the end. Scan backwards over the largest possible comment.
  const earliest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error("End of central directory not found; this is not a zip file.");
}

function readEntries(buf) {
  const eocd = findEOCD(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CDH) {
      throw new Error(`Bad central directory signature at byte ${p}.`);
    }
    const fnLen = buf.readUInt16LE(p + 28);
    const exLen = buf.readUInt16LE(p + 30);
    const cmLen = buf.readUInt16LE(p + 32);

    const e = {
      verMade: buf.readUInt16LE(p + 4),
      verNeed: buf.readUInt16LE(p + 6),
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14),
      crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      diskStart: buf.readUInt16LE(p + 34),
      internalAttr: buf.readUInt16LE(p + 36),
      extAttr: buf.readUInt32LE(p + 38),
      name: buf.subarray(p + 46, p + 46 + fnLen),
      comment: buf.subarray(p + 46 + fnLen + exLen, p + 46 + fnLen + exLen + cmLen),
    };

    // The local header is the authority on sizes: an entry streamed with a
    // data descriptor leaves these fields zeroed there and writes the real
    // values after the payload, so reading them from here keeps the rebuilt
    // archive byte for byte equivalent in meaning.
    const lho = buf.readUInt32LE(p + 42);
    if (buf.readUInt32LE(lho) !== SIG_LFH) {
      throw new Error(`Bad local header for ${e.name.toString()}.`);
    }
    e.lCrc = buf.readUInt32LE(lho + 14);
    e.lCsize = buf.readUInt32LE(lho + 18);
    e.lUsize = buf.readUInt32LE(lho + 22);
    const lFnLen = buf.readUInt16LE(lho + 26);
    const lExLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lFnLen + lExLen;
    e.raw = buf.subarray(dataStart, dataStart + e.csize);
    e.dataStart = dataStart;

    // Carry any data descriptor through untouched, including the optional
    // signature, or the next entry would not be found.
    if (e.flags & 0x08) {
      let after = dataStart + e.csize;
      after += buf.readUInt32LE(after) === SIG_DATA_DESCRIPTOR ? 16 : 12;
      e.descriptor = buf.subarray(dataStart + e.csize, after);
    } else {
      e.descriptor = Buffer.alloc(0);
    }

    entries.push(e);
    p += 46 + fnLen + exLen + cmLen;
  }

  return {
    entries,
    eocdComment: buf.subarray(eocd + 22, eocd + 22 + buf.readUInt16LE(eocd + 20)),
  };
}

function buildAlignmentExtra(pad) {
  if (pad === 0) return Buffer.alloc(0);
  if (pad < 4) return Buffer.alloc(pad); // too small to hold an extra field header
  const extra = Buffer.alloc(pad);
  extra.writeUInt16LE(ALIGNMENT_MARKER, 0);
  extra.writeUInt16LE(pad - 4, 2);
  return extra;
}

function align(inputPath, outputPath, alignment = 4) {
  const buf = fs.readFileSync(inputPath);
  const { entries, eocdComment } = readEntries(buf);

  const body = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;

  for (const e of entries) {
    const headerLen = 30 + e.name.length;
    const pad = (alignment - ((offset + headerLen) % alignment)) % alignment;
    const extra = buildAlignmentExtra(pad);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(SIG_LFH, 0);
    lfh.writeUInt16LE(e.verNeed, 4);
    lfh.writeUInt16LE(e.flags, 6);
    lfh.writeUInt16LE(e.method, 8);
    lfh.writeUInt16LE(e.time, 10);
    lfh.writeUInt16LE(e.date, 12);
    lfh.writeUInt32LE(e.lCrc, 14);
    lfh.writeUInt32LE(e.lCsize, 18);
    lfh.writeUInt32LE(e.lUsize, 22);
    lfh.writeUInt16LE(e.name.length, 26);
    lfh.writeUInt16LE(extra.length, 28);

    body.push(lfh, e.name, extra, e.raw, e.descriptor);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(SIG_CDH, 0);
    cdh.writeUInt16LE(e.verMade, 4);
    cdh.writeUInt16LE(e.verNeed, 6);
    cdh.writeUInt16LE(e.flags, 8);
    cdh.writeUInt16LE(e.method, 10);
    cdh.writeUInt16LE(e.time, 12);
    cdh.writeUInt16LE(e.date, 14);
    cdh.writeUInt32LE(e.crc, 16);
    cdh.writeUInt32LE(e.csize, 20);
    cdh.writeUInt32LE(e.usize, 24);
    cdh.writeUInt16LE(e.name.length, 28);
    cdh.writeUInt16LE(0, 30); // the central directory carries no padding
    cdh.writeUInt16LE(e.comment.length, 32);
    cdh.writeUInt16LE(e.diskStart, 34);
    cdh.writeUInt16LE(e.internalAttr, 36);
    cdh.writeUInt32LE(e.extAttr, 38);
    cdh.writeUInt32LE(offset, 42);

    directory.push(cdh, e.name, e.comment);
    directorySize += 46 + e.name.length + e.comment.length;
    offset += headerLen + extra.length + e.csize + e.descriptor.length;
  }

  const directoryOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directorySize, 12);
  eocd.writeUInt32LE(directoryOffset, 16);
  eocd.writeUInt16LE(eocdComment.length, 20);

  fs.writeFileSync(outputPath, Buffer.concat([...body, ...directory, eocd, eocdComment]));
  return entries.length;
}

function check(path, alignment = 4) {
  const buf = fs.readFileSync(path);
  const { entries } = readEntries(buf);
  let stored = 0;
  const bad = [];
  for (const e of entries) {
    if (e.method === 0) stored++;
    if (e.dataStart % alignment !== 0) bad.push(`${e.name.toString()} (${e.dataStart})`);
  }
  return { total: entries.length, stored, bad };
}

const [, , ...args] = process.argv;
if (args[0] === "--check") {
  const result = check(args[1]);
  console.log(`  entries    : ${result.total} (${result.stored} stored)`);
  console.log(`  misaligned : ${result.bad.length}`);
  if (result.bad.length) {
    for (const name of result.bad.slice(0, 5)) console.log(`    ${name}`);
  }
  process.exit(result.bad.length ? 1 : 0);
} else if (args.length === 2) {
  const count = align(args[0], args[1]);
  console.log(`  rewrote ${count} entries -> ${args[1]}`);
} else {
  console.error("usage: node scripts/align-apk.mjs <in.apk> <out.apk> | --check <apk>");
  process.exit(2);
}
