const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Apply NativeWind first
const nativeWindConfig = withNativeWind(config, { input: "./global.css" });

// Then add custom resolver for Privy mock (must preserve NativeWind's resolver)
const originalResolveRequest = nativeWindConfig.resolver.resolveRequest;
nativeWindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@privy-io/expo") {
    return {
      filePath: path.resolve(__dirname, "lib/privy-mock.js"),
      type: "sourceFile",
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = nativeWindConfig;
