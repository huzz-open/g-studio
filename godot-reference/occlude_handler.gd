## 遮挡处理器（子节点组件）
## 作为子节点添加到任何需要遮挡功能的实体下
## 自动发现同级的 Sprite2D 和 Area2D，也可通过 @export 手动指定
##
## 1:1 结构：每个遮挡区域是独立的 Area2D，groups 在 Area2D 上。
## 使用 area_entered/exited 信号，自动聚合凸分解子形状，无需引用计数。
class_name OccludeHandler extends Node

const OPACITY_PREFIX = "occlude_opacity_"

@export var sprite: Sprite2D
@export var detection_area: Area2D
@export var occlude_shader: Shader = preload("res://shaders/occlude.gdshader")

class OccludeData:
	var area: Area2D
	var world_points: Array[Vector2]
	var is_y_sort: bool
	var sort_y: float
	var opacity: float
	var is_screen_mask: bool

var _active: Dictionary = {}    # Area2D → OccludeData
var _current: Area2D = null

func _ready() -> void:
	if not sprite or not detection_area:
		for child in get_parent().get_children():
			if not sprite and child is Sprite2D:
				sprite = child as Sprite2D
			elif not detection_area and child is Area2D:
				detection_area = child as Area2D
	_ensure_shader_material()
	detection_area.area_entered.connect(_on_area_entered)
	detection_area.area_exited.connect(_on_area_exited)

func _ensure_shader_material() -> void:
	if sprite.material is ShaderMaterial:
		printerr("OccludeHandler: Sprite2D '%s' 已有 ShaderMaterial，遮挡 shader 未自动挂载。\n如需遮挡功能，请在自定义 shader 中 #include \"occlude.gdshaderinc\"。" % sprite.name)
		return
	var mat := ShaderMaterial.new()
	mat.shader = occlude_shader
	sprite.material = mat

func _physics_process(_delta: float) -> void:
	if not _current:
		return
	var data: OccludeData = _active.get(_current)
	if not data or not data.is_y_sort:
		return
	var mat := sprite.material as ShaderMaterial
	var player_y: float = get_parent().global_position.y
	if player_y >= data.sort_y:
		mat.set_shader_parameter("point_count", 0)
	else:
		_set_poly(mat, data)

static func parse_opacity(area: Area2D) -> float:
	for group in area.get_groups():
		var g := group as String
		if g.begins_with(OPACITY_PREFIX):
			var val := g.substr(OPACITY_PREFIX.length()).to_int()
			return clampf(float(val) / 100.0, 0.0, 1.0)
	return -1.0

func _on_area_entered(area: Area2D) -> void:
	var is_top := area.is_in_group("occlude_top_layer")
	var is_y_sort := area.is_in_group("occlude_y_sort")
	var is_screen_mask := area.is_in_group("occlude_screen_mask")
	var opacity := parse_opacity(area)
	if not (is_top or is_y_sort or is_screen_mask or opacity >= 0.0):
		return

	var shape_node := _find_shape_child(area)

	var data := OccludeData.new()
	data.area = area
	data.world_points = _get_world_points(shape_node)
	data.is_y_sort = is_y_sort
	data.is_screen_mask = is_screen_mask
	data.opacity = opacity if opacity >= 0.0 else 0.0
	if is_y_sort:
		data.sort_y = -INF
		for p in data.world_points:
			if p.y > data.sort_y:
				data.sort_y = p.y

	_active[area] = data
	_apply(area, data)

func _on_area_exited(area: Area2D) -> void:
	_active.erase(area)
	if area == _current:
		if _active.is_empty():
			_clear_shader()
		else:
			var next: Area2D = _active.keys()[0]
			_apply(next, _active[next])

func _apply(area: Area2D, data: OccludeData) -> void:
	_current = area
	var mat := sprite.material as ShaderMaterial
	mat.set_shader_parameter("use_screen_mask", data.is_screen_mask)
	mat.set_shader_parameter("occlude_opacity", data.opacity)
	if data.is_y_sort:
		var player_y: float = get_parent().global_position.y
		if player_y >= data.sort_y:
			mat.set_shader_parameter("point_count", 0)
		else:
			_set_poly(mat, data)
	else:
		_set_poly(mat, data)

func _set_poly(mat: ShaderMaterial, data: OccludeData) -> void:
	mat.set_shader_parameter("point_count", data.world_points.size())
	mat.set_shader_parameter("poly", data.world_points)

func _clear_shader() -> void:
	_current = null
	var mat := sprite.material as ShaderMaterial
	mat.set_shader_parameter("point_count", 0)
	mat.set_shader_parameter("use_screen_mask", false)

## 找到 Area2D 下的第一个形状子节点
func _find_shape_child(area: Area2D) -> Node2D:
	for child in area.get_children():
		if child is CollisionPolygon2D or child is CollisionShape2D:
			return child as Node2D
	return null

## 从形状节点提取世界坐标多边形点
func _get_world_points(shape_node: Node2D) -> Array[Vector2]:
	var local_points: Array[Vector2] = []
	if shape_node is CollisionPolygon2D:
		var poly_node := shape_node as CollisionPolygon2D
		local_points.assign(poly_node.polygon)
	elif shape_node is CollisionShape2D:
		var cs := shape_node as CollisionShape2D
		if cs.shape is RectangleShape2D:
			var half := (cs.shape as RectangleShape2D).size / 2.0
			local_points = [
				Vector2(-half.x, -half.y), Vector2(half.x, -half.y),
				Vector2(half.x, half.y), Vector2(-half.x, half.y),
			]
	var world_points: Array[Vector2] = []
	for p in local_points:
		world_points.append(shape_node.to_global(p))
	return world_points
