// PM2 config for Promptaria.
// Started via C:\ProgramData\pm2-cli\pm2.cmd with PM2_HOME=C:\ProgramData\pm2 so the
// boot task (S4U logon, no user profile) can resurrect it after a reboot.
module.exports = {
  apps: [
    {
      name: 'promptaria',
      script: 'server/index.js',
      cwd: 'C:\\Users\\Administrator\\Desktop\\claud\\promptaria',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 3400,
        SITE_URL: 'https://promptaria.ir',
      },
      error_file: 'C:\\Users\\Administrator\\Desktop\\claud\\promptaria\\logs\\err.log',
      out_file: 'C:\\Users\\Administrator\\Desktop\\claud\\promptaria\\logs\\out.log',
      time: true,
    },
  ],
};
