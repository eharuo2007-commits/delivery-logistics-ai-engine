/**
 * ============================================================================
 * LogiEngine AI — Formatadores, Syntax Highlighting JSON e Helpers de UI
 * ============================================================================
 */

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2
});

/**
 * Formata valor numérico para moeda Real Brasileiro (R$ XX,XX).
 * @param {number} value
 * @returns {string}
 */
export function formatBrl(value) {
  return BRL_FORMATTER.format(Number(value) || 0);
}

/**
 * Formata timestamp ISO para horário legível de telemetria (HH:MM:SS.mmm).
 * @param {string} isoString
 * @returns {string}
 */
export function formatTelemetryTime(isoString) {
  try {
    const d = new Date(isoString);
    const time = d.toLocaleTimeString('pt-BR', { hour12: false });
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${time}.${ms}`;
  } catch {
    return '--:--:--';
  }
}

/**
 * Retorna os metadados visuais (cor, label, ícone) para o nível de risco.
 * @param {'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'} riskLevel
 */
export function getRiskBadgeMeta(riskLevel) {
  switch (String(riskLevel || '').toUpperCase()) {
    case 'CRITICAL':
      return {
        code: 'CRITICAL',
        label: 'CRITICAL RISK',
        subtitle: 'Alerta Vermelho de Malha',
        className: 'risk-badge--critical'
      };
    case 'HIGH':
      return {
        code: 'HIGH',
        label: 'HIGH RISK',
        subtitle: 'Pressão Operacional Alta',
        className: 'risk-badge--high'
      };
    case 'MEDIUM':
      return {
        code: 'MEDIUM',
        label: 'MEDIUM RISK',
        subtitle: 'Atenção Moderada na Rota',
        className: 'risk-badge--medium'
      };
    default:
      return {
        code: 'LOW',
        label: 'LOW RISK',
        subtitle: 'Malha Estável & Nominal',
        className: 'risk-badge--low'
      };
  }
}

/**
 * Aplica Syntax Highlighting seguro (HTML escapado) a um objeto ou string JSON
 * para exibição no painel de Engineering Telemetry.
 * @param {Object|string} jsonInput
 * @returns {string} HTML com spans estilizados por token JSON
 */
export function syntaxHighlightJson(jsonInput) {
  let jsonString =
    typeof jsonInput === 'string' ? jsonInput : JSON.stringify(jsonInput, null, 2);

  jsonString = jsonString
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return jsonString.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    match => {
      let tokenClass = 'json-token-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          tokenClass = 'json-token-key';
        } else {
          // Destaca valores de enum de risco dentro do JSON
          if (/^"(LOW|MEDIUM|HIGH|CRITICAL)"$/.test(match)) {
            tokenClass = `json-token-enum json-token-enum--${match.replace(/"/g, '').toLowerCase()}`;
          } else {
            tokenClass = 'json-token-string';
          }
        }
      } else if (/true|false/.test(match)) {
        tokenClass = 'json-token-boolean';
      } else if (/null/.test(match)) {
        tokenClass = 'json-token-null';
      }
      return `<span class="${tokenClass}">${match}</span>`;
    }
  );
}
