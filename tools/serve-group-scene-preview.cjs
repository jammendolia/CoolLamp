// Serve only the generated room preview on this computer's loopback interface.
// Run from any directory: node tools/serve-group-scene-preview.cjs
// Stop with Ctrl+C. No lamp connections, directory listings, or file uploads.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const preview = path.resolve(__dirname, '../.build/room-effects-preview.html');
if (!fs.existsSync(preview)) {
  console.error('Generate .build/room-effects-preview.html first.');
  process.exit(1);
}

const server = http.createServer((request, response) => {
  const allowed = request.url === '/' || request.url === '/room-effects-preview.html';
  if (!allowed || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end('Not found');
    return;
  }
  // Read on each request so regenerating the preview only needs a refresh.
  fs.readFile(preview, (error, html) => {
    if (error) {
      response.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Preview unavailable. Regenerate the HTML and refresh.');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  });
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${server.address().port}/room-effects-preview.html` }));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
