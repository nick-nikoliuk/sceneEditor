const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const WebpackCleanupPlugin = require('webpack-cleanup-plugin');

module.exports = {
  context: path.resolve(__dirname, 'src'),
  entry: {
    main: ['./index.js']
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  module: {
    loaders: [{
      test: /\.styl/,
      loader: 'style-loader!css-loader!stylus-loader'
    }, {
      test: /\.js$/,
      loader: 'babel-loader'
    }, {
      test: /\.(mtl|obj|fbx|jpg|png|json)$/,
      loader: 'file-loader?name=[path][name].[ext]?[hash]&context=./src'
    }]
  },
  plugins: [
    new WebpackCleanupPlugin(),
    // new webpack.optimize.CommonsChunkPlugin("init"),
    new HtmlWebpackPlugin({
      template: './index.ejs'
      // chunks: ['init']
    }),
    new CopyWebpackPlugin([
      {from: '**/*.FBX'},
      {from: '**/*.tga'},
      {from: '**/*.jpg'},
      {from: '**/*.png'},
      {from: '**/*.tga'},
      {from: '**/*.json'}
    ])
  ]
};