import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Profile Snapshot',
    description:
      'Save and restore per-site browser profile snapshots for development and QA.',
    permissions: ['activeTab', 'cookies', 'scripting', 'storage', 'tabs'],
    host_permissions: ['<all_urls>'],
  },
});
