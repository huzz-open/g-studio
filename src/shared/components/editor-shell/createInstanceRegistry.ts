export function createInstanceRegistry<T>(factory: (id: string) => T) {
  const instances = new Map<string, T>()

  function get(id: string): T {
    let inst = instances.get(id)
    if (!inst) {
      inst = factory(id)
      instances.set(id, inst)
    }
    return inst
  }

  function remove(id: string): boolean {
    return instances.delete(id)
  }

  function has(id: string): boolean {
    return instances.has(id)
  }

  return { get, remove, has }
}
