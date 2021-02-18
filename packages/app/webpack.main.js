const path = require("path");

const factory = (env, args) => {
  return {
    target: 'electron-main',
    mode: 'development',
    entry: './src/main/index.ts',
    output: {
      path: path.resolve(__dirname, 'bundle'),
      pathinfo: true,
      filename: 'main.js'
    },
    resolve: {
      extensions: [".js", ".jsx", ".json", ".ts", ".tsx"]
    },
    module: {
      rules: [
        {
          test: [/\.jsx?$/, /\.tsx?$/],
          use: 'babel-loader'
        }
      ]
    },
    externals: {
      'fsevents': "commonjs2 fsevents"
    }
  }
}

module.exports = factory;