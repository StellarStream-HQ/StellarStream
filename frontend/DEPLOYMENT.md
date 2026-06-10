# StellarStream Frontend Deployment Guide

Production-ready deployment guide for StellarStream frontend on Vercel.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Environment Setup](#environment-setup)
- [Building for Production](#building-for-production)
- [Deploying to Vercel](#deploying-to-vercel)
- [Post-Deployment Verification](#post-deployment-verification)
- [Monitoring & Observability](#monitoring--observability)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

- Node.js 18+ (latest LTS recommended)
- npm 9+ or yarn 3+
- Git
- Vercel CLI (optional but recommended)

### Accounts Required

- Vercel account with access to the project
- GitHub/GitLab account (for repository access)
- Stellar network account (testnet or mainnet)

---

## Pre-Deployment Checklist

### Code Quality

- [ ] All TypeScript errors resolved (`npm run lint`)
- [ ] No console.log statements in production code (except errors/warnings)
- [ ] All tests passing (`npm run test`)
- [ ] No hardcoded API URLs or secrets
- [ ] All dependencies up to date

### Configuration

- [ ] Environment variables defined in Vercel dashboard
- [ ] .env.example updated with all required variables
- [ ] vercel.json properly configured
- [ ] next.config.ts optimized for production
- [ ] Security headers configured in headers()

### Performance

- [ ] Bundle size checked and optimized
- [ ] Images optimized with next/image
- [ ] Lazy loading implemented for heavy components
- [ ] CSS minimized and deduplicated
- [ ] Dead code removed

### Security

- [ ] No sensitive data in code or environment files
- [ ] CORS properly configured
- [ ] Security headers enabled
- [ ] Content Security Policy configured
- [ ] SQL injection protections in place (if applicable)

---

## Environment Setup

### 1. Create Environment Variables

Create a `.env.production` file locally (never commit this):

```bash
NEXT_PUBLIC_API_URL=https://api.stellarstream.app
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_CDN_URL=https://cdn.stellarstream.app
```

### 2. Configure Vercel Environment Variables

In Vercel dashboard:

1. Go to Settings → Environment Variables
2. Add all public variables (NEXT_PUBLIC_*)
3. Add all private variables (hidden from client)
4. Set different values for each environment (Production, Preview, Development)

```
Production:
- NEXT_PUBLIC_API_URL=https://api.stellarstream.app
- NEXT_PUBLIC_STELLAR_NETWORK=mainnet

Preview:
- NEXT_PUBLIC_API_URL=https://api-preview.stellarstream.app
- NEXT_PUBLIC_STELLAR_NETWORK=testnet

Development:
- NEXT_PUBLIC_API_URL=http://localhost:3000
- NEXT_PUBLIC_STELLAR_NETWORK=testnet
```

---

## Building for Production

### Local Build

```bash
# Install dependencies
npm ci

# Build for production
npm run build

# Verify build output
ls -la .next/
```

### Build Output Structure

```
.next/
├── standalone/          # Standalone server files
├── static/              # Static assets (CSS, JS)
├── cache/               # Build cache
└── telemetry.json       # Build telemetry
```

### Performance Checks

```bash
# Check bundle size
npm run build -- --analyze

# View build information
cat .next/build-manifest.json | jq '.pages' | head -20
```

---

## Deploying to Vercel

### Option 1: Automatic Deployment (Recommended)

Connect your GitHub repository to Vercel:

1. Visit [https://vercel.com/new](https://vercel.com/new)
2. Select your repository
3. Configure build settings:
   - **Framework**: Next.js
   - **Build Command**: npm run build
   - **Output Directory**: .next
   - **Environment Variables**: Add all required variables
4. Click "Deploy"

### Option 2: Manual Deployment with Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to production
vercel --prod

# Deploy to preview (staging)
vercel
```

### Option 3: Git Push

Push to your main branch to automatically deploy:

```bash
git add .
git commit -m "Production release v1.0"
git push origin main
```

---

## Post-Deployment Verification

### 1. Verify Deployment

```bash
# Check deployment status
vercel --list

# View deployment logs
vercel logs --prod
```

### 2. Health Checks

- [ ] Application loads without errors (check browser console)
- [ ] All pages accessible and render correctly
- [ ] API calls working (check Network tab)
- [ ] Assets loading from CDN
- [ ] Wallet connection functional
- [ ] User authentication working

### 3. Performance Checks

Use Lighthouse:

```bash
# Install Lighthouse CLI
npm install -g lighthouse

# Run audit
lighthouse https://stellarstream.app --view

# Target scores:
# - Performance: > 80
# - Accessibility: > 95
# - Best Practices: > 90
# - SEO: > 90
```

### 4. Security Validation

- [ ] HTTPS enforced
- [ ] Security headers present:
  - X-Content-Type-Options
  - X-Frame-Options
  - X-XSS-Protection
  - Referrer-Policy
- [ ] No console errors related to security
- [ ] CSP headers configured

Use https://securityheaders.com for validation.

---

## Monitoring & Observability

### Enable Sentry Error Tracking

1. Create Sentry project at [https://sentry.io](https://sentry.io)
2. Set environment variable:
   ```
   NEXT_PUBLIC_SENTRY_DSN=https://YOUR_KEY@sentry.io/PROJECT_ID
   ```
3. Configure in your app:
   ```typescript
   import * as Sentry from "@sentry/nextjs";

   Sentry.init({
     dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
     environment: process.env.NODE_ENV,
   });
   ```

### Enable Vercel Analytics

In your `app/layout.tsx`:

```typescript
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

### Monitor Key Metrics

- Page load time (Core Web Vitals)
- Error rate
- API response times
- Resource usage (CPU, memory)
- Traffic patterns

---

## Rollback Procedure

### Revert to Previous Deployment

```bash
# View deployment history
vercel --list

# Promote previous deployment to production
vercel promote <deployment-url>

# Or revert via Vercel dashboard:
# Settings → Deployments → Select version → Promote to Production
```

### Emergency Rollback

1. Go to Vercel dashboard
2. Navigate to Deployments
3. Find stable previous version
4. Click "Promote to Production"
5. Notify team of rollback

---

## Troubleshooting

### Build Fails

**Error**: "Module not found"
```bash
# Solution: Clear cache and reinstall
rm -rf node_modules .next
npm ci
npm run build
```

**Error**: "TypeScript compilation errors"
```bash
# Check errors locally
npm run lint
# Fix errors before deployment
```

### Deployment Hangs

```bash
# Check build logs
vercel logs --prod

# If stuck, cancel deployment
vercel remove <deployment-url>

# Redeploy with clean cache
vercel --prod --force
```

### Environment Variables Not Working

- [ ] Variable is defined in Vercel dashboard
- [ ] Variable name matches code exactly
- [ ] Public variables prefixed with `NEXT_PUBLIC_`
- [ ] Redeploy after adding/changing variables

### Performance Issues

1. Check Vercel Analytics dashboard
2. Profile using Chrome DevTools
3. Check bundle size: `npm run build -- --analyze`
4. Enable image optimization
5. Implement code splitting

### CORS Errors

```typescript
// Add CORS headers in next.config.ts
async headers() {
  return [{
    source: '/api/:path*',
    headers: [
      { key: 'Access-Control-Allow-Origin', value: process.env.VERCEL_URL },
    ]
  }];
}
```

---

## Monitoring Checklist

After deployment, monitor for 24-48 hours:

- [ ] Error rates normal
- [ ] No spike in API latency
- [ ] Core Web Vitals good
- [ ] User feedback positive
- [ ] Support tickets minimal
- [ ] Database queries performing normally
- [ ] Cache hit rates optimal

---

## Best Practices

### Deployment Frequency

- Small changes: Deploy to preview first
- Larger features: Use feature flags
- Critical fixes: Hotfix procedure to production
- Regular releases: Weekly or bi-weekly cycle

### Release Notes

Always create release notes:

```markdown
## v1.0.0 - Production Release

### Features
- New dashboard interface
- Improved stream creation flow

### Bug Fixes
- Fixed wallet connection timeout
- Resolved data sync issue

### Performance
- 40% reduction in bundle size
- 25% improvement in load time
```

### Maintenance Windows

Plan maintenance with team:

- Schedule during low-traffic hours
- Notify users in advance
- Have rollback plan ready
- Monitor closely during and after

---

## Support & Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment/vercel)
- [Stellar Documentation](https://developers.stellar.org)
- [Soroban SDK](https://developers.stellar.org/docs/smart-contracts)

---

**Last Updated**: 2024
**Version**: 1.0
