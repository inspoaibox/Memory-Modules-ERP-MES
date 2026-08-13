const path = require("node:path");

const projectRoot = __dirname;

module.exports = {
  apps: [
    {
      name: "memory-erp-mes-api",
      cwd: path.join(projectRoot, "apps", "api"),
      script: "dist/index.js",
      interpreter: process.env.NODE_BINARY || process.execPath,
      node_args: "--env-file=.env",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      time: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "43127",
        SEED_DEMO_DATA: "false"
      }
    }
  ]
};
