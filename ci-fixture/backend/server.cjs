'use strict';
const http = require('node:http');
const fs = require('node:fs');
const data = '/data/value';
http.createServer((request, response) => {
  if (request.url === '/healthz') { response.end('backend-ready\n'); return; }
  if (request.url !== '/value') { response.writeHead(404).end(); return; }
  if (request.method === 'PUT') {
    let value = '';
    request.on('data', chunk => {
      value += chunk;
      if (Buffer.byteLength(value) > 1024) request.destroy();
    });
    request.on('end', () => {
      fs.writeFileSync(data + '.next', value, { mode: 0o600 });
      fs.renameSync(data + '.next', data);
      response.end('stored\n');
    });
    return;
  }
  response.end(fs.existsSync(data) ? fs.readFileSync(data) : 'empty\n');
}).listen(8080, '0.0.0.0');
