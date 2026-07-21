// SVG components mirroring the website's visual language.
//
// Built from native SVG primitives only — rounded corners are rx/clipPath,
// shadows are feDropShadow, type is outlined by typeset.mjs. See that file for
// why foreignObject is avoided.
//
// Token values are lifted verbatim from the site's theme.scss / _brand.yml.

import sharp from "sharp";
import { richLine, textBlock, textPath, widthOf } from "./typeset.mjs";

export const C = {
  cream: "#F4EEE2",
  cream2: "#EFE7D7",
  surface: "#FBF7EE",
  ink: "#2B2620",
  inkSoft: "#6B6253",
  inkFaint: "#97907F",
  forest: "#36513C",
  olive: "#6E7350",
  sage: "#97A083",
  burnt: "#BC5C32",
  tan: "#DAC6A0",
  sand: "#E8DCC4",
};

// --bb-line: rgba(43,38,32,.12)
const LINE = { color: "#2B2620", opacity: 0.12 };

// --bb-shadow-card: 0 1px 2px rgba(43,38,32,.04), 0 18px 40px -22px rgba(43,38,32,.30)
// The -22px spread is approximated by pulling stdDeviation in.
const SHADOW_CARD = `
  <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="150%">
    <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="${C.ink}" flood-opacity="0.04"/>
    <feDropShadow dx="0" dy="12" stdDeviation="9" flood-color="${C.ink}" flood-opacity="0.26"/>
  </filter>`;

// --bb-shadow-soft: 0 10px 30px -18px rgba(43,38,32,.35)
const SHADOW_SOFT = `
  <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="${C.ink}" flood-opacity="0.32"/>
  </filter>`;

const RADIUS = 18;

const svgDoc = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
  `viewBox="0 0 ${width} ${height}" fill="none" role="img">${body}</svg>`;

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const title = (text) => `<title>${escapeXml(text)}</title>`;

// ------------------------------------------------------------------ imagery

/**
 * Fetch and re-encode an image as a data URI. Everything must be inlined: the
 * SVG is served through GitHub's camo proxy, which will not resolve external
 * references from inside it.
 */
async function inlineImage(url, transform, quality) {
  const res = await fetch(url, { headers: { "user-agent": "blenback-readme-builder" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  // base64 inflates by ~33% and these files are committed on every content
  // change, so keep the encode lean — they are displayed at well under 500px
  const jpeg = await transform(sharp(Buffer.from(await res.arrayBuffer())))
    .jpeg({ quality, chromaSubsampling: "4:2:0", mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export const thumbnailUri = (url, width, height) =>
  inlineImage(url, (img) => img.resize(width, height, { fit: "cover", position: "attention" }), 62);

// object-position: 50% 30% on the site — "top" is the closest sharp equivalent
export const portraitUri = (url, size) =>
  inlineImage(url, (img) => img.resize(size, size, { fit: "cover", position: "top" }), 72);

// --------------------------------------------------------------------- card

const PAD_X = 20;
const PAD_TOP = 10;
const PAD_BOTTOM = 34; // room for the drop shadow
const BODY_PAD = 18;

// Cards are rendered at the pixel width they will occupy on the page, so text
// in a 3-up row reads at the same size as text in a 2-up row.
export const thumbHeight = (cardW) => Math.round(cardW * 0.346);

/** Height the card body needs, so a whole row can share one height. */
export function cardHeight(fonts, card, CARD_W) {
  const inner = CARD_W - BODY_PAD * 2;
  const titleLines = Math.min(
    textBlock(fonts.satoshi700, card.title, 0, 0, 17, 22, C.ink, inner, 3).lines,
    3,
  );
  const blurbLines = card.blurb
    ? textBlock(fonts.spectral, card.blurb, 0, 0, 13.5, 19, C.inkSoft, inner, 3).lines
    : 0;

  return (
    (card.image ? thumbHeight(CARD_W) : 0) +
    BODY_PAD +
    titleLines * 22 +
    10 +
    (card.meta ? 16 : 0) +
    (blurbLines ? 8 + blurbLines * 19 : 0) +
    (card.tags?.length ? 14 + 24 : 0) +
    BODY_PAD
  );
}

/** A pill-shaped category tag, matching --bb-radius-pill. */
function tagPill(fonts, text, x, y) {
  const size = 11;
  const w = widthOf(fonts.satoshi500, text, size) + 20;
  const h = 22;
  return {
    width: w,
    svg:
      `<rect x="${x}" y="${y}" width="${w.toFixed(2)}" height="${h}" rx="${h / 2}" ` +
      `fill="${C.cream2}" stroke="${LINE.color}" stroke-opacity="${LINE.opacity}"/>` +
      textPath(fonts.satoshi500, text, x + 10, y + 15, size, C.olive),
  };
}

/**
 * One content card: rounded surface, real drop shadow, cover-cropped thumbnail
 * clipped to the top corners.
 */
export function renderCard(fonts, card, height, CARD_W) {
  const w = CARD_W + PAD_X * 2;
  const h = height + PAD_TOP + PAD_BOTTOM;
  const inner = CARD_W - BODY_PAD * 2;
  const left = PAD_X + BODY_PAD;
  const THUMB_H = thumbHeight(CARD_W);
  let y = PAD_TOP;

  const parts = [
    title(card.title),
    `<defs>${SHADOW_CARD}
      <clipPath id="cardClip">
        <rect x="${PAD_X}" y="${PAD_TOP}" width="${CARD_W}" height="${height}" rx="${RADIUS}"/>
      </clipPath>
    </defs>`,
    `<rect x="${PAD_X}" y="${PAD_TOP}" width="${CARD_W}" height="${height}" rx="${RADIUS}" ` +
      `fill="${C.surface}" filter="url(#cardShadow)"/>`,
  ];

  if (card.image) {
    parts.push(
      `<g clip-path="url(#cardClip)">` +
        `<rect x="${PAD_X}" y="${PAD_TOP}" width="${CARD_W}" height="${THUMB_H}" fill="${C.cream2}"/>` +
        `<image href="${card.image}" x="${PAD_X}" y="${PAD_TOP}" width="${CARD_W}" ` +
        `height="${THUMB_H}" preserveAspectRatio="xMidYMid slice"/>` +
        `</g>`,
    );
    y += THUMB_H;
  }

  y += BODY_PAD + 15; // first baseline
  const titleBlock = textBlock(fonts.satoshi700, card.title, left, y, 17, 22, C.ink, inner, 3);
  parts.push(titleBlock.svg);
  y += titleBlock.height + 10;

  if (card.meta) {
    parts.push(textPath(fonts.satoshi500, card.meta, left, y, 12, C.inkFaint));
    y += 16;
  }

  if (card.blurb) {
    y += 8;
    const blurb = textBlock(fonts.spectral, card.blurb, left, y + 5, 13.5, 19, C.inkSoft, inner, 3);
    parts.push(blurb.svg);
    y += blurb.height;
  }

  if (card.tags?.length) {
    y += 14;
    let cursor = left;
    for (const tag of card.tags) {
      const pill = tagPill(fonts, tag, cursor, y);
      if (cursor + pill.width > left + inner) break; // never overflow the card
      parts.push(pill.svg);
      cursor += pill.width + 6;
    }
  }

  // hairline border, drawn last so it sits above the thumbnail
  parts.push(
    `<rect x="${PAD_X + 0.5}" y="${PAD_TOP + 0.5}" width="${CARD_W - 1}" height="${height - 1}" ` +
      `rx="${RADIUS}" fill="none" stroke="${LINE.color}" stroke-opacity="${LINE.opacity}"/>`,
  );

  return svgDoc(w, h, parts.join(""));
}

// ------------------------------------------------------------------- banner

/** The hero: eyebrow, two-tone name, role, intro and the ringed portrait. */
export function renderBanner(fonts, { portrait, role, intro }) {
  const W = 1100;
  const H = 440;
  const left = 64;
  const textWidth = 560;

  // portrait geometry
  const cx = 860;
  const cy = 216;
  const r = 150;
  const ring = 6;

  const parts = [
    title("Hi there, I'm Ben Black"),
    `<defs>${SHADOW_SOFT}
      <clipPath id="portraitClip"><circle cx="${cx}" cy="${cy}" r="${r - ring}"/></clipPath>
    </defs>`,
    `<rect width="${W}" height="${H}" rx="${RADIUS}" fill="${C.cream}"/>`,
  ];

  // eyebrow — Spectral italic, burnt orange, exactly as on the site
  parts.push(textPath(fonts.spectralItalic, "Hi there, I'm", left, 106, 27, C.burnt));

  // "Ben" over "Black." — Satoshi 900, ink then forest, tight tracking
  parts.push(textPath(fonts.satoshi900, "Ben", left - 4, 196, 92, C.ink));
  parts.push(textPath(fonts.satoshi900, "Black.", left - 4, 282, 92, C.forest));

  // role line, with the working-group name picked out in burnt orange
  const roleY = 326;
  parts.push(
    richLine(
      [
        { text: "Head of the Working Group ", font: fonts.satoshi500, size: 16, fill: C.ink },
        { text: role.group, font: fonts.satoshi700, size: 16, fill: C.burnt },
        // the comma belongs to this line so the wrapped remainder reads as
        // "…Living Labs," / "at ZALF."
        { text: ",", font: fonts.satoshi500, size: 16, fill: C.ink },
      ],
      left,
      roleY,
    ).svg,
  );
  parts.push(
    richLine([{ text: role.suffix, font: fonts.satoshi500, size: 16, fill: C.ink }], left, roleY + 22).svg,
  );

  parts.push(
    textBlock(fonts.spectral, intro, left, roleY + 54, 15, 22, C.inkSoft, textWidth, 3).svg,
  );

  // portrait: outer glow, cream ring, cover-cropped photo
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r + 22}" fill="${C.sand}" fill-opacity="0.45"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.surface}" filter="url(#softShadow)"/>`);
  parts.push(
    `<image href="${portrait}" x="${cx - r + ring}" y="${cy - r + ring}" ` +
      `width="${(r - ring) * 2}" height="${(r - ring) * 2}" ` +
      `preserveAspectRatio="xMidYMid slice" clip-path="url(#portraitClip)"/>`,
  );
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${r - ring / 2}" fill="none" stroke="${C.tan}" stroke-opacity="0.55" stroke-width="1"/>`,
  );

  // the dotted squiggle from the site's hero
  parts.push(
    `<g transform="translate(${cx - 168} ${cy + r + 10}) scale(0.82)" stroke="${C.sage}" stroke-width="2.9" ` +
      `stroke-linecap="round" fill="none">` +
      `<path d="M6 46 C 40 70, 70 10, 110 20 S 180 60, 224 -10" stroke-dasharray="2 11"/>` +
      `<path d="M224 -10 l -14 2 m 14 -2 l -4 -13"/>` +
      `</g>`,
  );

  return svgDoc(W, H, parts.join(""));
}

// -------------------------------------------------------------------- pills

/** A pill button matching the site's --bb-radius-pill call-to-action style. */
export function renderPill(fonts, { label, fill, textColor = "#FFFFFF", icon }) {
  const size = 15;
  const h = 44;
  const padX = 22;
  const iconSize = 17;
  const gap = icon ? 9 : 0;
  const textW = widthOf(fonts.satoshi700, label, size);
  const w = padX * 2 + (icon ? iconSize + gap : 0) + textW;
  const pad = 6; // shadow room

  const parts = [
    title(label),
    `<defs>${SHADOW_SOFT}</defs>`,
    `<rect x="${pad}" y="${pad / 2}" width="${w.toFixed(2)}" height="${h}" rx="${h / 2}" fill="${fill}"/>`,
  ];

  let cursor = pad + padX;
  if (icon) {
    const scale = iconSize / 24;
    parts.push(
      `<g transform="translate(${cursor.toFixed(2)} ${(pad / 2 + (h - iconSize) / 2).toFixed(2)}) scale(${scale.toFixed(4)})">` +
        `<path d="${icon}" fill="${textColor}"/></g>`,
    );
    cursor += iconSize + gap;
  }
  parts.push(textPath(fonts.satoshi700, label, cursor, pad / 2 + h / 2 + 5.5, size, textColor));

  return svgDoc(w + pad * 2, h + pad, parts.join(""));
}
