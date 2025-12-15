// src/api/airtable/airtableErrors.js
// Error classes for Airtable API integration

class AirtableBaseError extends Error {
  /**
   * @param {string} message - Human‑readable error message.
   * @param {Object} [options]
   * @param {number} [options.statusCode] - HTTP status code (if any).
   * @param {Error} [options.cause] - Underlying error cause (e.g. Axios error).
   */
  constructor(message, { statusCode, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    if (statusCode != null) {
      this.statusCode = statusCode;
    }
    if (cause) {
      this.cause = cause;
    }
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// 401 / 403 - authentication / authorization problems
export class AirtableAuthError extends AirtableBaseError {
  constructor(message = "Airtable authentication/authorization failed", options = {}) {
    super(message, { ...options, statusCode: options.statusCode ?? 401 });
  }
}

// 404 - base/table/record not found
export class AirtableNotFoundError extends AirtableBaseError {
  constructor(message = "Requested Airtable resource was not found", options = {}) {
    super(message, { ...options, statusCode: options.statusCode ?? 404 });
  }
}

// 429 - rate limits, with optional retry/backoff metadata
export class AirtableRateLimitError extends AirtableBaseError {
  /**
   * @param {string} [message]
   * @param {Object} [options]
   * @param {number} [options.retryAfter] - Suggested wait time in seconds before retrying.
   * @param {number} [options.statusCode] - HTTP status code (defaults to 429).
   * @param {Error} [options.cause] - Underlying error cause.
   */
  constructor(message = "Airtable rate limit exceeded", { retryAfter, statusCode, cause } = {}) {
    super(message, { statusCode: statusCode ?? 429, cause });
    if (retryAfter != null) {
      this.retryAfter = retryAfter;
    }
    // Hint for caller that this error is typically retryable with backoff
    this.isRetryable = true;
  }
}

// 5xx - server‑side issues on Airtable's side
export class AirtableServerError extends AirtableBaseError {
  constructor(message = "Airtable server error", options = {}) {
    const status = options.statusCode ?? 500;
    super(message, { ...options, statusCode: status });
    this.isRetryable = true;
  }
}

// Other 4xx errors not covered above
export class AirtableClientError extends AirtableBaseError {
  constructor(message = "Airtable client error", options = {}) {
    const status = options.statusCode ?? 400;
    super(message, { ...options, statusCode: status });
  }
}

// Network / transport‑level issues (timeout, DNS, etc.)
export class AirtableNetworkError extends AirtableBaseError {
  /**
   * @param {string} [message]
   * @param {Object} [options]
   * @param {string} [options.code] - Low‑level network/axios error code (e.g. 'ECONNABORTED').
   * @param {Error} [options.cause] - Underlying error cause.
   */
  constructor(message = "Airtable network error", { code, cause } = {}) {
    super(message, { cause });
    if (code) {
      this.code = code;
    }
    // Network errors are often retryable with backoff
    this.isRetryable = true;
  }
}

export {
  AirtableBaseError,
};
