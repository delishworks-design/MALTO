"use client";

import { useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { isNative } from "@/lib/is-native";

/**
 * Registers the device for push and, critically, creates the notification
 * channel the alerts will arrive on.
 *
 * The channel has to exist before the first notification is posted, and this is
 * the only place that can guarantee it. If the app has never created it, the
 * Firebase SDK quietly makes one of its own with "basic settings out of the
 * box", and on Android 8+ a channel's sound is fixed at creation and cannot be
 * changed by the app afterwards. The chime would then be unrecoverable short of
 * an uninstall, with nothing in the logs to explain it. So the channel is
 * created on every launch: Android ignores a create for a channel that exists,
 * and if a future release needs a different sound it uses a new id.
 *
 * Three places name the channel, and they must agree:
 *   - here, createChannel
 *   - CHANNEL_ID in lib/push-fcm.ts
 *   - malto_jobs_channel in android/app/src/main/res/values/strings.xml
 * scripts/check-notification-assets.mjs fails the build if they ever drift.
 *
 * Silently inert in a browser, so it is safe to leave in the portal for iPhone
 * users, who get web push from public/portal/sw.js instead.
 */

// Kept in step with the build's versionName.
const APP_VERSION = "1.0.1";

type State = "unknown" | "unsupported" | "denied" | "registered" | "failed";

let registered = false;

/** True once the device token has been stored, so the UI can say so. */
export function pushState(): State {
  if (typeof window === "undefined") return "unknown";
  if (!isNative()) return "unsupported";
  return registered ? "registered" : "unknown";
}

export function PushRegistration() {
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    // Held so it can be detached on unmount. addListener returns a handle rather
    // than a disposer, and a leaked listener keeps the whole closure alive.
    let registration: { remove: () => Promise<void> } | undefined;

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const { LocalNotifications } = await import("@capacitor/local-notifications");

        // Must happen before permission, so that by the time anything can be
        // posted the channel it will land on already has the sound.
        await LocalNotifications.createChannel({
          id: "malto_jobs_v1",
          name: "Job alerts",
          description: "New jobs, job updates and cancellations.",
          importance: 4, // High: makes a sound and shows as a heads-up banner
          visibility: 1,
          vibration: true,
          lights: true,
          lightColor: "#3F6B4F",
          // Filename only, no path, lowercase. This is the single most
          // fragile string in the app: a mismatch means silence on Android 8+
          // and no error anywhere.
          sound: "malto_job.wav",
        });

        let permission = await PushNotifications.checkPermissions();
        if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
          permission = await PushNotifications.requestPermissions();
        }
        if (permission.receive !== "granted") {
          // Declined, or blocked in system settings. Not an error worth a red
          // banner: the portal still works and the partner can turn it on later.
          return;
        }

        // Capacitor 8 returns void from register(). The token arrives on the
        // 'registration' event, so the listener has to be attached first or the
        // token is emitted while nothing is listening and is simply lost. The
        // older `register()` returning a token is what most examples show, and
        // writing that way means no token is ever stored and no alert is ever
        // sent, with no error anywhere.
        registration = await PushNotifications.addListener("registration", async (token) => {
          try {
            const supabase = createClient();
            const { data: userData } = await supabase.auth.getUser();
            const user = userData?.user;
            if (!user || cancelled || !token?.value) return;

            // The token is the row's identity. FCM rotates it on reinstall, and
            // the unique constraint means a new token replaces the stale row
            // instead of leaving one that will never deliver and will be paid
            // for on every future send.
            const { error } = await supabase.from("push_devices").upsert(
              {
                user_id: user.id,
                token: token.value,
                platform: "android",
                app_version: APP_VERSION,
                seen_at: new Date().toISOString(),
              },
              { onConflict: "token" }
            );

            if (error) {
              console.error("[push] could not store the device token:", error.message);
              return;
            }
            registered = true;
            window.dispatchEvent(new CustomEvent("malto:push-ready"));
          } catch (e) {
            console.error("[push] could not store the device token:", e);
          }
        });

        PushNotifications.addListener("registrationError", (error) => {
          // Usually no Play Services on the device, which is common on Huawei
          // and anything without Google apps. Nothing the app can do about it.
          console.error("[push] registration failed:", error?.error ?? error);
        });

        await PushNotifications.register();

        /**
         * A notification that arrives while the app is open.
         *
         * Android does not display a notification for a foreground message. The
         * SDK hands it to the app and stops, so without this a partner watching
         * the portal would see nothing at all until they switched away and back.
         * It goes out on the same channel, which is what makes it sound the
         * same as a background alert.
         */
        await PushNotifications.addListener("pushNotificationReceived", async (notification) => {
          try {
            await LocalNotifications.schedule({
              notifications: [
                {
                  title: notification.title ?? "MALTO",
                  body: notification.body ?? "You have an update.",
                  id: Math.floor(Date.now() % 2147483647),
                  channelId: "malto_jobs_v1",
                  smallIcon: "ic_stat_malto",
                  largeIcon: "ic_malto_large",
                  // Collapse repeats for the same job on the lock screen.
                  extra: { url: notification.data?.url ?? "/portal" },
                },
              ],
            });
          } catch (e) {
            // A notification that will not post is not worth breaking anything
            // over, and the job itself is unaffected either way.
            console.error("[push] could not show the foreground notification:", e);
          }
        });

        // Tapping a notification that arrived while the app was closed. Without
        // this the alert does nothing at all, which is the most common way a
        // push feature is found to be broken.
        await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
          const target = (action.notification.extra as { url?: string })?.url ?? "/portal";
          if (typeof window !== "undefined") window.location.assign(target);
        });
      } catch (e) {
        // Never throw out of here. This component renders nothing and runs on
        // every portal load, so an unhandled rejection would surface as a
        // console error on every page the partner opens.
        console.error("[push] registration failed:", e);
      }
    })();

    return () => {
      cancelled = true;
      registration?.remove();
    };
  }, []);

  return null;
}
