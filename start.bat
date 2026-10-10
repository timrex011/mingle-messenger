@echo off
title Mingle Messenger
cd /d "%~dp0"
echo Starte Mingle Messenger...
echo Oeffne http://localhost:3000 im Browser...
start http://localhost:3000
node server/src/index.js
pause
