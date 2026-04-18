export default {
  apps: [
    {
      name: "solicited-advice",
      script: "dist/index.js",
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
