import { fileURLToPath } from "url";
import path from "path";
import TerserPlugin from "terser-webpack-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  entry: {
    "nostrly-login": "./src/js/nostrly-login.ts",
    "nostrly-register": "./src/js/nostrly-register.ts",
    "nostrly-tools": "./src/js/nostrly-tools.ts",
    "nostrly-cashu-redeem": "./src/js/nostrly-cashu-redeem.ts",
    "nostrly-cashu-lock": "./src/js/nostrly-cashu-lock.ts",
    "nostrly-cashu-witness": "./src/js/nostrly-cashu-witness.ts",
    "nostrly-cashu-request": "./src/js/nostrly-cashu-request.ts",
    "nostrly-cashu-gift": "./src/js/nostrly-cashu-gift.ts",
    "nostrly-cashu-cache": "./src/js/nostrly-cashu-cache.ts",
    "nostrly-cashu-gather": "./src/js/nostrly-cashu-gather.ts",
  },
  output: {
    filename: "[name].min.js",
    path: path.resolve(__dirname, "assets/js"),
  },
  mode: "production",
  optimization: {
    minimizer: [new TerserPlugin()],
    runtimeChunk: { name: "nostrly-runtime" },
    splitChunks: {
      chunks: "all",
      cacheGroups: {
        // Only split node_modules; shared src/ code stays in each entry so
        // PHP only has to enqueue runtime + vendor + entry
        default: false,
        defaultVendors: false,
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: "nostrly-vendor",
          chunks: "all",
        },
      },
    },
  },
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
    modules: ["node_modules"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/, // Match .ts and .tsx files
        use: "ts-loader", // Use ts-loader to compile
        exclude: /node_modules/, // Skip node_modules
      },
    ],
  },
};
