import { shiftHours } from '../utils/shiftHours.js';

export const DAYS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const days = value => Array.isArray(value) && value.length <= 7 && new Set(value).size === value.length && value.every(day => DAYS.includes(day));

export function validateDraftRequests(requests, employees) {
  if (!Array.isArray(requests) || requests.length > employees.length) throw new Error('Peticions de simulació invàlides.');
  const ids = new Set();
  for (const r of requests) {
    if (!record(r) || Object.keys(r).some(k => !['employeeId', 'daysOff', 'shiftsByDay', 'noSplit', 'absences', 'maxHours'].includes(k)) ||
        !Number.isSafeInteger(r.employeeId) || ids.has(r.employeeId) || !employees.some(e => e.id === r.employeeId) ||
        (r.daysOff !== undefined && !days(r.daysOff)) ||
        (r.noSplit !== undefined && typeof r.noSplit !== 'boolean') ||
        (r.maxHours !== undefined && (!Number.isFinite(r.maxHours) || r.maxHours < 0 || r.maxHours > 168)) ||
        (r.shiftsByDay !== undefined && (!record(r.shiftsByDay) || Object.entries(r.shiftsByDay).some(([d, t]) => !DAYS.includes(d) || !['MANANA', 'TARDE'].includes(t)))) ||
        (r.absences !== undefined && (!record(r.absences) || Object.entries(r.absences).some(([d, t]) => !DAYS.includes(d) || !['VACACIONES', 'BAJA_MEDICA'].includes(t))))) {
      throw new Error('Petició no admesa o persona fora de la botiga.');
    }
    ids.add(r.employeeId);
  }
}

// These objects are the scheduler's in-memory snapshot, never database records.
export function applyDraftRequests(requests, employees) {
  validateDraftRequests(requests, employees);
  for (const r of requests) {
    const e = employees.find(e => e.id === r.employeeId);
    for (const d of r.daysOff || []) e.diasPreferenciaLibre[d] = true;
    Object.assign(e.turnosPorDiaPreferencia, r.shiftsByDay || {});
    Object.assign(e.diasAusente, r.absences || {});
    if (r.maxHours !== undefined) e.maxHorasSemana = Math.min(e.maxHorasSemana, r.maxHours);
    if (r.noSplit) {
      e.condParsed = { ...e.condParsed, partidosMax: 0 };
      e.condicionesFijas = `${e.condicionesFijas || ''}. No fa mai torns PARTIDO.`;
    }
  }
}

/** Check the FINAL grid, not the model's claims or the saved week's conflicts. */
export function reviewDraft(schedules, employees, rules, closedDays, requests, freeRules) {
  const checks = [];
  const check = (employeeId, requirement, ok, detail) => checks.push({ employeeId, requirement, status: ok ? 'respected' : 'conflict', detail });
  for (const e of employees) {
    const shifts = schedules.filter(s => s.empleadoId === e.id);
    const work = shifts.filter(s => s.turno !== 'LIBRE');
    const hours = work.reduce((sum, s) => sum + shiftHours(e, s.turno), 0) + (e.horasYaTrabajadas || 0);
    check(e.id, 'Hores màximes setmanals', hours <= e.maxHorasSemana, `${hours} / ${e.maxHorasSemana} h, incloent altres botigues`);
    check(e.id, 'Setmana completa', DAYS.every(d => shifts.filter(s => s.dia === d).length === 1), 'Un torn o dia lliure per persona i dia');
    for (const s of work) {
      const slot = e.dispParsed?.[s.dia];
      const available = s.turno === 'MANANA' ? slot?.M !== false : s.turno === 'TARDE' ? slot?.T !== false : slot?.M !== false && slot?.T !== false;
      check(e.id, `Disponibilitat ${s.dia}`, available && !closedDays.includes(s.dia) && !e.diasAusente[s.dia] && !e.diasPreferenciaLibre[s.dia] && !e.diasOcupadosOtrosEstablecimientos?.[s.dia] && (!e.turnosPorDiaPreferencia[s.dia] || e.turnosPorDiaPreferencia[s.dia] === s.turno), s.turno);
    }
    const r = requests.find(r => r.employeeId === e.id);
    if (r?.noSplit) check(e.id, 'Sense torns partits', !work.some(s => s.turno === 'PARTIDO'), 'Petició de la simulació');
    for (const d of r?.daysOff || []) check(e.id, `${d} lliure`, shifts.some(s => s.dia === d && s.turno === 'LIBRE'), 'Petició de la simulació');
    for (const [d, t] of Object.entries(r?.shiftsByDay || {})) check(e.id, `${d} només ${t}`, shifts.some(s => s.dia === d && [t, 'LIBRE'].includes(s.turno)), 'Petició de la simulació');
    for (const [d, t] of Object.entries(r?.absences || {})) check(e.id, `${d} ${t}`, shifts.some(s => s.dia === d && s.turno === 'LIBRE' && s.ausencia === t), 'Absència simulada, no desada');
  }
  for (const d of DAYS.filter(d => !closedDays.includes(d))) {
    const rule = rules.find(r => r.diasAplica && JSON.parse(r.diasAplica).includes(d)) || rules.find(r => !r.diasAplica) || rules[0];
    if (!rule) continue;
    for (const [role, suffix] of [['DEPENDIENTA', 'Dependientas'], ['ELABORACION', 'Elaboracion']]) {
      for (const [shift, period] of [['MANANA', 'Manana'], ['TARDE', 'Tarde']]) {
        const count = schedules.filter(s => s.dia === d && [shift, 'PARTIDO'].includes(s.turno) && s.empleado.funcion === role).length;
        const min = rule[`min${suffix}${period}`] ?? 0;
        const max = rule[`max${suffix}${period}`] ?? Infinity;
        check(null, `${d} ${role} ${shift}`, count >= min && count <= max, `${count} persones; mínim ${min}${Number.isFinite(max) ? `, màxim ${max}` : ''}`);
      }
    }
  }
  const notVerified = ['Equitat històrica, alternança de dissabtes i temps de descans: no certificats per aquesta revisió.'];
  if (!rules.length) notVerified.push('No hi ha regles de cobertura configurades; no es pot certificar la cobertura.');
  if (freeRules.length || employees.some(e => e.condicionesFijas || e.condicionesEstructuradas)) notVerified.push('Condicions fixes i regles de text: el motor les ha rebut, però aquesta revisió no en certifica el compliment complet.');
  return { checks, conflicts: checks.filter(c => c.status === 'conflict'), notVerified,
    allRespected: checks.some(c => c.status === 'conflict') ? false : null,
    explanation: 'Esborrany calculat amb les dades vigents i les peticions temporals indicades. Els dies lliures, absències i límits personals tenen prioritat sobre la cobertura. Reviseu els conflictes abans de desar o publicar. No s’ha modificat ni enviat cap horari.' };
}
