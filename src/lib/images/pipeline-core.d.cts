export interface CoreRgbaImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export type CoreKnockoutStatus =
  | 'knocked-out'
  | 'already-cutout'
  | 'no-background'
  | 'ragged-background'
  | 'subject-eaten'
  | 'reverted';

export interface CoreKnockoutResult {
  image: CoreRgbaImage;
  status: CoreKnockoutStatus;
  knocked: number;
}

export interface AlphaQualityReport {
  transparentShare: number;
  lowAlphaShare: number;
  semiTransparentShare: number;
  opaqueShare: number;
  solidComponents: number;
  solidStrayShare: number;
}

declare const core: {
  knockOutBackground(
    input: CoreRgbaImage,
    options?: { useGradient?: boolean; bgTol?: number; allowRagged?: boolean }
  ): CoreKnockoutResult;
  trimTransparent(input: CoreRgbaImage, alphaThreshold?: number): CoreRgbaImage;
  clearLowAlphaMatte(
    input: CoreRgbaImage,
    threshold?: number
  ): { image: CoreRgbaImage; cleared: number };
  dropStrayBackground(
    input: CoreRgbaImage
  ): { image: CoreRgbaImage; dropped: number; blobs: number };
  alphaQualityReport(input: CoreRgbaImage): AlphaQualityReport;
};

export = core;
