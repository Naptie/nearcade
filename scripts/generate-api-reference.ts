/// <reference types="node" />

/**
 * Publishes the self-hosted script bundle that powers the interactive API
 * reference at `/api/docs`.
 *
 * The bundle is copied from the installed `@scalar/api-reference` package into
 * `static/`, which means the reference is served as a plain static asset: it
 * never enters the server bundle, and it needs no runtime route.
 *
 * The package does not expose the bundle through its `exports` map (only the
 * programmatic entry points are exported), so the path is taken from the
 * `browser` field the package declares for exactly this file. Resolving the
 * package through `require.resolve` keeps that working regardless of how the
 * dependency is laid out on disk.
 *
 * The IIFE build is used on purpose: the ESM build is code-split and expects its
 * sibling chunks to be served next to it, which does not hold when the bundle
 * is published as a single file. The IIFE build is self-contained — it injects
 * its own stylesheet at runtime and pulls in no other file.
 */
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { API_REFERENCE_SCRIPT } from '../src/lib/api/reference';

const require = createRequire(import.meta.url);

/**
 * Locate the browser bundle the package declares for browser consumption.
 *
 * The package does not export `./package.json`, so the manifest is read from
 * disk: `require.resolve` points at `<package>/dist/index.js`, so the manifest
 * sits two directories up.
 */
const resolveReferenceBundle = async (): Promise<string> => {
  const entry = require.resolve('@scalar/api-reference');
  const packageRoot = path.dirname(path.dirname(entry));
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
    browser?: string;
  };

  if (!manifest.browser) {
    throw new Error(
      '@scalar/api-reference no longer declares a "browser" field; update how the API reference is published.'
    );
  }

  return path.resolve(packageRoot, manifest.browser);
};

const root = process.cwd();
const output = path.join(root, 'static', API_REFERENCE_SCRIPT);

await mkdir(path.dirname(output), { recursive: true });
await copyFile(await resolveReferenceBundle(), output);

const { size } = await stat(output);
console.log(
  `Published the API reference script (${(size / 1024 / 1024).toFixed(2)} MB) at ${API_REFERENCE_SCRIPT}`
);
