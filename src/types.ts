export interface EventSummary {
  id: string;
  type: string;
  method: string;
  url: string;
  status?: number;
  source: string;
  timestamp: number;
}

export interface EventOutline {
  id: string;
  type: string;
  method: string;
  url: string;
  httpVersion: string;
  status?: number;
  source: string;
  timestamp: number;
  tags: string[];
  timing: Record<string, unknown>;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Record<string, string | string[]>;
    bodySize: number;
  };
  response?: {
    status: number;
    statusMessage: string;
    headers: Record<string, string | string[]>;
    bodySize: number;
  };
}

export interface EventBody {
  body: string;
  totalSize: number;
  isTruncated: boolean;
}

export interface ProxyConfig {
  httpProxyPort: number;
  certPath: string;
  certFingerprint: string;
  externalNetworkAddresses: string[];
}

export interface Interceptor {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  isActivable: boolean;
  isSupported: boolean;
  inProgress: boolean;
}

export interface Operation {
  name: string;
  description: string;
  category: string;
  tiers: string[];
  annotations: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ExecuteResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}

export interface SendRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  rawBody: Buffer | string;
}

export interface SendOptions {
  proxyConfig?: {
    proxyUrl: string;
    noProxy?: string[];
  };
  ignoreHostHttpsErrors?: boolean | string[];
  clientCertificate?: {
    pfx: Buffer;
    passphrase?: string;
  };
}

export interface SendEvent {
  type: 'request-start' | 'response-head' | 'response-body-part' | 'response-end' | 'error';
  [key: string]: unknown;
}

export interface SendResult {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  timing: {
    startTime: number;
    endTime: number;
    durationMs: number;
  };
}

export interface AuditEntry {
  timestamp: string;
  replay_id: string;
  source_event_id: string | null;
  mutations: Record<string, unknown> | null;
  target_url: string;
  response_status: number;
  response_size: number;
  finding_id: string | null;
  description: string;
}
