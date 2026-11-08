#!/usr/bin/env node
/**
 * Deploy the repository's public/ assets to the existing chatmirror-cloud Worker.
 *
 * The existing Worker module is fetched from Cloudflare and reused unchanged.
 * Durable Object and secret bindings are retained with keep_bindings.
 *
 * Required environment:
 *   CLOUDFLARE_API_TOKEN   Workers Scripts Read + Workers Scripts Write
 *   CLOUDFLARE_ACCOUNT_ID  Cloudflare account ID
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const workerName = "chatmirror-cloud";
const apiBase = "https://api.cloudflare.com/client/v4";

if (!accountId || !apiToken) {
  throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN before deploying.");
}

async function api(path, options = {}) {
  const response = await fetch(apiBase + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!response.ok || data.success === false) {
    throw new Error(`Cloudflare API ${options.method || "GET"} ${path} failed (${response.status}): ${JSON.stringify(data.errors || data)}`);
  }
  return data;
}

async function collectFiles(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await walk(directory);
  return files.sort();
}

const publicDir = new URL("../public/", import.meta.url);
const publicPath = decodeURIComponent(publicDir.pathname);
const filePaths = await collectFiles(publicPath);
if (!filePaths.length) throw new Error("No files found in public/.");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const filesByHash = new Map();
const manifest = {};
for (const filePath of filePaths) {
  const bytes = await readFile(filePath);
  // Cloudflare's asset manifest uses the first 16 bytes of SHA-256.
  const hash = createHash("sha256").update(bytes).digest().subarray(0, 16).toString("hex");
  const assetPath = "/" + relative(publicPath, filePath).split(sep).join("/");
  manifest[assetPath] = { hash, size: bytes.length };
  filesByHash.set(hash, {
    bytes,
    contentType: mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
  });
}

console.log(`Registering ${Object.keys(manifest).length} static assets for ${workerName}...`);
const session = await api(`/accounts/${accountId}/workers/scripts/${workerName}/assets-upload-session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ manifest }),
});
const uploadJwt = session.result?.jwt;
let completionJwt = uploadJwt;
const buckets = session.result?.buckets || [];

for (let index = 0; index < buckets.length; index += 1) {
  const form = new FormData();
  for (const hash of buckets[index]) {
    const asset = filesByHash.get(hash);
    if (!asset) throw new Error(`Cloudflare requested unknown asset hash: ${hash}`);
    // Cloudflare expects each multipart field value to be the Base64 string
    // itself (not a file upload with a filename).
    form.append(hash, asset.bytes.toString("base64"));
  }

  const response = await fetch(`${apiBase}/accounts/${accountId}/workers/assets/upload?base64=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${uploadJwt}` },
    body: form,
  });
  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    result = { raw };
  }
  const isFinalBucket = index === buckets.length - 1;
  // Cloudflare returns HTTP 202 with no JWT for intermediate batches.
  // The final batch returns the completion JWT (normally HTTP 201).
  if (!response.ok || result.success !== true || (isFinalBucket && !result.result?.jwt)) {
    throw new Error(
      `Asset bucket ${index + 1}/${buckets.length} upload failed (HTTP ${response.status}): ${JSON.stringify({
        success: result.success,
        errors: result.errors,
        messages: result.messages,
        result: result.result,
        raw: result.raw,
      })}`
    );
  }
  if (result.result?.jwt) completionJwt = result.result.jwt;
  console.log(`Uploaded asset batch ${index + 1}/${buckets.length} (HTTP ${response.status}).`);
}

if (!completionJwt) throw new Error("Cloudflare did not return the asset completion token.");

// Reuse the currently deployed Worker module. This avoids replacing the API,
// auth logic, Durable Object class, or any application secrets.
const sourceResponse = await api(`/accounts/${accountId}/workers/scripts/${workerName}/content/v2`);
const sourceText = typeof sourceResponse === "string" ? sourceResponse : sourceResponse.raw;
if (!sourceText) throw new Error("Could not read the existing Worker module.");
const boundary = sourceText.match(/^--([^\r\n]+)/)?.[1];
if (!boundary) throw new Error("Could not identify the existing Worker source multipart boundary.");
const partStart = sourceText.indexOf("\r\n\r\n") + 4;
const partEnd = sourceText.lastIndexOf(`\r\n--${boundary}--`);
if (partStart < 4 || partEnd <= partStart) throw new Error("Could not extract the existing Worker module.");
const workerCode = sourceText.slice(partStart, partEnd).replace(/\r?\n$/, "");

const metadata = {
  main_module: "worker.js",
  compatibility_date: "2026-10-09",
  compatibility_flags: ["global_fetch_strictly_public"],
  usage_model: "standard",
  bindings: [{ type: "assets", name: "ASSETS" }],
  keep_bindings: ["durable_object_namespace", "secret_text"],
  assets: {
    jwt: completionJwt,
    config: { base_path: "/", run_worker_first: ["/api/*"] },
  },
  annotations: {
    "workers/message": "Refresh ChatMirror cloud frontend assets from GitHub",
  },
};

const versionForm = new FormData();
versionForm.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
versionForm.append("worker.js", new Blob([workerCode], { type: "application/javascript+module" }), "worker.js");

const versionUpload = await api(`/accounts/${accountId}/workers/scripts/${workerName}/versions`, {
  method: "POST",
  body: versionForm,
});
const versionId = versionUpload.result?.id;
if (!versionId) throw new Error("Cloudflare did not return a new Worker version ID.");

const versionInfo = await api(`/accounts/${accountId}/workers/scripts/${workerName}/versions/${versionId}`);
const bindings = versionInfo.result?.resources?.bindings || [];
const hasAssets = bindings.some(binding => binding.name === "ASSETS" && binding.type === "assets");
const hasChatConnections = bindings.some(binding => binding.name === "CHAT_CONNECTIONS" && binding.type === "durable_object_namespace");
const hasPasswordSecret = bindings.some(binding => binding.name === "CHATMIRROR_PASSWORD_HASH" && binding.type === "secret_text");
const requiredSecrets = [
  "CHATMIRROR_PASSWORD_HASH",
  "SESSION_SECRET",
  "CHATMIRROR_EVENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "TOKEN_NEXUS_CLIENT_KEY",
];
const missingSecrets = requiredSecrets.filter(name =>
  !bindings.some(binding => binding.name === name && binding.type === "secret_text")
);
if (!hasAssets || !hasChatConnections || missingSecrets.length) {
  throw new Error("New version is missing required bindings; refusing to deploy. Missing secrets: " + JSON.stringify(missingSecrets) + ". Bindings: " + JSON.stringify(bindings));
}

console.log(`Created version ${versionId}; required chat and auth bindings are present.`);
await api(`/accounts/${accountId}/workers/scripts/${workerName}/deployments`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    strategy: "percentage",
    versions: [{ version_id: versionId, percentage: 100 }],
    annotations: { "workers/message": "Deploy updated ChatMirror cloud frontend assets" },
  }),
});

console.log(`Deployed ${workerName} successfully. Static assets now serve from its existing workers.dev hostname.`);
