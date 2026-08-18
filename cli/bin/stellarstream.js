#!/usr/bin/env node
import { runCLI } from "../dist/cli.js";

runCLI(process.argv).catch((error) => {
  console.error("Fatal CLI Error:", error.message);
  process.exit(1);
});
