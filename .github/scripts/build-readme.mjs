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

import { readFile, writeFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

const PROFI = "https://raw.githubusercontent.com/blenback/profi/main";
const SITE_REPO = "blenback/blenback.github.io";
const SITE = "https://blenback.github.io";
const README = "README.md";

// brand palette, mirrored from _brand.yml on the website
const FOREST = "36513C";
const OLIVE = "6E7350";
const BURNT = "BC5C32";

const MAX = { posts: 4, publications: 4, presentations: 4, outputs: 3 };

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

const blurb = (text, limit = 180) => escapeHtml(truncate(stripMarkdown(text), limit));

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

// A responsive-ish card grid. GitHub strips CSS, so the layout has to be a
// plain HTML table: image on top, then title, meta line and blurb.
function cardGrid(cards, columns) {
  const width = Math.floor(100 / columns);
  const rows = [];

  for (let i = 0; i < cards.length; i += columns) {
    const slice = cards.slice(i, i + columns);
    const cells = slice.map((card) => {
      const parts = [];
      if (card.image) {
        parts.push(
          `<a href="${card.href}"><img src="${card.image}" width="100%" alt="${escapeHtml(card.alt ?? card.title)}"></a>`,
          "<br>",
        );
      }
      parts.push(`<b><a href="${card.href}">${escapeHtml(card.title)}</a></b>`);
      if (card.meta) parts.push(`<br><sub>${card.meta}</sub>`);
      if (card.blurb) parts.push(`<br><br>${card.blurb}`);
      if (card.tags?.length) {
        const tags = card.tags
          .map((tag) => `<img src="${badge(tag, OLIVE)}" alt="${escapeHtml(tag)}">`)
          .join(" ");
        parts.push(`<br><br>${tags}`);
      }
      return `      <td width="${width}%" valign="top">\n        ${parts.join("\n        ")}\n      </td>`;
    });

    // pad the final row so the columns stay even
    while (cells.length < columns) cells.push(`      <td width="${width}%"></td>`);
    rows.push(`    <tr>\n${cells.join("\n")}\n    </tr>`);
  }

  return `<table>\n${rows.join("\n")}\n</table>`;
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
    meta: [monthYear(post.date), ...asArray(post.meta.categories).slice(0, 2)]
      .map((part) => escapeHtml(part))
      .join(" &middot; "),
    blurb: blurb(post.blurb),
  }));

  return cardGrid(await resolveCards(cards, MAX.posts), 2);
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
        .map((part) => escapeHtml(String(part).trim()))
        .join(" &middot; "),
      tags: asArray(item.categories).slice(0, 3),
    }));

  return cardGrid(await resolveCards(cards, MAX.presentations), 2);
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

  return cardGrid(await resolveCards(cards, MAX.outputs), MAX.outputs);
}

// ---------------------------------------------------------------- assembly

function replaceSection(readme, name, body) {
  const start = `<!--START_SECTION:${name}-->`;
  const end = `<!--END_SECTION:${name}-->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(readme)) throw new Error(`README is missing the "${name}" section markers`);
  return readme.replace(pattern, `${start}\n${body}\n${end}`);
}

const [publications, presentations, outputs] = await Promise.all([
  fetchYaml("publications"),
  fetchYaml("presentations"),
  fetchYaml("other_outputs"),
]);

const sections = {
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
