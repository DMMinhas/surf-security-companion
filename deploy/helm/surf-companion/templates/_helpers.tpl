{{- define "surf-companion.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "surf-companion.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "surf-companion.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "surf-companion.labels" -}}
app.kubernetes.io/name: {{ include "surf-companion.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "surf-companion.backendSelector" -}}
app.kubernetes.io/name: {{ include "surf-companion.name" . }}
app.kubernetes.io/component: backend
{{- end -}}

{{- define "surf-companion.frontendSelector" -}}
app.kubernetes.io/name: {{ include "surf-companion.name" . }}
app.kubernetes.io/component: frontend
{{- end -}}
