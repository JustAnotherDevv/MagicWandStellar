import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';

// Load .env so OPENROUTER_API_KEY is available in test processes
loadDotenv();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 1_800_000, // 30 min — contract builds + 429 retries + WASM compilation
    hookTimeout: 120_000,
    pool: 'forks',         // isolated processes per file — safe for DB + server tests
    reporter: 'verbose',
    include: ['tests/**/*.test.ts'],
  },
});
