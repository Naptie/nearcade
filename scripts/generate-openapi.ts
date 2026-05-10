/// <reference types="node" />

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ApiRouteDefinition } from '../src/lib/schemas/openapi';
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathItemObject,
  type ZodOpenApiPathsObject
} from 'zod-openapi';
import pkg from '../package.json' with { type: 'json' };

const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;

const root = process.cwd();
const routesRoot = path.join(root, 'src', 'routes');
const apiRoutesRoot = path.join(routesRoot, 'api');
const publicOutput = path.join(root, 'static', 'openapi.json');

const stripApiPrefix = (routePath: string) => {
  if (routePath === '/api') return '/';
  if (routePath.startsWith('/api/')) return routePath.slice('/api'.length);
  return routePath;
};

const collectOpenApiFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry: Dirent) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectOpenApiFiles(entryPath);
      }
      return entry.name === 'openapi.ts' ? [entryPath] : [];
    })
  );

  return files.flat().sort((left: string, right: string) => left.localeCompare(right));
};

const toRouteSegment = (segment: string) => {
  if (segment.startsWith('(') && segment.endsWith(')')) {
    return null;
  }

  return segment
    .replace(/^\[\[\.\.\.(.+)\]\]$/, '{$1}')
    .replace(/^\[\.\.\.(.+)\]$/, '{$1}')
    .replace(/^\[(.+)\]$/, '{$1}');
};

const pathFromOpenApiFile = (filePath: string) => {
  const relativeDir = path.relative(routesRoot, path.dirname(filePath));
  const routeSegments = relativeDir
    .split(path.sep)
    .map(toRouteSegment)
    .filter((segment: string | null): segment is string => Boolean(segment));

  return `/${routeSegments.join('/')}`;
};

const toPascalCase = (value: string) =>
  value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const buildOperationId = (method: (typeof methods)[number], routePath: string) => {
  const segments = routePath
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith('{') && segment.endsWith('}')) {
        return `By${toPascalCase(segment.slice(1, -1))}`;
      }

      return toPascalCase(segment);
    });

  return `${method}${segments.join('') || 'Root'}`;
};

const normalizePathItem = (routePath: string, pathItem: ZodOpenApiPathItemObject) => {
  const normalized: ZodOpenApiPathItemObject = { ...pathItem };

  for (const method of methods) {
    const operation = pathItem[method];
    if (!operation) {
      continue;
    }

    normalized[method] = {
      ...operation,
      operationId: operation.operationId ?? buildOperationId(method, routePath)
    } satisfies ZodOpenApiOperationObject;
  }
  return normalized;
};

const loadRouteDefinitions = async () => {
  const files = await collectOpenApiFiles(apiRoutesRoot);
  const definitions = await Promise.all(
    files.map(async (filePath) => {
      const loaded = (await import(pathToFileURL(filePath).href)) as {
        default?: ApiRouteDefinition;
        openapi?: ApiRouteDefinition;
      };
      const definition = loaded.default ?? loaded.openapi;

      if (!definition) {
        throw new Error(`Missing OpenAPI definition export in ${path.relative(root, filePath)}`);
      }

      const apiPath = pathFromOpenApiFile(filePath);
      const publicPath = stripApiPrefix(apiPath);

      return [publicPath, normalizePathItem(publicPath, definition.pathItem)] as const;
    })
  );

  const duplicates = definitions.filter(
    ([currentPath], index) =>
      definitions.findIndex(([candidatePath]) => candidatePath === currentPath) !== index
  );

  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate OpenAPI path definitions found: ${duplicates
        .map(([duplicatePath]) => duplicatePath)
        .join(', ')}`
    );
  }

  return {
    files,
    paths: Object.fromEntries(
      definitions.sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
    ) as ZodOpenApiPathsObject
  };
};

const { files, paths } = await loadRouteDefinitions();

const document = createDocument({
  openapi: '3.0.0',
  info: {
    title: 'nearcade API',
    version: pkg.version,
    description:
      'OpenAPI documentation generated from endpoint-local Zod definitions. Descriptions include English and Chinese text where handwritten documentation exists.'
  },
  servers: [{ url: '/api', description: 'API base URL' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer'
      }
    }
  },
  paths
});

await mkdir(path.dirname(publicOutput), { recursive: true });
await writeFile(publicOutput, `${JSON.stringify(document, null, 2)}\n`);

console.log(
  `Generated OpenAPI document with ${Object.keys(paths).length} paths from ${files.length} endpoint definitions at ${path.relative(root, publicOutput)}`
);
