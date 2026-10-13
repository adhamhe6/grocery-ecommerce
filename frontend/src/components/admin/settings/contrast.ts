// WCAG 2.x contrast maths (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio) used by the brand colour check.

export const WCAG_AA_NORMAL_TEXT = 4.5;

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** Relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** (L_lighter + 0.05) / (L_darker + 0.05), from 1 to 21. Null if either colour isn't a #RRGGBB value. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastReport { ratio: number; /** truncated (never rounded up) to 2 decimals for display */ display: string; passesAA: boolean }

/** How readable white text is on this background colour. The display value is truncated so 4.496 never reads as a pass. */
export function whiteTextContrast(background: string): ContrastReport | null {
  const ratio = contrastRatio(background, "#FFFFFF");
  if (ratio === null) return null;
  return { ratio, display: (Math.floor(ratio * 100) / 100).toFixed(2), passesAA: ratio >= WCAG_AA_NORMAL_TEXT };
}
