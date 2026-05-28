-- ============================================================
--  Fix: trusted owners' own events were always going to 'pending'
--
--  vautcher_events_set_moderation() short-circuited on
--  vautcher_is_moderator() before checking ownership, so a user who
--  is BOTH a moderator AND a trusted owner of a restaurant had their
--  own events forced to the queue (the editor saves with
--  moderation_status='pending' on every write, and the trigger never
--  rewrote it).
--
--  This rewrite consults the trust flag for the event's restaurant
--  first. The moderator-queue carve-out only applies when the caller
--  is NOT an owner of this event's restaurant — i.e., a real cross-
--  restaurant moderation action from the approval queue.
--
--  Also backfills: any 'pending' events whose owner is now marked
--  trusted are flipped to 'approved' immediately, so the queue and
--  the diner-side feed catch up. Refused events are left alone — a
--  moderator's refusal stands until the owner re-submits.
--
--  Re-runnable (idempotent).
-- ============================================================

-- NOTE: superseded by root-admin-schema.sql — kept identical here so
-- re-applying either file yields the same trigger. A moderator (root) is
-- implicitly trusted (their own events auto-approve); owners fall back to
-- per-tenant trust.
create or replace function public.vautcher_events_set_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_any_trusted boolean;
  v_is_mod boolean := public.vautcher_is_moderator();
begin
  if v_is_mod then
    if tg_op = 'UPDATE' and new.moderation_status = 'refused'
       and old.moderation_status is distinct from 'refused' then
      return new;
    end if;
    new.moderation_status := 'approved';
    new.refusal_reason := null;
    return new;
  end if;

  select exists(
    select 1 from public.vautcher_owners
     where restaurant_id = new.restaurant_id
       and trusted and not locked
  ) into v_any_trusted;
  new.moderation_status := case when v_any_trusted
                                then 'approved' else 'pending' end;
  if new.moderation_status <> 'refused' then
    new.refusal_reason := null;
  end if;
  return new;
end;
$$;

-- ---------- BACKFILL ----------
-- Approve every currently-pending event owned by a trusted owner so
-- the diner-side stops missing trusted-owner events that the buggy
-- trigger had quietly parked in the queue.
update public.vautcher_events e
   set moderation_status = 'approved',
       refusal_reason    = null
  from public.vautcher_owners o
 where o.restaurant_id  = e.restaurant_id
   and o.trusted        = true
   and e.moderation_status = 'pending';
