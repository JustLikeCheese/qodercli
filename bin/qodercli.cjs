#!/usr/bin/env node
"use strict";

// Suppress Node.js "unsettled top-level await" warning that fires when
// process.exit() is called while the bundled ESM top-level await is pending.
const origEmit = process.emit;
process.emit = function (event, warning) {
  if (
    event === "warning" &&
    warning &&
    typeof warning.message === "string" &&
    warning.message.includes("unsettled top-level await")
  ) {
    return false;
  }
  return origEmit.apply(this, arguments);
};

const { pathToFileURL } = require("node:url");
const { join } = require("node:path");

const bundlePath = join(__dirname, "..", "bundle", "qodercli.js");
import(pathToFileURL(bundlePath).href).catch((err) => {
  console.error("Failed to start qodercli:", err);
  process.exit(1);
});
