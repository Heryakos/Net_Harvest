const WebSocket = require('ws');

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
    }, 1000);
  }
  if (msg.type === 'picked_selector') {
    console.log('SUCCESS! Picked selector:', msg.selector);
    process.exit(0);
  }
  if (msg.type === 'error') {
    console.error('Error:', msg.message);
  }
});
