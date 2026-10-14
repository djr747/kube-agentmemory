{{- define "agentmemory.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- define "agentmemory.fullname" -}}
{{- default (printf "%s-%s" .Release.Name (include "agentmemory.name" .)) .Values.fullnameOverride | trunc 54 | trimSuffix "-" -}}
{{- end -}}
{{- define "agentmemory.selector" -}}
app.kubernetes.io/name: {{ include "agentmemory.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "agentmemory.labels" -}}
{{ include "agentmemory.selector" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}
{{- define "agentmemory.serviceAccount" -}}
{{- default (include "agentmemory.fullname" .) .Values.serviceAccount.name -}}
{{- end -}}
{{- define "agentmemory.image" -}}
{{- if .digest -}}{{ .repository }}@{{ .digest }}{{- else -}}{{ .repository }}:{{ .tag }}{{- end -}}
{{- end -}}
