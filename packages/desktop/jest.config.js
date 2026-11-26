/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: [
        '<rootDir>/tests/sanitizers/**/*.test.ts',
        '<rootDir>/tests/sanitizers/**/*.test.tsx',
        '<rootDir>/tests/lib/**/*.spec.ts',
    ],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
    },
    moduleNameMapper: {
        '\\.css$': '<rootDir>/tests/sanitizers/styleMock.js',
    },
}
