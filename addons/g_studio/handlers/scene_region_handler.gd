@tool
extends RefCounted
## .gs stores pixel coordinates with origin at image top-left (0,0).
## In Godot, Sprite2D sits at image center. Obstacles/Collision containers
## are also at image center, so child coordinates = gs_coord - img_center.
## Groups are stored as string names directly (e.g. "occlude_opacity_32").


func recognize(scene_root: Node) -> Dictionary:
	var result = {"regions": [], "texture": ""}

	for child in scene_root.get_children():
		if _is_background_sprite(child, scene_root):
			if child.texture:
				result["texture"] = child.texture.resource_path
		elif _is_occlude_container(child, scene_root):
			var img_center = child.position
			for area in child.get_children():
				if area is Area2D:
					var region = _extract_occlude_region(area, img_center)
					if not region.is_empty():
						result["regions"].append(region)
		elif _is_collision_container(child, scene_root):
			var img_center = child.position
			for shape_node in child.get_children():
				var region = _extract_collision_region(shape_node, child.name, img_center)
				if not region.is_empty():
					result["regions"].append(region)

	return result


func apply(regions: Array, scene_root: Node, texture_path: String) -> void:
	var obstacles = _ensure_occlude_container(scene_root)
	_ensure_collision_container(scene_root)
	_update_background_sprite(scene_root, texture_path)

	var img_center = obstacles.position

	var occlude_regions = []
	var collision_regions = []
	for r in regions:
		var rtype = int(r.get("type", 0))
		if rtype == 1:
			occlude_regions.append(r)
		elif rtype == 2:
			collision_regions.append(r)

	_sync_occlude_regions(obstacles, occlude_regions, scene_root, img_center)
	_sync_collision_regions(scene_root, collision_regions, img_center)


func create_scene(gs_data: Dictionary, gs_path: String) -> void:
	var data = gs_data.get("data", {})
	var tscn_path = gs_path.replace(".gs", ".tscn")
	var texture_res_path = _resolve_texture(gs_path, data.get("texture", ""))

	var root = Node2D.new()
	root.name = data.get("name", "Scene")
	root.y_sort_enabled = bool(data.get("y_sort", true))

	var sprite = Sprite2D.new()
	sprite.name = "Sprite2D"
	sprite.z_index = -1
	var img_center = Vector2.ZERO
	if not texture_res_path.is_empty() and ResourceLoader.exists(texture_res_path):
		sprite.texture = load(texture_res_path)
		if sprite.texture:
			var tex_size = sprite.texture.get_size()
			img_center = tex_size / 2.0
			sprite.position = img_center
	root.add_child(sprite)
	sprite.owner = root

	var regions = data.get("regions", [])
	var occlude_regions = []
	var collision_regions = []
	for r in regions:
		var rtype = int(r.get("type", 0))
		if rtype == 1:
			occlude_regions.append(r)
		elif rtype == 2:
			collision_regions.append(r)

	if occlude_regions.size() > 0:
		var obstacles = Node2D.new()
		obstacles.name = "Obstacles"
		obstacles.position = img_center
		root.add_child(obstacles)
		obstacles.owner = root
		for region in occlude_regions:
			_create_occlude_node(obstacles, region, root, img_center)

	if collision_regions.size() > 0:
		var collision = StaticBody2D.new()
		collision.name = "Collision"
		collision.position = img_center
		root.add_child(collision)
		collision.owner = root
		for region in collision_regions:
			_create_collision_node(collision, region, root, img_center)

	var packed = PackedScene.new()
	packed.pack(root)
	ResourceSaver.save(packed, tscn_path)
	root.queue_free()


# --- Structure helpers ---

func _is_background_sprite(node: Node, scene_root: Node) -> bool:
	return node is Sprite2D and node.get_parent() == scene_root


func _is_occlude_container(node: Node, scene_root: Node) -> bool:
	return node is Node2D and node.name == "Obstacles" and node.get_parent() == scene_root


func _is_collision_container(node: Node, scene_root: Node) -> bool:
	return node is StaticBody2D and node.name == "Collision" and node.get_parent() == scene_root


# --- Extract (Godot → .gs: add img_center) ---

func _extract_occlude_region(area: Area2D, img_center: Vector2) -> Dictionary:
	var region = {
		"name": str(area.name),
		"type": 1,
		"groups": [],
	}

	for group in area.get_groups():
		region["groups"].append(String(group))

	for child in area.get_children():
		if child is CollisionPolygon2D:
			region["verts"] = _polygon_to_verts(child.polygon, img_center)
			return region
		elif child is CollisionShape2D and child.shape is RectangleShape2D:
			region["rect"] = _shape_to_rect(child, img_center)
			return region

	return {}


func _extract_collision_region(node: Node, container_name: String, img_center: Vector2) -> Dictionary:
	var rname = str(node.name)
	if rname == "CollisionPolygon2D" or rname == "CollisionShape2D":
		rname = container_name

	if node is CollisionPolygon2D:
		return {
			"name": rname,
			"type": 2,
			"verts": _polygon_to_verts(node.polygon, img_center),
		}
	elif node is CollisionShape2D and node.shape is RectangleShape2D:
		return {
			"name": rname,
			"type": 2,
			"rect": _shape_to_rect(node, img_center),
		}
	return {}


# --- Ensure containers ---

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


# --- Sync ---

func _sync_occlude_regions(container: Node, regions: Array, scene_root: Node, img_center: Vector2) -> void:
	var existing = {}
	for child in container.get_children():
		if child is Area2D:
			existing[str(child.name)] = child

	var processed = []
	for region in regions:
		var rname = region.get("name", "")
		processed.append(rname)
		if existing.has(rname):
			_update_occlude_node(existing[rname], region, img_center)
		else:
			_create_occlude_node(container, region, scene_root, img_center)

	for key in existing:
		if not processed.has(key):
			existing[key].queue_free()


func _sync_collision_regions(scene_root: Node, regions: Array, img_center: Vector2) -> void:
	var container = _ensure_collision_container(scene_root)
	var existing = {}
	for child in container.get_children():
		existing[str(child.name)] = child

	var processed = []
	for region in regions:
		var rname = region.get("name", "")
		processed.append(rname)
		if existing.has(rname):
			_update_collision_node(existing[rname], region, img_center)
		else:
			_create_collision_node(container, region, scene_root, img_center)

	for key in existing:
		if not processed.has(key):
			existing[key].queue_free()


# --- Create nodes (.gs → Godot: subtract img_center) ---

func _create_occlude_node(parent: Node, region: Dictionary, owner: Node, img_center: Vector2) -> void:
	var area = Area2D.new()
	area.name = region.get("name", "Region")
	parent.add_child(area)
	area.owner = owner

	var groups = region.get("groups", [])
	for g in groups:
		var gs = String(g)
		if not gs.is_empty():
			area.add_to_group(gs, true)

	if region.has("verts"):
		var poly = CollisionPolygon2D.new()
		poly.name = "CollisionPolygon2D"
		poly.polygon = _verts_to_polygon(region.get("verts"), img_center)
		area.add_child(poly)
		poly.owner = owner
	elif region.has("rect"):
		var shape_node = CollisionShape2D.new()
		shape_node.name = "CollisionShape2D"
		var rect = region.get("rect")
		var shape = RectangleShape2D.new()
		shape.size = Vector2(rect[2], rect[3])
		shape_node.shape = shape
		shape_node.position = Vector2(rect[0] + rect[2] / 2.0 - img_center.x, rect[1] + rect[3] / 2.0 - img_center.y)
		area.add_child(shape_node)
		shape_node.owner = owner


func _create_collision_node(parent: Node, region: Dictionary, owner: Node, img_center: Vector2) -> void:
	var rname = region.get("name", "Collision")

	if region.has("verts"):
		var poly = CollisionPolygon2D.new()
		poly.name = rname
		poly.polygon = _verts_to_polygon(region.get("verts"), img_center)
		parent.add_child(poly)
		poly.owner = owner
	elif region.has("rect"):
		var shape_node = CollisionShape2D.new()
		shape_node.name = rname
		var rect = region.get("rect")
		var shape = RectangleShape2D.new()
		shape.size = Vector2(rect[2], rect[3])
		shape_node.shape = shape
		shape_node.position = Vector2(rect[0] + rect[2] / 2.0 - img_center.x, rect[1] + rect[3] / 2.0 - img_center.y)
		parent.add_child(shape_node)
		shape_node.owner = owner


# --- Update nodes ---

func _update_occlude_node(area: Area2D, region: Dictionary, img_center: Vector2) -> void:
	var desired_groups = []
	for g in region.get("groups", []):
		var gs = String(g)
		if not gs.is_empty():
			desired_groups.append(gs)

	for group in area.get_groups():
		var gs = String(group)
		if not desired_groups.has(gs):
			area.remove_from_group(gs)
	for group in desired_groups:
		if not area.is_in_group(group):
			area.add_to_group(group, true)

	for child in area.get_children():
		if child is CollisionPolygon2D and region.has("verts"):
			child.polygon = _verts_to_polygon(region.get("verts"), img_center)
			return
		elif child is CollisionShape2D and region.has("rect"):
			var rect = region.get("rect")
			child.shape.size = Vector2(rect[2], rect[3])
			child.position = Vector2(rect[0] + rect[2] / 2.0 - img_center.x, rect[1] + rect[3] / 2.0 - img_center.y)
			return


func _update_collision_node(node: Node, region: Dictionary, img_center: Vector2) -> void:
	if node is CollisionPolygon2D and region.has("verts"):
		node.polygon = _verts_to_polygon(region.get("verts"), img_center)
	elif node is CollisionShape2D and region.has("rect"):
		var rect = region.get("rect")
		node.shape.size = Vector2(rect[2], rect[3])
		node.position = Vector2(rect[0] + rect[2] / 2.0 - img_center.x, rect[1] + rect[3] / 2.0 - img_center.y)


# --- Conversion: .gs ↔ Godot ---

func _polygon_to_verts(polygon: PackedVector2Array, img_center: Vector2) -> Array:
	var result = []
	for point in polygon:
		result.append([point.x + img_center.x, point.y + img_center.y])
	return result


func _verts_to_polygon(verts: Array, img_center: Vector2) -> PackedVector2Array:
	var result = PackedVector2Array()
	for v in verts:
		result.append(Vector2(v[0] - img_center.x, v[1] - img_center.y))
	return result


func _shape_to_rect(shape_node: CollisionShape2D, img_center: Vector2) -> Array:
	var shape = shape_node.shape as RectangleShape2D
	var pos = shape_node.position
	var x = pos.x - shape.size.x / 2.0 + img_center.x
	var y = pos.y - shape.size.y / 2.0 + img_center.y
	return [x, y, shape.size.x, shape.size.y]


func _resolve_texture(gs_path: String, relative: String) -> String:
	if relative.is_empty():
		return ""
	var gs_dir = gs_path.get_base_dir()
	return gs_dir.path_join(relative).simplify_path()
