const net = require('net');
const RHOST = process.argv[2];
const LPORT = Number(process.argv[3] || 3001);
const RPORT = Number(process.argv[4] || LPORT);
net.createServer((c) => {
  const u = net.connect(RPORT, RHOST);
  c.pipe(u); u.pipe(c);
  c.on('error', () => u.destroy());
  u.on('error', () => c.destroy());
}).listen(LPORT, '127.0.0.1', () => console.log('fwd 127.0.0.1:' + LPORT + ' -> ' + RHOST + ':' + RPORT));
