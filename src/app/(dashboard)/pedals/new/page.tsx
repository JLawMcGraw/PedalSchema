'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PEDAL_CATEGORIES } from '@/lib/constants/pedal-categories';
import { preparePedalPhoto } from '@/lib/images/prepare-pedal-photo';
import type { KnockoutStatus } from '@/lib/images/knockout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * What the knockout managed to do, in the user's terms. The board draws photos
 * with no box behind them, so a photo that kept its background shows up as a
 * white rectangle - worth saying out loud before they save it.
 */
const PHOTO_NOTE: Record<KnockoutStatus, string> = {
  'knocked-out': 'Background removed — this will sit on the board as a cut-out.',
  'already-cutout': 'This image already has a transparent background. Nice.',
  'no-background': 'Couldn’t find a background to remove — the photo is used as-is.',
  'ragged-background':
    'The background is too busy to remove cleanly, so the photo is used as-is. A shot on a plain surface will cut out better.',
  reverted:
    'Couldn’t tell the pedal from the background, so the photo is used as-is. A shot on a plain surface will cut out better.',
};

export default function NewPedalPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    manufacturer: '',
    category: 'overdrive',
    widthInches: '2.9',
    depthInches: '5.1',
    heightInches: '2.3',
    voltage: '9',
    currentMa: '',
  });

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const showPhoto = (file: File | null, url: string | null, note: string | null) => {
    setImageFile(file);
    setPhotoNote(note);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const onImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (file && !file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG or JPEG).');
      return;
    }
    if (file && file.size > MAX_IMAGE_BYTES) {
      setError('Image must be under 5MB.');
      return;
    }
    if (!file) {
      showPhoto(null, null, null);
      return;
    }

    // Cut the background out before upload so the pedal renders as a silhouette
    // on the board, matching the mirrored system-pedal photos.
    setProcessing(true);
    try {
      const prepared = await preparePedalPhoto(file);
      showPhoto(prepared.file, prepared.previewUrl, PHOTO_NOTE[prepared.status]);
    } catch {
      showPhoto(file, URL.createObjectURL(file), 'Couldn’t process this image — it will be uploaded as-is.');
    } finally {
      setProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const width = parseFloat(form.widthInches);
    const depth = parseFloat(form.depthInches);
    const height = parseFloat(form.heightInches);
    if (!form.name.trim() || !form.manufacturer.trim()) {
      setError('Name and manufacturer are required.');
      return;
    }
    if (!(width > 0) || !(depth > 0) || !(height > 0)) {
      setError('Dimensions must be positive numbers.');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        setError('You must be signed in to add a pedal.');
        return;
      }

      // Upload the photo first so the pedal row can reference it
      let imageUrl: string | null = null;
      if (imageFile) {
        const ext = imageFile.type.includes('png') ? 'png' : 'jpg';
        // Processed photos are PNG so the knocked-out alpha survives
        const path = `user/${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('pedal-images')
          .upload(path, imageFile, { contentType: imageFile.type });
        if (upErr) {
          setError(`Image upload failed: ${upErr.message}`);
          return;
        }
        imageUrl = supabase.storage.from('pedal-images').getPublicUrl(path).data.publicUrl;
      }

      const { data: pedal, error: insErr } = await supabase
        .from('pedals')
        .insert({
          name: form.name.trim(),
          manufacturer: form.manufacturer.trim(),
          category: form.category,
          width_inches: width,
          depth_inches: depth,
          height_inches: height,
          voltage: parseInt(form.voltage) || 9,
          current_ma: form.currentMa ? parseInt(form.currentMa) : null,
          is_system: false,
          created_by: user.id,
          image_url: imageUrl,
        })
        .select('id')
        .single();
      if (insErr || !pedal) {
        setError(`Could not save pedal: ${insErr?.message ?? 'unknown error'}`);
        return;
      }

      // Standard mono in/out jacks so cables can route immediately
      const { error: jackErr } = await supabase.from('pedal_jacks').insert([
        { pedal_id: pedal.id, jack_type: 'input', side: 'right', position_percent: 50, label: 'Input' },
        { pedal_id: pedal.id, jack_type: 'output', side: 'left', position_percent: 50, label: 'Output' },
      ]);
      if (jackErr) {
        setError(`Pedal saved, but jacks failed: ${jackErr.message}`);
        return;
      }

      router.push('/pedals');
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Add Custom Pedal</CardTitle>
          <CardDescription>
            Add a pedal that isn&apos;t in the database. It will only be visible to you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Blues Driver" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manufacturer">Manufacturer</Label>
                <Input id="manufacturer" value={form.manufacturer} onChange={(e) => set('manufacturer')(e.target.value)} placeholder="BOSS" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={set('category')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PEDAL_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="width">Width (in)</Label>
                <Input id="width" type="number" step="0.01" min="0.1" value={form.widthInches} onChange={(e) => set('widthInches')(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="depth">Depth (in)</Label>
                <Input id="depth" type="number" step="0.01" min="0.1" value={form.depthInches} onChange={(e) => set('depthInches')(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="height">Height (in)</Label>
                <Input id="height" type="number" step="0.01" min="0.1" value={form.heightInches} onChange={(e) => set('heightInches')(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="voltage">Voltage</Label>
                <Input id="voltage" type="number" value={form.voltage} onChange={(e) => set('voltage')(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="current">Current (mA, optional)</Label>
                <Input id="current" type="number" value={form.currentMa} onChange={(e) => set('currentMa')(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="photo">Photo (optional, top-down on a plain surface works best)</Label>
              <Input
                id="photo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onImageChange}
                disabled={processing}
              />
              {processing && <p className="text-sm text-muted-foreground">Removing background…</p>}
              {imagePreview && (
                <div
                  className="flex items-center justify-center h-40 rounded-md overflow-hidden bg-muted/40"
                  style={{
                    // Checkerboard so a transparent cut-out reads as transparent
                    backgroundImage:
                      'linear-gradient(45deg, rgba(0,0,0,0.06) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.06) 75%), linear-gradient(45deg, rgba(0,0,0,0.06) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.06) 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 8px 8px',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="Preview" className="max-h-full max-w-full object-contain" />
                </div>
              )}
              {photoNote && <p className="text-sm text-muted-foreground">{photoNote}</p>}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.push('/pedals')} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Add Pedal'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
