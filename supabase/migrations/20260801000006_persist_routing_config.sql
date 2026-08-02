-- Persist the routing configuration.
--
-- RoutingConfig carries the pedal-LOOP wiring: which pedal acts as a hub and
-- which pedals run in its send/return (`pedalConfigs`), plus `useLoopPedals`
-- and `allowRotation`. None of it had anywhere to be stored. The save wrote
-- name, amp, the three boolean flags and the pedal rows, and nothing else -
-- so configuring an NS-2 loop through the Routing panel survived exactly as
-- long as the tab did.
--
-- It was invisible because a SIBLING mechanism does persist: the "Use
-- Send/Return Loop" switch sets PlacedPedal.useLoop, which has a column
-- (configuration_pedals.use_loop) and is saved. Two ways to describe the same
-- wiring, one durable and one not.
--
-- JSONB rather than more columns: pedalConfigs is a variable-length list of
-- per-pedal records, and the shape is owned by the RoutingConfig type in
-- src/types. A column per field would have to be migrated every time that type
-- grows, which is how `allowRotation` would have been forgotten too.
--
-- NOT stored here, deliberately: use_effects_loop and use_4_cable_method.
-- They already have their own columns, and the loader rebuilds them from those
-- rather than from this JSON, so the two cannot drift into disagreeing about
-- the same fact.

ALTER TABLE configurations
ADD COLUMN routing_config JSONB;

COMMENT ON COLUMN configurations.routing_config IS
  'RoutingConfig minus the flags that have their own columns: pedal-loop wiring (pedalConfigs), useLoopPedals, allowRotation. use_effects_loop and use_4_cable_method are authoritative in their own columns and are re-applied on load.';
