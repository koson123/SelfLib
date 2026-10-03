import { createApplication } from './app.js';
process.umask(0o077);
const port = Number(process.env.PORT || 3000);
const instance = createApplication({
  dataDir: process.env.DATA_DIR || './data',
  appUrl: process.env.APP_URL || `http://localhost:${port}`,
  staticDir: 'dist/public',
  allowLoopback: process.env.ALLOW_LOOPBACK_SOURCES === 'true',
});
const server = instance.app.listen(port, '0.0.0.0', () =>
  console.info(JSON.stringify({ event: 'listening', port, version: '0.1.0' })),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  const drained = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  await drained;
  await instance.close();
  clearTimeout(deadline);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
