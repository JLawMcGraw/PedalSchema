-- Save an editor configuration as one optimistic, transactional operation.
--
-- The browser previously updated the configuration, pruned pedals, and
-- upserted pedals in three independently committed requests. A failure could
-- therefore leave a half-saved board, and an RLS-filtered zero-row update
-- could be mistaken for success. `revision` also gives two editor tabs an
-- unambiguous way to reject stale writes.

ALTER TABLE configurations
ADD COLUMN revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0);

ALTER TABLE configuration_pedals
ADD COLUMN location_override BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN configurations.revision IS
  'Optimistic concurrency token for editor content saves. Incremented only by save_configuration; pinning and sharing remain independent actions.';

COMMENT ON COLUMN configuration_pedals.location_override IS
  'True when the owner manually chose this pedal location. Signal-chain normalization must preserve that choice across reloads.';

CREATE OR REPLACE FUNCTION save_configuration(
  p_configuration_id UUID,
  p_expected_revision BIGINT,
  p_configuration JSONB,
  p_pedals JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_revision BIGINT;
  v_revision BIGINT;
  v_updated_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to save this board'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_configuration) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_pedals) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid configuration save payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT revision
    INTO v_current_revision
    FROM configurations
   WHERE id = p_configuration_id
     AND user_id = auth.uid()
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Deliberately does not distinguish missing from someone else's board.
    RAISE EXCEPTION 'This board is unavailable or your session has expired'
      USING ERRCODE = '42501';
  END IF;

  IF v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'This board was changed in another tab. Reload before saving.'
      USING ERRCODE = '40001',
            DETAIL = format('expected revision %s, current revision %s',
                            p_expected_revision, v_current_revision);
  END IF;

  -- A client-generated placed-pedal id may update only a row already belonging
  -- to this configuration. This makes the boundary explicit before ON CONFLICT.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_pedals) item
      JOIN configuration_pedals cp ON cp.id = (item->>'id')::UUID
     WHERE cp.configuration_id <> p_configuration_id
  ) THEN
    RAISE EXCEPTION 'A placed pedal id belongs to a different board'
      USING ERRCODE = '22023';
  END IF;

  UPDATE configurations
     SET name = p_configuration->>'name',
         description = NULLIF(p_configuration->>'description', ''),
         amp_id = NULLIF(p_configuration->>'ampId', '')::UUID,
         use_effects_loop = COALESCE((p_configuration->>'useEffectsLoop')::BOOLEAN, false),
         use_4_cable_method = COALESCE((p_configuration->>'use4CableMethod')::BOOLEAN, false),
         modulation_in_loop = COALESCE((p_configuration->>'modulationInLoop')::BOOLEAN, false),
         routing_config = p_configuration->'routingConfig',
         power_supply_id = NULLIF(p_configuration->>'powerSupplyId', '')::UUID,
         revision = revision + 1
   WHERE id = p_configuration_id
  RETURNING revision, updated_at INTO v_revision, v_updated_at;

  DELETE FROM configuration_pedals cp
   WHERE cp.configuration_id = p_configuration_id
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(p_pedals) item
        WHERE (item->>'id')::UUID = cp.id
     );

  INSERT INTO configuration_pedals (
    id, configuration_id, pedal_id, x_inches, y_inches,
    rotation_degrees, chain_position, location, location_override,
    chain_position_locked, rotation_locked, power_output_id,
    is_active, use_loop
  )
  SELECT
    (item->>'id')::UUID,
    p_configuration_id,
    (item->>'pedalId')::UUID,
    (item->>'xInches')::DECIMAL,
    (item->>'yInches')::DECIMAL,
    COALESCE((item->>'rotationDegrees')::INTEGER, 0),
    (item->>'chainPosition')::INTEGER,
    (item->>'location')::chain_location,
    COALESCE((item->>'locationOverride')::BOOLEAN, false),
    COALESCE((item->>'chainPositionLocked')::BOOLEAN, false),
    COALESCE((item->>'rotationLocked')::BOOLEAN, false),
    NULLIF(item->>'powerOutputId', '')::UUID,
    COALESCE((item->>'isActive')::BOOLEAN, true),
    COALESCE((item->>'useLoop')::BOOLEAN, false)
  FROM jsonb_array_elements(p_pedals) item
  ON CONFLICT (id) DO UPDATE SET
    pedal_id = EXCLUDED.pedal_id,
    x_inches = EXCLUDED.x_inches,
    y_inches = EXCLUDED.y_inches,
    rotation_degrees = EXCLUDED.rotation_degrees,
    chain_position = EXCLUDED.chain_position,
    location = EXCLUDED.location,
    location_override = EXCLUDED.location_override,
    chain_position_locked = EXCLUDED.chain_position_locked,
    rotation_locked = EXCLUDED.rotation_locked,
    power_output_id = EXCLUDED.power_output_id,
    is_active = EXCLUDED.is_active,
    use_loop = EXCLUDED.use_loop;

  RETURN jsonb_build_object(
    'revision', v_revision,
    'updatedAt', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION save_configuration(UUID, BIGINT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_configuration(UUID, BIGINT, JSONB, JSONB) TO authenticated;
