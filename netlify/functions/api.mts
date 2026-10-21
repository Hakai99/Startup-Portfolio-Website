import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

// One function handles: project list, admin upload/delete, and serving uploaded sites at /p/<slug>/...
// Storage: Netlify Blobs (built into Netlify, no extra account).

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", txt: "text/plain; charset=utf-8", map: "application/json",
  xml: "application/xml", pdf: "application/pdf",
};
const typeOf = (p: string) => TYPES[p.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
const cleanPath = (p: string) =>
  p.split("/").filter((x) => x && x !== "." && x !== "..").join("/");

function authed(req: Request) {
  const pw = process.env.ADMIN_PASSWORD;
  return !!pw && req.headers.get("x-admin-password") === pw;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const meta = getStore({ name: "projects", consistency: "strong" });
  const files = getStore({ name: "project-files", consistency: "strong" });

  // ---- public: list projects
  if (path === "/api/projects" && req.method === "GET") {
    const { blobs } = await meta.list();
    const items = (await Promise.all(blobs.map((b) => meta.get(b.key, { type: "json" })))).filter(Boolean) as any[];
    items.sort((a, b) => b.createdAt - a.createdAt);
    return json(items);
  }

  // ---- public: serve an uploaded site
  if (path.startsWith("/p/")) {
    const rest = path.slice(3);
    const slash = rest.indexOf("/");
    if (slash === -1) return Response.redirect(`${url.origin}/p/${rest}/`, 301);
    const slug = rest.slice(0, slash);
    let file = cleanPath(decodeURIComponent(rest.slice(slash + 1))) || "index.html";
    let buf = await files.get(`${slug}/${file}`, { type: "arrayBuffer" });
    if (!buf && !file.includes(".")) {
      file = `${file}/index.html`;
      buf = await files.get(`${slug}/${file}`, { type: "arrayBuffer" });
    }
    if (!buf) return new Response("Not found", { status: 404 });
    return new Response(buf, { headers: { "content-type": typeOf(file), "cache-control": "public, max-age=60" } });
  }

  // ---- admin only below
  if (!authed(req)) return json({ error: "Wrong password (or ADMIN_PASSWORD is not set in Netlify)." }, 401);

  if (path === "/api/admin/check") return json({ ok: true });

  // create/update project info
  if (path === "/api/admin/project" && req.method === "POST") {
    const b = await req.json();
    const title = String(b.title ?? "").trim();
    if (!title) return json({ error: "Title is required" }, 400);
    const slug = b.slug ? slugify(String(b.slug)) : `${slugify(title)}-${Date.now().toString(36).slice(-4)}`;
    const old = (await meta.get(slug, { type: "json" })) as any;
    const price = Number(b.price);
    await meta.setJSON(slug, {
      slug, title,
      description: String(b.description ?? "").trim(),
      price: Number.isFinite(price) && price > 0 ? price : 0,
      createdAt: old?.createdAt ?? Date.now(),
    });
    return json({ slug });
  }

  // upload one file: PUT /api/admin/file?slug=..&path=..
  if (path === "/api/admin/file" && req.method === "PUT") {
    const slug = slugify(url.searchParams.get("slug") ?? "");
    const p = cleanPath(url.searchParams.get("path") ?? "");
    if (!p) return json({ error: "Missing path" }, 400);
    if (!(await meta.get(slug))) return json({ error: "Project not found" }, 404);
    await files.set(`${slug}/${p}`, await req.arrayBuffer());
    return json({ ok: true });
  }

  // delete project + its files
  if (path === "/api/admin/project" && req.method === "DELETE") {
    const slug = slugify(url.searchParams.get("slug") ?? "");
    const { blobs } = await files.list({ prefix: `${slug}/` });
    await Promise.all(blobs.map((b) => files.delete(b.key)));
    await meta.delete(slug);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
};

export const config: Config = { path: ["/api/projects", "/api/admin/*", "/p/*"] };
