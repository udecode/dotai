#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get the environment variable name and default value from command line args
const varName = process.argv[2];
const defaultValue = process.argv[3] || '';

if (!varName) {
  process.exit(1);
}

// Use current working directory
const projectDir = process.cwd();
const claudePath = path.join(projectDir, '.claude');
let env = {};

// Read settings.json
try {
  const settingsPath = path.join(claudePath, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (settings.env) {
    env = { ...env, ...settings.env };
  }
} catch (e) {
  // Ignore if file doesn't exist or is invalid
}

// Read settings.local.json (overrides)
try {
  const localSettingsPath = path.join(claudePath, 'settings.local.json');
  const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf8'));
  if (localSettings.env) {
    env = { ...env, ...localSettings.env };
  }
} catch (e) {
  // Ignore if file doesn't exist or is invalid
}

// Output the value
const finalValue = env[varName] !== undefined ? env[varName] : defaultValue;
console.log(finalValue);
