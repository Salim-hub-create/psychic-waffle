#!/bin/bash

echo "🔄 Stopping any existing server processes..."
pkill -f "node server.js" || true
pkill -f "nodemon" || true

echo "⏱️  Waiting for processes to stop..."
sleep 2

echo "🚀 Starting fresh server with modular invoice generator..."
npm run dev
