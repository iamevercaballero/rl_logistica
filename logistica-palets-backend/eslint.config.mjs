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

      // Techo de tamaño (RL-B-04). Un archivo de 3.000 líneas no es un problema
      // de estilo: nadie lo lee entero antes de tocarlo, y ahí es donde se
      // esconden los efectos que este mismo informe fue encontrando.
      //
      // Es un trinquete, no una prohibición retroactiva: los archivos que hoy
      // pasan el techo están abajo con su tamaño actual como límite, así que no
      // pueden crecer, y cada vez que uno se achica hay que bajar su número. Un
      // corte de un servicio de 3.300 líneas es un trabajo aparte y con riesgo
      // de regresión propio; esto detiene el crecimiento mientras tanto.
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Deuda registrada: tamaño actual como techo. Bajar el número al achicarlos.
    files: ['src/modules/movements/movements.service.ts'],
    rules: { 'max-lines': ['error', { max: 2600, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['src/modules/locations/locations.service.ts'],
    rules: { 'max-lines': ['error', { max: 1012, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['src/modules/reports/reports.service.ts'],
    rules: { 'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }] },
  },
  {
    // Las pruebas de integración son largas por naturaleza: describen casos, no
    // acumulan lógica. El techo acá sólo evita un archivo inmanejable.
    files: ['test/**/*.ts'],
    rules: { 'max-lines': ['error', { max: 1200, skipBlankLines: true, skipComments: true }] },
  },
];
