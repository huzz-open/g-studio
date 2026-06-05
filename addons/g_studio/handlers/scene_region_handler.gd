@tool
extends RefCounted
## Handler for GsType.SceneRegion (type=1).
## Implements recognize, apply, and create_scene.

const GROUP_MAP = {
	"occlude_top_layer": 1,
	"occlude_y_sort": 2,
	"occlude_screen_mask": 3,
	"occlude_opacity_50": 4,
}

const REVERSE_GROUP_MAP = {
	1: "occlude_top_layer",
	2: "occlude_y_sort",
	3: "occlude_screen_mask",
	4: "occlude_opacity_50",
}


# --- recognize: scene tree → .gs data ---

func recognize(scene_root: Node) -> Dictionary:
	var result = {"regions": [], "texture": ""}

	for child in scene_root.get_children():
		if _is_background_sprite(child, scene_root):
			if child.texture:
				result.texture = child.texture.resource_path
		elif _is_occlude_container(child, scene_root):
			for area in child.get_children():
				if area is Area2D:
					var region = _extract_occlude_region(area)
					if not region.is_empty():
						result.regions.append(region)
		elif _is_collision_container(child, scene_root):
			for shape_node in child.get_children():
				var region = _extract_collision_region(shape_node, child.name)
				if not region.is_empty():
					result.regions.append(region)

	return result


# --- apply: .gs data → scene tree (in-place update) ---

func apply(regions: Array, scene_root: Node, texture_path: String) -> void:
	var obstacles = _ensure_occlude_container(scene_root)
	_ensure_collision_container(scene_root)
	_update_background_sprite(scene_root, texture_path)

	var occlude_regions = regions.filter(func(r): return r.get("type", 0) == 1)
	var collision_regions = regions.filter(func(r): return r.get("type", 0) == 2)

	_sync_occlude_regions(obstacles, occlude_regions, scene_root)
	_sync_collision_regions(scene_root, collision_regions)


# --- create_scene: .gs → new .tscn ---

func create_scene(gs_data: Dictionary, gs_path: String) -> void:
	var data = gs_data.get("data", {})
	var tscn_path = gs_path.replace(".gs", ".tscn")
	var texture_res_path = _resolve_texture(gs_path, data.get("texture", ""))

	var root = Node2D.new()
	root.name = data.get("name", "Scene")
	root.y_sort_enabled = data.get("y_sort", true)

	# Background sprite
	var sprite = Sprite2D.new()
	sprite.name = "Sprite2D"
	if not texture_res_path.is_empty() and ResourceLoader.exists(texture_res_path):
		sprite.texture = load(texture_res_path)
		if sprite.texture:
			var tex_size = sprite.texture.get_size()
			sprite.position = tex_size / 2.0
	root.add_child(sprite)
	sprite.owner = root

	# Apply regions
	var regions = data.get("regions", [])
	var occlude_regions = regions.filter(func(r): return r.get("type", 0) == 1)
	var collision_regions = regions.filter(func(r): return r.get("type", 0) == 2)

	if occlude_regions.size() > 0:
		var obstacles = Node2D.new()
		obstacles.name = "Obstacles"
		if sprite.texture:
			obstacles.position = sprite.position
		root.add_child(obstacles)
		obstacles.owner = root

		for region in occlude_regions:
			_create_occlude_node(obstacles, region, root)

	if collision_regions.size() > 0:
		var collision = StaticBody2D.new()
		collision.name = "Collision"
		if sprite.texture:
			collision.position = sprite.position
		root.add_child(collision)
		collision.owner = root

		for region in collision_regions:
			_create_collision_node(collision, region, root)

	# Save as .tscn
	var packed = PackedScene.new()
	packed.pack(root)
	ResourceSaver.save(packed, tscn_path)
	root.queue_free()


# --- Structure recognition helpers ---

func _is_background_sprite(node: Node, scene_root: Node) -> bool:
	return node is Sprite2D and node.get_parent() == scene_root


func _is_occlude_container(node: Node, scene_root: Node) -> bool:
	return (node.name == "Obstacles"
		and node is Node2D
		and node.get_parent() == scene_root)


func _is_collision_container(node: Node, scene_root: Node) -> bool:
	return (node is StaticBody2D
		and node.name == "Collision"
		and node.get_parent() == scene_root)


# --- Extract data from existing nodes ---

func _extract_occlude_region(area: Area2D) -> Dictionary:
	var region = {
		"name": area.name,
		"type": 1,
		"groups": [],
	}

	for group in area.get_groups():
		if GROUP_MAP.has(group):
			region.groups.append(GROUP_MAP[group])

	for child in area.get_children():
		if child is CollisionPolygon2D:
			region["verts"] = _polygon_to_verts(child.polygon)
			return region
		elif child is CollisionShape2D and child.shape is RectangleShape2D:
			region["rect"] = _shape_to_rect(child)
			return region

	return {}


func _extract_collision_region(node: Node, container_name: String) -> Dictionary:
	var name = node.name if node.name != "CollisionPolygon2D" and node.name != "CollisionShape2D" else container_name

	if node is CollisionPolygon2D:
		return {
			"name": name,
			"type": 2,
			"verts": _polygon_to_verts(node.polygon),
		}
	elif node is CollisionShape2D and node.shape is RectangleShape2D:
		return {
			"name": name,
			"type": 2,
			"rect": _shape_to_rect(node),
		}
	return {}


# --- Sync helpers ---

func _ensure_occlude_container(scene_root: Node) -> Node:
	for child in scene_root.get_children():
		if _is_occlude_container(child, scene_root):
			return child
	var obstacles = Node2D.new()
	obstacles.name = "Obstacles"
	scene_root.add_child(obstacles)
	obstacles.owner = scene_root
	return obstacles


func _ensure_collision_container(scene_root: Node) -> Node:
	for child in scene_root.get_children():
		if _is_collision_container(child, scene_root):
			return child
	var collision = StaticBody2D.new()
	collision.name = "Collision"
	scene_root.add_child(collision)
	collision.owner = scene_root
	return collision


func _update_background_sprite(scene_root: Node, texture_path: String) -> void:
	if texture_path.is_empty():
		return
	for child in scene_root.get_children():
		if _is_background_sprite(child, scene_root):
			if ResourceLoader.exists(texture_path):
				child.texture = load(texture_path)
			return


func _sync_occlude_regions(container: Node, regions: Array, scene_root: Node) -> void:
	var existing: Dictionary = {}
	for child in container.get_children():
		if child is Area2D:
			existing[child.name] = child

	var processed_names: Array = []

	for region in regions:
		var rname = region.get("name", "")
		processed_names.append(rname)

		if existing.has(rname):
			_update_occlude_node(existing[rname], region)
		else:
			_create_occlude_node(container, region, scene_root)

	for name in existing:
		if name not in processed_names:
			existing[name].queue_free()


func _sync_collision_regions(scene_root: Node, regions: Array) -> void:
	var container = _ensure_collision_container(scene_root)
	var existing: Dictionary = {}
	for child in container.get_children():
		existing[child.name] = child

	var processed_names: Array = []

	for region in regions:
		var rname = region.get("name", "")
		processed_names.append(rname)

		if existing.has(rname):
			_update_collision_node(existing[rname], region)
		else:
			_create_collision_node(container, region, scene_root)

	for name in existing:
		if name not in processed_names:
			existing[name].queue_free()


# --- Node creation ---

func _create_occlude_node(parent: Node, region: Dictionary, owner: Node) -> void:
	var area = Area2D.new()
	area.name = region.get("name", "Region")
	parent.add_child(area)
	area.owner = owner

	# Set groups
	var groups = region.get("groups", [])
	for g in groups:
		if REVERSE_GROUP_MAP.has(g):
			area.add_to_group(REVERSE_GROUP_MAP[g])

	# Create shape
	if region.has("verts"):
		var poly = CollisionPolygon2D.new()
		poly.name = "CollisionPolygon2D"
		poly.polygon = _verts_to_polygon(region.verts)
		area.add_child(poly)
		poly.owner = owner
	elif region.has("rect"):
		var shape_node = CollisionShape2D.new()
		shape_node.name = "CollisionShape2D"
		var rect = region.rect
		var shape = RectangleShape2D.new()
		shape.size = Vector2(rect[2], rect[3])
		shape_node.shape = shape
		shape_node.position = Vector2(rect[0] + rect[2] / 2.0, rect[1] + rect[3] / 2.0)
		area.add_child(shape_node)
		shape_node.owner = owner


func _create_collision_node(parent: Node, region: Dictionary, owner: Node) -> void:
	var rname = region.get("name", "Collision")

	if region.has("verts"):
		var poly = CollisionPolygon2D.new()
		poly.name = rname
		poly.polygon = _verts_to_polygon(region.verts)
		parent.add_child(poly)
		poly.owner = owner
	elif region.has("rect"):
		var shape_node = CollisionShape2D.new()
		shape_node.name = rname
		var rect = region.rect
		var shape = RectangleShape2D.new()
		shape.size = Vector2(rect[2], rect[3])
		shape_node.shape = shape
		shape_node.position = Vector2(rect[0] + rect[2] / 2.0, rect[1] + rect[3] / 2.0)
		parent.add_child(shape_node)
		shape_node.owner = owner


# --- Node update ---

func _update_occlude_node(area: Area2D, region: Dictionary) -> void:
	# Update groups
	var desired_groups: Array = []
	for g in region.get("groups", []):
		if REVERSE_GROUP_MAP.has(g):
			desired_groups.append(REVERSE_GROUP_MAP[g])

	for group in area.get_groups():
		if GROUP_MAP.has(group) and group not in desired_groups:
			area.remove_from_group(group)
	for group in desired_groups:
		if not area.is_in_group(group):
			area.add_to_group(group)

	# Update shape
	for child in area.get_children():
		if child is CollisionPolygon2D and region.has("verts"):
			child.polygon = _verts_to_polygon(region.verts)
			return
		elif child is CollisionShape2D and region.has("rect"):
			var rect = region.rect
			child.shape.size = Vector2(rect[2], rect[3])
			child.position = Vector2(rect[0] + rect[2] / 2.0, rect[1] + rect[3] / 2.0)
			return


func _update_collision_node(node: Node, region: Dictionary) -> void:
	if node is CollisionPolygon2D and region.has("verts"):
		node.polygon = _verts_to_polygon(region.verts)
	elif node is CollisionShape2D and region.has("rect"):
		var rect = region.rect
		node.shape.size = Vector2(rect[2], rect[3])
		node.position = Vector2(rect[0] + rect[2] / 2.0, rect[1] + rect[3] / 2.0)


# --- Data conversion utilities ---

func _polygon_to_verts(polygon: PackedVector2Array) -> Array:
	var result = []
	for point in polygon:
		result.append([point.x, point.y])
	return result


func _verts_to_polygon(verts: Array) -> PackedVector2Array:
	var result = PackedVector2Array()
	for v in verts:
		result.append(Vector2(v[0], v[1]))
	return result


func _shape_to_rect(shape_node: CollisionShape2D) -> Array:
	var shape = shape_node.shape as RectangleShape2D
	var pos = shape_node.position
	var x = pos.x - shape.size.x / 2.0
	var y = pos.y - shape.size.y / 2.0
	return [x, y, shape.size.x, shape.size.y]


func _resolve_texture(gs_path: String, relative: String) -> String:
	if relative.is_empty():
		return ""
	var gs_dir = gs_path.get_base_dir()
	return gs_dir.path_join(relative).simplify_path()
