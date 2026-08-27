'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PEDAL_CATEGORIES } from '@/lib/constants/pedal-categories';
import {
  correctPreparedPedalPhoto,
  preparePedalPhoto,
  type PreparedPhoto,
} from '@/lib/images/prepare-pedal-photo';
import {
  DEFAULT_PHOTO_GEOMETRY,
  type PhotoGeometryCorrection,
  type QuarterTurns,
} from '@/lib/images/geometry';
import type { KnockoutStatus } from '@/lib/images/knockout';
import {
  approvedImageMetadata,
  isUsablePedalPhotoStatus,
  noImageMetadata,
} from '@/lib/images/upload-state';
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
  'already-cutout': 'This image already has a transparent background.',
  'no-background': 'We couldn’t find a background to remove. Choose another photo or add the pedal without one.',
  'subject-eaten':
    'The pedal is too close in colour to its background. Choose a more contrasting surface or add the pedal without a photo.',
  'ragged-background':
    'The background is too busy to remove cleanly. Choose a plain surface or add the pedal without a photo.',
  reverted:
    'We couldn’t separate the pedal from the background. Choose another photo or add the pedal without one.',
};

export default function NewPedalPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [preparedPhoto, setPreparedPhoto] = useState<PreparedPhoto | null>(null);
  const [basePreparedPhoto, setBasePreparedPhoto] = useState<PreparedPhoto | null>(null);
  const [photoGeometry, setPhotoGeometry] = useState<PhotoGeometryCorrection>(
    DEFAULT_PHOTO_GEOMETRY
  );
  const [perspectiveDraft, setPerspectiveDraft] = useState(0);
  const [photoResolutionRequired, setPhotoResolutionRequired] = useState(false);

  // Object URLs retain their Blob until revoked. Replacement is handled by
  // showPhoto; this cleanup covers leaving the form with a preview still open.
  const previewOnUnmount = useRef<string | null>(null);
  useEffect(() => {
    previewOnUnmount.current = imagePreview;
  }, [imagePreview]);
  useEffect(
    () => () => {
      if (previewOnUnmount.current) URL.revokeObjectURL(previewOnUnmount.current);
    },
    []
  );

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

  const showPhoto = (
    file: File | null,
    url: string | null,
    note: string | null,
    prepared: PreparedPhoto | null,
    resolutionRequired: boolean
  ) => {
    setImageFile(file);
    setPhotoNote(note);
    setPreparedPhoto(prepared);
    setPhotoResolutionRequired(resolutionRequired);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const clearPhoto = () => {
    showPhoto(null, null, null, null, false);
    setBasePreparedPhoto(null);
    setPhotoGeometry(DEFAULT_PHOTO_GEOMETRY);
    setPerspectiveDraft(0);
    if (imageInputRef.current) imageInputRef.current.value = '';
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
      clearPhoto();
      return;
    }

    // Cut the background out before upload so the pedal renders as a silhouette
    // on the board, matching the mirrored system-pedal photos.
    setProcessing(true);
    try {
      const prepared = await preparePedalPhoto(file);
      const usable = isUsablePedalPhotoStatus(prepared.status);
      setBasePreparedPhoto(usable ? prepared : null);
      setPhotoGeometry(DEFAULT_PHOTO_GEOMETRY);
      setPerspectiveDraft(0);
      showPhoto(
        usable ? prepared.file : null,
        prepared.previewUrl,
        PHOTO_NOTE[prepared.status],
        prepared,
        !usable
      );
    } catch {
      setBasePreparedPhoto(null);
      setPhotoGeometry(DEFAULT_PHOTO_GEOMETRY);
      setPerspectiveDraft(0);
      showPhoto(
        null,
        URL.createObjectURL(file),
        'We couldn’t process this image. Choose another photo or add the pedal without one.',
        null,
        true
      );
    } finally {
      setProcessing(false);
      // A failed file may need to be selected again after the user changes the
      // lighting or crop. Clearing the native value lets that fire `change`.
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const applyGeometryCorrection = async (next: PhotoGeometryCorrection) => {
    if (!basePreparedPhoto) return;
    setError(null);
    setProcessing(true);
    try {
      const corrected = await correctPreparedPedalPhoto(basePreparedPhoto, next);
      setPhotoGeometry(next);
      setPerspectiveDraft(next.topEdgeCorrection);
      showPhoto(
        corrected.file,
        corrected.previewUrl,
        PHOTO_NOTE[corrected.status],
        corrected,
        false
      );
    } catch {
      setError('We couldn’t apply that photo correction. The previous preview is unchanged.');
    } finally {
      setProcessing(false);
    }
  };

  const rotatePhoto = (direction: -1 | 1) => {
    const quarterTurns = ((photoGeometry.quarterTurns + direction + 4) % 4) as QuarterTurns;
    void applyGeometryCorrection({
      quarterTurns,
      topEdgeCorrection: perspectiveDraft,
    });
  };

  const declaredAspect =
    Math.max(parseFloat(form.widthInches) || 2.9, 0.1) /
    Math.max(parseFloat(form.depthInches) || 5.1, 0.1);
  const photoFootprintRatio = preparedPhoto
    ? preparedPhoto.width / preparedPhoto.height / declaredAspect
    : null;
  const photoShapeMismatch =
    photoFootprintRatio !== null &&
    (photoFootprintRatio < 0.8 || photoFootprintRatio > 1.25);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (processing || photoResolutionRequired) {
      setError('Choose another photo or continue without this one before saving.');
      return;
    }

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
          // Provenance travels with every image we serve (see the rights
          // statement in README.md). For an upload the owner is the source.
          image_source_url: imageUrl ? 'user-upload' : null,
          image_license: imageUrl ? 'user-provided' : null,
          image_fetched_at: imageUrl ? new Date().toISOString() : null,
          ...(imageUrl && preparedPhoto && isUsablePedalPhotoStatus(preparedPhoto.status)
            ? approvedImageMetadata(
                preparedPhoto.status,
                {
                  sourceWidth: preparedPhoto.sourceWidth,
                  sourceHeight: preparedPhoto.sourceHeight,
                  outputWidth: preparedPhoto.width,
                  outputHeight: preparedPhoto.height,
                },
                { widthInches: width, depthInches: depth },
                photoGeometry
              )
            : noImageMetadata()),
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <Label htmlFor="photo">Photo (optional)</Label>
              <div className="border border-border bg-background px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                Shoot directly overhead with the whole pedal visible. Use a plain surface that
                contrasts with the enclosure and avoid strong shadows.
              </div>
              <Input
                ref={imageInputRef}
                id="photo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onImageChange}
                disabled={processing}
              />
              {processing && <p className="text-sm text-muted-foreground">Removing background…</p>}
              {imagePreview && (
                <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
                  <div className="bg-card p-3">
                    <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Cutout
                    </p>
                    <div
                      className="flex h-44 items-center justify-center overflow-hidden"
                      style={{
                        backgroundColor: 'oklch(0.29 0.011 250)',
                        backgroundImage:
                          'linear-gradient(45deg, oklch(0.225 0.009 250) 25%, transparent 25%, transparent 75%, oklch(0.225 0.009 250) 75%), linear-gradient(45deg, oklch(0.225 0.009 250) 25%, transparent 25%, transparent 75%, oklch(0.225 0.009 250) 75%)',
                        backgroundSize: '16px 16px',
                        backgroundPosition: '0 0, 8px 8px',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imagePreview}
                        alt="Processed pedal on a transparency grid"
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  </div>

                  <div className="bg-card p-3">
                    <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Board result
                    </p>
                    <div
                      className="flex h-44 items-center justify-center overflow-hidden bg-[oklch(0.225_0.009_250)]"
                      style={{
                        backgroundImage:
                          'linear-gradient(to bottom, transparent 0%, transparent 18%, oklch(0.345 0.013 250) 18%, oklch(0.345 0.013 250) 24%, transparent 24%, transparent 56%, oklch(0.345 0.013 250) 56%, oklch(0.345 0.013 250) 62%, transparent 62%)',
                      }}
                    >
                      <div
                        className="relative h-40 max-w-full"
                        style={{
                          aspectRatio: `${Math.max(parseFloat(form.widthInches) || 2.9, 0.1)} / ${Math.max(parseFloat(form.depthInches) || 5.1, 0.1)}`,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imagePreview}
                          alt="Processed pedal at its declared board footprint"
                          className="absolute inset-0 size-full object-contain"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {preparedPhoto && !photoResolutionRequired && (
                <div className="space-y-3 border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Geometry correction
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Rotate sideways photos or straighten a top edge narrowed by camera angle.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={processing}
                        onClick={() => rotatePhoto(-1)}
                      >
                        Rotate left
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={processing}
                        onClick={() => rotatePhoto(1)}
                      >
                        Rotate right
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-4">
                        <Label htmlFor="photo-perspective">Top-edge correction</Label>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {Math.round(perspectiveDraft * 100)}%
                        </span>
                      </div>
                      <input
                        id="photo-perspective"
                        type="range"
                        min="-0.35"
                        max="0.35"
                        step="0.01"
                        value={perspectiveDraft}
                        onChange={(event) => setPerspectiveDraft(Number(event.target.value))}
                        className="h-8 w-full accent-[var(--primary)]"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        processing ||
                        Math.abs(perspectiveDraft - photoGeometry.topEdgeCorrection) < 0.001
                      }
                      onClick={() =>
                        void applyGeometryCorrection({
                          ...photoGeometry,
                          topEdgeCorrection: perspectiveDraft,
                        })
                      }
                    >
                      Apply correction
                    </Button>
                  </div>
                  {photoShapeMismatch && photoFootprintRatio !== null && (
                    <p role="status" className="text-xs leading-relaxed text-[oklch(0.76_0.13_78)]">
                      The visible photo is {Math.round(Math.abs(photoFootprintRatio - 1) * 100)}%{' '}
                      {photoFootprintRatio > 1 ? 'wider' : 'narrower'} than the dimensions you entered.
                      The board will preserve the photo shape, so check the preview or correct the angle.
                    </p>
                  )}
                </div>
              )}
              {photoNote && (
                <p
                  role={photoResolutionRequired ? 'alert' : 'status'}
                  className={`text-sm ${
                    photoResolutionRequired ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  {photoNote}
                </p>
              )}
              {imagePreview && (
                <div className="flex flex-wrap gap-2">
                  {photoResolutionRequired ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => imageInputRef.current?.click()}
                      >
                        Choose another photo
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={clearPhoto}>
                        Continue without photo
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={clearPhoto}>
                      Remove photo
                    </Button>
                  )}
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => router.push('/pedals')} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || processing || photoResolutionRequired}>
                {saving ? 'Saving…' : 'Add Pedal'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
