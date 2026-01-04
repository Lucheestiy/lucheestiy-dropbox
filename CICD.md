# CI/CD Documentation

This document describes the continuous integration and deployment workflows for the Droppr file sharing application.

## Overview

The project uses GitHub Actions for automated testing, security scanning, building, and deployment. There are three main workflows:

1. **CI Workflow** (`ci.yml`) - Runs tests and security scans on every push and pull request
2. **Docker Build Workflow** (`docker-build.yml`) - Builds and pushes Docker images to GitHub Container Registry
3. **Deploy Workflow** (`deploy.yml`) - Deploys the application to production or staging environments

## Workflows

### 1. CI Workflow

**Triggers:** Push to any branch, pull requests

**Jobs:**
- `backend-lint`: Runs Ruff and Mypy on Python code
- `backend-tests`: Runs pytest with coverage reporting
- `frontend-lint`: Runs ESLint on TypeScript/JavaScript code
- `frontend-tests`: Runs Vitest unit tests and Playwright E2E tests
- `security-scan`: Runs Trivy security scans on filesystem and Docker images

**Configuration:**
- Python version: 3.11
- Node.js version: 22
- Security scan severity: CRITICAL and HIGH only

### 2. Docker Build Workflow

**Triggers:**
- Push to master/main branch
- Tags matching `v*` pattern
- Pull requests to master/main

**Features:**
- Multi-architecture builds (linux/amd64, linux/arm64)
- Automatic image tagging based on branch, PR, version, and commit SHA
- Push to GitHub Container Registry (ghcr.io)
- Build caching using GitHub Actions cache

**Images Built:**
- `ghcr.io/<owner>/droppr-media-server`
- `ghcr.io/<owner>/droppr-app`
- `ghcr.io/<owner>/droppr-nginx`

**Tag Formats:**
- Branch: `master`, `main`
- PR: `pr-123`
- Version: `v1.2.3`, `1.2`, `1`
- Commit: `master-abc1234`
- Latest: `latest` (for master/main only)

### 3. Deploy Workflow

**Triggers:**
- Manual trigger (workflow_dispatch)
- Push to master/main branch (production)

**Environments:**
- **Production**: Automatically deploys on push to master/main
- **Staging**: Manual deployment via workflow_dispatch

**Features:**
- SSH-based deployment to remote servers
- Automated health checks after deployment
- Automatic rollback on failure
- Optional Slack notifications

**Deployment Steps:**
1. Pull latest code from repository
2. Build Docker images
3. Stop existing services
4. Start new services
5. Clean up old Docker images
6. Verify deployment
7. Run health checks
8. Rollback on failure (if needed)

## Setup Instructions

### Required Secrets

Configure these secrets in your GitHub repository settings:

#### Production Deployment
- `DEPLOY_SSH_KEY`: SSH private key for production server access
- `DEPLOY_HOST`: Production server hostname or IP
- `DEPLOY_USER`: SSH username for production server
- `DEPLOY_PATH`: Path to application directory on production server

#### Staging Deployment (Optional)
- `STAGING_SSH_KEY`: SSH private key for staging server access
- `STAGING_HOST`: Staging server hostname or IP
- `STAGING_USER`: SSH username for staging server
- `STAGING_PATH`: Path to application directory on staging server

#### Notifications (Optional)
- `SLACK_WEBHOOK`: Slack webhook URL for deployment notifications

### Server Requirements

Your deployment servers must have:
- Git installed
- Docker and Docker Compose installed
- SSH access configured
- Application repository cloned at `DEPLOY_PATH` or `STAGING_PATH`
- Proper permissions for the deployment user

### SSH Key Setup

1. Generate an SSH key pair:
   ```bash
   ssh-keygen -t ed25519 -C "github-deploy" -f deploy_key
   ```

2. Add the public key to your server's `~/.ssh/authorized_keys`:
   ```bash
   ssh-copy-id -i deploy_key.pub user@server
   ```

3. Add the private key to GitHub secrets:
   - Go to repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `DEPLOY_SSH_KEY`
   - Value: Contents of `deploy_key` file

### Environment Configuration

Create GitHub environments for production and staging:

1. Go to repository Settings → Environments
2. Create "production" environment
   - Add protection rules (e.g., required reviewers)
   - Set environment URL: `https://dropbox.lucheestiy.com`
3. Create "staging" environment (optional)
   - Set environment URL: `https://staging.dropbox.lucheestiy.com`

## Usage

### Running Tests Locally

Before pushing code, run tests locally:

```bash
# Backend tests
cd media-server
pytest -v --cov=app

# Frontend tests
cd nginx
npm test
npm run test:e2e
```

### Deploying to Production

Production deployment happens automatically when you push to master/main:

```bash
git checkout master
git pull origin master
git merge feature-branch
git push origin master
```

The workflow will:
1. Run all CI checks
2. Build Docker images
3. Deploy to production
4. Run health checks
5. Notify on Slack (if configured)

### Deploying to Staging

Manually trigger a staging deployment:

1. Go to Actions tab in GitHub
2. Select "Deploy" workflow
3. Click "Run workflow"
4. Select branch to deploy
5. Click "Run workflow" button

### Rolling Back

If deployment fails, the workflow automatically rolls back to the previous version. To manually roll back:

```bash
ssh user@server
cd /path/to/app
git reset --hard HEAD~1
docker compose down
docker compose up -d
```

## Monitoring Deployments

### Health Checks

The deployment workflow includes automated health checks that:
- Wait 10 seconds for services to start
- Poll the `/health` endpoint every 5 seconds
- Try up to 30 times (2.5 minutes total)
- Trigger rollback if health check fails

### Viewing Logs

Check deployment logs in GitHub Actions:
1. Go to Actions tab
2. Click on the workflow run
3. Click on the job name
4. Expand log sections

SSH into the server to view application logs:
```bash
ssh user@server
cd /path/to/app
docker compose logs -f media-server
docker compose logs -f nginx
```

### Grafana Dashboards

Monitor application health and errors using Grafana dashboards:
- Main Dashboard: `media-server/grafana_dashboard.json`
- Error Monitoring: `media-server/grafana_error_monitoring_dashboard.json`

Import these dashboards into your Grafana instance to monitor:
- Request rates and latency
- Error rates by status code
- Media processing performance
- Cache hit ratios
- Database and cache errors
- Recent error logs

## Troubleshooting

### Deployment Fails with Permission Denied

Check SSH key permissions and server access:
```bash
ssh -i deploy_key user@server "ls -la /path/to/app"
```

Ensure the deployment user has permissions:
```bash
sudo chown -R deploy-user:deploy-user /path/to/app
```

### Docker Build Fails

Check available disk space:
```bash
ssh user@server "df -h"
docker system prune -a
```

### Health Check Fails

Check application logs:
```bash
docker compose logs media-server
docker compose ps
curl -v http://localhost/health
```

Verify environment variables:
```bash
docker compose config
```

### Tests Fail in CI

Run tests locally with the same configuration:
```bash
# Use same Python version
python --version  # Should be 3.11

# Use same Node version
node --version  # Should be 22

# Install exact dependencies
pip install -r requirements.txt -r requirements-dev.txt
npm ci
```

## Best Practices

1. **Always run tests locally** before pushing
2. **Use feature branches** and pull requests for code review
3. **Test in staging** before deploying to production
4. **Monitor deployments** using Grafana dashboards
5. **Set up Slack notifications** for deployment status
6. **Keep secrets secure** and rotate them regularly
7. **Review security scan results** and fix vulnerabilities
8. **Tag releases** with semantic versioning (v1.2.3)
9. **Document breaking changes** in commit messages
10. **Test rollback procedure** periodically

## Maintenance

### Updating Workflow Dependencies

Regularly update GitHub Actions:
```yaml
- uses: actions/checkout@v4  # Check for v5
- uses: actions/setup-python@v5  # Check for v6
```

### Cleaning Up Old Images

The deployment workflow automatically prunes old Docker images. To manually clean up:
```bash
ssh user@server
docker image prune -a -f
docker volume prune -f
```

### Rotating SSH Keys

1. Generate new SSH key pair
2. Add new public key to server
3. Update GitHub secret with new private key
4. Test deployment
5. Remove old public key from server

## Security Considerations

- **Never commit secrets** to the repository
- **Use environment-specific secrets** for production and staging
- **Enable branch protection** for master/main
- **Require pull request reviews** before merging
- **Enable security scanning** and fix vulnerabilities promptly
- **Use least privilege** for deployment SSH keys
- **Audit deployment logs** regularly
- **Keep dependencies updated** to patch security issues

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Trivy Security Scanner](https://github.com/aquasecurity/trivy)
- [Prometheus Monitoring](https://prometheus.io/docs/)
- [Grafana Dashboards](https://grafana.com/docs/)
