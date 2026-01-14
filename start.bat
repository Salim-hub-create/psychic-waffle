@echo off
echo 🔄 Stopping any existing server processes...
taskkill /F /IM node.exe 2>NUL
taskkill /F /IM nodemon.exe 2>NUL

echo ⏱️  Waiting for processes to stop...
timeout /t 2 /nobreak >NUL

echo 🚀 Starting fresh server with modular invoice generator...
npm run dev
