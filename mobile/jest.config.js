module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/__tests__/properties/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '^expo-sqlite$': '<rootDir>/__tests__/__mocks__/expo-sqlite.ts',
    '^expo-haptics$': '<rootDir>/__tests__/__mocks__/expo-haptics.ts',
    '^expo-sharing$': '<rootDir>/__tests__/__mocks__/expo-sharing.ts',
  },
};
