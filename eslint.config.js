/**
 * ESLint v9 Flat Config
 *
 * - We keep the repo-wide rules in `@biu/eslint-config`.
 * - This root config mainly wires it up and adds Node-specific overrides for build/config files.
 */
const path = require("node:path");

const VITE_SRC_ROOT = path.join(__dirname, "apps/vite-app/src");
const LAYER_FILES = [
  "apps/vite-app/src/platform/**/*.{js,jsx,ts,tsx}",
  "apps/vite-app/src/lib/**/*.{js,jsx,ts,tsx}",
  "apps/vite-app/src/data/**/*.{js,jsx,ts,tsx}",
];
const FORBIDDEN_TARGET_LAYERS = {
  platform: ["lib", "store", "components"],
  lib: ["store", "components"],
  data: ["components"],
};

function getLayer(filename) {
  const relativePath = path.relative(VITE_SRC_ROOT, filename);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return relativePath.split(path.sep)[0];
}

function getTargetLayer(filename, rawSource) {
  if (typeof rawSource !== "string" || rawSource === "") return null;

  let resolvedSource;
  if (rawSource.startsWith("@/")) {
    resolvedSource = path.resolve(VITE_SRC_ROOT, `.${rawSource.slice(1)}`);
  } else if (rawSource.startsWith(".")) {
    resolvedSource = path.resolve(path.dirname(filename), rawSource);
  } else {
    return null;
  }

  const relativePath = path.relative(VITE_SRC_ROOT, resolvedSource);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return relativePath.split(path.sep)[0];
}

function unwrapStaticModuleExpression(source) {
  if (!source) return null;
  if (source.type === "Literal" && typeof source.value === "string") return source.value;
  if (source.type === "TemplateLiteral" && source.expressions.length === 0) {
    return source.quasis[0]?.value.cooked ?? null;
  }
  if (
    source.type === "TSAsExpression" ||
    source.type === "TSTypeAssertion" ||
    source.type === "TSNonNullExpression" ||
    source.type === "TSSatisfiesExpression"
  ) {
    return unwrapStaticModuleExpression(source.expression);
  }
  return null;
}

const noCrossLayerImports = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      crossLayer: "{{sourceLayer}} layer must not import {{targetLayer}} layer.",
    },
  },
  create(context) {
    const sourceLayer = getLayer(context.filename);
    const forbiddenTargets = sourceLayer ? FORBIDDEN_TARGET_LAYERS[sourceLayer] : undefined;
    if (!forbiddenTargets) return {};

    function checkModuleSource(sourceNode) {
      const rawSource = unwrapStaticModuleExpression(sourceNode);
      const targetLayer = getTargetLayer(context.filename, rawSource);
      if (targetLayer && forbiddenTargets.includes(targetLayer)) {
        context.report({
          node: sourceNode,
          messageId: "crossLayer",
          data: { sourceLayer, targetLayer },
        });
      }
    }

    return {
      ImportDeclaration: (node) => checkModuleSource(node.source),
      ExportNamedDeclaration: (node) => {
        if (node.source) checkModuleSource(node.source);
      },
      ExportAllDeclaration: (node) => checkModuleSource(node.source),
      ImportExpression: (node) => checkModuleSource(node.source),
      TSImportType: (node) => checkModuleSource(node.source),
    };
  },
};

const echotalkPlugin = {
  rules: {
    "no-cross-layer-imports": noCrossLayerImports,
  },
};

module.exports = [
  // Replaces legacy `.eslintignore` (deprecated in ESLint v9)
  {
    ignores: [
      "**/dist/**",
      "**/.turbo/**",
      "**/.vite/**",
      "**/.webpack_cache/**",
      "**/node_modules/**",
    ],
  },

  // Base rules shared across apps/packages
  ...require("@biu/eslint-config"),

  {
    files: LAYER_FILES,
    plugins: {
      echotalk: echotalkPlugin,
    },
    rules: {
      "echotalk/no-cross-layer-imports": "error",
    },
  },
];
