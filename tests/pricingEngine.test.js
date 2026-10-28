import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCep,
  estimateRouteDistanceFromCeps,
  calculateDeterministicPricing,
  combineDeterministicAndAiPricing,
  SCENARIO_PRESETS
} from '../src/domain/pricingEngine.js';

import {
  LOGIENGINE_RESPONSE_JSON_SCHEMA,
  validateAndSanitizeAiOutput,
  runRealisticMockInference
} from '../src/services/geminiService.js';

test('Camada de Domínio: Deve calcular taxa determinística R$ 1,80/km e adicional de peso/volume', () => {
  const result = calculateDeterministicPricing({
    originCep: '01310-100',
    destCep: '04001-001',
    distanceKm: 10.0,
    weightKg: 5.0, // 2kg acima da franquia de 3kg -> 2 * 0.85 = R$ 1,70
    volumeCategory: 'MEDIUM' // + R$ 2,20
  });

  assert.equal(result.ratePerKmBrl, 1.80);
  assert.equal(result.distanceCostBrl, 18.00);
  assert.equal(result.weightAddonBrl, 1.70);
  assert.equal(result.volumeAddonBrl, 2.20);
  assert.equal(result.totalWeightVolumeAddonBrl, 3.90);
  // Base Fixa (4.50) + Distância (18.00) + Adicional Peso/Volume (3.90) = 26.40
  assert.equal(result.baseTotalBrl, 26.40);
});

test('Camada de Domínio: Deve estimar distância geográfica entre CEPs distintos', () => {
  const geo = estimateRouteDistanceFromCeps('01310-100', '04538-132');
  assert.ok(geo.distanceKm > 1.2);
  assert.equal(formatCep('01310100'), '01310-100');
});

test('Camada de Inteligência: Mock Engine deve respeitar estritamente o JSON Schema da Gemini API', async () => {
  const preset = SCENARIO_PRESETS.CRITICAL_STORM_FRIDAY;
  const deterministic = calculateDeterministicPricing(preset);
  const { payload, telemetry } = await runRealisticMockInference(preset, deterministic);

  // Verifica chaves obrigatórias do JSON Schema
  for (const requiredKey of LOGIENGINE_RESPONSE_JSON_SCHEMA.required) {
    assert.ok(requiredKey in payload, `Campo obrigatório ausente: ${requiredKey}`);
  }

  assert.ok(payload.surge_multiplier >= 1.0 && payload.surge_multiplier <= 2.5);
  assert.equal(typeof payload.estimated_sla_minutes, 'number');
  assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(payload.risk_level));
  assert.ok(Array.isArray(payload.bottleneck_factors) && payload.bottleneck_factors.length > 0);
  assert.equal(typeof payload.routing_recommendation, 'string');
  assert.ok(payload.confidence_score >= 0.0 && payload.confidence_score <= 1.0);
  assert.equal(telemetry.httpCode, 200);
  assert.ok(telemetry.latencyMs >= 0);

  // Combinação executiva final
  const combined = combineDeterministicAndAiPricing(deterministic, payload);
  assert.equal(
    combined.executiveSummary.finalDynamicPriceBrl,
    Number((deterministic.baseTotalBrl * payload.surge_multiplier).toFixed(2))
  );
});

test('Validador de Schema: Deve limitar surge_multiplier entre 1.0 e 2.5', () => {
  const sanitized = validateAndSanitizeAiOutput({
    surge_multiplier: 9.9,
    estimated_sla_minutes: 42,
    risk_level: 'CRITICAL',
    bottleneck_factors: ['Teste'],
    routing_recommendation: 'Alocar moto',
    confidence_score: 1.5
  });

  assert.equal(sanitized.surge_multiplier, 2.5);
  assert.equal(sanitized.confidence_score, 1.0);
});
