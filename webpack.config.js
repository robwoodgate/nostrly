import { fileURLToPath } from 'url';
import path from 'path';
import TerserPlugin from 'terser-webpack-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  entry: {
    'nostrly-login': './src/js/nostrly-login.js',
    'nostrly-register': './src/js/nostrly-register.js',
    'nostrly-tools': './src/js/nostrly-tools.js',
    'nostrly-cashu': './src/js/nostrly-cashu.js',
    // 'nostrly-public': './src/js/nostrly-public.js',
  },
  output: {
    filename: '[name].min.js',
    path: path.resolve(__dirname, 'assets/js'),
  },
  mode: 'production',
  optimization: {
    minimizer: [new TerserPlugin()],
  },
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    modules: ['node_modules'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,           // Match .ts and .tsx files
        use: 'ts-loader',          // Use ts-loader to compile
        exclude: /node_modules/,   // Skip node_modules
      },
    ],
  },
};
