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

create or replace function public.vautcher_events_set_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := lower(auth.jwt() ->> 'email');
  v_trusted boolean;
begin
  -- Is the caller an owner of THIS event's restaurant?
  select trusted into v_trusted
    from public.vautcher_owners
   where restaurant_id = new.restaurant_id
     and lower(email) = v_email
   limit 1;

  if found then
    -- Owner of this restaurant — trust flag decides, every time.
    new.moderation_status := case when coalesce(v_trusted, false)
                                  then 'approved' else 'pending' end;
    if new.moderation_status <> 'refused' then
      new.refusal_reason := null;
    end if;
    return new;
  end if;

  -- Not an owner of this restaurant. A moderator acting from the
  -- approval queue (approving / refusing somebody else's event) is
  -- the only legitimate path here — keep their status as set.
  if public.vautcher_is_moderator() then
    return new;
  end if;

  -- Anyone else shouldn't really reach this (RLS gates inserts),
  -- but be safe and force pending.
  new.moderation_status := 'pending';
  new.refusal_reason := null;
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
