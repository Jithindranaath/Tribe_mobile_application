module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
    plugins: [
      // react-native-reanimated MUST be listed last
      "react-native-reanimated/plugin",
    ],
  };
};
