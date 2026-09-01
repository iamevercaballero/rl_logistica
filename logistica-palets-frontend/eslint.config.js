import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Convención ya usada en el código: un identificador con guion bajo
      // adelante es deliberadamente ignorado (`_enableSorting`, `_res`). Sin
      // esta opción la regla lo marca como error y empuja a borrar props de la
      // API pública de un componente sólo para callar al linter.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Aviso, no error: esta regla protege el Fast Refresh del servidor de
      // desarrollo — que un archivo exporte un componente y además un hook o una
      // constante hace que el hot reload remonte de más. No puede causar un bug
      // en producción. La marcan los archivos de contexto (`theme.tsx`,
      // `toast.tsx`, `CommandPalette`, `DataTable`), donde exportar el proveedor
      // junto a su hook es el patrón canónico de React, y partirlos en dos
      // archivos sería ruido sin ninguna ganancia en runtime.
      'react-refresh/only-export-components': 'warn',

      // Aviso: el compilador de React informa acá que no pudo preservar una
      // memoización manual. Es un dato de optimización, no un defecto — el
      // componente funciona igual, sólo se salta una optimización.
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  {
    // Techo de tamaño (RL-B-04). Un componente de 3.000 líneas no es un problema
    // de estilo: nadie lo lee entero antes de tocarlo.
    //
    // Es un trinquete, no una prohibición retroactiva: los archivos que hoy lo
    // pasan están abajo con su tamaño actual como límite, así que no pueden
    // crecer, y cada vez que uno se achica hay que bajar su número. Partir una
    // pantalla de 3.200 líneas es un trabajo aparte, con su propio riesgo de
    // regresión; esto detiene el crecimiento mientras tanto.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Deuda registrada: tamaño actual como techo. Bajar el número al achicarlos.
    files: ['src/pages/Movements.tsx'],
    rules: { 'max-lines': ['error', { max: 3000, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['src/pages/Reports.tsx'],
    rules: { 'max-lines': ['error', { max: 1700, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['src/pages/InventoryAdjustment.tsx'],
    rules: { 'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['src/pages/Warehouses.tsx'],
    rules: { 'max-lines': ['error', { max: 940, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['src/pages/Pallets.tsx'],
    rules: { 'max-lines': ['error', { max: 930, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['src/pages/Locations.tsx'],
    rules: { 'max-lines': ['error', { max: 830, skipBlankLines: true, skipComments: true }] },
  },
  {
    // TanStack Table tipa sus columnas como `ColumnDef<T, any>`: el `any` es
    // parte de su firma pública, no una omisión nuestra. Cambiarlo por
    // `unknown` no compila contra la librería.
    files: ['src/design-system/DataTable/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
