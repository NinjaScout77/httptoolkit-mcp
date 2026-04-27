export class HttpToolkitMcpError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'HttpToolkitMcpError';
  }
}

export class AuthTokenMissingError extends HttpToolkitMcpError {
  public readonly tools_affected = ['replay_request', 'replay_raw'];
  public readonly tools_still_available = [
    'events_list',
    'events_get',
    'events_body',
    'server_status',
    'interceptors_list',
  ];
  public readonly docs = 'https://github.com/NinjaScout77/httptoolkit-mcp#authentication';

  constructor() {
    super(
      'HTK_SERVER_TOKEN is required for replay tools. ' +
        'Read tools work without it. See README#authentication.',
      'AUTH_TOKEN_MISSING',
    );
    this.name = 'AuthTokenMissingError';
  }

  toErrorPayload(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      tools_affected: this.tools_affected,
      tools_still_available: this.tools_still_available,
      docs: this.docs,
    };
  }
}

export class HttpToolkitError extends HttpToolkitMcpError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message, 'HTTP_ERROR');
    this.name = 'HttpToolkitError';
  }
}

export class ProRequiredError extends HttpToolkitMcpError {
  constructor(public readonly operation: string) {
    super(
      `This operation requires HTTPToolkit Pro: ${operation}. ` +
        'Upgrade at https://httptoolkit.com/get-pro',
      'PRO_REQUIRED',
    );
    this.name = 'ProRequiredError';
  }
}

export class OutOfScopeError extends HttpToolkitMcpError {
  constructor(
    public readonly host: string,
    public readonly allowedPatterns: string[],
  ) {
    super(
      `Replay blocked: ${host} is not in the allowlist. ` +
        `Allowed patterns: ${allowedPatterns.join(', ') || '(none)'}`,
      'OUT_OF_SCOPE',
    );
    this.name = 'OutOfScopeError';
  }
}

export class RateLimitedError extends HttpToolkitMcpError {
  constructor(
    public readonly host: string,
    public readonly retryAfterMs: number,
  ) {
    super(
      `Rate limited for host ${host}. Queue depth exceeded. ` +
        `Retry after ${retryAfterMs}ms.`,
      'RATE_LIMITED',
    );
    this.name = 'RateLimitedError';
  }
}

export class MutationError extends HttpToolkitMcpError {
  constructor(message: string) {
    super(message, 'MUTATION_ERROR');
    this.name = 'MutationError';
  }
}

export class SocketConnectionError extends HttpToolkitMcpError {
  constructor(public readonly socketPath: string) {
    super(
      `Cannot connect to HTTPToolkit via socket at ${socketPath}. ` +
        'Is HTTPToolkit desktop app running?',
      'SOCKET_CONNECTION_ERROR',
    );
    this.name = 'SocketConnectionError';
  }
}
