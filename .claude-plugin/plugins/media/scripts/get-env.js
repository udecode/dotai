#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get the environment variable name and default value from command line args
const varName = process.argv[2];
const defaultValue = process.argv[3] || '';

// Log to file next to script
const logFile = path.join(__dirname, 'get-env.log');

function log(...args) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.join(' ')}\n`;
  try {
    fs.appendFileSync(logFile, message);
  } catch (e) {
    // Silently fail if can't write log
  }
}

if (!varName) {
  log('ERROR: No variable name provided');
  process.exit(1);
}

log(`Looking for env var: ${varName}`);
log(`Default value: ${defaultValue}`);

// Use current working directory
const projectDir = process.cwd();
log(`Project directory: ${projectDir}`);

const claudePath = path.join(projectDir, '.claude');
let env = {};

// Read settings.json
try {
  const settingsPath = path.join(claudePath, 'settings.json');
  log(`Reading settings from: ${settingsPath}`);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (settings.env) {
    env = { ...env, ...settings.env };
    log(`Found env in settings.json: ${JSON.stringify(settings.env)}`);
  }
} catch (e) {
  log(`Failed to read settings.json: ${e.message}`);
}

// Read settings.local.json (overrides)
try {
  const localSettingsPath = path.join(claudePath, 'settings.local.json');
  log(`Reading local settings from: ${localSettingsPath}`);
  const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf8'));
  if (localSettings.env) {
    env = { ...env, ...localSettings.env };
    log(`Found env in settings.local.json (overrides): ${JSON.stringify(localSettings.env)}`);
  }
} catch (e) {
  log(`Failed to read settings.local.json: ${e.message}`);
}

// Output the value
const finalValue = env[varName] !== undefined ? env[varName] : defaultValue;
log(`Final value for ${varName}: ${finalValue}`);
log('---');
console.log(finalValue);
