-- ============================================================
--  Optional demo data — gives the most recent visitor profile a
--  few loyalty stamps so the voucher card shows populated.
--  Safe to run after schema.sql. Idempotent (won't double-seed).
--  In production, stamps are added by the owner/restaurant app.
-- ============================================================

insert into public.vautcher_stamps (profile_id, stamp_date)
select p.id, d.dt::date
from (
  select id from public.vautcher_profiles
  order by created_at desc
  limit 1
) p
cross join (values
  ('2026-01-12'), ('2026-02-03'), ('2026-02-25'),
  ('2026-03-14'), ('2026-04-02'), ('2026-04-21'), ('2026-05-09')
) as d(dt)
where not exists (
  select 1 from public.vautcher_stamps s where s.profile_id = p.id
);
