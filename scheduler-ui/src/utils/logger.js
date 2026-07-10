/**
 * Conditional logging utility
 * Debug logs only appear in development mode
 */

const isDev = import.meta.env.DEV;

export const logger = {
  debug: (...args) => {
    if (isDev) {
      console.log(...args);
    }
  },
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

export default logger;
