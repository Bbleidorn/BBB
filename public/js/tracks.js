// Strecken werden wie im Baukasten aus Blöcken zusammengesetzt.
//   len   Länge in Metern
//   turn  Kurve in Grad (positiv = rechts, negativ = links)
//   dy    Höhenänderung in Metern
//   bank  Querneigung in Grad (neigt sich automatisch in die Kurve)
//   ease  Höhenverlauf: smooth (Standard) | in (Schanze) | out (Landung) | linear
//   type  road (Standard) | boost | gap (Lücke ohne Fahrbahn)
//   cp    Checkpoint am Anfang des Blocks
// Ziel und Auslaufzone werden automatisch angehängt.

export const TRACKS = [
  {
    id: 'gruene-welle',
    name: 'Grüne Welle',
    difficulty: 'Einsteiger',
    color: '#2ecc71',
    startHeight: 6,
    blocks: [
      { len: 140 },
      { len: 110, turn: 90, bank: 8 },
      { len: 60, cp: true },
      { len: 80, dy: 8 },
      { len: 130, turn: -120, bank: 10 },
      { len: 50, type: 'boost' },
      { len: 120, cp: true },
      { len: 140, turn: 150, bank: 12 },
      { len: 90, dy: -8 },
      { len: 70, turn: -45 },
      { len: 60, cp: true },
      { len: 110, turn: -90, bank: 8 },
      { len: 120 },
    ],
  },
  {
    id: 'schanzen',
    name: 'Schanzenland',
    difficulty: 'Mittel',
    color: '#f39c12',
    startHeight: 10,
    blocks: [
      { len: 120 },
      { len: 30, type: 'boost' },
      { len: 40, dy: 2.5, ease: 'in' },
      { len: 30, dy: -8, type: 'gap', ease: 'linear' },
      { len: 90, dy: -2, ease: 'out' },
      { len: 110, turn: -90, bank: 10, cp: true },
      { len: 80, dy: 10 },
      { len: 120, turn: 120, bank: 12 },
      { len: 40, type: 'boost', cp: true },
      { len: 60 },
      { len: 35, dy: 2, ease: 'in' },
      { len: 32, dy: -9, type: 'gap', ease: 'linear' },
      { len: 110, dy: -2, ease: 'out' },
      { len: 120, turn: -150, bank: 14, cp: true },
      { len: 60, type: 'boost' },
      { len: 40, dy: 4, ease: 'in' },
      { len: 34, dy: -6, type: 'gap', ease: 'linear' },
      { len: 110 },
    ],
  },
  {
    id: 'steilkurven',
    name: 'Steilkurven',
    difficulty: 'Schwer',
    color: '#e74c3c',
    startHeight: 5,
    blocks: [
      { len: 100 },
      { len: 40, type: 'boost' },
      { len: 200, turn: 180, bank: 28 },
      { len: 80, dy: 12, cp: true },
      { len: 180, turn: -180, bank: 28 },
      { len: 50, type: 'boost' },
      { len: 60, cp: true },
      { len: 35, dy: 3, ease: 'in' },
      { len: 30, dy: -6, type: 'gap', ease: 'linear' },
      { len: 90, dy: -2, ease: 'out' },
      { len: 220, turn: 200, bank: 30, cp: true },
      { len: 100, dy: -8 },
      { len: 100 },
    ],
  },
];
