// Recovery performance, frost risk, condensation/insulation advice, room noise and annual savings.
import type { Project } from '../core/types'
import type { AirflowResult } from './airflow'
import type { NetworkResult } from './network'
import { siteClimate } from './heatload'

export interface EnergyResult {
  eta: number
  thetaE: number; thetaI: number
  supplyTemp: number // after recovery at design conditions
  exhaustTemp: number // leaving the unit
  frostRisk: boolean
  /** Ventilation heat demand per year without / with recovery, kWh. */
  qWithout: number; qWith: number; recovered: number
  fanPowerW: number; fanKWh: number
  costWithout: number; costWith: number; savings: number
  co2Saved: number // kg/yr at an indicative 0.2 kg/kWh heat
  ductAdvice: { system: string; inHeated: boolean; advice: string }[]
}

export function computeEnergy(p: Project, air: AirflowResult): EnergyResult {
  const { loc, thetaE } = siteClimate(p)
  const unit = p.hvac.units[0]
  const type = unit ? p.library.hvac.units.find(u => u.id === unit.typeId) : undefined
  const eta = type?.efficiency ?? 0
  const thetaI = 20
  const q = air.qTotal
  const supplyTemp = thetaE + eta * (thetaI - thetaE)
  const exhaustTemp = thetaI - eta * (thetaI - thetaE)
  // Ventilation heat demand over the heating season: 0,34 · q · HDD · 24 / 1000 (kWh)
  const qWithout = (0.34 * q * loc.hdd * 24) / 1000
  const qWith = qWithout * (1 - eta)
  const recovered = qWithout - qWith
  const fanPowerW = (type?.sfp ?? 0) * q
  const fanKWh = (fanPowerW * p.site.fanHours) / 1000
  const costWithout = (qWithout / p.site.heatingEfficiency) * p.site.energyPrice
  const costWith = (qWith / p.site.heatingEfficiency) * p.site.energyPrice + fanKWh * p.site.electricityPrice
  return {
    eta, thetaE, thetaI, supplyTemp, exhaustTemp, frostRisk: exhaustTemp < 0,
    qWithout, qWith, recovered, fanPowerW, fanKWh, costWithout, costWith, savings: costWithout - costWith,
    co2Saved: (recovered / p.site.heatingEfficiency) * 0.2,
    ductAdvice: [
      { system: 'outdoor', inHeated: true, advice: 'vaporBarrier' },
      { system: 'exhaust', inHeated: true, advice: 'vaporBarrier' },
      { system: 'supply', inHeated: false, advice: 'thermalIfUnheated' },
      { system: 'extract', inHeated: false, advice: 'thermalIfUnheated' }
    ]
  }
}

export interface RoomNoise { roomId: string; name: string; lp: number; limit: number | null; ok: boolean }

/**
 * Simplified room noise estimate: unit sound power at the supply port minus plenum insertion loss and a
 * natural duct attenuation per metre, split between the terminals; plus terminal self-noise; room correction
 * −8 dB (typical furnished room). Indicative only — final check with the manufacturer's acoustic data.
 */
export function computeNoise(p: Project, air: AirflowResult, net: NetworkResult): RoomNoise[] {
  const unit = p.hvac.units[0]
  const type = unit ? p.library.hvac.units.find(u => u.id === unit.typeId) : undefined
  if (!type) return []
  const ATT_PER_M = 0.5 // dB/m, indicative for small round ducts
  const ROOM_CORR = -8
  const out: RoomNoise[] = []
  for (const rf of air.rooms) {
    const terms = net.terminals.filter(t => t.roomId === rf.roomId && t.connected && (t.system === 'supply' || t.system === 'extract'))
    if (!terms.length) continue
    let energy = 0
    for (const t of terms) {
      const share = t.q / Math.max(1, t.system === 'supply' ? net.qSupply : net.qExtract)
      const segs = net.segments.filter(s => s.system === t.system)
      const pathLen = segs.length ? Math.min(30, segs.reduce((s, x) => s + x.length, 0) / Math.max(1, net.terminals.filter(x => x.system === t.system).length)) : 5
      const pl = p.hvac.plenums.find(x => x.system === t.system)
      const il = pl ? p.library.hvac.plenums.find(x => x.id === pl.typeId)?.insertionLoss ?? 0 : 0
      const fromUnit = type.soundPower + 10 * Math.log10(Math.max(share, 1e-6)) - il - ATT_PER_M * pathLen
      const tt = p.library.hvac.terminals.find(x => x.id === p.hvac.terminals.find(y => y.id === t.terminalId)?.typeId)
      const self = tt ? tt.lwRef + 50 * Math.log10(Math.max(t.q, 1) / tt.qRef) : 0
      energy += Math.pow(10, fromUnit / 10) + Math.pow(10, self / 10)
    }
    const lp = 10 * Math.log10(energy) + ROOM_CORR
    const limit = air.profile.rooms[rf.type]?.noiseLimit ?? null
    out.push({ roomId: rf.roomId, name: rf.name, lp, limit, ok: limit == null || lp <= limit })
  }
  return out
}
