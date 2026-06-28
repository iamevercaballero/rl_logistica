// Flat config (ESLint v9). Usa los paquetes ya instalados
// (@typescript-eslint/parser y eslint-plugin) sin meta-paquetes extra.
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'src/migrations/**', // SQL generado por TypeORM, no se lintea
      '*.cjs',
      '*.mjs',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // El código usa 'any' de forma deliberada en varios bordes (payloads JWT,
      // casts de @nestjs/jwt). No lo tratamos como error.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
