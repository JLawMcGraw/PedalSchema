-- Let a chain REORDER save.
--
-- configuration_pedals has UNIQUE(configuration_id, chain_position), which is a
-- real invariant: two pedals cannot occupy the same place in the signal chain.
-- But it was IMMEDIATE, and Postgres checks an immediate unique constraint row
-- by row as the statement runs, not once at the end.
--
-- The save path upserts every pedal in one statement. Any edit that renumbers
-- the chain - adding a pedal mid-chain, dragging one up the list, anything that
-- makes two pedals swap places - therefore fails halfway through, because the
-- row being moved INTO position 2 collides with the row that has not yet been
-- moved OUT of it:
--
--   duplicate key value violates unique constraint
--     "configuration_pedals_configuration_id_chain_position_key"
--   Key (configuration_id, chain_position)=(..., 2) already exists.
--
-- The final state was always legal. Only the intermediate one was not, and the
-- user saw "Failed to save" for an edit that was perfectly valid.
--
-- DEFERRABLE INITIALLY DEFERRED moves the check to the end of the transaction,
-- so the statement may pass through an illegal intermediate state and still be
-- rejected if it LANDS on one. The guarantee is unchanged; only the moment it
-- is enforced moves.
--
-- Safe for the upsert's ON CONFLICT: its arbiter is the PRIMARY KEY (id), which
-- stays immediate. Postgres refuses to arbitrate on a deferrable constraint,
-- but it never had to here.

ALTER TABLE configuration_pedals
  DROP CONSTRAINT configuration_pedals_configuration_id_chain_position_key;

ALTER TABLE configuration_pedals
  ADD CONSTRAINT configuration_pedals_configuration_id_chain_position_key
  UNIQUE (configuration_id, chain_position)
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT configuration_pedals_configuration_id_chain_position_key
  ON configuration_pedals IS
  'Two pedals cannot share a chain position. DEFERRED because the save upserts the whole chain in one statement, so a reorder legitimately passes through a state where two rows briefly hold the same number.';
