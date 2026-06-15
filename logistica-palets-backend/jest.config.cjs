/**
 * Jest — tests de integración del motor de stock (PostgreSQL real).
 * maxWorkers:1 → los archivos de test comparten la base y no deben correr en paralelo
 * (la concurrencia que importa se prueba con Promise.all DENTRO de un test).
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testEnvironment: 'node',
  testTimeout: 30000,
  maxWorkers: 1,
};
