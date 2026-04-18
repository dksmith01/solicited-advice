export default {
  apps: [
    {
      name: "solicited-advice",
      script: "dist/index.js",
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      // Environment variables are loaded from .env at startup.
      // PM2 does not auto-load .env — set them here or use dotenv in index.ts.
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
