/** Standalone Vite renderer server. Does not load Electron plugins or application backends. */
import { createServer } from 'vite';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
const close = async () => { await server.close(); process.exit(0); };
process.on('SIGTERM', close);
process.on('SIGINT', close);
