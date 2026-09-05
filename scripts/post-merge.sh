#!/bin/bash
set -e
npm ci
npm run push -w @workspace/db
