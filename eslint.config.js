import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'mobile']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // TanStack file routes intentionally export both Route metadata and components.
      'react-refresh/only-export-components': 'off',
      // Local editable drafts and media seek requests are synchronized from query/player state.
      'react-hooks/set-state-in-effect': 'off',
      // The generated component toolkit contains decorative, memoized placeholder widths.
      'react-hooks/purity': 'off',
    },
  },
])
