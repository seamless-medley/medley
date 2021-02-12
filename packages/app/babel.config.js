const main = {
  presets: [
    "@babel/preset-env",
    "@babel/preset-react",
    "@babel/preset-typescript"
  ],
  plugins: [
    [
      "@babel/plugin-proposal-decorators",
      {
        "decoratorsBeforeExport": true
      }
    ],
    "@babel/plugin-proposal-class-properties",
    "@babel/plugin-proposal-optional-chaining",
    "@babel/plugin-proposal-nullish-coalescing-operator",
    "@babel/transform-runtime"
  ]
};

module.exports = main;