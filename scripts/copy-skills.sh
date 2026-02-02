#!/bin/bash

# Remove and recreate skills directory
rm -rf skills
mkdir -p skills

# Find all plugin skills directories and copy them
for plugin_skills in .claude-plugin/plugins/*/skills; do
  if [ -d "$plugin_skills" ]; then
    # Copy all skills directly to root skills directory
    cp -r "$plugin_skills"/* skills/
  fi
done
