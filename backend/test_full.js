const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');

const serverProc = spawn('npx', ['tsx', 'src/server.ts'], {
  cwd: path.join(__dirname, 'backend'),
  stdio: 'pipe'
});

serverProc.stdout.on('data', d => console.log('SERVER STDOUT:', d.toString().trim()));
serverProc.stderr.on('data', d => console.error('SERVER STDERR:', d.toString().trim()));

setTimeout(() => {
  console.log('Connecting to WS...');
  const ws = new WebSocket('ws://localhost:3000/api/browser/session');
  
  ws.on('open', () => {
    console.log('Connected');
    ws.send(JSON.stringify({ type: 'start', url: 'https://example.com' }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'session_ready') {
      console.log('Session ready. Enabling picker...');
      ws.send(JSON.stringify({ type: 'enable_picker' }));
      
      setTimeout(() => {
        console.log('Sending click...');
        ws.send(JSON.stringify({ type: 'click', x: 50, y: 50 }));
      }, 2000);
    }
    if (msg.type === 'picked_selector') {
      console.log('SUCCESS! Picked selector:', msg.selector);
      serverProc.kill();
      process.exit(0);
    }
    if (msg.type === 'error') {
      console.error('Error:', msg.message);
    }
  });
}, 3000);
