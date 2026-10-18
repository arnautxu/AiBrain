import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewClockCoverage } from '../src/services/clock-coverage.js';
import { reviewDraft, DAYS } from '../src/services/draft-scenario.js';

const shop = { horarioApertura: '08:00', horarioCierre: '20:00', cierraMediodia: false };
const rules = [{ minDependientasManana: 1, minDependientasTarde: 1 }];
const employees = [
  { id: 1, funcion: 'DEPENDIENTA', horasPorTurno: 6, horaEntradaManana: '08:00' },
  { id: 2, funcion: 'DEPENDIENTA', horaEntradaTarde: '14:45' },
];
const shifts = [
  { empleadoId: 1, dia: 'MARTES', turno: 'MANANA' },
  { empleadoId: 2, dia: 'MARTES', turno: 'TARDE' },
];
const review = (s = shifts, es = employees, est = shop, rs = rules) => reviewClockCoverage(s, es, rs, ['MARTES'], est);

test('W44 regression: headcounts pass but Tuesday 14:00–14:45 has zero dependents', () => {
  const result = review();
  assert.equal(result.checks.filter(c => c.status === 'conflict').length, 1);
  assert.match(result.checks.find(c => c.status === 'conflict').detail, /14:00–14:45: 0 personas; mínimo 1/);
  const es = employees.map(e => ({ ...e, maxHorasSemana: 40, diasAusente: {}, diasPreferenciaLibre: {}, turnosPorDiaPreferencia: {} }));
  const schedules = es.flatMap(e => DAYS.map(dia => ({ empleadoId: e.id, empleado: e, dia,
    turno: dia === 'MARTES' ? (e.id === 1 ? 'MANANA' : 'TARDE') : 'LIBRE' })));
  const full = reviewDraft(schedules, es, rules, DAYS.filter(d => d !== 'MARTES'), [], [], shop);
  assert.ok(full.checks.filter(c => /MARTES DEPENDIENTA (MANANA|TARDE)$/.test(c.requirement)).every(c => c.status === 'respected'));
  assert.equal(full.allRespected, false);
  assert.ok(full.conflicts.some(c => c.requirement.includes('cobertura por horas')));
});

test('the returned Excel correction, 14:00–20:00, closes the gap without moving another person', () => {
  assert.equal(review([shifts[0], { ...shifts[1], horaEntrada: '14:00' }]).checks.filter(c => c.status === 'conflict').length, 0);
});

test('midday shop closure is excluded, but a split worker break is not counted as presence', () => {
  const split = [{ empleadoId: 3, dia: 'MARTES', turno: 'PARTIDO', horaEntrada: '08:00', horaDescanso: '13:30' }];
  const es = [{ id: 3, funcion: 'DEPENDIENTA' }];
  assert.match(review(split, es).checks.find(c => c.status === 'conflict').detail, /13:30–16:30: 0/);
  const closed = { ...shop, cierraMediodia: true, inicioCierreMediodia: '13:30', finCierreMediodia: '16:30' };
  assert.equal(review(split, es, closed).checks.filter(c => c.status === 'conflict').length, 0);
});

test('overlaps satisfy higher minima and duplicate rows never count as two people', () => {
  const rs = [{ minDependientasManana: 2, minDependientasTarde: 2 }];
  const s = [shifts[0], shifts[0], { ...shifts[1], horaEntrada: '14:00' }];
  assert.ok(review(s, employees, shop, rs).checks.every(c => c.status === 'conflict'));
});

test('missing opening hours and asymmetric minima remain explicitly unverified', () => {
  assert.match(review(shifts, employees, {}).notVerified[0], /no verificada/);
  assert.ok(review(shifts, employees, shop, [{ minDependientasManana: 2, minDependientasTarde: 1 }]).notVerified.some(n => n.includes('mínimos distintos')));
});

test('another role never fills a dependent gap and inputs remain unchanged', () => {
  const es = [...employees, { id: 3, funcion: 'ELABORACION', horasPorTurno: 6 }];
  const s = [...shifts, { empleadoId: 3, dia: 'MARTES', turno: 'TARDE', horaEntrada: '14:00' }];
  const before = structuredClone({ s, es, shop, rules });
  assert.ok(review(s, es).checks.some(c => c.status === 'conflict'));
  assert.deepEqual({ s, es, shop, rules }, before);
});
