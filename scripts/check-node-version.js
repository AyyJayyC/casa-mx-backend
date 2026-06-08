const [major] = process.versions.node.split(".").map(Number);

if (major < 18) {
  console.error(`\n❌ Unsupported Node.js version: ${process.versions.node}`);
  console.error("Casa MX backend requires Node.js 18.x or newer.");
  console.error("Please switch Node version and try again.\n");
  process.exit(1);
}

if (major > 20) {
  console.warn(
    `\n⚠️  Node.js ${process.versions.node} is newer than tested (18-20).`,
  );
  console.warn(
    "The application may work but is not officially supported on this version.",
  );
  console.warn("Continuing with build...\n");
}
