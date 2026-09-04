import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "drizzle/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "parity/golden-dataset.csv",
      "src/db/seed/ruleset-v1.generated.json",
      "next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    rules: {
      // The codebase deliberately uses explicit .js extensions on
      // relative imports throughout (required for tsx/node's native ESM
      // loader when scripts run directly, e.g. seed scripts) — see
      // docs/runbook.md's "known gotchas". Next's default rule set
      // doesn't need to police this either way, but be explicit that
      // it's intentional, not an oversight, if it's ever flagged.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default eslintConfig;
