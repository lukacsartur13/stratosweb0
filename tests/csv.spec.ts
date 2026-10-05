import { test, expect } from '@playwright/test';
import { BOM, parseCsv, records, toCsv } from '../portal/src/lib/csv.ts';

/** The Portal's CSV import and export (portal/src/lib/csv.ts). */

test('writing: semicolons, a BOM, quotes where needed, and no formula can run', () => {
  const csv = toCsv([
    { name: 'Kovács Anna', note: 'Mondta: "jó"; holnap', amount: 1500000, risky: '=HYPERLINK("x")' },
    { name: 'Béla', note: 'két\nsor', amount: -250, risky: '-5' },
  ], [
    { key: 'name', header: 'Név' }, { key: 'note', header: 'Megjegyzés' }, { key: 'amount', header: 'Összeg' }, { key: 'risky', header: 'X' },
  ]);
  expect(csv.startsWith(BOM)).toBe(true);
  expect(csv.slice(1).split('\r\n')[0]).toBe('Név;Megjegyzés;Összeg;X');
  expect(csv).toContain('"Mondta: ""jó""; holnap"');
  expect(csv).toContain(`'=HYPERLINK(""x"")`);
  expect(csv).toContain("'-5");
  expect(csv).toContain('"két\nsor";-250;');
});

test('reading round-trips what was written, and detects comma and tab files', () => {
  const back = parseCsv(toCsv([{ a: 'x;y', b: 'q"z' }], [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }]));
  expect(back).toEqual([['A', 'B'], ['x;y', 'q"z']]);
  expect(parseCsv('name,email\r\n"Kert, Kft.",a@b.hu\r\n\r\n')).toEqual([['name', 'email'], ['Kert, Kft.', 'a@b.hu']]);
  expect(parseCsv('name\temail\nAnna\ta@b.hu')).toEqual([['name', 'email'], ['Anna', 'a@b.hu']]);
});

test('headers are matched in Hungarian or English, accents and case ignored; unknown ones are reported', () => {
  const r = records(parseCsv('Cégnév;E-mail;Telefonszám;Kedvenc szín\nRapidkert;a@b.hu;+36 1;kék'), {
    name: ['name', 'company', 'cegnev', 'cég'], email: ['email', 'e-mail'], phone: ['phone', 'telefon', 'telefonszam'],
  });
  expect(r.data).toEqual([{ name: 'Rapidkert', email: 'a@b.hu', phone: '+36 1' }]);
  expect(r.matched.sort()).toEqual(['email', 'name', 'phone']);
  expect(r.unknown).toEqual(['Kedvenc szín']);
});
