import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceFinalScheduleBounds, remainingWeeklyHours } from '../src/services/final-schedule-bounds.js';
import { shiftHours } from '../src/utils/shiftHours.js';
import { reviewClockCoverage, missingClockCoverageMinutes } from '../src/services/clock-coverage.js';
const days = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];
const employee = (id, extra = {}) => ({ id, funcion: 'DEPENDIENTA', maxHorasSemana: 40, ...extra });
const grid = (id, shifts) => ({ empleadoId: id, dias: days.map((dia, i) => ({ dia, turno: shifts[i] || 'LIBRE' })) });
const hours = (h, e) => h.dias.reduce((sum, d) => sum + shiftHours(e, d.turno), 0);

test('43/40 is corrected after the final pass, retaining the Wednesday afternoon request', () => {
  const e = employee(1, { horasObjetivoSemana: 48, turnosPorDiaPreferencia: { MIERCOLES: 'TARDE' } });
  const h = [grid(1, ['PARTIDO', 'PARTIDO', 'TARDE', 'PARTIDO', 'LIBRE', 'MANANA'])];
  assert.equal(hours(h[0], e), 43);
  enforceFinalScheduleBounds(h, [e], []);
  assert.ok(hours(h[0], e) <= 40);
  assert.equal(h[0].dias[2].turno, 'TARDE');
  assert.equal(remainingWeeklyHours(e), 40);
});

test('final coverage repair respects maxima, reduced days and hours in other shops', () => {
  const employees = [employee(1, { horasPorTurno: 4, maxHorasSemana: 20, horasYaTrabajadas: 16 }), employee(2)];
  const h = [grid(1, ['MANANA', 'MANANA']), grid(2, [])];
  const rules = [{ diasAplica: '["LUNES","MARTES"]', minDependientasManana: 1, maxDependientasManana: 1, maxDependientasTarde: 0 }];
  enforceFinalScheduleBounds(h, employees, rules, days.slice(2));
  assert.ok(hours(h[0], employees[0]) <= 4);
  for (const day of days.slice(0, 2)) assert.equal(h.filter(x => ['MANANA', 'PARTIDO'].includes(x.dias.find(d => d.dia === day).turno)).length, 1);
  assert.ok(h[0].dias.every(d => d.turno !== 'PARTIDO'));
});

test('impossible minima remain visible instead of breaching hours, absences or maximum coverage', () => {
  const e = employee(1, { maxHorasSemana: 0, diasAusente: { LUNES: 'BAJA_MEDICA' } });
  const h = [grid(1, ['MANANA'])];
  enforceFinalScheduleBounds(h, [e], [{ minDependientasManana: 2, maxDependientasManana: 1 }]);
  assert.equal(hours(h[0], e), 0);
  assert.ok(h[0].dias.every(d => d.turno === 'LIBRE'));
});

test('coverage excess is removed even after late condition passes; malformed grids fail closed', () => {
  const es = [employee(1), employee(2)];
  const h = es.map(e => grid(e.id, ['TARDE']));
  enforceFinalScheduleBounds(h, es, [{ minDependientasTarde: 1, maxDependientasTarde: 1 }], days.slice(1));
  assert.equal(h.filter(x => x.dias[0].turno === 'TARDE').length, 1);
  assert.throws(() => enforceFinalScheduleBounds([h[0], h[0]], es, []));
  assert.throws(() => remainingWeeklyHours(employee(3, { maxHorasSemana: NaN })));
});

test('weekday names on legacy rules select Saturday coverage without applying Friday defaults', async () => {
  const { ruleForDay } = await import('../src/utils/ruleForDay.js');
  const rules = [{ nombre: 'DIVENDRES', minDependientasManana: 6 }, { nombre: 'DISSABTE', minDependientasManana: 7 }];
  assert.equal(ruleForDay(rules, 'VIERNES').minDependientasManana, 6);
  assert.equal(ruleForDay(rules, 'SABADO').minDependientasManana, 7);
  assert.equal(ruleForDay(rules, 'LUNES'), null);
  assert.equal(ruleForDay([{ nombre: 'General', minDependientasManana: 1 }, { nombre: 'DISSABTE', minDependientasManana: 7 }], 'SABADO').minDependientasManana, 7);
  assert.throws(() => ruleForDay([{ diasAplica: 'broken' }], 'LUNES'));
});

test('moves capped hours between days to spread unavoidable shortages without leaving a shift empty', () => {
  const es = [employee(1, { maxHorasSemana: 7 }), employee(2, { maxHorasSemana: 7 })];
  const h = es.map(e => grid(e.id, ['MANANA']));
  const rules = [{ minDependientasManana: 2, maxDependientasManana: 2, maxDependientasTarde: 0 }];
  enforceFinalScheduleBounds(h, es, rules, days.slice(2));
  for (const day of days.slice(0, 2)) assert.equal(h.filter(x => x.dias.find(d => d.dia === day).turno === 'MANANA').length, 1);
  for (const e of es) assert.equal(hours(h.find(x => x.empleadoId === e.id), e), 7);
});


test('recovers an exact afternoon count with an atomic same-role exchange, without losing coverage', () => {
  const es = [employee(1, { condicionesEstructuradas: { matinsExactes: 3, tardesExactes: 3, partidoCompta: 'MATI_I_TARDA' } }), employee(2)];
  const h = [grid(1, ['PARTIDO', 'PARTIDO', 'TARDE', 'TARDE', 'MANANA']), grid(2, ['MANANA', 'MANANA', 'MANANA', 'MANANA', 'MANANA'])];
  const rules = [{ diasAplica: JSON.stringify(days.slice(0, 2)), minDependientasManana: 2, minDependientasTarde: 1, maxDependientasManana: 2, maxDependientasTarde: 1 }, { diasAplica: JSON.stringify(days.slice(2, 5)), minDependientasManana: 1, minDependientasTarde: 0, maxDependientasManana: 2, maxDependientasTarde: 1 }];
  const oldCounts = days.slice(0, 5).map(day => ['MANANA', 'TARDE'].map(t => h.filter(x => [t, 'PARTIDO'].includes(x.dias.find(d => d.dia === day).turno)).length));
  enforceFinalScheduleBounds(h, es, rules, days.slice(5), (e, _day, shift) => {
    if (e.id !== 1 || shift !== 'MANANA') return true;
    return h[0].dias.filter(d => ['MANANA', 'PARTIDO'].includes(d.turno)).length < 3;
  });
  assert.equal(h[0].dias.filter(d => ['TARDE', 'PARTIDO'].includes(d.turno)).length, 3);
  assert.equal(h[0].dias.filter(d => ['MANANA', 'PARTIDO'].includes(d.turno)).length, 3);
  assert.deepEqual(days.slice(0, 5).map(day => ['MANANA', 'TARDE'].map(t => h.filter(x => [t, 'PARTIDO'].includes(x.dias.find(d => d.dia === day).turno)).length)), oldCounts);
  for (const e of es) assert.ok(hours(h.find(x => x.empleadoId === e.id), e) <= e.maxHorasSemana);
});

test('does not buy a fixed condition by exceeding a partner contract or changing requested shifts', () => {
  for (const protection of [{ maxHorasSemana: 35 }, { condicionesEstructuradas: { maxPartidos: 0 } }, { turnosPorDiaPreferencia: Object.fromEntries(days.slice(0, 5).map(d => [d, 'MANANA'])) }]) {
    const es = [employee(1, { condicionesEstructuradas: { matinsExactes: 3, tardesExactes: 3, partidoCompta: 'MATI_I_TARDA' } }), employee(2, protection)];
    const h = [grid(1, ['PARTIDO', 'PARTIDO', 'TARDE', 'TARDE', 'MANANA']), grid(2, ['MANANA', 'MANANA', 'MANANA', 'MANANA', 'MANANA'])];
    const before = structuredClone(h);
    enforceFinalScheduleBounds(h, es, [{ diasAplica: JSON.stringify(days.slice(0, 2)), minDependientasManana: 2, minDependientasTarde: 1, maxDependientasManana: 2, maxDependientasTarde: 1 }, { diasAplica: JSON.stringify(days.slice(2, 5)), minDependientasManana: 1, minDependientasTarde: 0, maxDependientasManana: 2, maxDependientasTarde: 1 }], days.slice(5));
    assert.deepEqual(h, before);
  }
});

const shop = { horarioApertura: '08:00', horarioCierre: '20:00', cierraMediodia: false };
const clockRows = h => h.flatMap(person => person.dias.map(d => ({ empleadoId: person.empleadoId, ...d })));
function gapScenario(extra = {}, maximum = 2, requested = true) {
  const es = [
    employee(1, { maxHorasSemana: 20, horasYaTrabajadas: 13, condParsed: { partidosMax: 0 }, ...(requested ? { turnosRequeridosBorrador: { VIERNES: 'TARDE' } } : {}) }),
    employee(2, { horasPorTurno: 6, horaEntradaManana: '08:00', horaEntradaTarde: '14:00', maxHorasSemana: 30, turnosPorDiaPreferencia: { VIERNES: 'MANANA' }, turnosRequeridosBorrador: { VIERNES: 'MANANA' } }),
    employee(3, { horasPorTurno: 6, horaEntradaManana: '08:00', horaEntradaTarde: '14:00', maxHorasSemana: 30, horasYaTrabajadas: 24, ...extra }),
  ];
  const h = [grid(1, ['', '', '', '', 'TARDE']), grid(2, ['', '', '', '', 'MANANA']), grid(3, [])];
  const rules = [{ diasAplica: '["VIERNES"]', minDependientasManana: 1, minDependientasTarde: 1, maxDependientasManana: 1, maxDependientasTarde: maximum }];
  return { es, h, rules };
}

test('repairs the live 45-minute gap using available cover while retaining required shifts and hours', () => {
  const { es, h, rules } = gapScenario();
  assert.equal(missingClockCoverageMinutes(clockRows(h), es, rules, ['VIERNES'], shop), 45);
  enforceFinalScheduleBounds(h, es, rules, days.filter(d => d !== 'VIERNES'), () => true, shop);
  assert.equal(missingClockCoverageMinutes(clockRows(h), es, rules, ['VIERNES'], shop), 0);
  assert.equal(h[0].dias[4].turno, 'TARDE');
  assert.equal(h[1].dias[4].turno, 'MANANA');
  assert.equal(h[2].dias[4].turno, 'TARDE');
  for (const e of es) assert.ok(hours(h.find(x => x.empleadoId === e.id), e) <= remainingWeeklyHours(e));
});

test('exchanges late and free same-role workers atomically when maximum afternoon cover is one', () => {
  const { es, h, rules } = gapScenario({}, 1, false);
  enforceFinalScheduleBounds(h, es, rules, days.filter(d => d !== 'VIERNES'), () => true, shop);
  assert.equal(missingClockCoverageMinutes(clockRows(h), es, rules, ['VIERNES'], shop), 0);
  assert.equal(h[0].dias[4].turno, 'LIBRE');
  assert.equal(h[2].dias[4].turno, 'TARDE');
});

for (const restriction of [
  { diasPreferenciaLibre: { VIERNES: true } },
  { diasAusente: { VIERNES: 'VACACIONES' } },
  { maxHorasSemana: 24 },
  { turnosPorDiaPreferencia: { VIERNES: 'MANANA' } },
  { dispParsed: { VIERNES: { M: true, T: false } } },
]) test(`keeps an impossible clock gap visible rather than violating ${Object.keys(restriction)[0]}`, () => {
  const { es, h, rules } = gapScenario(restriction);
  enforceFinalScheduleBounds(h, es, rules, days.filter(d => d !== 'VIERNES'), () => true, shop);
  assert.equal(h[0].dias[4].turno, 'TARDE');
  assert.equal(h[2].dias[4].turno, 'LIBRE');
  assert.equal(missingClockCoverageMinutes(clockRows(h), es, rules, ['VIERNES'], shop), 45);
  assert.ok(reviewClockCoverage(clockRows(h), es, rules, ['VIERNES'], shop).checks.some(c => c.status === 'conflict'));
});

test('does not drop a required late shift to satisfy a conflicting maximum of one worker', () => {
  const { es, h, rules } = gapScenario({}, 1, true);
  enforceFinalScheduleBounds(h, es, rules, days.filter(d => d !== 'VIERNES'), () => true, shop);
  assert.equal(h[0].dias[4].turno, 'TARDE');
  assert.equal(h[2].dias[4].turno, 'LIBRE');
  assert.equal(missingClockCoverageMinutes(clockRows(h), es, rules, ['VIERNES'], shop), 45);
});

test('replays the seven-person live grid, closes Friday 14:00–14:45 and preserves every temporary condition', async () => {
  const { applyDraftRequests, reviewDraft } = await import('../src/services/draft-scenario.js');
  const es = Array.from({ length: 7 }, (_, i) => employee(i + 1, {
    funcion: i < 4 ? 'DEPENDIENTA' : 'ELABORACION',
    maxHorasSemana: i ? 30 : 40, horasPorTurno: i ? 6 : null,
    horaEntradaManana: i ? '08:00' : null, horaEntradaTarde: i ? '14:00' : null,
    diasPreferenciaLibre: {}, diasAusente: {}, turnosPorDiaPreferencia: {},
  }));
  const requests = [
    { employeeId: 1, maxHours: 20, daysOff: ['LUNES', 'SABADO'], shiftsByDay: { MARTES: 'MANANA', MIERCOLES: 'TARDE' }, requiredShiftsByDay: { JUEVES: 'TARDE' }, noSplit: true },
    { employeeId: 2, maxHours: 30, daysOff: ['MARTES'], requiredShiftsByDay: { SABADO: 'MANANA' }, noSplit: true },
    { employeeId: 3, maxHours: 24, daysOff: ['VIERNES'], requiredShiftsByDay: { JUEVES: 'TARDE' }, noSplit: true },
    { employeeId: 4, maxHours: 30, daysOff: ['JUEVES'], requiredShiftsByDay: { MARTES: 'TARDE' }, noSplit: true },
    { employeeId: 5, maxHours: 30, daysOff: ['JUEVES'], requiredShiftsByDay: { MARTES: 'MANANA' }, noSplit: true },
    { employeeId: 6, maxHours: 24, shiftsByDay: { MARTES: 'TARDE' }, requiredShiftsByDay: { JUEVES: 'MANANA' }, noSplit: true },
    { employeeId: 7, maxHours: 30, daysOff: ['MARTES'], requiredShiftsByDay: { LUNES: 'MANANA', JUEVES: 'TARDE' }, noSplit: true },
  ];
  applyDraftRequests(requests, es);
  const codes = { M: 'MANANA', T: 'TARDE', F: 'LIBRE' };
  const h = ['FMFTTFF', 'MFTMFMF', 'FFMTFTF', 'TTFFMTF', 'TMMFMFF', 'FTFMTMF', 'MFTTFTF']
    .map((week, i) => grid(i + 1, [...week].map(c => codes[c])));
  const rules = [{ minDependientasManana: 1, minDependientasTarde: 1, minElaboracionManana: 1, minElaboracionTarde: 1 }];
  assert.equal(missingClockCoverageMinutes(clockRows(h), es, rules, days.slice(0, 6), shop), 45);
  enforceFinalScheduleBounds(h, es, rules, ['DOMINGO'], () => true, shop);
  assert.equal(missingClockCoverageMinutes(clockRows(h), es, rules, days.slice(0, 6), shop), 0);
  const review = reviewDraft(clockRows(h).map(s => ({ ...s, empleado: es.find(e => e.id === s.empleadoId) })), es, rules, ['DOMINGO'], requests, [], shop);
  assert.deepEqual(review.conflicts, []);
  for (const e of es) {
    const week = h.find(p => p.empleadoId === e.id);
    assert.ok(hours(week, e) <= e.maxHorasSemana);
    assert.ok(week.dias.filter(d => d.turno !== 'LIBRE').length <= 5);
  }
  // The required late Thursday remains and the second dependent covers 14:00.
  assert.equal(h[0].dias[3].turno, 'TARDE');
});
