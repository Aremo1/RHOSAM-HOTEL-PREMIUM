# GitHub Environments Setup

This document explains how to configure GitHub environments for deployment protection.

## Required Environments

### 1. Staging Environment

**Purpose:** Test deployments before production

**Setup Steps:**
1. Go to your repo → Settings → Environments
2. Click "New environment"
3. Name: `staging`
4. Configure:
   - ✅ Required reviewers: Add yourself
   - ✅ Wait timer: 0 minutes (auto-deploy)
   - ✅ Branches: `main` only

**Environment Variables:**
```
STAGING_API_URL=https://rhosam-hotel-staging.onrender.com
STAGING_DATABASE_URL=postgresql://...staging-db...
STAGING_JWT_SECRET=staging-secret-key
```

### 2. Production Environment

**Purpose:** Production deployments with approval gate

**Setup Steps:**
1. Go to your repo → Settings → Environments
2. Click "New environment"
3. Name: `production`
4. Configure:
   - ✅ Required reviewers: Add yourself (or team)
   - ✅ Wait timer: 5 minutes (optional)
   - ✅ Branches: `main` only
   - ✅ Deployment branches: Selected branches → `main`

**Environment Variables:**
```
API_URL=https://rhosam-hotel-api.onrender.com
DATABASE_URL=postgresql://...production-db...
JWT_SECRET=your-production-secret
PAYMENT_GATEWAY=PAYSTACK
PAYSTACK_SECRET_KEY=sk_live_xxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
```

## How It Works

```
Push to main
    ↓
┌─────────────────┐
│ Pre-deploy Check│ ← Security audit, change detection
└────────┬────────┘
         ↓
┌─────────────────┐
│ Staging Deploy  │ ← Auto-deploys to staging
└────────┬────────┘
         ↓
┌─────────────────┐
│ Manual Approval │ ← You approve production deploy
└────────┬────────┘
         ↓
┌─────────────────┐
│ Production      │ ← Deploys to production
└────────┬────────┘
         ↓
┌─────────────────┐
│ Notification    │ ← Success/failure notification
└─────────────────┘
```

## Quick Setup Command

Run this in your terminal to set up environments via GitHub CLI:

```bash
# Create staging environment
gh api repos/Aremo1/RHOSAM-HOTEL-PREMIUM/environments/staging \
  -X PUT \
  -f 'protected_branches=true' \
  -f 'prevent_self_review=true'

# Create production environment with reviewers
gh api repos/Aremo1/RHOSAM-HOTEL-PREMIUM/environments/production \
  -X PUT \
  -f 'protected_branches=true' \
  -f 'prevent_self_review=true' \
  -f 'wait_timer=300'
```

## Security Best Practices

1. **Never commit secrets** — Use GitHub Secrets for all sensitive values
2. **Require reviews** — At least 1 reviewer for production
3. **Branch protection** — Only `main` branch can deploy
4. **Audit logs** — Check deployment history regularly
5. **Rotate secrets** — Change keys periodically

## Troubleshooting

### Deployment stuck waiting for approval
- Go to Actions → Select the workflow run
- Click "Review deployments"
- Approve or reject

### Environment variables not available
- Check Settings → Environments → [environment name]
- Verify variables are set correctly
- Ensure variable names match workflow file

### Health check failing
- Verify `/api/health` endpoint is accessible
- Check database connection in Render dashboard
- Review backend logs for errors
