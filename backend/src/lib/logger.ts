import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const prettyLogs = process.env.PRETTY_LOGS === "true";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(!isProduction && prettyLogs
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});
