// Renders the dynamic sections of the profile README.
//
// Sources of truth (never the published RSS feeds — those lag a site rebuild,
// and publications.xml emits the site root as every item's link):
//   - blenback/profi *.yaml            -> publications, presentations, outputs
//   - blenback.github.io posts/*.qmd   -> posts (no YAML equivalent in profi)
//
// Each section is written between <!--START_SECTION:x--> / <!--END_SECTION:x-->
// markers in README.md. Any fetch or parse failure aborts the whole run so a
// transient outage can never blank a section.

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { loadIcons } from "./lib/icons.mjs";
import { loadFonts } from "./lib/typeset.mjs";
import {
  C,
  cardHeight,
  portraitUri,
  renderBanner,
  renderCard,
  renderPill,
  thumbHeight,
  thumbnailUri,
} from "./lib/svg.mjs";

const PROFI = "https://raw.githubusercontent.com/blenback/profi/main";
const SITE_REPO = "blenback/blenback.github.io";
const SITE = "https://blenback.github.io";
const README = "README.md";
const ART = ".github/assets";

// shields.io badges for the publication links, in the brand palette
const FOREST = "36513C";
const OLIVE = "6E7350";
const BURNT = "BC5C32";

const MAX = { posts: 4, publications: 4, presentations: 4, outputs: 3 };

// Rendered pixel width per card, chosen so type reads at the same size whether
// a section is laid out 2-up or 3-up.
const CARD_W = { 2: 520, 3: 340 };
const COL_PCT = { 2: "49%", 3: "32%" };

const fonts = await loadFonts();

// ---------------------------------------------------------------- fetching

const AUTH = process.env.GITHUB_TOKEN
  ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  : {};

async function fetchText(url) {
  // cache-bust: raw.githubusercontent caches aggressively and the whole point
  // of this workflow is to pick up same-day edits to the source repos
  const bust = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${bust}cache=${Date.now()}`, {
    headers: { "user-agent": "blenback-readme-builder" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

const fetchYaml = async (name) => parseYaml(await fetchText(`${PROFI}/${name}.yaml`));

async function listDir(repo, path) {
  const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=main`;
  const res = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "blenback-readme-builder", ...AUTH },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

const headCache = new Map();
function urlExists(url) {
  if (!headCache.has(url)) {
    headCache.set(
      url,
      fetch(url, { method: "HEAD" })
        .then((res) => res.ok)
        .catch(() => false),
    );
  }
  return headCache.get(url);
}

// Two independent hazards, both seen in the live data:
//  - an entry points at an asset that was renamed or never published
//    -> keep the card, drop the image
//  - an entry exists in profi but its page is a Quarto draft, so the URL 404s
//    -> drop the card entirely, and backfill from further down the list
async function resolveCards(cards, max) {
  const checked = await Promise.all(
    cards.map(async (card) => {
      const [pageOk, imageOk] = await Promise.all([
        // only vouch for our own pages — third-party hosts in other_outputs
        // routinely reject HEAD from bots, which would drop valid cards
        card.href.startsWith(SITE) ? urlExists(card.href) : Promise.resolve(true),
        card.image ? urlExists(card.image) : Promise.resolve(true),
      ]);
      if (!pageOk) console.warn(`unreachable page, dropping card: ${card.href}`);
      if (!imageOk) console.warn(`missing image, text-only card: ${card.image}`);
      return { ...card, pageOk, image: imageOk ? card.image : undefined };
    }),
  );
  return checked.filter((card) => card.pageOk).slice(0, max);
}

// ---------------------------------------------------------------- helpers

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Titles and journals in publications.yaml are lifted from BibTeX and still
// carry brace protection and escaped ampersands.
const deBibtex = (text) =>
  String(text ?? "")
    .replace(/[{}]/g, "")
    .replace(/\\&/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Blurbs come from prose that may contain inline markdown. Flatten it to plain
// text *before* truncating — truncating first can slice a link in half and
// leave raw "[label](https://…" in the card.
const stripMarkdown = (text) =>
  String(text ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function truncate(text, limit) {
  const clean = String(text ?? "").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, clean.lastIndexOf(" ", limit)).trimEnd()}…`;
}

const blurb = (text, limit = 180) => truncate(stripMarkdown(text), limit);

// Asset paths appear as "/assets/x.png", "assets/x.png" and — in post front
// matter, which is relative to posts/ — "../assets/x.png".
const assetUrl = (path) =>
  /^https?:\/\//.test(path)
    ? path
    : `${SITE}/${String(path).replace(/^(\.{1,2}\/|\/)+/, "")}`;

// Several older entries store a bare "https://10.1016/..." which is not a
// resolvable URL. Normalise anything that looks like a raw DOI.
function doiUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const match = value.match(/(10\.\d{4,9}\/\S+)/);
  return match ? `https://doi.org/${match[1]}` : value;
}

const badge = (label, color, logo) =>
  `https://img.shields.io/badge/${encodeURIComponent(label)}-${color}?style=flat-square${
    logo ? `&logo=${logo}&logoColor=white` : ""
  }`;

const linkBadge = (href, label, color, logo) =>
  `<a href="${href}"><img src="${badge(label, color, logo)}" alt="${label}"></a>`;

const monthYear = (date) =>
  date.toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

const asArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

// ---------------------------------------------------------------- rendering

/**
 * Write one SVG per card and return the markup that lays them out.
 *
 * Deliberately not a <table>: GitHub's stylesheet puts a 1px border on every
 * cell and greys alternate rows, and strips the style attributes that could
 * undo it. Inline images inside a centred div flow side by side with no
 * chrome at all, and each card carries its own rounded corners and shadow.
 */
async function cardGrid(section, cards, columns) {
  const width = CARD_W[columns];

  // thumbnails have to be inlined as data URIs — camo will not resolve an
  // external reference from inside an SVG it is proxying
  await Promise.all(
    cards.map(async (card) => {
      if (card.image) card.image = await thumbnailUri(card.image, width, thumbHeight(width));
    }),
  );

  // one shared height per section keeps the grid on a baseline
  const height = Math.max(...cards.map((card) => cardHeight(fonts, card, width)));

  const markup = await Promise.all(
    cards.map(async (card, i) => {
      const file = `${ART}/cards/${section}-${i + 1}.svg`;
      await writeFile(file, renderCard(fonts, card, height, width));
      const alt = escapeHtml([card.title, card.meta].filter(Boolean).join(" — "));
      return `  <a href="${card.href}"><img src="${file}" width="${COL_PCT[columns]}" alt="${alt}"></a>`;
    }),
  );

  return `<div align="center">\n${markup.join("\n")}\n</div>`;
}

function frontMatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("post is missing YAML front matter");
  return { meta: parseYaml(match[1]) ?? {}, body: match[2] };
}

// Posts do not all set `description`, so fall back to the opening prose block,
// skipping Quarto divs and raw HTML.
const firstParagraph = (body) =>
  body
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith(":::") && !block.startsWith("<")) ?? "";

async function renderPosts() {
  const entries = (await listDir(SITE_REPO, "posts")).filter(
    (entry) => entry.type === "file" && entry.name.endsWith(".qmd"),
  );
  if (!entries.length) throw new Error("no posts found in the website repo");

  const posts = (
    await Promise.all(
      entries.map(async (entry) => {
        const { meta, body } = frontMatter(await fetchText(entry.download_url));
        return {
          slug: entry.name.replace(/\.qmd$/, ""),
          date: new Date(meta.date),
          meta,
          blurb: meta.description ?? firstParagraph(body),
        };
      }),
    )
  )
    .filter((post) => post.meta.draft !== true)
    .sort((a, b) => b.date - a.date)
    .slice(0, MAX.posts * 2); // over-fetch so unpublished posts can be skipped

  const cards = posts.map((post) => ({
    href: `${SITE}/posts/${post.slug}.html`,
    title: post.meta.title,
    image: post.meta.image ? assetUrl(post.meta.image) : undefined,
    alt: post.meta["image-alt"],
    meta: [monthYear(post.date), ...asArray(post.meta.categories).slice(0, 2)].join(" · "),
    blurb: blurb(post.blurb),
  }));

  return cardGrid("posts", await resolveCards(cards, MAX.posts), 2);
}

function renderPublications(publications) {
  const recent = [...publications]
    .reverse() // within a year, later in the file is more recent
    .sort((a, b) => Number(b.year) - Number(a.year))
    .slice(0, MAX.publications);

  return recent
    .map((pub) => {
      const paper = doiUrl(pub.doi);
      const links = [
        paper && linkBadge(paper, "Paper", FOREST, "doi"),
        pub.preprint_url && linkBadge(doiUrl(pub.preprint_url), "Preprint", OLIVE),
        pub.code_url && linkBadge(pub.code_url, "Code", BURNT, "github"),
        pub.data_url && linkBadge(doiUrl(pub.data_url), "Data", OLIVE, "zenodo"),
      ].filter(Boolean);

      const venue = [pub.journal && `<i>${escapeHtml(deBibtex(pub.journal))}</i>`, pub.year]
        .filter(Boolean)
        .join(" &middot; ");

      const title = escapeHtml(deBibtex(pub.title));
      const heading = paper ? `<a href="${paper}">${title}</a>` : title;

      return [
        `<b>${heading}</b><br>`,
        `<sub>${escapeHtml(deBibtex(pub.authors))}</sub><br>`,
        `<sub>${venue}</sub>`,
        links.length ? `<br>${links.join(" ")}` : "",
      ].join("\n");
    })
    .join("\n\n<br>\n\n");
}

async function renderPresentations(presentations) {
  const cards = [...presentations]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, MAX.presentations * 2) // over-fetch so drafts can be skipped
    .map((item) => ({
      // deliberately not item.url: those are stored in trailing-slash form
      // ("/presentations/<id>/") and every one of them 404s. The site publishes
      // one .html page per id.
      href: `${SITE}/presentations/${item.id}.html`,
      title: deBibtex(item.title),
      image: item.image ? assetUrl(item.image) : undefined,
      alt: item["image-alt"],
      meta: [item.event, item.location, monthYear(new Date(item.date))]
        .filter(Boolean)
        .map((part) => String(part).trim())
        .join(" · "),
      tags: asArray(item.categories).slice(0, 3),
    }));

  return cardGrid("presentations", await resolveCards(cards, MAX.presentations), 2);
}

async function renderOutputs(outputs) {
  const cards = [...outputs]
    .reverse()
    .slice(0, MAX.outputs * 2)
    .map((item) => ({
      href: item.path,
      title: item.title,
      image: item.image ? assetUrl(item.image) : undefined,
      blurb: blurb(item.description, 160),
      tags: asArray(item.categories),
    }));

  return cardGrid("outputs", await resolveCards(cards, MAX.outputs), 3);
}

// ----------------------------------------------------------------- chrome

const BUTTONS = [
  { label: "Website", href: `${SITE}/`, icon: "quarto", fill: C.forest },
  { label: "Download CV", href: `${SITE}/curriculum-vitae/`, icon: "document", fill: C.burnt },
  { label: "Scholar", href: "https://scholar.google.com/citations?hl=en&user=h00y-m4AAAAJ", icon: "googlescholar", fill: C.forest },
  { label: "ORCID", href: "https://orcid.org/0000-0002-8113-2114", icon: "orcid", fill: C.forest },
  { label: "ResearchGate", href: "https://www.researchgate.net/profile/Benjamin-Black-5", icon: "researchgate", fill: C.forest },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/ben-black-9889a1150/", icon: "linkedin", fill: C.forest },
  { label: "GitHub", href: "https://github.com/blenback", icon: "github", fill: C.forest },
  { label: "Email", href: "mailto:benjaminsamuel.black@zalf.de", icon: "envelope", fill: C.olive },
];

const ROLE = {
  group: "Data & Modelling Infrastructure for Living Labs",
  suffix: "at ZALF.",
};

const INTRO =
  "A scientific researcher working on spatial modelling, data and scientific " +
  "visualisation. I share the work that doesn't always make it into papers — " +
  "code, maps and field notes — in the hope that it's useful.";

async function renderHero() {
  const portrait = await portraitUri(`${SITE}/assets/landing_portrait_cropped.jpg`, 380);
  await writeFile(`${ART}/banner.svg`, renderBanner(fonts, { portrait, role: ROLE, intro: INTRO }));

  const icons = await loadIcons([...new Set(BUTTONS.map((b) => b.icon))]);
  const pills = await Promise.all(
    BUTTONS.map(async (button) => {
      const file = `${ART}/buttons/${button.label.toLowerCase().replace(/\s+/g, "-")}.svg`;
      await writeFile(file, renderPill(fonts, { ...button, icon: icons[button.icon] }));
      // height keeps every pill on one visual line whatever its label length
      return `  <a href="${button.href}"><img src="${file}" height="34" alt="${button.label}"></a>`;
    }),
  );

  // Link the banner to the site: GitHub auto-wraps any unlinked image in a
  // link to the raw file, so without this, clicking it opens the SVG source.
  return [
    `<div align="center">`,
    `  <a href="${SITE}/"><img src="${ART}/banner.svg" width="100%" alt="Hi there, I'm Ben Black — Head of the Working Group ${ROLE.group}, ${ROLE.suffix}"></a>`,
    ``,
    ...pills,
    `</div>`,
  ].join("\n");
}

// ---------------------------------------------------------------- assembly

function replaceSection(readme, name, body) {
  const start = `<!--START_SECTION:${name}-->`;
  const end = `<!--END_SECTION:${name}-->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(readme)) throw new Error(`README is missing the "${name}" section markers`);
  return readme.replace(pattern, `${start}\n${body}\n${end}`);
}

// Rebuild the generated art from scratch so renamed or removed entries never
// leave orphaned SVGs behind.
await rm(`${ART}/cards`, { recursive: true, force: true });
await rm(`${ART}/buttons`, { recursive: true, force: true });
await mkdir(`${ART}/cards`, { recursive: true });
await mkdir(`${ART}/buttons`, { recursive: true });

const [publications, presentations, outputs] = await Promise.all([
  fetchYaml("publications"),
  fetchYaml("presentations"),
  fetchYaml("other_outputs"),
]);

const sections = {
  hero: await renderHero(),
  posts: await renderPosts(),
  publications: renderPublications(publications),
  presentations: await renderPresentations(presentations),
  outputs: await renderOutputs(outputs),
};

let readme = await readFile(README, "utf8");
for (const [name, body] of Object.entries(sections)) {
  readme = replaceSection(readme, name, body);
  console.log(`rendered ${name} (${body.length} chars)`);
}

await writeFile(README, readme);
console.log("README.md written");
