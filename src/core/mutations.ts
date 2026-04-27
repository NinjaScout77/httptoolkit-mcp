import { MutationError } from '../core/errors.js';

/**
 * A mutable HTTP request representation used as input/output for the mutation engine.
 */
export interface MutableRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  rawBody: string;
}

const VALID_METHODS = new Set([
  'GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE', 'PATCH',
]);

const VALID_PREFIXES = new Set(['headers', 'url', 'method', 'body']);

const JSON_CONTENT_TYPES = new Set([
  'application/json',
  'application/x-www-form-urlencoded',
]);

/**
 * Apply a set of mutations to a request, returning a new mutated request.
 *
 * Pure function — does not modify the input request.
 * Validates ALL mutation keys up front before applying any mutations.
 * Applies mutations in alphabetical key order for determinism.
 */
export function applyMutations(
  request: Readonly<MutableRequest>,
  mutations: Record<string, unknown>,
): MutableRequest {
  const keys = Object.keys(mutations);

  // Empty mutations — return a shallow copy
  if (keys.length === 0) {
    return {
      method: request.method,
      url: request.url,
      headers: request.headers.map(([k, v]) => [k, v]),
      rawBody: request.rawBody,
    };
  }

  // Phase 1: Validate ALL keys up front
  validateAllKeys(keys, mutations, request);

  // Phase 2: Apply mutations in alphabetical order on a deep copy
  const result: MutableRequest = {
    method: request.method,
    url: request.url,
    headers: request.headers.map(([k, v]) => [k, v]),
    rawBody: request.rawBody,
  };

  const sortedKeys = [...keys].sort();

  for (const key of sortedKeys) {
    const value = mutations[key];
    applyOne(result, key, value);
  }

  // Phase 3: Post-validation
  validateResult(result);

  return result;
}

// ── Validation ──────────────────────────────────────────────────────

function validateAllKeys(
  keys: string[],
  mutations: Record<string, unknown>,
  request: Readonly<MutableRequest>,
): void {
  for (const key of keys) {
    if (key === '') {
      throw new MutationError('Mutation key must not be empty');
    }

    const prefix = key.split('.')[0]!;

    if (!VALID_PREFIXES.has(prefix)) {
      throw new MutationError(
        `Unknown mutation key prefix "${prefix}" in "${key}". ` +
          `Valid prefixes: ${Array.from(VALID_PREFIXES).join(', ')}`,
      );
    }

    // Validate specific key structures
    if (prefix === 'method') {
      validateMethodKey(key, mutations[key]);
    } else if (prefix === 'url') {
      validateUrlKey(key, mutations[key], request);
    } else if (prefix === 'body') {
      validateBodyKey(key, mutations[key], request);
    }
    // headers.* — any subkey is valid
  }
}

function validateMethodKey(key: string, value: unknown): void {
  if (key !== 'method') {
    throw new MutationError(
      `Invalid mutation key "${key}". Use "method" to set the HTTP method.`,
    );
  }
  if (typeof value !== 'string') {
    throw new MutationError('Method mutation value must be a string');
  }
  const upper = value.toUpperCase();
  if (!VALID_METHODS.has(upper)) {
    throw new MutationError(
      `Invalid HTTP method "${value}". Valid methods: ${Array.from(VALID_METHODS).join(', ')}`,
    );
  }
}

function validateUrlKey(
  key: string,
  value: unknown,
  _request: Readonly<MutableRequest>,
): void {
  const parts = key.split('.');
  const subKey = parts[1];

  if (!subKey) {
    throw new MutationError(
      `Invalid mutation key "${key}". Use url.path, url.host, or url.query.<name>.`,
    );
  }

  if (subKey === 'path') {
    // url.path or url.path.<n>
    if (parts.length === 3) {
      validatePathSegmentIndex(parts[2]!, _request);
    } else if (parts.length > 3) {
      throw new MutationError(
        `Invalid mutation key "${key}". For path segment replacement use url.path.<n>.`,
      );
    }
  } else if (subKey === 'query') {
    if (parts.length < 3) {
      throw new MutationError(
        `Invalid mutation key "${key}". Use url.query.<param_name>.`,
      );
    }
  } else if (subKey === 'host') {
    if (parts.length !== 2) {
      throw new MutationError(
        `Invalid mutation key "${key}". Use url.host to replace the hostname.`,
      );
    }
    if (typeof value !== 'string') {
      throw new MutationError('url.host value must be a string');
    }
  } else {
    throw new MutationError(
      `Invalid mutation key "${key}". Valid url sub-keys: path, query, host.`,
    );
  }
}

function validatePathSegmentIndex(
  indexStr: string,
  request: Readonly<MutableRequest>,
): void {
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0) {
    throw new MutationError(
      `Invalid path segment index "${indexStr}". Must be a non-negative integer.`,
    );
  }
  const parsed = new URL(request.url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (index >= segments.length) {
    throw new MutationError(
      `Path segment index ${index} is out of range. ` +
        `Path "${parsed.pathname}" has ${segments.length} segment(s) (0-indexed).`,
    );
  }
}

function validateBodyKey(
  key: string,
  _value: unknown,
  request: Readonly<MutableRequest>,
): void {
  const parts = key.split('.');
  const subKey = parts[1];

  if (!subKey) {
    throw new MutationError(
      `Invalid mutation key "${key}". Use body.raw or body.<field>.`,
    );
  }

  // body.raw — always valid
  if (subKey === 'raw') {
    return;
  }

  // body.<field> — requires JSON-compatible content type
  const contentType = findHeaderValue(request.headers, 'content-type');
  const baseContentType = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';

  if (!JSON_CONTENT_TYPES.has(baseContentType)) {
    throw new MutationError(
      `Cannot apply body field mutation "${key}" — Content-Type is "${contentType ?? '(none)'}". ` +
        'Field-level body mutations require application/json or application/x-www-form-urlencoded. ' +
        'Use body.raw to replace the entire body instead.',
    );
  }

  // Validate the body is parseable JSON
  try {
    JSON.parse(request.rawBody);
  } catch {
    throw new MutationError(
      `Cannot apply body field mutation "${key}" — body is not valid JSON.`,
    );
  }
}

// ── Mutation application ────────────────────────────────────────────

function applyOne(result: MutableRequest, key: string, value: unknown): void {
  const parts = key.split('.');
  const prefix = parts[0]!;

  switch (prefix) {
    case 'method':
      result.method = (value as string).toUpperCase();
      break;
    case 'headers':
      applyHeaderMutation(result, parts[1]!, value);
      break;
    case 'url':
      applyUrlMutation(result, parts, value);
      break;
    case 'body':
      applyBodyMutation(result, parts, value);
      break;
  }
}

function applyHeaderMutation(
  result: MutableRequest,
  headerName: string,
  value: unknown,
): void {
  // Find existing header (case-insensitive)
  const existingIndex = result.headers.findIndex(
    ([k]) => k.toLowerCase() === headerName.toLowerCase(),
  );

  if (value === null) {
    // Delete
    if (existingIndex !== -1) {
      result.headers = [
        ...result.headers.slice(0, existingIndex),
        ...result.headers.slice(existingIndex + 1),
      ];
    }
  } else if (existingIndex !== -1) {
    // Replace — preserve original casing of header name
    result.headers = result.headers.map((entry, i) =>
      i === existingIndex ? [entry[0]!, String(value)] : entry,
    );
  } else {
    // Add new
    result.headers = [...result.headers, [headerName, String(value)]];
  }
}

function applyUrlMutation(
  result: MutableRequest,
  parts: string[],
  value: unknown,
): void {
  const subKey = parts[1]!;
  const parsed = new URL(result.url);

  if (subKey === 'host') {
    parsed.hostname = String(value);
  } else if (subKey === 'path') {
    if (parts.length === 2) {
      // Replace full path
      parsed.pathname = String(value);
    } else {
      // Replace nth segment
      const index = Number(parts[2]);
      const segments = parsed.pathname.split('/').filter(Boolean);
      segments[index] = String(value);
      parsed.pathname = '/' + segments.join('/');
    }
  } else if (subKey === 'query') {
    const paramName = parts.slice(2).join('.');
    if (value === null) {
      parsed.searchParams.delete(paramName);
    } else {
      parsed.searchParams.set(paramName, String(value));
    }
  }

  result.url = parsed.toString();
}

function applyBodyMutation(
  result: MutableRequest,
  parts: string[],
  value: unknown,
): void {
  const subKey = parts[1]!;

  if (subKey === 'raw') {
    result.rawBody = String(value);
    return;
  }

  // Field-level JSON patch — dot-path starting from parts[1]
  const fieldPath = parts.slice(1);
  const body = JSON.parse(result.rawBody);
  setNestedField(body, fieldPath, value);
  result.rawBody = JSON.stringify(body);
}

/**
 * Set a nested field in an object using a dot-path array.
 * Creates intermediate objects as needed.
 */
function setNestedField(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]!;
    if (
      current[segment] === undefined ||
      current[segment] === null ||
      typeof current[segment] !== 'object'
    ) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const lastKey = path[path.length - 1]!;
  current[lastKey] = value;
}

// ── Post-validation ─────────────────────────────────────────────────

function validateResult(result: MutableRequest): void {
  // Validate URL is still parseable
  try {
    new URL(result.url);
  } catch {
    throw new MutationError(
      `Mutations produced an invalid URL: "${result.url}"`,
    );
  }

  // Validate method
  if (!VALID_METHODS.has(result.method)) {
    throw new MutationError(
      `Mutations produced an invalid HTTP method: "${result.method}"`,
    );
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function findHeaderValue(
  headers: ReadonlyArray<readonly [string, string]>,
  name: string,
): string | undefined {
  const entry = headers.find(([k]) => k.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}
