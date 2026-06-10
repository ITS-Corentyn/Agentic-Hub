// Config ESLint "audit" autonome : lint JS / TS / Vue sans avoir besoin du
// tsconfig du repo cible (pas de type-checking). Centre sur la qualite,
// la complexite (-> dimension performance) et quelques regles de securite.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
      '**/vendor/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/*.min.js',
      '**/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended, // recommended (sans type-checking)
  ...vue.configs['flat/recommended'],
  {
    rules: {
      // Complexite / maintenabilite (classees en performance/qualite par le moteur)
      complexity: ['warn', 12],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', 100],
      'max-params': ['warn', 5],
      'max-nested-callbacks': ['warn', 4],
      // Securite ponctuelle
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // On calme le bruit pur "style" pour rester actionnable
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-unused-vars': 'off',
    },
  },
];
