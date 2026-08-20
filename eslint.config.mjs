import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  /*
   * The Node scripts are CommonJS, and that is not a mistake to be corrected.
   *
   * `.claude/scripts/**` (the verification gates) and `scraper/**` are run by
   * `node` directly - never imported by the app, never bundled, no build step
   * between them and the runtime. `require()` is the correct call there, and
   * the app's ESM/TypeScript config was reporting all 152 of them as errors.
   *
   * WHY THIS IS WORTH A CONFIG BLOCK RATHER THAN A SHRUG. Those 152 were not
   * merely noise, they were CAMOUFLAGE. Two real errors were sitting in the
   * same output - `Spine` being created during render in the chain panel,
   * which was rebuilding all 22 rows on every render - and the item had been
   * carried for several sessions as "152 errors, all no-require-imports, a
   * config override" by people who had reasonably stopped reading at the
   * count. Lint going green matters much less than lint being READABLE: the
   * point of this block is that the next real error in src/ is visible.
   *
   * Scoped by path on purpose. A blanket disable would let a `require()` into
   * the app bundle, where it genuinely is a defect.
   */
  {
    files: [".claude/scripts/**/*.js", "scraper/**/*.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    /*
     * `_name` means "required by a signature, not needed here".
     *
     * `ChainRule.apply` is `(pedals, context)`; five of the rules genuinely do
     * not consult the context, and the interface is not optional. Same for the
     * `direction` a label helper takes because its twin needs it. Without this
     * the only ways to silence them are to lie about the signature or to leave
     * a standing warning - and a warning list nobody finishes reading is how
     * the two real defects in this repo stayed hidden under 152 lines of
     * `no-require-imports`.
     *
     * Deliberately does NOT ignore unused CAUGHT ERRORS or unused locals - an
     * unused local is dead code and an unused `catch (e)` is usually a swallowed
     * failure. This covers arguments only.
     */
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^$" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
