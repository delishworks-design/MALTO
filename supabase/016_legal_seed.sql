-- ---------------------------------------------------------------------------
-- Legal copy, first draft
--
-- These documents were written straight into the database rather than kept in
-- version control, and that is a trap: there was no way back from an accidental
-- overwrite, and the recovery only worked because an unrelated scratch file
-- happened to still hold a copy. Keeping the starting text here means a bad
-- write is always recoverable.
--
-- on conflict do nothing on purpose. Once the text lives in the database it
-- belongs to the business and is edited from the admin Settings screen, so
-- re-running this must never quietly revert a rewrite. Change it here when you
-- want a new draft on a fresh database, not on this one.
--
-- All three are drafts and have not been checked by a lawyer.
-- ---------------------------------------------------------------------------

insert into public.site_settings (key, value) values
  ('terms_body', '## Booking

Booking through this website is a request, not a confirmed appointment. MALTO reviews the request, checks availability, and sends you a quote. The booking is confirmed when you accept that quote.

## Price and payment

The price shown during booking is an estimate. The final price is confirmed in the quote. We will not start work before you have accepted a price.

## Schedule

The date and time you give are a preference. We confirm the actual schedule with you. If a cleaner cannot make it, we will offer another. If a booking is cancelled or postponed, tell us as early as you can so the slot can be offered to someone else.

## Choosing a cleaner

You may choose a partner from our list, or leave it to us. Every partner is approved by MALTO before appearing and must accept the work before it is confirmed.

## Your responsibilities

Give us accurate information, tell us about anything that affects the work such as pets, alarms, access, parking or fragile items, and make sure someone can let us in at the agreed time.

## Our responsibilities

Agree the scope and price in writing before work starts, use partners we have approved, and tell you who is coming.

## Problems

Tell us within 48 hours of anything going wrong, and include photographs if you can. We will put it right. Complaints about damage are handled with whoever caused it.

## Your information

See the privacy notice.

## This is a draft

These terms are a starting point and have not been checked by a lawyer. They are not final until they say so.'),
  ('privacy_policy_body', '## What we collect

**If you book a cleaning** we hold your name, mobile number, email address, service address, city, property details, your preferred date and time, any notes or photos you send, and the job history we keep for scheduling and aftercare.

**If you are a partner** we hold your name, photograph, biography, years of experience, service areas, the services you take, your availability, your mobile number, your email address, and your job history.

**If you write a review** we keep the text, the rating, your first name and your city.

## Why we hold it

To quote you, to schedule the work, to pay a partner, to publish a partner profile a customer has chosen, and to answer questions about a job. We do not sell your details to anyone.

## What is public

A partner''s name, photograph, biography, headline, years of experience, service areas, services and rating are public. A partner''s mobile number, email address and account details are not. Booking details are not public.

## How long we keep it

Booking and job records for as long as the relationship continues and afterwards as long as we need them for accounting, complaints and aftercare. Partner profile information until you ask us to remove it, and a record of the agreement you accepted for as long as you have been a partner.

## Your choices

Ask us for a copy of what we hold, ask us to correct it, or ask us to delete a partner profile and stop publishing it. Contact details are in the footer of this site.

## This is a draft

This notice is a starting point and has not been checked by a lawyer. It is not final until it says so.'),
  ('partner_agreement_body', '## 1. Who you are and what you agree to

You are an independent cleaning partner. You are not an employee of MALTO Cleaning Services. You provide your own equipment and supplies unless a booking states otherwise, and you follow the scope agreed with the customer.

## 2. Who is responsible for the work

MALTO is responsible for agreeing the scope, the schedule and the price with the customer, and for paying you for the work you complete. You are responsible for carrying out the agreed scope competently, for the condition of the people you bring, and for any damage or loss caused by you or anyone working on your behalf.

Where a partner causes damage, that partner bears the cost of putting it right. MALTO does not carry liability for a partner''s own negligence. Confirm that you hold whatever insurance your work requires before you accept your first job.

## 3. What customers see

Your name, photograph, headline, biography, years of experience, service areas and the services you take appear on the public website once MALTO approves your profile. Your mobile number, email address and account details are never published.

## 4. Ratings and reviews

Customers may review you after a job they completed with you. A review cannot be removed by you. MALTO may hide a review that is abusive, defamatory or about someone other than the work.

## 5. Your availability

You keep your availability up to date. MALTO offers a job based on what you have published. If you can no longer take a job, decline it as early as you can so the customer can be offered someone else.

## 6. Money

MALTO sets the price shown to the customer. The amount paid to you is whatever has been agreed for that job. Payment terms are confirmed with you separately and are not set out here.

## 7. Ending it

Either of us can end the arrangement at any time. Booking the service at any point through this website means you accept these terms. If you have not accepted them, do not create an account.'),
  ('partner_agreement_version', 'draft-2026-09-27')

on conflict (key) do nothing;
