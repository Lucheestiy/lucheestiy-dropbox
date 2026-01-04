{{/*
Expand the name of the chart.
*/}}
{{- define "droppr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "droppr.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "droppr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "droppr.labels" -}}
helm.sh/chart: {{ include "droppr.chart" . }}
{{ include "droppr.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "droppr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "droppr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "droppr.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "droppr.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Media Server labels
*/}}
{{- define "droppr.mediaServer.labels" -}}
{{ include "droppr.labels" . }}
app.kubernetes.io/component: media-server
{{- end }}

{{/*
Nginx labels
*/}}
{{- define "droppr.nginx.labels" -}}
{{ include "droppr.labels" . }}
app.kubernetes.io/component: nginx
{{- end }}

{{/*
Celery Worker labels
*/}}
{{- define "droppr.celeryWorker.labels" -}}
{{ include "droppr.labels" . }}
app.kubernetes.io/component: celery-worker
{{- end }}

{{/*
Redis labels
*/}}
{{- define "droppr.redis.labels" -}}
{{ include "droppr.labels" . }}
app.kubernetes.io/component: redis
{{- end }}

{{/*
FileBrowser labels
*/}}
{{- define "droppr.filebrowser.labels" -}}
{{ include "droppr.labels" . }}
app.kubernetes.io/component: filebrowser
{{- end }}
