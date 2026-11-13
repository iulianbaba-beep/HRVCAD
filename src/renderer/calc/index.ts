// All analyses for a project snapshot, memoised on the (immutable) project object.
import type { Project } from '../core/types'
import { computeAirflows, type AirflowResult } from './airflow'
import { analyseNetwork, type NetworkResult } from './network'
import { computeHeatLoad, type HeatLoadResult } from './heatload'
import { computeEnergy, computeNoise, type EnergyResult, type RoomNoise } from './energy'
import { modelChecks, type Check } from './checks'

export interface Analysis {
  air: AirflowResult
  net: NetworkResult
  heat: HeatLoadResult
  energy: EnergyResult
  noise: RoomNoise[]
  checks: Check[]
}

const memo = new WeakMap<Project, Analysis>()

export function analyse(p: Project): Analysis {
  const m = memo.get(p)
  if (m) return m
  const air = computeAirflows(p)
  const net = analyseNetwork(p, air)
  const heat = computeHeatLoad(p, air)
  const energy = computeEnergy(p, air)
  const noise = computeNoise(p, air, net)
  const checks = modelChecks(p, air, net)
  const a = { air, net, heat, energy, noise, checks }
  memo.set(p, a)
  return a
}
