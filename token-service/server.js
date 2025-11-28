// Token Service - Microservice for Token-2022 operations
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const tokenRoutes = require('./routes/token');

const app = express();
const PORT = process.env.TOKEN_SERVICE_PORT || 3001;

// CORS configuration - allow all origins for development
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api', tokenRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'token-service',
    timestamp: new Date().toISOString() 
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    success: false, 
    error: err.message || 'Internal server error' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[token-service] Token Service running on port ${PORT}`);
  console.log(`[token-service] Health check: http://localhost:${PORT}/health`);
  console.log('[token-service] HELIUS_API_KEY loaded:', !!process.env.HELIUS_API_KEY);
  console.log('[token-service] NETWORK loaded:', !!process.env.NETWORK);
  console.log('[token-service] RPC_URL loaded:', !!process.env.RPC_URL);
});

app.on('error', (err) => {
  console.error('[token-service] Server error:', err);
});

module.exports = app;

