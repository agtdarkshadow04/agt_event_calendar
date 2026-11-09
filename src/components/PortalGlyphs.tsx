import { portalGlyphCode } from '../lib/validation';

/**
 * Draws a portal code as No Man's Sky portal glyphs with the bundled NMS
 * Glyphs Mono font (spec UI-14). Renders nothing unless the code is exactly 12
 * hexadecimal digits. Always show the hexadecimal text next to it: the glyphs
 * are hidden from screen readers and translation tools.
 */
export function PortalGlyphs({ code, className = '' }: { code: string; className?: string }) {
  const glyphs = portalGlyphCode(code);
  if (!glyphs) return null;
  return (
    <span className={`portal-glyphs ${className}`.trim()} aria-hidden="true" translate="no">
      {glyphs}
    </span>
  );
}
