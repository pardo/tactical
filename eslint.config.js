import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },
  {
    // The sim must stay deterministic.
    files: ['src/sim/**/*.js'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded rng.' },
        { object: 'Date', property: 'now', message: 'No wall-clock time in the sim.' },
        { object: 'performance', property: 'now', message: 'No wall-clock time in the sim.' },
      ],
      'no-restricted-imports': ['error', { patterns: ['three', '*/render/*', '*/ui/*', '*/net/*'] }],
    },
  },
];
