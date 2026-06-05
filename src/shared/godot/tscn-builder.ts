/**
 * Type-safe .tscn file builder for Godot 4.x (format=3).
 * Generates valid text scene files that Godot can open directly.
 */

export interface ExtResource {
  type: string
  path: string
}

export interface SubResource {
  type: string
  props: Record<string, string>
}

export interface SceneNode {
  name: string
  type: string
  parent: string
  groups?: string[]
  props?: Record<string, string>
}

export class TscnBuilder {
  private extResources: ExtResource[] = []
  private subResources: { id: string; res: SubResource }[] = []
  private nodes: SceneNode[] = []
  private rootName = 'Root'
  private rootType = 'Node2D'
  private rootProps: Record<string, string> = {}

  private extIdCounter = 0
  private subIdCounter = 0

  setRoot(name: string, type: string, props?: Record<string, string>): this {
    this.rootName = name
    this.rootType = type
    if (props) this.rootProps = props
    return this
  }

  addExtResource(type: string, path: string): string {
    this.extIdCounter++
    const id = String(this.extIdCounter)
    this.extResources.push({ type, path })
    return id
  }

  addSubResource(type: string, props: Record<string, string>): string {
    this.subIdCounter++
    const id = `SubResource_${this.subIdCounter}`
    this.subResources.push({ id, res: { type, props } })
    return id
  }

  addNode(node: SceneNode): this {
    this.nodes.push(node)
    return this
  }

  build(): string {
    const lines: string[] = []
    const loadSteps = this.extResources.length + this.subResources.length + 1

    lines.push(`[gd_scene load_steps=${loadSteps} format=3]`)
    lines.push('')

    for (let i = 0; i < this.extResources.length; i++) {
      const res = this.extResources[i]
      lines.push(`[ext_resource type="${res.type}" path="${res.path}" id="${i + 1}"]`)
    }
    if (this.extResources.length > 0) lines.push('')

    for (const { id, res } of this.subResources) {
      lines.push(`[sub_resource type="${res.type}" id="${id}"]`)
      for (const [k, v] of Object.entries(res.props)) {
        lines.push(`${k} = ${v}`)
      }
      lines.push('')
    }

    lines.push(`[node name="${escapeNodeName(this.rootName)}" type="${this.rootType}"]`)
    for (const [k, v] of Object.entries(this.rootProps)) {
      lines.push(`${k} = ${v}`)
    }
    lines.push('')

    for (const node of this.nodes) {
      const parts = [`name="${escapeNodeName(node.name)}"`, `type="${node.type}"`, `parent="${node.parent}"`]
      if (node.groups && node.groups.length > 0) {
        parts.push(`groups=[${node.groups.map(g => `"${g}"`).join(', ')}]`)
      }
      lines.push(`[node ${parts.join(' ')}]`)
      if (node.props) {
        for (const [k, v] of Object.entries(node.props)) {
          lines.push(`${k} = ${v}`)
        }
      }
      lines.push('')
    }

    return lines.join('\n')
  }
}

export function escapeNodeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

export function formatVector2(x: number, y: number): string {
  return `Vector2(${x}, ${y})`
}

export function formatPackedVector2Array(points: [number, number][]): string {
  return 'PackedVector2Array(' + points.map(([x, y]) => `${x}, ${y}`).join(', ') + ')'
}

export function formatExtResourceRef(id: string): string {
  return `ExtResource("${id}")`
}

export function formatSubResourceRef(id: string): string {
  return `SubResource("${id}")`
}
