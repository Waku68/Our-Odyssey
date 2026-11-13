import globals from 'globals';
export default [{ files: ['**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker } },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-const-assign': 'error', 'no-import-assign': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error' } }];
