export interface Glicko2Rating {
  rating: number
  rd: number
  volatility: number
}

export interface Glicko2Game {
  opponent: Glicko2Rating
  score: number
}

export const GLICKO2_DEFAULTS: Glicko2Rating = {
  rating: 1500,
  rd: 350,
  volatility: 0.06,
}

const SCALE = 173.7178
const TAU = 0.5

function toMu(rating: number): number {
  return (rating - 1500) / SCALE
}

function toPhi(rd: number): number {
  return rd / SCALE
}

function fromMu(mu: number): number {
  return mu * SCALE + 1500
}

function fromPhi(phi: number): number {
  return phi * SCALE
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))
}

function updateVolatility(
  phi: number,
  sigma: number,
  delta: number,
  v: number,
  tau = TAU,
): number {
  const a = Math.log(sigma * sigma)
  const phi2 = phi * phi
  const tau2 = tau * tau
  const delta2 = delta * delta

  function f(x: number): number {
    const ex = Math.exp(x)
    const num = ex * (delta2 - phi2 - v - ex)
    const den = 2 * (phi2 + v + ex) ** 2
    return num / den - (x - a) / tau2
  }

  let A = a
  if (delta2 > phi2 + v) {
    A = Math.log(delta2 - phi2 - v)
  }

  let B: number
  if (delta2 > phi2 + v) {
    B = a
  } else {
    let k = 1
    while (f(a - k * tau) < 0) k++
    B = a - k * tau
  }

  let fA = f(A)
  let fB = f(B)

  while (Math.abs(B - A) > 1e-6) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB < 0) {
      A = B
      fA = fB
    } else {
      fA /= 2
    }
    B = C
    fB = fC
  }

  return Math.exp(A / 2)
}

/** Update one player after a rating period (one or more games). */
export function updateGlicko2Player(
  player: Glicko2Rating,
  games: Glicko2Game[],
  tau = TAU,
): Glicko2Rating {
  const mu = toMu(player.rating)
  const phi = toPhi(player.rd)
  const sigma = player.volatility

  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma)
    return { rating: player.rating, rd: fromPhi(phiStar), volatility: sigma }
  }

  let vInv = 0
  let deltaSum = 0

  for (const game of games) {
    const muJ = toMu(game.opponent.rating)
    const phiJ = toPhi(game.opponent.rd)
    const gJ = g(phiJ)
    const eJ = expectedScore(mu, muJ, phiJ)
    vInv += gJ * gJ * eJ * (1 - eJ)
    deltaSum += gJ * (game.score - eJ)
  }

  const v = 1 / vInv
  const delta = v * deltaSum
  const newSigma = updateVolatility(phi, sigma, delta, v, tau)
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma)
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const newMu = mu + newPhi * newPhi * deltaSum

  return {
    rating: fromMu(newMu),
    rd: fromPhi(newPhi),
    volatility: newSigma,
  }
}
