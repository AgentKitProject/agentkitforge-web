{{/*
Chart name.
*/}}
{{- define "agentkitforge-web.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name (release name).
*/}}
{{- define "agentkitforge-web.fullname" -}}
{{- printf "%s" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agentkitforge-web.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "agentkitforge-web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — web
*/}}
{{- define "agentkitforge-web.selectorLabelsWeb" -}}
app.kubernetes.io/name: {{ include "agentkitforge-web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: web
{{- end }}

{{/*
Web ConfigMap name
*/}}
{{- define "agentkitforge-web.webConfigmapName" -}}
{{ include "agentkitforge-web.fullname" . }}-web-config
{{- end }}

{{/*
Web Secret name (chart-managed)
*/}}
{{- define "agentkitforge-web.webSecretName" -}}
{{ include "agentkitforge-web.fullname" . }}-web-secret
{{- end }}

{{/*
Effective web Secret name — the existing Secret if provided, else chart-managed.
*/}}
{{- define "agentkitforge-web.webEffectiveSecretName" -}}
{{- if .Values.web.secrets.existingSecret -}}
{{ .Values.web.secrets.existingSecret }}
{{- else -}}
{{ include "agentkitforge-web.webSecretName" . }}
{{- end -}}
{{- end }}

{{/*
In-cluster Postgres DATABASE_URL (used when bundled postgres is enabled and the
secret does not already supply DATABASE_URL). The password is read at runtime
from the effective secret, so we only build the non-secret parts here and let
the Deployment compose the URL via env interpolation.
*/}}
{{- define "agentkitforge-web.postgresHost" -}}
{{ include "agentkitforge-web.fullname" . }}-postgres
{{- end }}

{{/*
In-cluster MinIO endpoint.
*/}}
{{- define "agentkitforge-web.minioEndpoint" -}}
http://{{ include "agentkitforge-web.fullname" . }}-minio:9000
{{- end }}

{{/*
Web ServiceAccount name. When Auto is enabled the web pod runs under a dedicated
ServiceAccount so RBAC can grant it Job-management permissions in its namespace.
*/}}
{{- define "agentkitforge-web.webServiceAccountName" -}}
{{ include "agentkitforge-web.fullname" . }}-web
{{- end }}

{{/*
In-cluster web Service URL (used by the Auto worker + sweep to reach the app's
internal endpoints). Honors auto.internalUrl when set.
*/}}
{{- define "agentkitforge-web.webInternalUrl" -}}
{{- if .Values.auto.internalUrl -}}
{{ .Values.auto.internalUrl }}
{{- else -}}
http://{{ include "agentkitforge-web.fullname" . }}-web
{{- end -}}
{{- end }}

{{/*
The namespace the Auto dispatcher creates Jobs in (auto.namespace or the release
namespace).
*/}}
{{- define "agentkitforge-web.autoNamespace" -}}
{{- if .Values.auto.namespace -}}
{{ .Values.auto.namespace }}
{{- else -}}
{{ .Release.Namespace }}
{{- end -}}
{{- end }}
