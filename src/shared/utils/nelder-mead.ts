/** Standard Nelder–Mead: reflection 1, expansion 2, contraction/shrink 1/2.
 * Derivative-free local minimization; callers supply multiple starting points. */
export function nelderMead(loss: (x: number[]) => number, initial: number[], steps: number[], iterations = 120) {
  const evaluate = (x: number[]) => ({ x, loss: loss(x) })
  const simplex = [evaluate([...initial]), ...initial.map((_, i) => evaluate(initial.map((v, j) => v + (i === j ? steps[i] : 0))))]
  const n = initial.length
  for (let iteration = 0; iteration < iterations; iteration++) {
    simplex.sort((a, b) => a.loss - b.loss)
    if (simplex.every(p => p.x.every((v, j) => Math.abs(v - simplex[0]!.x[j]) < steps[j] * .015))) break
    const centroid = initial.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n)
    const worst = simplex[n]!, best = simplex[0]!
    const at = (factor: number) => evaluate(centroid.map((v, j) => v + factor * (v - worst.x[j])))
    const reflected = at(1)
    if (reflected.loss < best.loss) {
      const expanded = at(2); simplex[n] = expanded.loss < reflected.loss ? expanded : reflected
    } else if (reflected.loss < simplex[n - 1]!.loss) simplex[n] = reflected
    else {
      const outside = reflected.loss < worst.loss, contracted = at(outside ? .5 : -.5)
      if (contracted.loss < (outside ? reflected.loss : worst.loss)) simplex[n] = contracted
      else for (let i = 1; i <= n; i++) simplex[i] = evaluate(simplex[i]!.x.map((v, j) => best.x[j] + .5 * (v - best.x[j])))
    }
  }
  simplex.sort((a, b) => a.loss - b.loss)
  return simplex[0]!
}
