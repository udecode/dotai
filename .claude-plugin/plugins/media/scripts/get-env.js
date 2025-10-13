#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get the environment variable name and default value from command line args
const varName = process.argv[2];
const defaultValue = process.argv[3] || '';

// Enable debug logging with DEBUG=1 environment variable
const debug = process.env.DEBUG === '1';

function log(...args) {
  if (debug) {
    console.error('[get-env]', ...args);
  }
}

if (!varName) {
  console.error('Usage: get-env.js <VAR_NAME> [default_value]');
  process.exit(1);
}

log(`Looking for env var: ${varName}`);
log(`Default value: ${defaultValue}`);

const projectDir = process.env.CLAUDE_PROJECT_DIR;
if (!projectDir) {
  log('CLAUDE_PROJECT_DIR not set, using default');
  console.log(defaultValue);
  process.exit(0);
}

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
    log(`Found env in settings.json:`, settings.env);
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
    log(`Found env in settings.local.json (overrides):`, localSettings.env);
  }
} catch (e) {
  log(`Failed to read settings.local.json: ${e.message}`);
}

// Output the value
const finalValue = env[varName] !== undefined ? env[varName] : defaultValue;
log(`Final value for ${varName}: ${finalValue}`);
console.log(finalValue);
