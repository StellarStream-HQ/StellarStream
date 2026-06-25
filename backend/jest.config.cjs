/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Point Jest at the dedicated jest tests folder so it doesn't pick up
  // the existing node:test files in src/__tests__
  testMatch: [
    "**/src/__jest__/**/*.test.ts",
    "**/src/__jest__/integration/**/*.test.ts",
  ],
  moduleNameMapper: {
    // Strip .js extensions from ESM imports so ts-jest can resolve them
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          // ts-jest needs CommonJS output to work without experimental flags
          module: "CommonJS",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  // Silence noisy logger output during tests
  setupFiles: ["<rootDir>/src/__jest__/setup.ts"],
  // Integration tests may take slightly longer — allow up to 10 s per test
  testTimeout: 10000,
};
