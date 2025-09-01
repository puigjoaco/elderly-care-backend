const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 4000;

// CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://puigjoaco.github.io',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:4000'
    ];
    
    // Allow requests with no origin (like mobile apps)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins for now, restrict in production
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for monitoring
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    service: "Elderly Care Backend",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: "1.0.0"
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({ 
    message: "Elderly Care API v1.0",
    status: "online",
    endpoints: {
      health: "/health",
      api: "/api",
      auth: "/api/auth",
      users: "/api/users",
      caregivers: "/api/caregivers",
      activities: "/api/activities"
    }
  });
});

// API routes placeholder
app.get("/api", (req, res) => {
  res.json({ 
    message: "API endpoint",
    version: "1.0.0",
    documentation: "https://github.com/puigjoaco/elderly-care-system"
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: "Endpoint not found",
    path: req.path,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    status: err.status || 500
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
    🚀 Elderly Care Backend Server
    ================================
    Environment: ${process.env.NODE_ENV || 'development'}
    Port: ${PORT}
    Health: http://localhost:${PORT}/health
    Time: ${new Date().toISOString()}
    ================================
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;
