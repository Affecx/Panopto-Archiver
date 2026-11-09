import { defineConfig } from "wxt";
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Panopto Archiver",
    description: "Archive explicitly downloadable lecture resources locally.",
    permissions: [
      "activeTab",
      "scripting",
      "downloads",
      "storage",
      "webRequest",
    ],
    optional_host_permissions: ["https://*/*"],
    host_permissions: [
      "https://*.panopto.com/*",
      "https://*.panopto.eu/*",
      "https://*.panopto.cloud/*",
      "http://localhost/*",
    ],
  },
});
