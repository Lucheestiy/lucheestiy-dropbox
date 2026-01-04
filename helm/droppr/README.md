# Droppr Helm Chart

Official Helm chart for deploying Droppr file sharing application to Kubernetes.

## Introduction

This chart bootstraps a Droppr deployment on a Kubernetes cluster using the Helm package manager. It includes:

- Media server (Flask application)
- Nginx frontend
- Celery workers for background tasks
- Redis for caching and task queue
- FileBrowser for file management
- Horizontal Pod Autoscaling (HPA)
- Persistent storage for media, cache, and database
- Prometheus metrics integration

## Prerequisites

- Kubernetes 1.23+
- Helm 3.8+
- ReadWriteMany storage class (NFS, CephFS, GlusterFS, or cloud provider equivalent)
- Container registry access

## Installation

### Quick Start

```bash
# Install with default values
helm install droppr . --namespace droppr --create-namespace

# Install with custom values
helm install droppr . \
  --namespace droppr \
  --create-namespace \
  --values custom-values.yaml
```

### Generate Secure Secrets

**CRITICAL**: Generate secure secrets before production deployment:

```bash
# Generate secrets
AUTH_SECRET=$(openssl rand -base64 32)
SIGNING_KEY=$(openssl rand -base64 32)

# Install with secrets
helm install droppr . \
  --namespace droppr \
  --create-namespace \
  --set secrets.authSecret="$AUTH_SECRET" \
  --set secrets.internalSigningKey="$SIGNING_KEY"
```

### Configure Container Images

Update image repositories and tags:

```bash
helm install droppr . \
  --namespace droppr \
  --set mediaServer.image.repository=ghcr.io/your-org/droppr-media-server \
  --set mediaServer.image.tag=v1.10.0 \
  --set nginx.image.repository=ghcr.io/your-org/droppr-nginx \
  --set nginx.image.tag=v1.10.0
```

## Configuration

### Key Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.namespace` | Kubernetes namespace | `droppr` |
| `mediaServer.replicaCount` | Media server replica count | `3` |
| `mediaServer.image.repository` | Media server image | `ghcr.io/your-org/droppr-media-server` |
| `mediaServer.image.tag` | Image tag | `latest` |
| `mediaServer.autoscaling.enabled` | Enable HPA | `true` |
| `mediaServer.autoscaling.minReplicas` | Min replicas | `3` |
| `mediaServer.autoscaling.maxReplicas` | Max replicas | `10` |
| `nginx.service.type` | Service type (LoadBalancer/NodePort/ClusterIP) | `LoadBalancer` |
| `nginx.service.loadBalancerIP` | Static LoadBalancer IP | `""` |
| `persistence.media.size` | Media storage size | `500Gi` |
| `persistence.media.storageClass` | Storage class for media | `nfs-client` |
| `persistence.cache.size` | Cache storage size | `100Gi` |
| `redis.persistence.enabled` | Enable Redis persistence | `true` |
| `redis.persistence.size` | Redis storage size | `10Gi` |
| `ingress.enabled` | Enable Ingress | `false` |
| `ingress.hosts` | Ingress hosts | `[{host: dropbox.lucheestiy.com}]` |
| `secrets.authSecret` | JWT auth secret (required) | `REPLACE_WITH_RANDOM_SECRET` |

### Resource Limits

| Component | CPU Request | Memory Request | CPU Limit | Memory Limit |
|-----------|-------------|----------------|-----------|--------------|
| Media Server | 500m | 512Mi | 2000m | 2Gi |
| Nginx | 100m | 128Mi | 500m | 256Mi |
| Celery Worker | 1000m | 1Gi | 4000m | 4Gi |
| Redis | 100m | 256Mi | 500m | 512Mi |
| FileBrowser | 100m | 128Mi | 500m | 512Mi |

### Storage Classes

This chart requires two types of storage:

1. **ReadWriteMany** (media and cache):
   - NFS
   - CephFS
   - GlusterFS
   - AWS EFS
   - Azure Files
   - Google Filestore

2. **ReadWriteOnce** (Redis):
   - Standard block storage
   - AWS EBS
   - Azure Disk
   - Google Persistent Disk

## Values File Examples

### Minimal Production Configuration

```yaml
secrets:
  authSecret: "your-generated-secret-here"
  internalSigningKey: "your-signing-key-here"

mediaServer:
  image:
    repository: ghcr.io/your-org/droppr-media-server
    tag: v1.10.0

nginx:
  image:
    repository: ghcr.io/your-org/droppr-nginx
    tag: v1.10.0
  service:
    type: LoadBalancer

persistence:
  media:
    size: 500Gi
    storageClass: "nfs-client"
  cache:
    size: 100Gi
    storageClass: "nfs-client"
```

### With Ingress and TLS

```yaml
secrets:
  authSecret: "your-generated-secret-here"

ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/proxy-body-size: "1g"
  hosts:
    - host: dropbox.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: droppr-tls
      hosts:
        - dropbox.example.com

nginx:
  service:
    type: ClusterIP  # Use Ingress instead of LoadBalancer
```

### High Availability Configuration

```yaml
mediaServer:
  replicaCount: 5
  autoscaling:
    enabled: true
    minReplicas: 5
    maxReplicas: 20
    targetCPUUtilizationPercentage: 60

nginx:
  replicaCount: 5
  autoscaling:
    minReplicas: 5
    maxReplicas: 15

celeryWorker:
  replicaCount: 4
  autoscaling:
    minReplicas: 4
    maxReplicas: 12

redis:
  persistence:
    enabled: true
    size: 20Gi
```

### Development Configuration

```yaml
mediaServer:
  replicaCount: 1
  autoscaling:
    enabled: false
  resources:
    requests:
      memory: "256Mi"
      cpu: "250m"
    limits:
      memory: "1Gi"
      cpu: "1000m"

nginx:
  replicaCount: 1
  autoscaling:
    enabled: false
  service:
    type: NodePort

celeryWorker:
  replicaCount: 1
  autoscaling:
    enabled: false

redis:
  persistence:
    enabled: false

persistence:
  media:
    size: 50Gi
  cache:
    size: 10Gi
```

## Upgrading

### Upgrade Release

```bash
# Upgrade with new values
helm upgrade droppr . \
  --namespace droppr \
  --values custom-values.yaml

# Reuse existing values
helm upgrade droppr . \
  --namespace droppr \
  --reuse-values

# Force recreation of pods
helm upgrade droppr . \
  --namespace droppr \
  --reuse-values \
  --force
```

### Rollback

```bash
# View release history
helm history droppr -n droppr

# Rollback to previous revision
helm rollback droppr -n droppr

# Rollback to specific revision
helm rollback droppr 3 -n droppr
```

## Uninstallation

```bash
# Uninstall release
helm uninstall droppr -n droppr

# Delete namespace (WARNING: deletes all data)
kubectl delete namespace droppr
```

**Note**: Persistent volumes may not be automatically deleted. Check and delete manually if needed:

```bash
kubectl get pv
kubectl delete pv <pv-name>
```

## Monitoring

### Prometheus Metrics

Metrics are exposed at `/metrics` on the media server service:

```bash
kubectl port-forward svc/droppr-media-server -n droppr 5000:5000
curl http://localhost:5000/metrics
```

### Enable ServiceMonitor

For Prometheus Operator integration:

```yaml
monitoring:
  enabled: true
  serviceMonitor:
    enabled: true
    interval: 30s
    scrapeTimeout: 10s
```

### Grafana Dashboard

Import the provided Grafana dashboard:

```bash
kubectl create configmap droppr-grafana-dashboard \
  --from-file=grafana_error_monitoring_dashboard.json \
  -n droppr
```

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n droppr
kubectl describe pod <pod-name> -n droppr
kubectl logs -f <pod-name> -n droppr
```

### Check Service Status

```bash
kubectl get svc -n droppr
kubectl get endpoints -n droppr
```

### Check Storage

```bash
kubectl get pvc -n droppr
kubectl describe pvc droppr-media-pvc -n droppr
```

### Common Issues

**Pods in Pending state**:
- Check PVC binding: `kubectl get pvc -n droppr`
- Verify storage class exists: `kubectl get storageclass`
- Check resource availability: `kubectl describe nodes`

**ImagePullBackOff**:
- Verify image repository and tag
- Check imagePullSecrets configuration
- Ensure registry access

**CrashLoopBackOff**:
- Check logs: `kubectl logs <pod-name> -n droppr`
- Verify configuration and secrets
- Check resource limits

## Security

### Secrets Management

Never commit secrets to version control. Use one of:

1. **Generate at install time** (recommended):
   ```bash
   --set secrets.authSecret="$(openssl rand -base64 32)"
   ```

2. **External secrets manager**:
   - AWS Secrets Manager
   - HashiCorp Vault
   - Kubernetes External Secrets Operator

3. **Encrypted values file**:
   ```bash
   helm secrets install droppr . -f secrets.yaml
   ```

### Network Policies

Enable network policies for enhanced security:

```yaml
networkPolicy:
  enabled: true
  policyTypes:
    - Ingress
    - Egress
```

### Pod Security

Pod security contexts are configured by default:

```yaml
podSecurityContext:
  fsGroup: 1000
  runAsUser: 1000
  runAsNonRoot: true

securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: false
```

## Development

### Template Testing

Test template rendering:

```bash
# Dry run
helm install droppr . --dry-run --debug

# Template output
helm template droppr . > output.yaml

# Lint chart
helm lint .
```

### Local Testing

Test with minikube or kind:

```bash
# Start minikube
minikube start

# Install chart
helm install droppr . --namespace droppr --create-namespace

# Access service
minikube service droppr-nginx -n droppr
```

## Support

For issues and questions:

- GitHub Issues: https://github.com/your-org/droppr/issues
- Documentation: See [K8S.md](../../K8S.md) for detailed deployment guide

## License

This chart is part of the Droppr project. See main repository for license information.
