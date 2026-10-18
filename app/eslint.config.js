import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'src-tauri/gen', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Interface strings must come from src/i18n (ADR-007); literal text in JSX is a mistake.
      'no-restricted-syntax': [
        'error',
        { selector: 'JSXText[value=/[A-Za-zА-Яа-яЁё]/]', message: 'Use t() from src/i18n for interface text.' },
      ],
    },
  },
  { files: ['src/**/*.test.{ts,tsx}', 'e2e/**'], rules: { 'no-restricted-syntax': 'off' } },
);
