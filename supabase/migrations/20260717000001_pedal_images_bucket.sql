-- Public storage bucket for pedal photos:
--   system/{pedal_id}.{ext}      images mirrored from manufacturer CDNs
--   user/{user_id}/{file}        uploads for custom pedals
INSERT INTO storage.buckets (id, name, public)
VALUES ('pedal-images', 'pedal-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read pedal images" ON storage.objects
  FOR SELECT USING (bucket_id = 'pedal-images');

CREATE POLICY "Users upload own pedal images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pedal-images'
    AND (storage.foldername(name))[1] = 'user'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Users update own pedal images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'pedal-images'
    AND (storage.foldername(name))[1] = 'user'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Users delete own pedal images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'pedal-images'
    AND (storage.foldername(name))[1] = 'user'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
