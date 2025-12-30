import pino from "pino";
import fs from "fs";
import path from "path";
import { Transform } from "stream";

// Directory where log files will be written (relative to project root when run from npm scripts)
const LOG_DIR = path.resolve(process.cwd(), "logs");

/**
 * Ensure the log directory exists.
 */
function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (err) {
    // If we cannot create the directory, we still want console logging to work.
    // So we just print an error to stderr and continue.
    // eslint-disable-next-line no-console
    console.error("[logger] Failed to ensure log directory:", err);
  }
}

/**
 * Build log file path for the current date.
 * File name format: "YYYY-MM-DD - wine-list-log"
 */
function getTodayLogFilePath() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  const fileName = `${year}-${month}-${day} - wine-list-log`;
  return path.join(LOG_DIR, fileName);
}

ensureLogDir();

// Pino destination for the daily file (append mode).
const fileDestination = pino.destination({
  dest: getTodayLogFilePath(),
  // sync true to avoid "sonic boom is not ready yet" when the process exits immediately
  // (CLI usage with process.exit). For this project the log volume is small.
  sync: true,
});

// Create a Transform stream that adds a newline after each log entry for stdout
const stdoutWithNewline = new Transform({
  transform(chunk, encoding, callback) {
    // Add a newline after each chunk (log entry)
    this.push(chunk);
    this.push("\n");
    callback();
  },
});

// Pipe the transform stream to stdout
stdoutWithNewline.pipe(process.stdout);

// Configure multistream to tee logs to both console (stdout) and file.
const streams = pino.multistream([
  { stream: stdoutWithNewline, level: "info" }, // console with newline
  { stream: fileDestination, level: "info" }, // daily file
]);

// Low-level Pino instance (non esportato direttamente) che parla con gli stream.
const pinoLogger = pino(
  {
    level: "info", // default minimum level
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  streams,
);

/**
 * Sanitize sensitive data from log metadata
 * Removes or masks tokens, passwords, and other sensitive information
 */
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return meta;
  }
  
  const sanitized = { ...meta };
  const sensitiveKeys = [
    'access_token',
    'token',
    'authToken',
    'password',
    'secret',
    'apiKey',
    'api_key',
  ];
  
  // Remove or mask sensitive keys
  for (const key of sensitiveKeys) {
    if (key in sanitized && sanitized[key]) {
      const value = String(sanitized[key]);
      // Mask token: show first 4 and last 4 characters
      if (value.length > 8) {
        sanitized[key] = `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
      } else {
        sanitized[key] = '***';
      }
    }
  }
  
  // Recursively sanitize nested objects (like req.body)
  for (const [key, value] of Object.entries(sanitized)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      sanitized[key] = sanitizeMeta(value);
    }
  }
  
  return sanitized;
}

// Interfaccia di logging dell'applicazione:
// logger.info("messaggio", { meta })
// logger.warn("messaggio", { meta })
// logger.error("messaggio", { meta })
export const logger = {
  info(message, meta = {}) {
    const sanitized = sanitizeMeta(meta);
    pinoLogger.info(sanitized, message);
  },
  warning(message, meta = {}) {
    const sanitized = sanitizeMeta(meta);
    pinoLogger.warn(sanitized, message);
  },
  warn(message, meta = {}) {
    const sanitized = sanitizeMeta(meta);
    pinoLogger.warn(sanitized, message);
  },
  error(message, meta = {}) {
    const sanitized = sanitizeMeta(meta);
    pinoLogger.error(sanitized, message);
  },
};

// Alias comodo se preferisci usare `log.info(...)` ecc.
export const log = {
  error: (message, meta = {}) => logger.error(message, meta),
  warning: (message, meta = {}) => logger.warning(message, meta),
  info: (message, meta = {}) => logger.info(message, meta),
};

/**
 * Count how many executions have occurred today by counting
 * "------- NEW EXECUTION -------" messages in today's log file.
 * @returns {number} The execution number (1-based)
 */
function getExecutionNumber() {
  const logFilePath = getTodayLogFilePath();
  try {
    if (!fs.existsSync(logFilePath)) {
      return 1; // First execution of the day
    }
    
    const logContent = fs.readFileSync(logFilePath, "utf-8");
    const lines = logContent.split("\n").filter((line) => line.trim() !== "");
    
    // Count occurrences of "------- NEW EXECUTION -------"
    let count = 0;
    for (const line of lines) {
      try {
        const logEntry = JSON.parse(line);
        if (logEntry.msg === "------- NEW EXECUTION -------") {
          count++;
        }
      } catch {
        // Skip invalid JSON lines
        continue;
      }
    }
    
    return count + 1; // Next execution number
  } catch (err) {
    // If we can't read the file, assume it's the first execution
    // eslint-disable-next-line no-console
    console.error("[logger] Failed to read log file for execution count:", err);
    return 1;
  }
}

/**
 * Write the initial execution log when the module is loaded.
 */
function writeInitialExecutionLog() {
  const executionNumber = getExecutionNumber();
  const timestamp = new Date().toISOString();
  
  logger.info("------- NEW EXECUTION -------", {
    timestamp,
    executionNumber,
  });
}

// Write the initial execution log when the module is loaded
writeInitialExecutionLog();


