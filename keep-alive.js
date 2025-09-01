// Auto-ping para mantener el servidor despierto en Render
const https = require('https');

function keepAlive() {
  // Ping ourselves every 14 minutes
  setInterval(() => {
    https.get('https://elderly-care-backend-1lfm.onrender.com/health', (res) => {
      console.log(`Keep-alive ping: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('Keep-alive error:', err.message);
    });
  }, 14 * 60 * 1000); // 14 minutos
  
  console.log('Keep-alive service started');
}

module.exports = keepAlive;