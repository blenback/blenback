// Text rendering for the generated SVGs.
//
// Every glyph is converted to a <path>. That costs a little file size but buys
// two things GitHub makes us care about:
//   - no @font-face, so nothing is fetched when the SVG renders (GitHub serves
//     these through its camo proxy, which blocks external subresources)
//   - identical output in every browser, unlike foreignObject, which Firefox
//     refuses to render inside an <img> (bugzilla 834619)

import opentype from "opentype.js";

const FONTSHARE_CSS = "https://api.fontshare.com/v2/css?f[]=satoshi@";
const GOOGLE_TTF = "https://raw.githubusercontent.com/google/fonts/main/ofl/spectral";

// Chrome UA: Fontshare varies the CSS it serves by user agent and only offers
// the .ttf that opentype.js can parse to browser-like clients.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function loadSatoshi(weight) {
  const css = await fetch(`${FONTSHARE_CSS}${weight}&display=swap`, {
    headers: { "user-agent": UA },
  }).then((res) => res.text());
  const match = css.match(/\/\/cdn\.fontshare\.com\/[^'"]+\.ttf/);
  if (!match) throw new Error(`could not find a .ttf for Satoshi ${weight} in the Fontshare CSS`);
  return opentype.parse(toArrayBuffer(await fetchBuffer(`https:${match[0]}`)));
}

async function loadSpectral(style) {
  return opentype.parse(toArrayBuffer(await fetchBuffer(`${GOOGLE_TTF}/Spectral-${style}.ttf`)));
}

// opentype.parse wants a real ArrayBuffer, not a Buffer view into a pool
const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

export async function loadFonts() {
  const [satoshi500, satoshi700, satoshi900, spectral, spectralItalic] = await Promise.all([
    loadSatoshi(500),
    loadSatoshi(700),
    loadSatoshi(900),
    loadSpectral("Regular"),
    loadSpectral("Italic"),
  ]);
  return { satoshi500, satoshi700, satoshi900, spectral, spectralItalic };
}

export const widthOf = (font, text, size) => font.getAdvanceWidth(text, size);

// opentype.js's own toPathData() rounds via a helper that can yield literal
// "NaN" in the output, which silently truncates the glyph run at that point
// (every glyph after it disappears). Serialise the commands ourselves instead.
const num = (value) => {
  const rounded = Math.round(value * 10) / 10;
  if (!Number.isFinite(rounded)) throw new Error(`non-finite path coordinate: ${value}`);
  return String(rounded);
};

function pathData(path) {
  let out = "";
  for (const c of path.commands) {
    switch (c.type) {
      case "M":
        out += `M${num(c.x)} ${num(c.y)}`;
        break;
      case "L":
        out += `L${num(c.x)} ${num(c.y)}`;
        break;
      case "C":
        out += `C${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`;
        break;
      case "Q":
        out += `Q${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)}`;
        break;
      case "Z":
        out += "Z";
        break;
      default:
        throw new Error(`unexpected path command "${c.type}"`);
    }
  }
  return out;
}

/** A single run of text as an SVG <path>, positioned on its baseline. */
export function textPath(font, text, x, y, size, fill, opacity) {
  if (!text) return "";
  const data = pathData(font.getPath(text, x, y, size));
  if (!data) return "";
  const alpha = opacity == null ? "" : ` fill-opacity="${opacity}"`;
  return `<path d="${data}" fill="${fill}"${alpha}/>`;
}

/**
 * Greedy word wrap. Returns at most `maxLines` lines, ellipsising the last one
 * if the text does not fit.
 */
export function wrap(font, text, size, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (widthOf(font, candidate, size) <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  const overflowed = lines.length === maxLines && words.join(" ") !== lines.join(" ");
  if (overflowed) lines[lines.length - 1] = ellipsise(font, lines[lines.length - 1], size, maxWidth);
  return lines;
}

function ellipsise(font, line, size, maxWidth) {
  let text = line;
  while (text && widthOf(font, `${text}…`, size) > maxWidth) {
    text = text.replace(/\s*\S$/, "");
  }
  return `${text}…`;
}

/** Lay out a wrapped block of text, returning the paths and the height used. */
export function textBlock(font, text, x, y, size, lineHeight, fill, maxWidth, maxLines, opacity) {
  const lines = wrap(font, text, size, maxWidth, maxLines);
  const paths = lines.map((line, i) => textPath(font, line, x, y + i * lineHeight, size, fill, opacity));
  return { svg: paths.join(""), lines: lines.length, height: lines.length * lineHeight };
}

/**
 * A single line built from differently styled segments, e.g. the role line
 * where the working-group name is burnt orange and the rest is ink.
 * Each segment is { text, font, size, fill }.
 */
export function richLine(segments, x, y) {
  let cursor = x;
  const paths = segments.map(({ text, font, size, fill }) => {
    const path = textPath(font, text, cursor, y, size, fill);
    cursor += widthOf(font, text, size);
    return path;
  });
  return { svg: paths.join(""), width: cursor - x };
}
