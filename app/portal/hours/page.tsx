"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { PortalChrome } from "@/components/portal/PortalChrome";

/**
 * Weekly hours, shown and not editable.
 *
 * This screen exists because the admin team page claims, in writing, that
 * "Partners set these themselves from their portal". That was never true: the
 * portal had no hours code at all, and partner_availability_rules has no policy
 * a partner could write through. Rather than leave a promise on the admin page
 * that the product does not keep, the portal shows the hours and says who sets
 * them, and the admin copy was corrected to match.
 *
 * Read-only is also the safer default. A partner who shortens their own hours
 * can strand a client who already booked a slot in a window that no longer
 * exists. The admin can see the bookings and the hours in the same place and
 * resolve it deliberately.
 */

type Rule = { weekday: number; start_time: string; end_time: string };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const trim = (t: string) => String(t ?? "").slice(0, 5);

export default function PortalHours() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userData?.user) { router.replace("/portal/login"); return; }
      const userId = userData.user.id;

      const [mine, rulesRes] = await Promise.all([
        supabase.from("team_members").select("id,name").eq("user_id", userId).limit(1).maybeSingle(),
        // 012_partner_self_service.sql added this read policy: a partner can
        // see their own hours but not change them.
        supabase.from("partner_availability_rules").select("weekday,start_time,end_time").eq("partner_id", userId),
      ]);

      if (mine.error) throw mine.error;
      if (!mine.data) { router.replace("/portal/login"); return; }
      setName(mine.data.name);
      setRules((rulesRes.data as Rule[]) ?? []);
    } catch (e: any) {
      setError(e?.message || "Could not load your hours.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <PortalChrome active="hours"><p className="portal-lead" style={{ paddingTop: 24 }}>Loading your hours…</p></PortalChrome>;
  }

  const working = DAYS.filter((_, i) => rules.some((r) => r.weekday === i)).length;

  return (
    <PortalChrome active="hours" name={name}>
      <div style={{ padding: 0 }}>
        {error ? <div className="portal-notice error">{error}</div> : null}

        <h1 className="portal-title">Your hours</h1>
        <p className="portal-lead">
          {working === 0
            ? "You have no working hours set, so you will not be offered slots."
            : `You are available on ${working} day${working === 1 ? "" : "s"} a week.`}
        </p>

        <div className="portal-panel">
          {DAYS.map((day, i) => {
            const rs = rules.filter((r) => r.weekday === i);
            return (
              <div
                key={day}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "12px 0",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: 15 }}>{day}</span>
                <span className="portal-hint" style={{ textAlign: "right" }}>
                  {rs.length
                    ? rs.map((r) => `${trim(r.start_time)} – ${trim(r.end_time)}`).join(", ")
                    : "Not working"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="portal-notice info">
          <strong>These are set by the MALTO team.</strong>
          <br />
          Ask us to change them. We keep them here so you can see when a client can book you, and so there
          is never a disagreement about whether a slot was available.
        </div>

        <div className="portal-panel">
          <div className="portal-panel-head"><strong>Cannot take a job right now?</strong></div>
          <p className="portal-hint" style={{ marginBottom: 12 }}>
            Switch yourself to unavailable on the Jobs tab. That stops new assignments immediately, without
            changing the hours a client has already booked against.
          </p>
          <a className="portal-btn secondary" href="/portal" style={{ marginBottom: 0 }}>
            Go to Jobs
          </a>
        </div>
      </div>
    </PortalChrome>
  );
}
