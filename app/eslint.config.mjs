// Flat ESLint config (ESLint 9 / Next 16).
//
// Next 16 removed the `next lint` command, and ESLint 9 dropped the legacy
// `.eslintrc` lookup in favour of this flat-config file. `eslint-config-next`'s
// default export is the ready-made flat-config array (core-web-vitals + the
// TypeScript rules + the Next parser), so we spread it and add our ignores.
//
// Lint with `npm run lint` (now `eslint .`).
import next from 'eslint-config-next'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'tsconfig.tsbuildinfo',
    ],
  },
  ...next,
  {
    // `eslint-config-next@16` bundles `eslint-plugin-react-hooks` v6, which adds
    // several rules at "error" that did not exist (or were off) under the old
    // `next lint`. This codebase predates them, so they fire on ~50 working
    // call sites. Keep them as visible warnings rather than hard-failing the
    // command on a migration; flip any back to "error" and do a cleanup pass
    // when ready. Scoped to source files (and registering the plugin here) so the
    // override also resolves when ESLint lints root config files.
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
]
