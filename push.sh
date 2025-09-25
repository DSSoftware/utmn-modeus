#!/bin/bash

pkill -f node 
cd /files/bot 
git pull 
git fetch --all 
git reset --hard 
npm install
node --no-deprecation app.js
