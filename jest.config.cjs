/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm', // or other ESM presets
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/node_modules/'],
  testMatch: ['**/__tests__/**/*.spec.[jt]s'],
  transform: {
    '\\.(gql|graphql)$': '@graphql-tools/jest-transform',
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  coverageReporters: ['clover', 'text'],
  collectCoverageFrom: ['src/**/*.{js,ts}'],
}
