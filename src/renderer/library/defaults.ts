// Starter construction library. Every λ value here is ORIENTATIVE and flagged verified:false
// until checked against the Mc 001-2022 / C107 material tables or the manufacturer's declaration.
import type { Library, Material, WallType } from '../core/types'

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

export const DEFAULT_LIBRARY: Library = { materials: DEFAULT_MATERIALS, wallTypes: DEFAULT_WALL_TYPES }
