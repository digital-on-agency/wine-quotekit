import pino from "pino";
import fs from "fs";
import path from "path";

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

// Configure multistream to tee logs to both console (stdout) and file.
const streams = pino.multistream([
  { stream: process.stdout, level: "info" }, // console
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

// Interfaccia di logging dell'applicazione:
// logger.info("messaggio", { meta })
// logger.warn("messaggio", { meta })
// logger.error("messaggio", { meta })
export const logger = {
  info(message, meta = {}) {
    pinoLogger.info(meta, message);
  },
  warning(message, meta = {}) {
    pinoLogger.warn(meta, message);
  },
  warn(message, meta = {}) {
    pinoLogger.warn(meta, message);
  },
  error(message, meta = {}) {
    pinoLogger.error(meta, message);
  },
};

// Alias comodo se preferisci usare `log.info(...)` ecc.
export const log = {
  error: (message, meta = {}) => logger.error(message, meta),
  warning: (message, meta = {}) => logger.warning(message, meta),
  info: (message, meta = {}) => logger.info(message, meta),
};


