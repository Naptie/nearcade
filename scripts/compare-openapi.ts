/// <reference types="node" />

/**
 * Compares the OpenAPI document of the working tree with a published one,
 * operation by operation, ignoring key order.
 *
 *   pnpm exec tsx ./scripts/compare-openapi.ts [oldFile] [newFile]
 *
 * Without a file argument it compares the document the working tree generates
 * with the one a deployment serves — which is what "did the contract change
 * since the last deployment?" means now that no document is committed to the
 * repository.
 *
 * `SITE_URL` names that deployment and has no default: a default that
 * silently reaches the production site would have a fork compare itself
 * against the site it was forked from.
 */
import { readFile } from 'node:fs/promises';
import { generateOpenApiDocument } from '../src/lib/api/openapi';

const SITE_URL = process.env.SITE_URL?.trim();
if (!SITE_URL) {
  throw new Error(
    'SITE_URL must name the deployment to compare against — for example ' +
      'SITE_URL=http://localhost:5173 pnpm api:diff'
  );
}

const loadOld = async (oldFile: string | undefined) => {
  if (oldFile) {
    return JSON.parse(await readFile(oldFile, 'utf8'));
  }

  const response = await fetch(`${SITE_URL}/openapi.json`);
  if (!response.ok) {
    throw new Error(`Could not read ${SITE_URL}/openapi.json — HTTP ${response.status}`);
  }
  return response.json();
};

const loadNew = async (newFile: string | undefined) => {
  if (newFile) {
    return JSON.parse(await readFile(newFile, 'utf8'));
  }
  return generateOpenApiDocument();
};

const oldDoc = await loadOld(process.argv[2]);
const newDoc = await loadNew(process.argv[3]);

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

type Operation = {
  parameters?: { in: string; name: string; schema: unknown }[];
};

/** The parameter set, compared as a map of name -> schema. */
const parametersOf = (operation: Operation): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const parameter of operation.parameters ?? []) {
    out[`${parameter.in}:${parameter.name}`] = parameter.schema;
  }
  return out;
};

const addedPaths: string[] = [];
const removedPaths: string[] = [];
const changedParameters: string[] = [];
const addedParameters: string[] = [];
const removedParameters: string[] = [];
let compared = 0;

for (const [routePath, oldItem] of Object.entries(
  oldDoc.paths as Record<string, Record<string, Operation>>
)) {
  const newItem = newDoc.paths?.[routePath];
  if (!newItem) {
    removedPaths.push(routePath);
    continue;
  }
  for (const method of METHODS) {
    const oldOperation = oldItem[method];
    if (!oldOperation) continue;
    const newOperation = newItem[method];
    compared++;

    if (!newOperation) {
      changedParameters.push(`${method.toUpperCase()} ${routePath} — operation missing`);
      continue;
    }

    const oldParameters = parametersOf(oldOperation);
    const newParameters = parametersOf(newOperation);

    for (const key of Object.keys(oldParameters)) {
      if (!(key in newParameters))
        removedParameters.push(`${method.toUpperCase()} ${routePath} ${key}`);
      else if (canonical(oldParameters[key]) !== canonical(newParameters[key])) {
        changedParameters.push(
          `${method.toUpperCase()} ${routePath} ${key}\n      old ${canonical(oldParameters[key])}\n      new ${canonical(newParameters[key])}`
        );
      }
    }
    for (const key of Object.keys(newParameters)) {
      if (!(key in oldParameters))
        addedParameters.push(`${method.toUpperCase()} ${routePath} ${key}`);
    }
  }
}

for (const routePath of Object.keys(newDoc.paths)) {
  if (!(routePath in oldDoc.paths)) addedPaths.push(routePath);
}

console.log(`compared ${compared} operations that existed before the migration`);
console.log(`\npaths added:      ${addedPaths.length}`);
console.log(`paths removed:    ${removedPaths.length}`);
console.log(`parameters added:   ${addedParameters.length}`);
console.log(`parameters removed: ${removedParameters.length}`);
console.log(`parameters changed: ${changedParameters.length}`);

for (const item of changedParameters) console.log(`  CHANGED ${item}`);
for (const item of removedParameters) console.log(`  REMOVED ${item}`);
for (const item of addedParameters.slice(0, 20)) console.log(`  ADDED   ${item}`);
if (addedParameters.length > 20) console.log(`  … +${addedParameters.length - 20} more added`);
for (const item of removedPaths) console.log(`  PATH REMOVED ${item}`);
