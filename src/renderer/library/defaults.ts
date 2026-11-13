// Starter construction library. Every λ value here is ORIENTATIVE and flagged verified:false
// until checked against the Mc 001-2022 / C107 material tables or the manufacturer's declaration.
import type { HvacCatalog, Library, Locality, Material, NormProfile, ProjectDefaults, RoomRule, RoomType, SiteSettings, SlabType, WallType } from '../core/types'

const TODO_SRC = 'Orientativ — de verificat (Mc 001-2022 / C107 / declarația producătorului)'

const m = (id: string, name: string, lambda: number, density?: number, source = TODO_SRC): Material =>
  ({ id, name, lambda, density, source, verified: false })

export const DEFAULT_MATERIALS: Material[] = [
  m('mat_beton_armat', 'Beton armat', 1.74, 2500),
  m('mat_beton_simplu', 'Beton simplu', 1.62, 2400),
  m('mat_bca_600', 'BCA (beton celular autoclavizat) 600', 0.27, 600),
  m('mat_caramida_plina', 'Cărămidă plină', 0.80, 1800),
  m('mat_caramida_goluri', 'Cărămidă cu goluri verticale (GVP)', 0.60, 1550),
  m('mat_bloc_ceramic', 'Bloc ceramic termoizolant (λ echivalent)', 0.20, 800, 'Declarația producătorului — de completat'),
  m('mat_mortar_ciment', 'Mortar de ciment', 0.93, 1800),
  m('mat_tencuiala', 'Tencuială var-ciment', 0.87, 1700),
  m('mat_gips_carton', 'Placă gips-carton', 0.25, 900),
  m('mat_eps', 'Polistiren expandat EPS', 0.040, 20),
  m('mat_eps_grafit', 'Polistiren expandat grafitat', 0.031, 20),
  m('mat_xps', 'Polistiren extrudat XPS', 0.035, 35),
  m('mat_vata_bazaltica', 'Vată minerală bazaltică', 0.040, 100),
  m('mat_vata_sticla', 'Vată minerală de sticlă', 0.037, 20),
  m('mat_pur', 'Spumă poliuretanică PUR/PIR', 0.025, 35),
  m('mat_lemn_rasinoase', 'Lemn rășinoase', 0.17, 550),
  m('mat_osb', 'Placă OSB', 0.13, 650),
  m('mat_sapa', 'Șapă de ciment', 1.40, 2000),
  m('mat_gresie', 'Gresie / plăci ceramice', 1.30, 2300),
  m('mat_parchet', 'Parchet lemn', 0.18, 700)
]

const L = (materialId: string, mm: number) => ({ materialId, thickness: mm / 1000 })

export const DEFAULT_WALL_TYPES: WallType[] = [
  { id: 'wt_ext_bca30_eps10', name: 'Exterior BCA 30 + EPS 10', category: 'exterior',
    layers: [L('mat_tencuiala', 10), L('mat_eps', 100), L('mat_bca_600', 300), L('mat_tencuiala', 15)] },
  { id: 'wt_ext_gvp25_eps10', name: 'Exterior cărămidă GVP 25 + EPS 10', category: 'exterior',
    layers: [L('mat_tencuiala', 10), L('mat_eps', 100), L('mat_caramida_goluri', 250), L('mat_tencuiala', 15)] },
  { id: 'wt_ext_bloc30_vata10', name: 'Exterior bloc ceramic 30 + vată 10', category: 'exterior',
    layers: [L('mat_tencuiala', 10), L('mat_vata_bazaltica', 100), L('mat_bloc_ceramic', 300), L('mat_tencuiala', 15)] },
  { id: 'wt_int_caramida125', name: 'Interior cărămidă 12,5', category: 'interior',
    layers: [L('mat_tencuiala', 15), L('mat_caramida_plina', 125), L('mat_tencuiala', 15)] },
  { id: 'wt_int_bca15', name: 'Interior BCA 15', category: 'interior',
    layers: [L('mat_tencuiala', 15), L('mat_bca_600', 150), L('mat_tencuiala', 15)] },
  { id: 'wt_int_gc10', name: 'Interior gips-carton 10', category: 'interior',
    layers: [L('mat_gips_carton', 12.5), L('mat_vata_sticla', 75), L('mat_gips_carton', 12.5)] }
]

export const DEFAULT_SLAB_TYPES: SlabType[] = [
  { id: 'st_ground_xps10', name: 'Placă pe sol + XPS 10', category: 'ground',
    layers: [L('mat_xps', 100), L('mat_beton_armat', 150), L('mat_sapa', 50), L('mat_gresie', 10)] },
  { id: 'st_inter_ba15', name: 'Planșeu intermediar b.a. 15', category: 'intermediate',
    layers: [L('mat_tencuiala', 15), L('mat_beton_armat', 150), L('mat_eps', 30), L('mat_sapa', 50), L('mat_parchet', 15)] },
  { id: 'st_attic_vata25', name: 'Planșeu sub pod + vată 25', category: 'ceiling-unheated',
    layers: [L('mat_vata_bazaltica', 250), L('mat_beton_armat', 150), L('mat_tencuiala', 15)] },
  { id: 'st_roof_tile_vata25', name: 'Acoperiș țiglă + vată 25 (mansardă)', category: 'roof',
    layers: [L('mat_osb', 18), L('mat_vata_bazaltica', 250), L('mat_gips_carton', 12.5)] },
  { id: 'st_roof_flat_eps20', name: 'Terasă b.a. + EPS 20', category: 'roof',
    layers: [L('mat_eps', 200), L('mat_beton_armat', 150), L('mat_tencuiala', 15)] }
]

const EX = 'Exemplu generic — înlocuiți cu datele din fișa tehnică a produsului'
const round = (mm: number[], price: (mm: number) => number, codePrefix: string, idPrefix: string, inner?: (mm: number) => number) =>
  mm.map(v => ({ id: `${idPrefix}${v}`, label: `Ø${v}`, d: (inner ? inner(v) : v) / 1000, price: price(v), code: `${codePrefix}${v}` }))

export const DEFAULT_HVAC: HvacCatalog = {
  units: [
    { id: 'hrv_gen_300', name: 'Recuperator generic 300 m³/h', code: 'GEN-HRV-300', price: 9000, maxFlow: 300,
      curve: [{ q: 0, dp: 250 }, { q: 100, dp: 220 }, { q: 200, dp: 160 }, { q: 300, dp: 60 }],
      efficiency: 0.85, sfp: 0.30, soundPower: 48, portDiameter: 0.16, source: EX, verified: false },
    { id: 'hrv_gen_450', name: 'Recuperator generic 450 m³/h', code: 'GEN-HRV-450', price: 12500, maxFlow: 450,
      curve: [{ q: 0, dp: 300 }, { q: 150, dp: 270 }, { q: 300, dp: 200 }, { q: 450, dp: 80 }],
      efficiency: 0.88, sfp: 0.28, soundPower: 50, portDiameter: 0.18, source: EX, verified: false }
  ],
  ductMaterials: [
    { id: 'dm_spiro', name: 'Tub spiro tablă zincată', kind: 'rigid', shape: 'round', roughness: 0.15,
      sizes: round([100, 125, 160, 200, 250], v => Math.round(v * 0.25), 'SPIRO-', 'sp'),
      zetaBend90: 0.25, zetaTeeBranch: 0.8, zetaTeeThrough: 0.2, vMax: 4.0, source: EX, verified: false },
    { id: 'dm_semirigid', name: 'Tub semirigid (radial)', kind: 'semirigid', shape: 'round', roughness: 0.5,
      sizes: round([75, 90], v => (v === 75 ? 18 : 24), 'SR-', 'sr', v => (v === 75 ? 63 : 76)),
      zetaBend90: 0.4, zetaTeeBranch: 1.0, zetaTeeThrough: 0.3, vMax: 3.0, source: EX, verified: false },
    { id: 'dm_epp', name: 'Tub EPP', kind: 'epp', shape: 'round', roughness: 0.1,
      sizes: round([125, 160, 180], v => Math.round(v * 0.3), 'EPP-', 'epp'),
      zetaBend90: 0.3, zetaTeeBranch: 0.9, zetaTeeThrough: 0.25, vMax: 3.5, source: EX, verified: false },
    { id: 'dm_flex', name: 'Tub flexibil aluminiu', kind: 'flex', shape: 'round', roughness: 3.0,
      sizes: round([100, 125, 160], v => Math.round(v * 0.12), 'FLEX-', 'fx'),
      zetaBend90: 0.6, zetaTeeBranch: 1.0, zetaTeeThrough: 0.3, vMax: 3.0, source: EX, verified: false }
  ],
  terminals: [
    { id: 'tt_valve_sup', name: 'Gură refulare DN125', code: 'GEN-VS-125', use: 'supply', dn: 0.125, qRef: 30, dpRef: 20, maxFlow: 60, lwRef: 25, price: 90, source: EX, verified: false },
    { id: 'tt_valve_ext', name: 'Gură aspirație DN125', code: 'GEN-VE-125', use: 'extract', dn: 0.125, qRef: 45, dpRef: 25, maxFlow: 75, lwRef: 27, price: 90, source: EX, verified: false },
    { id: 'tt_grille_out', name: 'Grilă exterioară DN160', code: 'GEN-GR-160', use: 'outdoor', dn: 0.16, qRef: 300, dpRef: 15, maxFlow: 450, lwRef: 30, price: 160, source: EX, verified: false }
  ],
  plenums: [
    { id: 'pl_10x75', name: 'Distribuitor 10 × Ø75', code: 'GEN-PL-10', outlets: 10, qRef: 250, dpRef: 25, insertionLoss: 6, price: 650, source: EX, verified: false },
    { id: 'pl_6x75', name: 'Distribuitor 6 × Ø75', code: 'GEN-PL-6', outlets: 6, qRef: 150, dpRef: 20, insertionLoss: 5, price: 450, source: EX, verified: false }
  ]
}

export const DEFAULT_LIBRARY: Library = {
  materials: DEFAULT_MATERIALS, wallTypes: DEFAULT_WALL_TYPES, slabTypes: DEFAULT_SLAB_TYPES, hvac: DEFAULT_HVAC
}

// ---- Ventilation standards ---------------------------------------------------------
// DIN values marked verified were confirmed in IKZ-Haustechnik 10/2022 (Helios, "Lüftungskonzept", p. 41–42),
// which quotes DIN 1946-6; noise limits and comfort temperatures from I5-2022 tables 3.1.2.1 and 3.1.1.3 (cat. II).
const R = (r: Partial<RoomRule> & { tempInt: number }, verified = false): RoomRule => ({ ...r, verified })
const DIN: Record<RoomType, RoomRule> = {
  living: R({ supplyFactor: 3, tempInt: 20, noiseLimit: 35 }, true),
  bedroom: R({ supplyFactor: 2, tempInt: 20, noiseLimit: 30 }, true),
  kids: R({ supplyFactor: 2, tempInt: 20, noiseLimit: 30 }, true),
  study: R({ supplyFactor: 1.5, tempInt: 20, noiseLimit: 35 }, true),
  dining: R({ supplyFactor: 1.5, tempInt: 20, noiseLimit: 35 }, true),
  guest: R({ supplyFactor: 1.5, tempInt: 20, noiseLimit: 30 }, true),
  kitchen: R({ extract: 45, tempInt: 20 }),
  kitchenette: R({ extract: 40, tempInt: 20 }, true),
  bath: R({ extract: 45, tempInt: 24 }),
  wc: R({ extract: 25, tempInt: 20 }),
  utility: R({ extract: 25, tempInt: 18 }),
  sauna: R({ extract: 40, tempInt: 20 }, true),
  hall: R({ tempInt: 18 }),
  storage: R({ extract: 20, tempInt: 15 }, true),
  technical: R({ tempInt: 15 }),
  other: R({ tempInt: 20 })
}

const perRoom = (sup: Partial<Record<RoomType, Partial<RoomRule>>>): Record<RoomType, RoomRule> => {
  const out = {} as Record<RoomType, RoomRule>
  for (const k of Object.keys(DIN) as RoomType[]) {
    const base = DIN[k]
    out[k] = { tempInt: base.tempInt, noiseLimit: base.noiseLimit, verified: false, ...(sup[k] ?? {}) }
  }
  return out
}

export const DEFAULT_NORMS: NormProfile[] = [
  { id: 'DIN 1946-6', name: 'DIN 1946-6 — ventilare nominală', method: 'din1946', levelFactor: 1, rooms: DIN,
    source: 'DIN 1946-6 (formula q = f·(−0,002·A² + 1,15·A + 11), factori f_R,zu) — preluat din IKZ 10/2022; debitele de extracție pentru bucătărie/baie/WC sunt de verificat cu tabelul 16 din standard' },
  { id: 'I5-2022', name: 'I5-2022 — valori de pornire (de completat)', method: 'perRoom', levelFactor: 1,
    rooms: perRoom({
      living: { supplyFixed: 60 }, bedroom: { supplyPerPerson: 30 }, kids: { supplyPerPerson: 30 }, study: { supplyFixed: 30 },
      dining: { supplyFixed: 30 }, guest: { supplyPerPerson: 30 },
      kitchen: { extract: 60 }, kitchenette: { extract: 45 }, bath: { extract: 50 }, wc: { extract: 25 }, utility: { extract: 30 }, storage: { extract: 20 }, sauna: { extract: 40 }
    }),
    source: 'Valorile pe încăperi din I5-2022 (cap. 6.1 / anexe) nu au putut fi verificate automat — introduceți valorile din normativ' },
  { id: 'SR EN 16798-1', name: 'SR EN 16798-1 cat. II — valori de pornire (de completat)', method: 'perRoom', levelFactor: 1,
    rooms: perRoom({
      living: { supplyPerM2: 1.5 }, bedroom: { supplyPerM2: 1.5 }, kids: { supplyPerM2: 1.5 }, study: { supplyPerM2: 1.5 },
      dining: { supplyPerM2: 1.5 }, guest: { supplyPerM2: 1.5 },
      kitchen: { extract: 72 }, kitchenette: { extract: 72 }, bath: { extract: 54 }, wc: { extract: 36 }, utility: { extract: 36 }, storage: { extract: 20 }, sauna: { extract: 54 }
    }),
    source: 'Valori de pornire după anexa B (informativă) — de verificat cu SR EN 16798-1/NA' },
  { id: 'custom', name: 'Personalizat', method: 'din1946', levelFactor: 1, rooms: structuredClone(DIN), source: 'Introdus de utilizator' }
]

// ---- Climate ------------------------------------------------------------------------
// Zone temperatures per SR 1907-1 (I −12, II −15, III −18, IV −21, V −25 °C). Zone assignment and
// degree-days per locality are ORIENTATIVE and must be checked against SR 1907-1 / Mc 001 annexes.
const ZT = { 1: -12, 2: -15, 3: -18, 4: -21, 5: -25 } as const
const loc = (name: string, county: string, zone: 1 | 2 | 3 | 4 | 5, hdd: number): Locality =>
  ({ id: `${county}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, county, zone, thetaE: ZT[zone], hdd, verified: false })

export const LOCALITIES: Locality[] = [
  loc('București', 'B', 2, 3170), loc('Alba Iulia', 'AB', 3, 3520), loc('Arad', 'AR', 2, 3060), loc('Pitești', 'AG', 2, 3330),
  loc('Bacău', 'BC', 3, 3600), loc('Oradea', 'BH', 2, 3210), loc('Bistrița', 'BN', 3, 3780), loc('Botoșani', 'BT', 3, 3740),
  loc('Brașov', 'BV', 4, 4060), loc('Brăila', 'BR', 2, 3310), loc('Buzău', 'BZ', 2, 3290), loc('Reșița', 'CS', 2, 3140),
  loc('Călărași', 'CL', 2, 3240), loc('Cluj-Napoca', 'CJ', 3, 3700), loc('Constanța', 'CT', 1, 2850), loc('Sfântu Gheorghe', 'CV', 4, 4100),
  loc('Târgoviște', 'DB', 2, 3340), loc('Craiova', 'DJ', 2, 3170), loc('Galați', 'GL', 2, 3300), loc('Giurgiu', 'GR', 2, 3160),
  loc('Târgu Jiu', 'GJ', 2, 3250), loc('Miercurea Ciuc', 'HR', 5, 4650), loc('Deva', 'HD', 3, 3380), loc('Slobozia', 'IL', 2, 3250),
  loc('Iași', 'IS', 3, 3600), loc('Baia Mare', 'MM', 3, 3500), loc('Drobeta-Turnu Severin', 'MH', 2, 2990), loc('Târgu Mureș', 'MS', 3, 3680),
  loc('Piatra Neamț', 'NT', 3, 3640), loc('Slatina', 'OT', 2, 3230), loc('Ploiești', 'PH', 2, 3290), loc('Satu Mare', 'SM', 3, 3500),
  loc('Zalău', 'SJ', 3, 3560), loc('Sibiu', 'SB', 3, 3800), loc('Suceava', 'SV', 4, 3960), loc('Alexandria', 'TR', 2, 3200),
  loc('Timișoara', 'TM', 2, 3050), loc('Tulcea', 'TL', 2, 3080), loc('Vaslui', 'VS', 3, 3600), loc('Râmnicu Vâlcea', 'VL', 2, 3270),
  loc('Focșani', 'VN', 2, 3350)
]

export const DEFAULT_SITE: SiteSettings = {
  localityId: LOCALITIES[0].id, thetaEOverride: null, infiltrationACH: 0.1, thermalBridge: 0.05,
  energyPrice: 0.35, electricityPrice: 1.2, heatingEfficiency: 0.9, fanHours: 8760
}

export const PROJECT_DEFAULTS: ProjectDefaults = { library: DEFAULT_LIBRARY, site: DEFAULT_SITE, norms: DEFAULT_NORMS }
