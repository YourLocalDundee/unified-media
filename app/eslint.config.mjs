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

const config = [
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
    // these React-Compiler-era rules. They were briefly downgraded to "warn" during
    // the v16 migration because the codebase predated them; that cleanup pass is now
    // done (every call site fixed), so they are enforced as errors again. Scoped to
    // source files (and registering the plugin here) so the override also resolves
    // when ESLint lints root config files.
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/refs': 'error',
    },
  },
]

export default config
