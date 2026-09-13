import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Build the actual frontend in isolation. Only server-only route adapters differ;
// shared pages, components, illustrations, fixtures, fonts and CSS stay upstream.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, '.pages-build');
const output = path.join(root, 'out-pages');
const basePath = process.env.PAGES_BASE_PATH ?? '/DOCKET';
if (basePath && !/^\/[A-Za-z0-9_-]+$/.test(basePath)) throw new Error('Invalid PAGES_BASE_PATH');
await rm(stage, { recursive: true, force: true });
await rm(output, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const name of ['src', 'package.json', 'tsconfig.json', 'postcss.config.mjs', 'tailwind.config.ts']) {
  await cp(path.join(root, name), path.join(stage, name), { recursive: true });
}
try { await cp(path.join(root, 'public'), path.join(stage, 'public'), { recursive: true }); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
async function replace(file, before, after) {
  const filename = path.join(stage, file);
  const source = await readFile(filename, 'utf8');
  if (!source.includes(before)) throw new Error(`Pages adapter needs updating: ${file}`);
  await writeFile(filename, source.replace(before, after));
}
await rm(path.join(stage, 'src/app/api'), { recursive: true });
await writeFile(path.join(stage, 'next.config.mjs'), `export default ${JSON.stringify({
  output: 'export', basePath, trailingSlash: true, poweredByHeader: false,
  images: { unoptimized: true },
})};\n`);
for (const name of ['page.tsx', 'groups/page.tsx', 'g/[slug]/page.tsx']) {
  await replace(`src/app/${name}`, 'export const revalidate = 300;', 'export const dynamic = "force-static";');
}
for (const name of ['sitemap.ts', 'robots.ts']) {
  const file = path.join(stage, 'src/app', name);
  await writeFile(file, `export const dynamic = "force-static";\n${await readFile(file, 'utf8')}`);
}
await replace('src/app/page.tsx', 'action="/find"', `action="${basePath}/find/"`);
await replace('src/app/g/[slug]/join/page.tsx', 'import { getGroup }', 'import { listGroups, getGroup }');
await replace('src/app/g/[slug]/join/page.tsx', 'type Params =', 'export function generateStaticParams() { return listGroups().map(({ slug }) => ({ slug })); }\n\ntype Params =');
// Preserve the form, but never claim that a static host sent a sign-in email.
await replace('src/components/JoinFlow.tsx', '    setSubmitting(true);', '    setFormError("Sign-ups are not available on this preview. You can browse every group without joining.");\n    return;');
// Search keeps the original result views. In Pages the request runs in the browser;
// geocoder network/CORS failures use the existing unavailable state.
await replace('src/app/find/page.tsx', 'import type { Metadata } from "next";', '"use client";\nimport { useEffect, useState } from "react";');
await replace('src/app/find/page.tsx', 'import { headers } from "next/headers";\n', '');
await replace('src/app/find/page.tsx', 'import { allowLookupHeaders } from "@/lib/rate-limit";\n', '');
const findFile = path.join(stage, 'src/app/find/page.tsx');
let find = await readFile(findFile, 'utf8');
const start = find.indexOf('export const metadata:');
const end = find.indexOf('\n  return (', start);
if (start < 0 || end < 0) throw new Error('Find page adapter needs updating');
find = find.slice(0, start) + `export default function FindPage() {
  const [result, setResult] = useState<FindResult>({ status: "unresolved", query: "", reason: "empty" });
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search).get("address") ?? "";
    void findGroups(query).then((next) => { if (active) setResult(next); });
    return () => { active = false; };
  }, []);
` + find.slice(end);
await writeFile(findFile, find);
await replace('src/app/start/page.tsx', 'import type { Metadata } from "next";', '"use client";\nimport { useEffect, useState } from "react";');
await replace('src/app/start/page.tsx', 'export const metadata: Metadata = { title: "Start a group", robots: { index: false } };', '');
await replace('src/app/start/page.tsx', 'export default async function StartPage({ searchParams }: { searchParams: Promise<{ address?: string | string[] }> }) {\n  const { address } = await searchParams;\n  const place = (Array.isArray(address) ? address[0] : address)?.slice(0, 200);', 'export default function StartPage() {\n  const [place, setPlace] = useState<string>();\n  useEffect(() => { setPlace(new URLSearchParams(window.location.search).get("address")?.slice(0, 200)); }, []);');
const build = spawnSync(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', stage], {
  cwd: stage, stdio: 'inherit', env: { ...process.env, APP_URL: process.env.PAGES_URL ?? `https://k1lst1x.github.io${basePath}` },
});
if (build.status !== 0) process.exit(build.status ?? 1);
await cp(path.join(stage, 'out'), output, { recursive: true });
await writeFile(path.join(output, '.nojekyll'), '');
const html = await readFile(path.join(output, 'index.html'), 'utf8');
for (const marker of ['Where do you live?', `${basePath}/_next/static/`, 'Find my group']) {
  if (!html.includes(marker)) throw new Error(`Missing homepage marker: ${marker}`);
}
// These shared design files must remain byte-for-byte identical to the app.
for (const file of ['src/app/layout.tsx', 'src/app/globals.css', 'src/components/HeroIllustration.tsx', 'src/components/SiteHeader.tsx', 'tailwind.config.ts']) {
  if (await readFile(path.join(root, file), 'utf8') !== await readFile(path.join(stage, file), 'utf8')) {
    throw new Error(`Shared design changed in Pages build: ${file}`);
  }
}
for (const route of ['groups', 'chat', 'find', 'start', 'g/niles-neighbors', 'g/niles-neighbors/join']) {
  await readFile(path.join(output, route, 'index.html'));
}
for (const match of html.matchAll(/(?:src|href)="([^"?#]+)"/g)) {
  if (match[1].startsWith(`${basePath}/_next/`)) {
    await readFile(path.join(output, match[1].slice(basePath.length)));
  }
}
await rm(stage, { recursive: true, force: true });
console.log(`Pages export ready: ${output}`);
