const [major] = process.versions.node.split('.').map(Number);

if (major < 18 || major > 20) {
  console.error(`\n❌ Unsupported Node.js version: ${process.versions.node}`);
  console.error('Casa MX backend requires Node.js 18.x, 19.x, or 20.x.');
  console.error('Please switch Node version and try again.\n');
  process.exit(1);
}
