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
    // TanStack Table tipa sus columnas como `ColumnDef<T, any>`: el `any` es
    // parte de su firma pública, no una omisión nuestra. Cambiarlo por
    // `unknown` no compila contra la librería.
    files: ['src/design-system/DataTable/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
