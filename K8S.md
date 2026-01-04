# Kubernetes Deployment Guide

This guide covers deploying Droppr to Kubernetes using either raw manifests or Helm charts.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start with Helm](#quick-start-with-helm)
- [Manual Deployment with Manifests](#manual-deployment-with-manifests)
- [Configuration](#configuration)
- [Storage Requirements](#storage-requirements)
- [Scaling](#scaling)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Kubernetes cluster (1.23+)
- kubectl configured to access your cluster
- Helm 3.8+ (for Helm deployment)
- Storage classes configured:
  - `nfs-client` or similar ReadWriteMany storage for media and cache
  - `standard` or similar ReadWriteOnce storage for databases
- Container registry access (GitHub Container Registry)

## Quick Start with Helm

### 1. Install Helm Chart

```bash
# Add the Droppr Helm repository (if hosted)
# helm repo add droppr https://your-org.github.io/droppr-helm
# helm repo update

# Or install from local chart
cd helm/droppr

# Install with default values
helm install droppr . --namespace droppr --create-namespace

# Or install with custom values
helm install droppr . \
  --namespace droppr \
  --create-namespace \
  --values custom-values.yaml
```

### 2. Generate Secure Secrets

**IMPORTANT**: Before deploying to production, generate secure secrets:

```bash
# Generate auth secret
AUTH_SECRET=$(openssl rand -base64 32)

# Generate internal signing key
SIGNING_KEY=$(openssl rand -base64 32)

# Install with secrets
helm install droppr . \
  --namespace droppr \
  --create-namespace \
  --set secrets.authSecret="$AUTH_SECRET" \
  --set secrets.internalSigningKey="$SIGNING_KEY"
```

### 3. Configure Container Images

Update `values.yaml` or use `--set` flags to point to your container registry:

```bash
helm install droppr . \
  --namespace droppr \
  --set mediaServer.image.repository=ghcr.io/your-org/droppr-media-server \
  --set mediaServer.image.tag=v1.10.0 \
  --set nginx.image.repository=ghcr.io/your-org/droppr-nginx \
  --set nginx.image.tag=v1.10.0
```

### 4. Access the Application

```bash
# Get the service URL
kubectl get svc droppr-nginx -n droppr

# For LoadBalancer service:
export SERVICE_IP=$(kubectl get svc droppr-nginx -n droppr -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "Droppr available at: http://$SERVICE_IP"

# For port-forwarding (development):
kubectl port-forward svc/droppr-nginx -n droppr 8080:80
# Access at http://localhost:8080
```

## Manual Deployment with Manifests

If you prefer raw Kubernetes manifests over Helm:

### 1. Update Configuration

Edit `k8s/configmap.yaml` and `k8s/secret.yaml` with your values:

```bash
cd k8s

# Generate secrets
export AUTH_SECRET=$(openssl rand -base64 32)
export SIGNING_KEY=$(openssl rand -base64 32)

# Update secret.yaml with generated values
sed -i "s/REPLACE_WITH_RANDOM_SECRET/$AUTH_SECRET/g" secret.yaml
sed -i "s/REPLACE_WITH_SIGNING_KEY/$SIGNING_KEY/g" secret.yaml
```

### 2. Apply Manifests

```bash
# Create namespace
kubectl apply -f namespace.yaml

# Create storage
kubectl apply -f persistentvolume.yaml

# Create configuration
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml

# Deploy services
kubectl apply -f redis-deployment.yaml
kubectl apply -f filebrowser-deployment.yaml
kubectl apply -f media-server-deployment.yaml
kubectl apply -f celery-worker-deployment.yaml
kubectl apply -f nginx-deployment.yaml

# Create autoscaling
kubectl apply -f hpa.yaml
```

### 3. Verify Deployment

```bash
# Check pod status
kubectl get pods -n droppr

# Check services
kubectl get svc -n droppr

# View logs
kubectl logs -f -n droppr deployment/media-server
```

## Configuration

### Environment Variables

All configuration is managed through ConfigMaps and Secrets. Key settings:

**ConfigMap** (`configmap.yaml`):
- `DROPPR_UPLOAD_MAX_SIZE_MB`: Maximum upload size (default: 500)
- `DROPPR_REDIS_URL`: Redis connection URL
- `CELERY_BROKER_URL`: Celery broker URL
- `DROPPR_LOG_LEVEL`: Logging level (INFO, DEBUG, WARNING, ERROR)
- `DROPPR_ANALYTICS_ENABLED`: Enable analytics (true/false)
- `DROPPR_OTEL_ENABLED`: Enable OpenTelemetry tracing

**Secrets** (`secret.yaml`):
- `DROPPR_AUTH_SECRET`: JWT signing secret (required)
- `DROPPR_INTERNAL_SIGNING_KEY`: Internal API signing key
- `DROPPR_ADMIN_TOTP_SECRET`: Admin 2FA secret
- `DROPPR_CAPTCHA_SITE_KEY`: reCAPTCHA site key
- `DROPPR_CAPTCHA_SECRET_KEY`: reCAPTCHA secret key
- `SENTRY_DSN`: Sentry error tracking DSN
- R2 credentials (if using Cloudflare R2)

### Helm Values

Key `values.yaml` settings:

```yaml
# Replica counts
mediaServer.replicaCount: 3
nginx.replicaCount: 3
celeryWorker.replicaCount: 2

# Resource limits
mediaServer.resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "2000m"

# Autoscaling
mediaServer.autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

# Storage
persistence:
  media:
    size: 500Gi
    storageClass: "nfs-client"
  cache:
    size: 100Gi
    storageClass: "nfs-client"
```

## Storage Requirements

Droppr requires three types of persistent storage:

### 1. Media Storage (ReadWriteMany)

Stores uploaded files, shared across all pods.

**Requirements:**
- Access mode: `ReadWriteMany` (required)
- Size: 500Gi+ (adjust based on usage)
- Storage class: NFS, GlusterFS, CephFS, or cloud provider RWX storage

**Example NFS StorageClass:**

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-client
provisioner: nfs-storage
parameters:
  archiveOnDelete: "false"
```

### 2. Cache Storage (ReadWriteMany)

Stores thumbnails and proxy files.

**Requirements:**
- Access mode: `ReadWriteMany` (required)
- Size: 100Gi+ (adjust based on media volume)
- Storage class: Same as media storage

### 3. Redis Persistence (ReadWriteOnce)

Stores Redis data for persistence.

**Requirements:**
- Access mode: `ReadWriteOnce`
- Size: 10Gi
- Storage class: Standard block storage

### Verify Storage Classes

```bash
# List available storage classes
kubectl get storageclass

# Check PVC status
kubectl get pvc -n droppr

# Describe PVC for troubleshooting
kubectl describe pvc droppr-media-pvc -n droppr
```

## Scaling

### Horizontal Pod Autoscaler (HPA)

HPA automatically scales pods based on CPU/memory usage:

```yaml
# Media Server HPA
spec:
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        averageUtilization: 80
```

**View HPA Status:**

```bash
kubectl get hpa -n droppr
kubectl describe hpa media-server-hpa -n droppr
```

### Manual Scaling

Scale deployments manually if needed:

```bash
# Scale media server
kubectl scale deployment media-server -n droppr --replicas=5

# Scale Celery workers
kubectl scale deployment celery-worker -n droppr --replicas=4

# Scale nginx
kubectl scale deployment nginx -n droppr --replicas=5
```

### Resource Requests and Limits

Adjust resource limits in `values.yaml`:

```yaml
mediaServer:
  resources:
    requests:
      memory: "512Mi"  # Guaranteed memory
      cpu: "500m"      # Guaranteed CPU (0.5 cores)
    limits:
      memory: "2Gi"    # Maximum memory
      cpu: "2000m"     # Maximum CPU (2 cores)
```

## Monitoring

### Prometheus Metrics

Media server exposes Prometheus metrics at `/metrics`:

```bash
# Port-forward to access metrics
kubectl port-forward svc/media-server-service -n droppr 5000:5000

# Access metrics at http://localhost:5000/metrics
curl http://localhost:5000/metrics
```

### ServiceMonitor (Prometheus Operator)

Enable ServiceMonitor in `values.yaml`:

```yaml
monitoring:
  enabled: true
  serviceMonitor:
    enabled: true
    interval: 30s
    scrapeTimeout: 10s
```

### Health Checks

All services have liveness and readiness probes:

```bash
# Check pod health
kubectl get pods -n droppr

# View pod events
kubectl describe pod <pod-name> -n droppr

# Test health endpoint
kubectl exec -it <media-server-pod> -n droppr -- curl localhost:5000/health
```

### Logs

View application logs:

```bash
# All media server logs
kubectl logs -f -n droppr -l app.kubernetes.io/component=media-server

# Specific pod
kubectl logs -f -n droppr <pod-name>

# Previous pod instance (after crash)
kubectl logs -n droppr <pod-name> --previous

# Celery worker logs
kubectl logs -f -n droppr -l app.kubernetes.io/component=celery-worker

# Nginx logs
kubectl logs -f -n droppr -l app.kubernetes.io/component=nginx
```

## Ingress

### Enable Ingress

Update `values.yaml`:

```yaml
ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/proxy-body-size: "1g"
  hosts:
    - host: dropbox.lucheestiy.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: droppr-tls
      hosts:
        - dropbox.lucheestiy.com
```

### Install Ingress Controller

If not already installed:

```bash
# Install nginx-ingress
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace

# Install cert-manager (for TLS)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl get pods -n droppr

# Describe pod for events
kubectl describe pod <pod-name> -n droppr

# Check logs
kubectl logs <pod-name> -n droppr
```

Common issues:
- **ImagePullBackOff**: Update image repository/tag in values.yaml
- **CrashLoopBackOff**: Check logs for application errors
- **Pending**: Check PVC binding and resource availability

### Storage Issues

```bash
# Check PVC status
kubectl get pvc -n droppr

# Describe PVC
kubectl describe pvc droppr-media-pvc -n droppr

# Check storage class
kubectl get storageclass
```

Common issues:
- **Pending PVC**: Storage class not available or misconfigured
- **ReadWriteMany not supported**: Use NFS or compatible storage
- **No default storage class**: Specify storageClass in values.yaml

### Service Connection Issues

```bash
# Check services
kubectl get svc -n droppr

# Check endpoints
kubectl get endpoints -n droppr

# Test service connectivity from pod
kubectl exec -it <pod-name> -n droppr -- curl http://redis-service:6379
```

### Database Migration

Run database migrations:

```bash
# Execute in media server pod
kubectl exec -it deployment/media-server -n droppr -- flask db upgrade

# Or manually
kubectl exec -it <media-server-pod> -n droppr -- /bin/bash
cd /app
flask db upgrade
```

### Redis Connection Issues

```bash
# Test Redis connectivity
kubectl exec -it deployment/media-server -n droppr -- redis-cli -h redis-service ping

# Check Redis logs
kubectl logs -f deployment/redis -n droppr

# Verify Redis service
kubectl get svc redis-service -n droppr
```

### Resource Exhaustion

```bash
# Check resource usage
kubectl top nodes
kubectl top pods -n droppr

# Check HPA status
kubectl get hpa -n droppr

# Scale up manually if needed
kubectl scale deployment media-server -n droppr --replicas=5
```

## Upgrading

### Helm Upgrade

```bash
# Update chart
helm upgrade droppr . \
  --namespace droppr \
  --reuse-values

# Or with new values
helm upgrade droppr . \
  --namespace droppr \
  --values custom-values.yaml

# Rollback if needed
helm rollback droppr -n droppr
```

### Manual Upgrade

```bash
# Update images in manifests
kubectl set image deployment/media-server \
  media-server=ghcr.io/your-org/droppr-media-server:v1.11.0 \
  -n droppr

# Apply updated manifests
kubectl apply -f k8s/
```

## Backup and Restore

### Backup Media Files

```bash
# Create backup pod
kubectl run backup -n droppr --image=busybox --rm -it --restart=Never \
  --overrides='
  {
    "spec": {
      "containers": [{
        "name": "backup",
        "image": "busybox",
        "command": ["sleep", "3600"],
        "volumeMounts": [{
          "name": "media",
          "mountPath": "/media"
        }]
      }],
      "volumes": [{
        "name": "media",
        "persistentVolumeClaim": {
          "claimName": "droppr-media-pvc"
        }
      }]
    }
  }'

# Copy files from pod
kubectl cp droppr/backup:/media ./backup-media
```

### Backup Redis Data

```bash
# Trigger Redis save
kubectl exec -it deployment/redis -n droppr -- redis-cli SAVE

# Copy RDB file
kubectl cp droppr/<redis-pod>:/data/dump.rdb ./redis-backup.rdb
```

## Production Checklist

Before deploying to production:

- [ ] Update all secrets (AUTH_SECRET, SIGNING_KEY, etc.)
- [ ] Configure TLS/SSL certificates via Ingress
- [ ] Set up proper storage classes with backups
- [ ] Configure resource limits appropriately
- [ ] Enable monitoring and alerting
- [ ] Set up log aggregation (ELK, Loki, etc.)
- [ ] Configure network policies for security
- [ ] Test disaster recovery procedures
- [ ] Set up automated backups
- [ ] Configure CAPTCHA keys
- [ ] Enable Sentry error tracking
- [ ] Review and adjust HPA thresholds
- [ ] Test upgrade/rollback procedures

## Additional Resources

- [Helm Chart Documentation](helm/droppr/README.md)
- [API Documentation](API_CHANGELOG.md)
- [CI/CD Guide](CICD.md)
- [Improvement Plan](IMPROVEMENT_PLAN.md)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
