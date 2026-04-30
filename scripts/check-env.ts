/**
 * Environment Variable Validation Script
 * 
 * This script validates that all required production environment variables
 * are present before deployment. Run this during CI/CD or pre-deployment
 * to catch configuration issues early.
 * 
 * Usage: npx tsx scripts/check-env.ts
 */

interface EnvVariable {
  name: string;
  description: string;
  required: boolean;
  example?: string;
}

const REQUIRED_ENV_VARS: EnvVariable[] = [
  {
    name: 'DATABASE_URL',
    description: 'PostgreSQL connection string',
    required: true,
    example: 'postgresql://user:password@host:5432/database',
  },
  {
    name: 'REDIS_URL',
    description: 'Redis connection string (optional but recommended)',
    required: false,
    example: 'redis://localhost:6379',
  },
  {
    name: 'JWT_SECRET',
    description: 'Secret key for JWT access token signing',
    required: true,
    example: 'your-secure-random-string-min-32-chars',
  },
  {
    name: 'JWT_REFRESH_SECRET',
    description: 'Secret key for JWT refresh token signing',
    required: false,
    example: 'your-secure-random-string-min-32-chars',
  },
  {
    name: 'FRONTEND_URL',
    description: 'Frontend application URL for CORS',
    required: true,
    example: 'https://casamx.com',
  },
  {
    name: 'MAPS_API_KEY',
    description: 'Google Maps API key',
    required: true,
    example: 'AIza...',
  },
  {
    name: 'ENABLE_BILLABLE_MAPS',
    description: 'Enable Google-only billable Maps calls (must be true in production)',
    required: false,
    example: 'true',
  },
  {
    name: 'NODE_ENV',
    description: 'Application environment',
    required: true,
    example: 'production',
  },
  {
    name: 'PORT',
    description: 'Server port',
    required: false,
    example: '3001',
  },
];

function checkEnvironmentVariables(): void {
  console.log('🔍 Validating environment variables...\n');

  const errors: string[] = [];
  const warnings: string[] = [];
  const valid: string[] = [];

  for (const envVar of REQUIRED_ENV_VARS) {
    const value = process.env[envVar.name];

    if (!value || value.trim() === '') {
      if (envVar.required) {
        errors.push(
          `❌ MISSING REQUIRED: ${envVar.name}\n   Description: ${envVar.description}\n   Example: ${envVar.example || 'N/A'}`
        );
      } else {
        warnings.push(
          `⚠️  OPTIONAL NOT SET: ${envVar.name}\n   Description: ${envVar.description}\n   Example: ${envVar.example || 'N/A'}`
        );
      }
    } else {
      // Validate format for specific variables
      if (envVar.name === 'DATABASE_URL' && !value.startsWith('postgresql://')) {
        errors.push(
          `❌ INVALID FORMAT: ${envVar.name}\n   Must start with 'postgresql://'\n   Current: ${value.substring(0, 30)}...`
        );
      } else if (envVar.name === 'REDIS_URL' && !value.startsWith('redis://')) {
        errors.push(
          `❌ INVALID FORMAT: ${envVar.name}\n   Must start with 'redis://'\n   Current: ${value.substring(0, 30)}...`
        );
      } else if (envVar.name === 'JWT_SECRET' && value.length < 32) {
        errors.push(
          `❌ INSECURE: ${envVar.name}\n   Must be at least 32 characters\n   Current length: ${value.length}`
        );
      } else if (envVar.name === 'NODE_ENV' && !['development', 'production', 'test'].includes(value)) {
        errors.push(
          `❌ INVALID VALUE: ${envVar.name}\n   Must be 'development', 'production', or 'test'\n   Current: ${value}`
        );
      } else if (envVar.name === 'ENABLE_BILLABLE_MAPS' && !['true', 'false'].includes(value)) {
        errors.push(
          `❌ INVALID VALUE: ${envVar.name}\n   Must be 'true' or 'false'\n   Current: ${value}`
        );
      } else {
        valid.push(`✅ ${envVar.name}: ${value.substring(0, 30)}${value.length > 30 ? '...' : ''}`);
      }
    }
  }

  const isPlaceholderMapsKey = (raw: string | undefined) => {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return true;
    return (
      value.startsWith('replace_with') ||
      value.startsWith('your_') ||
      value.startsWith('changeme') ||
      value.startsWith('placeholder') ||
      (value.startsWith('<') && value.endsWith('>'))
    );
  };

  if (process.env.NODE_ENV === 'production') {
    if (process.env.ENABLE_BILLABLE_MAPS !== 'true') {
      errors.push(
        `❌ INVALID VALUE: ENABLE_BILLABLE_MAPS\n   Must be 'true' in production\n   Current: ${process.env.ENABLE_BILLABLE_MAPS || '(unset)'}`
      );
    }

    if (isPlaceholderMapsKey(process.env.MAPS_API_KEY)) {
      errors.push(
        '❌ INVALID VALUE: MAPS_API_KEY\n   Must be a real server-side Google Maps key in production\n   Current: placeholder or missing key'
      );
    }
  }

  // Print results
  if (valid.length > 0) {
    console.log('✅ Valid Environment Variables:');
    valid.forEach((v) => console.log(`   ${v}`));
    console.log('');
  }

  if (warnings.length > 0) {
    console.log('⚠️  Warnings:');
    warnings.forEach((w) => console.log(`   ${w}\n`));
  }

  if (errors.length > 0) {
    console.error('❌ VALIDATION FAILED:\n');
    errors.forEach((e) => console.error(`   ${e}\n`));
    console.error('\n💡 Tip: Copy .env.example to .env and fill in the values\n');
    process.exit(1);
  }

  console.log('✅ Environment validation passed!\n');

  // Production-specific checks
  if (process.env.NODE_ENV === 'production') {
    console.log('🔒 Production Environment Checks:');

    const productionChecks: string[] = [];

    if (process.env.JWT_SECRET === 'your-secret-key-change-in-production') {
      productionChecks.push('❌ JWT_SECRET is using default value - CHANGE THIS!');
    }

    if (process.env.FRONTEND_URL?.includes('localhost')) {
      productionChecks.push('⚠️  FRONTEND_URL contains "localhost" - is this correct for production?');
    }

    if (!process.env.REDIS_URL) {
      productionChecks.push('⚠️  REDIS_URL not set - caching will be disabled (performance impact)');
    }

    if (productionChecks.length > 0) {
      console.log('');
      productionChecks.forEach((check) => console.log(`   ${check}`));
      console.log('');
    } else {
      console.log('   All production checks passed!\n');
    }
  }

  console.log('🚀 Ready for deployment!\n');
}

// Run validation
try {
  checkEnvironmentVariables();
} catch (error) {
  console.error('❌ Unexpected error during validation:', error);
  process.exit(1);
}
