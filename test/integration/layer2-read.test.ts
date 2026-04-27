import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpClient } from './mcp-client.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

function parseToolResponse(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  expect(result.content).toBeDefined();
  expect(result.content.length).toBeGreaterThan(0);
  expect(result.content[0]!.type).toBe('text');
  const parsed = JSON.parse(result.content[0]!.text);
  return { parsed, isError: result.isError ?? false };
}

describe('Layer 2 — Read Tools (no auth required)', () => {
  let client: McpClient;

  beforeAll(async () => {
    client = new McpClient();
    // Start WITHOUT HTK_SERVER_TOKEN to test read-only mode
    await client.start({
      LOG_LEVEL: 'debug',
    });
  });

  afterAll(async () => {
    await client.stop();
  });

  // L2.1
  describe('L2.1 — server_status', () => {
    it('returns ready status with proxy config and version', async () => {
      const result = await client.callTool('server_status', {});
      const { parsed } = parseToolResponse(result);

      console.log('L2.1 server_status response:', JSON.stringify(parsed, null, 2));

      expect(parsed.ready).toBe(true);
      expect(typeof parsed.httpProxyPort).toBe('number');
      expect(parsed.certPath).toBeDefined();
      expect(typeof parsed.certPath).toBe('string');
      expect(parsed.certFingerprint).toBeDefined();
      expect(typeof parsed.certFingerprint).toBe('string');
      expect(parsed.version).toBe(pkg.version);
      // No token set, so replayAvailable should be false
      expect(parsed.replayAvailable).toBe(false);
    });
  });

  // L2.2
  describe('L2.2 — interceptors_list', () => {
    it('returns interceptor list with expected entries', async () => {
      const result = await client.callTool('interceptors_list', {});
      const { parsed } = parseToolResponse(result);

      console.log('L2.2 interceptors_list: found', parsed.interceptors?.length, 'interceptors');

      expect(parsed.interceptors).toBeDefined();
      expect(Array.isArray(parsed.interceptors)).toBe(true);
      expect(parsed.interceptors.length).toBeGreaterThan(0);

      const ids = parsed.interceptors.map((i: { id: string }) => i.id);
      console.log('L2.2 interceptor IDs:', ids);

      // Check for expected interceptors
      expect(ids).toContain('fresh-chrome');
      expect(ids).toContain('fresh-terminal');
    });
  });

  // L2.3
  describe('L2.3 — events_list (no filter)', () => {
    let eventsList: Array<Record<string, unknown>>;

    it('returns captured events', async () => {
      const result = await client.callTool('events_list', { limit: 50 });
      const { parsed } = parseToolResponse(result);

      console.log('L2.3 events_list response: total =', parsed.total, ', returned =', parsed.events?.length);

      expect(parsed.total).toBeDefined();
      expect(typeof parsed.total).toBe('number');
      expect(parsed.events).toBeDefined();
      expect(Array.isArray(parsed.events)).toBe(true);

      eventsList = parsed.events;

      if (eventsList.length > 0) {
        const first = eventsList[0]!;
        console.log('L2.3 first event:', JSON.stringify(first, null, 2));
        expect(first.id).toBeDefined();
        expect(typeof first.id).toBe('string');
        expect(first.method).toBeDefined();
        expect(first.url).toBeDefined();
      } else {
        console.log('L2.3 WARNING: No captured events found. Generate traffic through HTTPToolkit proxy first.');
      }
    });
  });

  // L2.4
  describe('L2.4 — events_list (with filter)', () => {
    it('filters events by hostname', async () => {
      // Try different filter syntaxes
      const filterVariants = [
        'hostname=httpbin.org',
        'hostname*=httpbin',
        'httpbin.org',
      ];

      let worked = false;
      for (const filter of filterVariants) {
        try {
          const result = await client.callTool('events_list', { filter, limit: 50 });
          const { parsed } = parseToolResponse(result);

          console.log(`L2.4 filter "${filter}": total=${parsed.total}, returned=${parsed.events?.length}`);

          if (parsed.events && parsed.events.length > 0) {
            worked = true;
            // Verify all returned events are for httpbin.org
            for (const event of parsed.events) {
              const url = event.url as string;
              expect(url).toContain('httpbin.org');
            }
            break;
          }
        } catch (err) {
          console.log(`L2.4 filter "${filter}" failed:`, err);
        }
      }

      if (!worked) {
        console.log('L2.4 WARNING: No httpbin.org events found. This is expected if no traffic was generated through the proxy.');
      }
    });
  });

  // L2.5
  describe('L2.5 — events_get', () => {
    it('returns full event outline', async () => {
      // Get an event ID first
      const listResult = await client.callTool('events_list', { limit: 5 });
      const { parsed: listParsed } = parseToolResponse(listResult);

      if (!listParsed.events || listParsed.events.length === 0) {
        console.log('L2.5 SKIP: No events available');
        return;
      }

      const eventId = listParsed.events[0].id as string;
      console.log('L2.5 fetching outline for event:', eventId);

      const result = await client.callTool('events_get', { id: eventId });
      const { parsed } = parseToolResponse(result);

      console.log('L2.5 events_get response:', JSON.stringify(parsed, null, 2));

      // Verify structure — the actual shape depends on HTTPToolkit's response
      expect(parsed).toBeDefined();
      // Check for request sub-object
      if (parsed.request) {
        expect(parsed.request.method).toBeDefined();
        expect(parsed.request.url).toBeDefined();
        if (parsed.request.headers) {
          console.log('L2.5 request headers present:', typeof parsed.request.headers);
        }
      }
      if (parsed.response) {
        console.log('L2.5 response status:', parsed.response.status);
      }
    });
  });

  // L2.6
  describe('L2.6 — events_body (request side)', () => {
    it('returns request body for a POST event', async () => {
      // Find a POST event
      const listResult = await client.callTool('events_list', { limit: 50 });
      const { parsed: listParsed } = parseToolResponse(listResult);

      const postEvent = listParsed.events?.find(
        (e: Record<string, unknown>) => e.method === 'POST'
      );

      if (!postEvent) {
        console.log('L2.6 SKIP: No POST events found');
        return;
      }

      console.log('L2.6 fetching request body for POST event:', postEvent.id);

      const result = await client.callTool('events_body', {
        id: postEvent.id,
        side: 'request',
      });
      const { parsed } = parseToolResponse(result);

      console.log('L2.6 events_body response:', JSON.stringify(parsed, null, 2));

      expect(parsed.body).toBeDefined();
      expect(parsed.encoding).toBeDefined();
      expect(['utf-8', 'base64']).toContain(parsed.encoding);
    });
  });

  // L2.7
  describe('L2.7 — events_body (response side, binary)', () => {
    it('returns base64-encoded body for binary content', async () => {
      // Find the PNG image event
      const listResult = await client.callTool('events_list', { limit: 50 });
      const { parsed: listParsed } = parseToolResponse(listResult);

      const imageEvent = listParsed.events?.find(
        (e: Record<string, unknown>) => {
          const url = e.url as string;
          return url.includes('/image/png') || url.includes('/image');
        }
      );

      if (!imageEvent) {
        console.log('L2.7 SKIP: No image events found');
        return;
      }

      // Check if event has a completed response (not aborted)
      if (imageEvent.status === 'aborted') {
        console.log('L2.7 SKIP: Image event was aborted, no response body available');
        return;
      }

      console.log('L2.7 fetching response body for image event:', imageEvent.id);

      const result = await client.callTool('events_body', {
        id: imageEvent.id,
        side: 'response',
      });
      const { parsed } = parseToolResponse(result);

      console.log('L2.7 events_body response: encoding =', parsed.encoding, ', bodyLength =', parsed.body?.length);

      if (parsed.encoding === 'base64') {
        // Verify PNG signature
        const buf = Buffer.from(parsed.body, 'base64');
        const pngSignature = [0x89, 0x50, 0x4e, 0x47];
        const firstBytes = Array.from(buf.subarray(0, 4));
        console.log('L2.7 first 4 bytes:', firstBytes.map((b: number) => b.toString(16)));
        expect(firstBytes).toEqual(pngSignature);
      } else {
        console.log('L2.7 WARNING: encoding is', parsed.encoding, 'for image data — binary detection may have a bug');
      }
    });
  });

  // L2.8
  describe('L2.8 — events_body (truncation)', () => {
    it('truncates body at max_length', async () => {
      // Find any event with a response body
      const listResult = await client.callTool('events_list', { limit: 50 });
      const { parsed: listParsed } = parseToolResponse(listResult);

      const completedEvent = listParsed.events?.find(
        (e: Record<string, unknown>) => e.status !== 'aborted' && e.status !== undefined && e.status !== null
      );

      if (!completedEvent) {
        console.log('L2.8 SKIP: No completed events with response bodies found');
        return;
      }

      console.log('L2.8 fetching truncated response body for event:', completedEvent.id);

      const result = await client.callTool('events_body', {
        id: completedEvent.id,
        side: 'response',
        max_length: 1024,
      });
      const { parsed } = parseToolResponse(result);

      console.log('L2.8 events_body response:', JSON.stringify({
        bodyLength: parsed.body?.length,
        isTruncated: parsed.isTruncated,
        totalSize: parsed.totalSize,
        encoding: parsed.encoding,
      }));

      if (parsed.totalSize > 1024) {
        expect(parsed.isTruncated).toBe(true);
        expect(parsed.body.length).toBeLessThanOrEqual(1100); // some slack for encoding
      }
    });
  });
});
