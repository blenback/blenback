// 24x24 icon path data for the pill buttons.
//
// Brand marks come from simple-icons at build time so they stay current; the
// two generic glyphs have no simple-icons equivalent and are defined here.

const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@13/icons";

const LOCAL = {
  envelope:
    "M1.5 4.5h21A1.5 1.5 0 0 1 24 6v12a1.5 1.5 0 0 1-1.5 1.5h-21A1.5 1.5 0 0 1 0 18V6a1.5 1.5 0 0 1 1.5-1.5Zm.9 2.4 9.6 6.3 9.6-6.3V6.6H2.4v.3Zm19.2 2.55-8.79 5.76a1.5 1.5 0 0 1-1.62 0L2.4 9.45v8.55h19.2V9.45Z",
  document:
    "M6 0h8.25L21 6.75V22.5A1.5 1.5 0 0 1 19.5 24h-13.5A1.5 1.5 0 0 1 4.5 22.5V1.5A1.5 1.5 0 0 1 6 0Zm7.5 2.4v5.1h5.1L13.5 2.4ZM8.25 12h7.5v1.8h-7.5V12Zm0 4.2h7.5V18h-7.5v-1.8Z",
};

async function simpleIcon(slug) {
  const url = `${SIMPLE_ICONS}/${slug}.svg`;
  const res = await fetch(url, { headers: { "user-agent": "blenback-readme-builder" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const match = (await res.text()).match(/ d="([^"]+)"/);
  if (!match) throw new Error(`no path data in the simple-icons SVG for "${slug}"`);
  return match[1];
}

/** Resolve a mix of simple-icons slugs and local glyph names to path data. */
export async function loadIcons(names) {
  const entries = await Promise.all(
    names.map(async (name) => [name, LOCAL[name] ?? (await simpleIcon(name))]),
  );
  return Object.fromEntries(entries);
}
