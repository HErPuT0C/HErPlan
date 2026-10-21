// Pictures of the tutorial project (F7-05), drawn for HErPlan as SVG: portraits of its characters, the
// lighthouse, a map of the island and a cover. Plain shapes, no fonts but the system's, so they look the
// same everywhere.

export interface PortraitStyle {
  bg: [string, string];
  skin: string;
  hair: string;
  shirt: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bald';
  beard?: boolean;
  scarf?: string;
}

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${body}\n</svg>\n`;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function hair(style: PortraitStyle): string {
  switch (style.hairStyle) {
    case 'short':
      return `<path d="M80 112 C76 62 104 48 128 48 C154 48 182 60 176 112 C168 86 150 76 128 78 C106 76 90 86 80 112 Z" fill="${style.hair}"/>`;
    case 'long':
      return `<path d="M76 196 C70 150 72 112 78 96 C86 60 108 46 128 46 C150 46 172 60 180 96 C186 116 186 150 180 196 C170 170 172 130 168 108 C156 88 144 82 128 82 C110 82 98 90 88 108 C84 132 86 170 76 196 Z" fill="${style.hair}"/>`;
    case 'bun':
      return `<circle cx="128" cy="44" r="22" fill="${style.hair}"/><path d="M80 112 C78 66 104 56 128 56 C152 56 180 66 176 112 C166 88 148 80 128 82 C108 80 90 90 80 112 Z" fill="${style.hair}"/>`;
    case 'bald':
      return `<path d="M84 108 C82 96 86 88 92 84 C90 96 90 104 92 112 Z M172 108 C174 96 170 88 164 84 C166 96 166 104 164 112 Z" fill="${style.hair}"/>`;
  }
}

/** A head-and-shoulders portrait, 256×256. */
export function portrait(style: PortraitStyle): string {
  return svg(
    256,
    256,
    [
      `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${style.bg[0]}"/><stop offset="1" stop-color="${style.bg[1]}"/></linearGradient></defs>`,
      `<rect width="256" height="256" fill="url(#bg)"/>`,
      `<path d="M40 256 C50 198 92 174 128 174 C164 174 206 198 216 256 Z" fill="${style.shirt}"/>`,
      style.scarf
        ? `<path d="M92 184 C110 198 146 198 164 184 L170 200 C146 216 110 216 86 200 Z" fill="${style.scarf}"/>`
        : '',
      `<rect x="112" y="148" width="32" height="36" rx="12" fill="${style.skin}" opacity="0.92"/>`,
      `<ellipse cx="128" cy="114" rx="46" ry="54" fill="${style.skin}"/>`,
      hair(style),
      style.beard
        ? `<path d="M86 124 C88 168 108 182 128 182 C148 182 168 168 170 124 C160 146 146 152 128 152 C110 152 96 146 86 124 Z" fill="${style.hair}"/>`
        : '',
      `<circle cx="110" cy="116" r="5" fill="#23252b"/><circle cx="146" cy="116" r="5" fill="#23252b"/>`,
      `<path d="M114 ${style.beard ? 160 : 144} Q128 ${style.beard ? 168 : 154} 142 ${style.beard ? 160 : 144}" stroke="#7a3b32" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

/** The ship's cat: a round head with ears, 256×256. */
export function catPortrait(): string {
  return svg(
    256,
    256,
    [
      `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d3a52"/><stop offset="1" stop-color="#1b2232"/></linearGradient></defs>`,
      `<rect width="256" height="256" fill="url(#bg)"/>`,
      `<path d="M64 256 C70 204 98 184 128 184 C158 184 186 204 192 256 Z" fill="#d9813a"/>`,
      `<path d="M74 92 L84 36 L118 74 Z M182 92 L172 36 L138 74 Z" fill="#d9813a"/>`,
      `<path d="M84 84 L88 52 L108 74 Z M172 84 L168 52 L148 74 Z" fill="#f2b98a"/>`,
      `<ellipse cx="128" cy="122" rx="62" ry="56" fill="#e08f46"/>`,
      `<path d="M100 82 L108 104 M128 76 L128 100 M156 82 L148 104" stroke="#b8642a" stroke-width="6" stroke-linecap="round"/>`,
      `<ellipse cx="104" cy="122" rx="10" ry="12" fill="#f5e27a"/><ellipse cx="152" cy="122" rx="10" ry="12" fill="#f5e27a"/>`,
      `<ellipse cx="104" cy="122" rx="3" ry="10" fill="#23252b"/><ellipse cx="152" cy="122" rx="3" ry="10" fill="#23252b"/>`,
      `<path d="M122 142 L134 142 L128 150 Z" fill="#b24a4a"/>`,
      `<path d="M128 150 Q118 160 108 154 M128 150 Q138 160 148 154" stroke="#7a3b32" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      `<path d="M70 140 L100 144 M70 152 L100 150 M186 140 L156 144 M186 152 L156 150" stroke="#f7efe2" stroke-width="2" stroke-linecap="round"/>`,
    ].join('\n'),
  );
}

function lighthouseScene(title: string | null): string {
  const stars = [
    [60, 40],
    [140, 70],
    [230, 30],
    [520, 50],
    [590, 90],
    [470, 24],
    [330, 44],
    [90, 110],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#f2f4ff" opacity="0.8"/>`)
    .join('');
  return [
    `<defs>`,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121a33"/><stop offset="0.7" stop-color="#2c3b63"/><stop offset="1" stop-color="#4a5d86"/></linearGradient>`,
    `<linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffe9a3" stop-opacity="0.85"/><stop offset="1" stop-color="#ffe9a3" stop-opacity="0"/></linearGradient>`,
    `<linearGradient id="beamLeft" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffe9a3" stop-opacity="0.6"/><stop offset="1" stop-color="#ffe9a3" stop-opacity="0"/></linearGradient>`,
    `</defs>`,
    `<rect width="640" height="400" fill="url(#sky)"/>`,
    stars,
    `<polygon points="372,118 640,40 640,170" fill="url(#beam)"/>`,
    `<polygon points="328,118 0,50 0,160" fill="url(#beamLeft)"/>`,
    `<path d="M0 300 Q80 286 160 300 T320 300 T480 300 T640 300 L640 400 L0 400 Z" fill="#1d2b48"/>`,
    `<path d="M0 330 Q80 316 160 330 T320 330 T480 330 T640 330 L640 400 L0 400 Z" fill="#16223b"/>`,
    `<path d="M250 310 C270 270 300 256 330 254 C370 252 410 270 430 310 Z" fill="#2a2f3a"/>`,
    `<polygon points="332,260 368,260 360,140 340,140" fill="#f4f1ea"/>`,
    `<polygon points="336,232 364,232 362,206 338,206" fill="#c9473f"/>`,
    `<polygon points="339,180 361,180 360,156 340,156" fill="#c9473f"/>`,
    `<rect x="334" y="124" width="32" height="18" rx="3" fill="#ffd977"/>`,
    `<polygon points="330,124 370,124 350,104" fill="#3a3f4b"/>`,
    `<rect x="328" y="140" width="44" height="5" fill="#3a3f4b"/>`,
    `<rect x="0" y="270" width="640" height="26" fill="#cfd6e6" opacity="0.12"/>`,
    title
      ? `<text x="320" y="374" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700" fill="#f7f3e8">${escape(title)}</text>`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The lighthouse at night, 640×400. */
export function lighthouse(): string {
  return svg(640, 400, lighthouseScene(null));
}

/** The cover of the tutorial project: the lighthouse and the game's title. */
export function cover(title: string): string {
  return svg(640, 400, lighthouseScene(title));
}

/** A map of the island with its places named, 640×420. */
export function islandMap(names: {
  island: string;
  lighthouse: string;
  pier: string;
  stairs: string;
  north: string;
}): string {
  const label = (x: number, y: number, text: string) =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#3b2f22">${escape(text)}</text>`;
  return svg(
    640,
    420,
    [
      `<rect width="640" height="420" fill="#e9dcc0"/>`,
      `<rect x="10" y="10" width="620" height="400" fill="none" stroke="#a88e64" stroke-width="3" rx="6"/>`,
      `<g stroke="#b9c9cf" stroke-width="2" fill="none" opacity="0.8">`,
      `<path d="M40 60 q12 -8 24 0 t24 0"/><path d="M520 340 q12 -8 24 0 t24 0"/><path d="M80 350 q12 -8 24 0 t24 0"/><path d="M500 80 q12 -8 24 0 t24 0"/>`,
      `</g>`,
      `<path d="M190 120 C240 70 360 62 430 104 C500 146 520 230 470 286 C420 344 300 352 230 314 C160 276 140 170 190 120 Z" fill="#c8b98d" stroke="#8a7350" stroke-width="3"/>`,
      `<path d="M230 150 C270 120 340 116 390 140 C430 160 446 210 420 250" fill="none" stroke="#a6946a" stroke-width="2" stroke-dasharray="6 6"/>`,
      `<path d="M388 140 L382 196 L330 232 L280 268" fill="none" stroke="#7b4a2a" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>`,
      `<polygon points="382,104 396,104 392,72 386,72" fill="#f4f1ea" stroke="#3b2f22" stroke-width="2"/>`,
      `<rect x="384" y="64" width="10" height="9" fill="#ffd977" stroke="#3b2f22" stroke-width="2"/>`,
      label(390, 126, names.lighthouse),
      `<rect x="250" y="292" width="54" height="10" fill="#7b4a2a"/><rect x="258" y="302" width="6" height="18" fill="#7b4a2a"/><rect x="290" y="302" width="6" height="18" fill="#7b4a2a"/>`,
      label(278, 340, names.pier),
      label(352, 222, names.stairs),
      label(320, 40, names.island),
      `<g transform="translate(560 360)"><circle r="26" fill="none" stroke="#8a7350" stroke-width="2"/><polygon points="0,-24 6,0 0,24 -6,0" fill="#8a7350"/><polygon points="0,-24 6,0 -6,0" fill="#c9473f"/></g>`,
      label(560, 324, names.north),
    ].join('\n'),
  );
}
