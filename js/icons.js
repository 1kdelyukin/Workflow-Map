// Minimal inline SVG icon set. All icons are 16×16, stroke-based, and inherit currentColor.

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  logo: '<path d="M8 1.6 13.6 4.8v6.4L8 14.4 2.4 11.2V4.8Z"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="4.6" r="1" fill="currentColor" stroke="none"/><circle cx="11.2" cy="9.8" r="1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="9.8" r="1" fill="currentColor" stroke="none"/><path d="M8 6.6V5.4M9.3 8.7l1.1.6M6.7 8.7l-1.1.6" stroke-width="1.1"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  search: '<circle cx="7.2" cy="7.2" r="4.4"/><path d="M10.6 10.6 13.6 13.6"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  'chev-r': '<path d="M6 3.5 10.5 8 6 12.5"/>',
  'chev-d': '<path d="M3.5 6 8 10.5 12.5 6"/>',
  'arrow-l': '<path d="M13 8H3.5M7.5 4 3.5 8l4 4"/>',
  dots: '<circle cx="3.2" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12.8" cy="8" r="1.2" fill="currentColor" stroke="none"/>',
  trash: '<path d="M3 4.5h10M6.4 4.5V3.2h3.2v1.3M4.7 4.5l.55 8a1.6 1.6 0 0 0 1.6 1.5h2.3a1.6 1.6 0 0 0 1.6-1.5l.55-8M6.7 7.2v4M9.3 7.2v4"/>',
  copy: '<rect x="5.8" y="5.8" width="7.2" height="7.2" rx="1.7"/><path d="M10.2 3.3H4.7A1.7 1.7 0 0 0 3 5v5.5"/>',
  download: '<path d="M8 2.5v8M5 7.6 8 10.6l3-3M3 13.2h10"/>',
  upload: '<path d="M8 10.5v-8M5 5.4 8 2.4l3 3M3 13.2h10"/>',
  magnet: '<path d="M3.2 2.8h3.2v5.4a1.6 1.6 0 0 0 3.2 0V2.8h3.2v5.4a4.8 4.8 0 0 1-9.6 0ZM3.2 5.6h3.2M9.6 5.6h3.2"/>',
  sun: '<circle cx="8" cy="8" r="2.7"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/>',
  moon: '<path d="M13.2 9.6A5.8 5.8 0 1 1 6.4 2.8a4.6 4.6 0 0 0 6.8 6.8Z"/>',
  fit: '<path d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3"/>',
  layout: '<rect x="1.8" y="6" width="3.8" height="4" rx="1.1"/><rect x="10.4" y="2" width="3.8" height="4" rx="1.1"/><rect x="10.4" y="10" width="3.8" height="4" rx="1.1"/><path d="M5.6 8h1.8c1.6 0 1.3-4 2.9-4M5.6 8h1.8c1.6 0 1.3 4 2.9 4"/>',
  map: '<rect x="2.2" y="3" width="11.6" height="10" rx="2.2"/><rect x="7.4" y="6.2" width="4.2" height="3.6" rx="1"/>',
  help: '<path d="M5.9 6.1a2.2 2.2 0 1 1 3.7 1.6c-.7.65-1.5.95-1.5 2"/><circle cx="8.1" cy="12.3" r=".95" fill="currentColor" stroke="none"/>',
  check: '<path d="M3 8.6l3.2 3.2L13 4.9"/>',
  stack: '<rect x="5.4" y="2.4" width="8.2" height="5.8" rx="1.6"/><path d="M10.6 10.8v.4a1.6 1.6 0 0 1-1.6 1.6H4A1.6 1.6 0 0 1 2.4 11.2V7.4A1.6 1.6 0 0 1 4 5.8h.4"/>',
  warn: '<path d="M8 2.6 14.2 13.2H1.8Z"/><path d="M8 6.4v3.2"/><circle cx="8" cy="11.4" r=".85" fill="currentColor" stroke="none"/>',
  pencil: '<path d="M3 13l.75-3L10.6 3.2a1.55 1.55 0 0 1 2.2 2.2L6 12.25 3 13ZM9.6 4.2l2.2 2.2"/>',
  target: '<circle cx="8" cy="8" r="5.4"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/>',
  cloud: '<path d="M4.9 12.6h6.6a2.9 2.9 0 0 0 .35-5.78 4 4 0 0 0-7.8.95A2.55 2.55 0 0 0 4.9 12.6Z"/>',
  eye: '<path d="M1.9 8s2.3-4.3 6.1-4.3S14.1 8 14.1 8s-2.3 4.3-6.1 4.3S1.9 8 1.9 8Z"/><circle cx="8" cy="8" r="1.9"/>',
  play: '<path d="M5.4 3.2 12.2 8l-6.8 4.8Z"/>',
  pause: '<path d="M5.4 3.4v9.2M10.6 3.4v9.2"/>',
  'step-f': '<path d="M3.4 3.6 9 8l-5.6 4.4ZM11.8 3.4v9.2"/>',
  'step-b': '<path d="M12.6 3.6 7 8l5.6 4.4ZM4.2 3.4v9.2"/>',
  route: '<path d="M2 12.8h4.6a1.6 1.6 0 0 0 1.6-1.6V4.8a1.6 1.6 0 0 1 1.6-1.6h2.4"/><path d="M10.6 1.1 13.3 3.2l-2.7 2.1"/>',
  lock: '<rect x="3.4" y="7.2" width="9.2" height="6.2" rx="1.7"/><path d="M5.7 7.2V5.1a2.3 2.3 0 0 1 4.6 0v2.1"/>',
  unlock: '<rect x="3.4" y="7.2" width="9.2" height="6.2" rx="1.7"/><path d="M5.7 7.2V5.1a2.3 2.3 0 0 1 4.4-.9"/>',
  reset: '<path d="M13 8.2a5 5 0 1 1-1.6-3.7"/><path d="M13.3 1.6v3h-3"/>',
  // connection-kind glyphs
  'edge-flow': '<path d="M2 8h9"/><path d="M8.4 4.9 11.5 8l-3.1 3.1"/>',
  'edge-callback': '<path d="M2 8h8.4" stroke-dasharray="3 2.6"/><path d="M8.4 4.9 11.5 8l-3.1 3.1"/>',
  'edge-relation': '<path d="M2.4 8h11.2" stroke-dasharray="0.1 3.6"/>',
  // node-type glyphs
  flag: '<path d="M4.2 14V2.6M4.2 3h7.6L9.9 5.6l1.9 2.6H4.2"/>',
  spark: '<path d="M7.2 2c.45 2.5 1.25 3.3 3.75 3.75C8.45 6.2 7.65 7 7.2 9.5 6.75 7 5.95 6.2 3.45 5.75 5.95 5.3 6.75 4.5 7.2 2Z"/><path d="M12 9.4c.27 1.5.75 1.98 2.25 2.25-1.5.27-1.98.75-2.25 2.25-.27-1.5-.75-1.98-2.25-2.25 1.5-.27 1.98-.75 2.25-2.25Z"/>',
  wand: '<path d="M2.8 13.2 9.3 6.7M9.3 6.7l1.6-1.6M12.2 1.8v2.6M10.9 3.1h2.6M13.4 6.4v2M12.4 7.4h2"/>',
  hook: '<circle cx="10.8" cy="3" r="1.25"/><path d="M10.8 4.4v4.4a3.4 3.4 0 0 1-6.8 0v-1.6M4 9.4 2.6 8.1M4 9.4l1.9-.4"/>',
  code: '<path d="M5.3 4.6 2.4 8l2.9 3.4M10.7 4.6 13.6 8l-2.9 3.4"/>',
  doc: '<path d="M9.3 2.4H5.1a1.6 1.6 0 0 0-1.6 1.6v8a1.6 1.6 0 0 0 1.6 1.6h5.8a1.6 1.6 0 0 0 1.6-1.6V5.6Z"/><path d="M9.3 2.4v3.2h3.2M5.8 8.6h4.4M5.8 10.8h3"/>',
  dot: '<circle cx="8" cy="8" r="2.7"/>',
};

export function icon(name, cls = '') {
  const body = PATHS[name] || PATHS.dot;
  return `<svg class="ic ${cls}" viewBox="0 0 16 16" width="16" height="16" ${STROKE} aria-hidden="true">${body}</svg>`;
}
