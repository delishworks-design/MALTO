-- ---------------------------------------------------------------------------
-- Partner admin access
--
-- partner_services, partner_areas, partner_availability_rules and
-- partner_time_off shipped with row level security switched on and no policies
-- at all. That silently locked every admin out: RLS with zero policies denies
-- everything to anon and authenticated alike, so only service_role could write
-- them. Anything written from the admin UI, or by a partner in the portal, was
-- going to fail at runtime with no obvious cause.
--
-- The agreement table is the exception and stays read-only. It is immutable for
-- everyone by trigger, and an admin who can neither edit nor forge an acceptance
-- is the whole point of recording one.
-- ---------------------------------------------------------------------------

-- Reuses the is_admin() helper from 007, which reads the admins table. Defining it
-- again here would be a second source of truth for who is an admin.

-- Admin may edit a partner's specialties and coverage.
drop policy if exists partner_services_admin_all on public.partner_services;
create policy partner_services_admin_all on public.partner_services
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists partner_areas_admin_all on public.partner_areas;
create policy partner_areas_admin_all on public.partner_areas
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists partner_availability_rules_admin_all on public.partner_availability_rules;
create policy partner_availability_rules_admin_all on public.partner_availability_rules
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists partner_time_off_admin_all on public.partner_time_off;
create policy partner_time_off_admin_all on public.partner_time_off
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A partner may read their own schedule so the portal can render it. Still
-- write-through-admin only: availability is approved coverage, so a partner
-- changing their own hours has to be a deliberate act by the business.
drop policy if exists partner_availability_rules_own_read on public.partner_availability_rules;
create policy partner_availability_rules_own_read on public.partner_availability_rules
  for select to authenticated
  using (exists (
    select 1 from public.team_members m
    where m.id = partner_availability_rules.partner_id
      and m.user_id = auth.uid()
  ));

drop policy if exists partner_time_off_own_read on public.partner_time_off;
create policy partner_time_off_own_read on public.partner_time_off
  for select to authenticated
  using (exists (
    select 1 from public.team_members m
    where m.id = partner_time_off.partner_id
      and m.user_id = auth.uid()
  ));

-- An admin can look at who accepted what and when, and nothing more.
drop policy if exists partner_agreements_admin_read on public.partner_agreements;
create policy partner_agreements_admin_read on public.partner_agreements
  for select to authenticated
  using (public.is_admin());

comment on table public.partner_agreements is
  'Immutable record of a partner accepting the partner agreement. Readable by admins; writable only by service_role through the registration endpoint, and never updatable or deletable.';

-- ---------------------------------------------------------------------------
-- Table privileges
--
-- The tables created in 010 and 011 were reachable only by service_role, so the
-- policies above could never take effect: a permissive policy still needs the
-- role to hold the privilege on the table. A policy on a table you cannot touch
-- is just a comment, which is why the admin got a 403 even after the policy
-- existed.
--
-- anon is granted nothing on purpose. The public directory reads through the
-- public_partners view, which is owned by the migration role and so resolves
-- with the owner's rights; customers never get a direct handle on these tables.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.partner_services to authenticated;
grant select, insert, update, delete on public.partner_areas to authenticated;
grant select, insert, update, delete on public.partner_availability_rules to authenticated;
grant select, insert, update, delete on public.partner_time_off to authenticated;

-- Read-only even for an admin. The acceptance record is evidence, not a setting.
grant select on public.partner_agreements to authenticated;

revoke all on public.partner_services from anon;
revoke all on public.partner_areas from anon;
revoke all on public.partner_availability_rules from anon;
revoke all on public.partner_time_off from anon;
revoke all on public.partner_agreements from anon;
