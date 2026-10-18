import { aHora, aMinutos, descansoPara, duracionDescanso, entradaPara, shiftHours } from '../utils/shiftHours.js';
import { ruleForDay } from '../utils/ruleForDay.js';

// Use the same entry, duration and break rules as the exported Excel. Never
// count a split-shift employee as present during their break.
export function workingIntervals(schedule, employee, establishment) {
  if (!schedule.turno || schedule.turno === 'LIBRE') return [];
  const start = aMinutos(schedule.horaEntrada || entradaPara(employee, schedule.turno));
  const duration = shiftHours(employee, schedule.turno) * 60;
  if (start === null || !(duration > 0)) return null;
  const end = start + duration + (schedule.turno === 'PARTIDO' ? duracionDescanso(establishment) : 0);
  if (end > 1440) return null; // Overnight coverage needs an explicit day model.
  if (schedule.turno !== 'PARTIDO') return [[start, end]];
  const pause = aMinutos(schedule.horaDescanso || descansoPara(schedule.turno, establishment));
  const resume = pause === null ? null : pause + duracionDescanso(establishment);
  if (pause === null || pause <= start || resume >= end) return null;
  return [[start, pause], [resume, end]];
}

function assessClockCoverage(schedules, employees, rules, openDays, establishment, measureOnly = false) {
  let missingMinutes = 0;
  const checks = [], notVerified = [];
  const open = aMinutos(establishment?.horarioApertura);
  const close = aMinutos(establishment?.horarioCierre);
  if (open === null || close === null || close <= open) return measureOnly ? 0 : { checks, notVerified: [
    'Cobertura por horas no verificada: faltan horas de apertura y cierre válidas. Indícalas en la ficha de la tienda; si no puedes, avisa al equipo Brain.' ] };
  let windows = [[open, close]];
  if (establishment.cierraMediodia) {
    const pause = aMinutos(establishment.inicioCierreMediodia);
    const resume = aMinutos(establishment.finCierreMediodia);
    if (pause === null || resume === null || pause <= open || resume <= pause || resume >= close) return measureOnly ? 0 : { checks, notVerified: [
      'Cobertura por horas no verificada: revisa el cierre de mediodía de la tienda; si no puedes corregirlo, avisa al equipo Brain.' ] };
    windows = [[open, pause], [resume, close]];
  }
  for (const day of openDays) {
    const rule = ruleForDay(rules, day);
    if (!rule) continue;
    for (const [role, suffix] of [['DEPENDIENTA', 'Dependientas'], ['ELABORACION', 'Elaboracion']]) {
      const morning = rule[`min${suffix}Manana`] ?? 0;
      const afternoon = rule[`min${suffix}Tarde`] ?? 0;
      // Without configured half-day boundaries, only the shared floor is
      // justified throughout continuous opening. Do not invent a noon cutoff.
      const floor = Math.min(morning, afternoon);
      if (morning !== afternoon) notVerified.push(`${day} ${role}: mínimos distintos por turno; falta delimitar las franjas para certificar cada mínimo por horas.`);
      if (!floor) continue;
      const people = new Map();
      let invalid = false;
      for (const schedule of schedules.filter(s => s.dia === day && s.turno !== 'LIBRE')) {
        const employee = employees.find(e => e.id === schedule.empleadoId);
        if (!employee || employee.funcion !== role) continue;
        const intervals = workingIntervals(schedule, employee, establishment);
        if (intervals === null) { invalid = true; continue; }
        people.set(employee.id, [...(people.get(employee.id) || []), ...intervals]);
      }
      if (invalid) notVerified.push(`${day} ${role}: hay horas de turno o descanso no válidas; avisa al equipo Brain para revisarlas.`);
      for (const [from, to] of windows) {
        const points = [...new Set([from, to, ...[...people.values()].flat(2).filter(t => t > from && t < to)])].sort((a, b) => a - b);
        for (let i = 0; i < points.length - 1; i++) {
          const start = points[i], end = points[i + 1];
          const count = [...people.values()].filter(intervals => intervals.some(([a, b]) => a <= start && b >= end)).length;
          missingMinutes += Math.max(0, floor - count) * (end - start);
          if (measureOnly) continue;
          checks.push({ employeeId: null, requirement: `${day} ${role} cobertura por horas`,
            status: count < floor ? 'conflict' : 'respected',
            detail: `${aHora(start)}–${aHora(end)}: ${count} personas; mínimo ${floor}.${count < floor ? ' Ajusta las horas o asigna una persona disponible para cubrir esta franja. Si no puedes resolverlo, avisa al equipo Brain.' : ''}` });
        }
      }
    }
  }
  return measureOnly ? missingMinutes : { checks, notVerified };
}

export function reviewClockCoverage(schedules, employees, rules, openDays, establishment) {
  return assessClockCoverage(schedules, employees, rules, openDays, establishment);
}

// Same interval calculation as the final review, without formatting a report
// for each candidate considered by the bounded repair search.
export function missingClockCoverageMinutes(schedules, employees, rules, openDays, establishment) {
  return assessClockCoverage(schedules, employees, rules, openDays, establishment, true);
}
