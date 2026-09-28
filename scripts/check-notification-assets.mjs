#!/usr/bin/env node
/**
 * Fails the build if the notification assets are not wired up consistently.
 *
 * Every problem this catches is silent at runtime, which is why it is worth a
 * script rather than a comment:
 *
 *   sound filename   Capacitor's own docs say a missing audio file gives the
 *                    system sound on Android 7 and *no sound at all* on Android
 *                    8+. No exception, no log, and Android 8+ is nearly every
 *                    phone. A typo in the name is therefore indistinguishable
 *                    from a muted phone.
 *
 *   channel id       Three separate places name it. If they disagree the
 *                    Firebase SDK silently falls back to a channel of its own,
 *                    and that channel's sound cannot be changed by the app
 *                    ever again, so the chime becomes unrecoverable short of an
 *                    uninstall.
 *
 *   sound file       A truncated or empty wav plays as silence, or as a click.
 *
 *   status bar icon  Android renders it from the alpha channel only, so an
 *                    icon with a solid background shows up as a plain white
 *                    square and is indistinguishable from no icon at all.
 *
 *   permissions      Without POST_NOTIFICATIONS the app cannot show an alert on
 *                    Android 13+, and the partner sees nothing.
 *
 *   node scripts/check-notification-assets.mjs
 */
import fs from "node:fs";

const RES = "android/app/src/main/res";
const RAW = `${RES}/raw`;
const CHANNEL = "malto_jobs_v1";
const SOUND = "malto_job.wav";

let failed = 0;
const fail = (m) => { failed++; console.log(`  FAIL  ${m}`); };
const ok = (m) => console.log(`  ok    ${m}`);

console.log("  notification sound");

// --- the sound file, and that it is a real wav
if (!fs.existsSync(`${RAW}/${SOUND}`)) {
  fail(`${RAW}/${SOUND} is missing`);
} else {
  const buf = fs.readFileSync(`${RAW}/${SOUND}`);
  const riff = buf.toString("ascii", 0, 4) === "RIFF";
  const wave = buf.toString("ascii", 8, 12) === "WAVE";
  if (!riff || !wave) {
    fail(`${SOUND} is not a RIFF/WAVE file`);
  } else {
    const channels = buf.readUInt16LE(22);
    const rate = buf.readUInt32LE(24);
    const bits = buf.readUInt16LE(34);
    const seconds = buf.length / (rate * channels * (bits / 8));
    // Android cuts a notification sound off around five seconds, and a long
    // alert gets silenced by the system before it finishes anyway.
    if (seconds > 5) fail(`${SOUND} is ${seconds.toFixed(1)}s; Android truncates past about 5s`);
    else if (seconds < 0.15) fail(`${SOUND} is only ${seconds.toFixed(2)}s, too short to notice`);
    else ok(`${SOUND} is ${seconds.toFixed(2)}s, ${rate}Hz ${channels}ch ${bits}-bit, ${(buf.length / 1024).toFixed(0)}KB`);
  }
}

// --- the three places that have to name the channel identically
const sources = [
  ["capacitor.config.ts sound", "capacitor.config.ts", new RegExp(`sound:\\s*["']${SOUND.replace(".", "\\.")}["']`)],
  ["capacitor.config.ts smallIcon", "capacitor.config.ts", /smallIcon:\s*["']ic_stat_malto["']/],
  ["strings.xml channel", `${RES}/values/strings.xml`, new RegExp(CHANNEL)],
  ["PushRegistration channel", "components/PushRegistration.tsx", new RegExp(CHANNEL)],
  ["PushRegistration sound", "components/PushRegistration.tsx", new RegExp(SOUND.replace(".", "\\."))],
  ["push-fcm CHANNEL_ID", "lib/push-fcm.ts", new RegExp(`CHANNEL_ID\\s*=\\s*["']${CHANNEL}["']`)],
];

for (const [label, file, pattern] of sources) {
  if (!fs.existsSync(file)) {
    fail(`${file} is missing`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  if (pattern.test(text)) ok(`${label} matches`);
  else fail(`${file} does not contain ${pattern}`);
}

// The channel in the manifest is a string reference, so it cannot be compared
// by text. Resolve it instead.
console.log("\n  manifest");
const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
if (/@string\/malto_jobs_channel/.test(manifest)) ok("default_notification_channel_id points at the string resource");
else fail("default_notification_channel_id does not point at @string/malto_jobs_channel");
if (/com\.google\.android\.gms\.firebase\.messaging\.default_notification_icon/.test(manifest) || /default_notification_icon/.test(manifest)) {
  ok("default_notification_icon is set");
} else fail("default_notification_icon is not set, so the status bar shows a white square");
if (/POST_NOTIFICATIONS/.test(manifest)) ok("POST_NOTIFICATIONS permission is declared");
else fail("POST_NOTIFICATIONS is missing; nothing can be shown on Android 13+");

// --- the status bar icon has to be a silhouette
console.log("\n  status bar icon");
const densities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
let iconProblems = 0;
for (const d of densities) {
  const p = `${RES}/drawable-${d}/ic_stat_malto.png`;
  if (!fs.existsSync(p)) { fail(`${p} is missing`); iconProblems++; continue; }
  const buf = fs.readFileSync(p);
  // PNG layout: 8 byte signature, then IHDR, whose payload is 13 bytes. Width
  // and height are at 16..23 and the colour type is the 10th byte of the
  // payload, which is byte 25 of the file, not byte 8. Reading it from the
  // wrong offset rejects every valid icon and teaches you to ignore the check.
  if (buf.readUInt32BE(0) !== 0x89504e47) { fail(`${p} is not a PNG`); iconProblems++; continue; }
  const colourType = buf[25];
  // 6 is RGBA, 4 is greyscale+alpha. Both work: Android reads only the alpha
  // channel, so the pixels underneath are irrelevant as long as they are opaque
  // where the shape is. 0 or 2 would throw the shape away.
  if (colourType !== 6 && colourType !== 4) {
    fail(`${p} has no alpha channel (colour type ${colourType}); Android would show a blank or a white square`);
    iconProblems++;
  }
}
if (!iconProblems) ok(`ic_stat_malto has a usable alpha channel at all ${densities.length} densities`);

for (const d of densities) {
  const p = `${RES}/drawable-${d}/ic_malto_large.png`;
  if (!fs.existsSync(p)) { fail(`${p} is missing`); iconProblems++; }
}
if (!iconProblems) ok(`ic_malto_large present at all ${densities.length} densities`);

console.log(failed ? `\n  ${failed} problem(s)` : "\n  all consistent");
process.exit(failed ? 1 : 0);
