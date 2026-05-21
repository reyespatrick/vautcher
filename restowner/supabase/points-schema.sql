-- ============================================================
--  Event loyalty-points targeting
--
--  An event can target customers by how many Vautcher loyalty
--  points (= stamps = QR scans) they hold:
--    points_min — only customers with AT LEAST this many points
--    points_max — only customers with AT MOST this many points
--  Used to decide who an event is pushed to. Re-runnable.
-- ============================================================

alter table public.vautcher_events
  add column if not exists points_min int,
  add column if not exists points_max int;
