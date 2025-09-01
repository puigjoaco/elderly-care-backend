// Quick setup script for testing without Docker
const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up test environment...\n');

// Create test .env file
const testEnv = `
# Test Environment Configuration
NODE_ENV=development
PORT=3000

# Use SQLite for testing (no external DB needed)
DATABASE_URL=sqlite://./test.db

# Test JWT secret
JWT_SECRET=test-secret-key-for-development-only

# Disable external services for testing
SENDGRID_API_KEY=
SENTRY_DSN=
FCM_SERVER_KEY=

# Test mode flags
TEST_MODE=true
BYPASS_PHOTO_VALIDATION=true
MOCK_GPS=true
MOCK_CAMERA=true
`;

fs.writeFileSync('.env', testEnv.trim());
console.log('✅ Created .env file for testing');

// Create test directories
const dirs = ['uploads', 'exports', 'logs', 'temp'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created ${dir}/ directory`);
    }
});

// Create package.json scripts if not exists
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!packageJson.scripts['setup:test']) {
    packageJson.scripts['setup:test'] = 'node setup-test.js';
    packageJson.scripts['dev:test'] = 'NODE_ENV=test nodemon src/index.ts';
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
    console.log('✅ Added test scripts to package.json');
}

console.log('\n✅ Test environment ready!');
console.log('\nNext steps:');
console.log('1. Run: npm install');
console.log('2. Run: npm run dev');
console.log('3. Open: http://localhost:3000/api/v1/health');
console.log('\nThe API will run with mock data and no external dependencies!');