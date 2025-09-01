// Servidor de prueba mínimo para Render
const http = require('http');

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  console.log(`Request received: ${req.method} ${req.url}`);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  
  if (req.url === '/') {
    res.end(JSON.stringify({
      message: 'Elderly Care Backend - Test Server',
      status: 'online',
      port: PORT,
      timestamp: new Date().toISOString()
    }));
  } else if (req.url === '/health') {
    res.end(JSON.stringify({
      status: 'OK',
      service: 'Test Server',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({
      error: 'Not found',
      path: req.url
    }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Test server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Ready to handle requests...`);
  
  // Start keep-alive service in production
  if (process.env.NODE_ENV === 'production') {
    require('./keep-alive')();
  }
});

// Handle errors
server.on('error', (err) => {
  console.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});