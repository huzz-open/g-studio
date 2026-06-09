@tool
extends RefCounted
## Handles SceneRegion .gs type: bidirectional conversion between .gs data and Godot scene nodes.
##
## Coordinate system:
##   .gs stores pixel coordinates with origin at image top-left (0,0).
##   In Godot, Sprite2D sits at image center. Obstacles/Collision containers
##   are also at image center, so child coordinates = gs_coord - img_center.


func recognize(scene_root: Node) -> Dictionary:
	var result: Dictionary = {"regions": [], "texture": ""}
	var img_center := _get_img_center(scene_root)

	for child: Node in scene_root.get_children():
		if _is_background_sprite(child, scene_root):
			if child.texture:
				result["texture"] = child.texture.resource_path
		elif _is_occlude_container(child, scene_root):
			for area: Node in child.get_children():
				if area is Area2D:
					var region := _extract_occlude_region(area as Area2D, img_center)
					if not region.is_empty():
						result["regions"].append(region)
		elif _is_collision_container(child, scene_root):
			for shape_node: Node in child.get_children():
				var region := _extract_collision_region(shape_node, child.name, img_center)
				if not region.is_empty():
					result["regions"].append(region)

	return result


func apply(regions: Array, scene_root: Node, texture_path: String) -> void:
	var obstacles := _ensure_occlude_container(scene_root)
	var collision := _ensure_collision_container(scene_root)
	_update_background_sprite(scene_root, texture_path)

	var img_center := _get_img_center(scene_root)
	obstacles.position = img_center
	collision.position = img_center

	var occlude_regions: Array = []
	var collision_regions: Array = []
	for r: Dictionary in regions:
		var rtype := int(r.get("type", 0))
		if rtype == 1:
			occlude_regions.append(r)
		elif rtype == 2:
			collision_regions.append(r)

	_sync_occlude_regions(obstacles, occlude_regions, scene_root, img_center)
	_sync_collision_regions(collision, collision_regions, scene_root, img_center)


func create_scene(gs_data: Dictionary, gs_path: String) -> void:
	var data: Dictionary = gs_data.get("data", {})
	var tscn_path := gs_path.replace(".gs", ".tscn")
	var texture_res_path := _resolve_texture(gs_path, data.get("texture", ""))

	var root := Node2D.new()
	root.name = data.get("name", "Scene")
	root.y_sort_enabled = bool(data.get("y_sort", true))

	var sprite := Sprite2D.new()
	sprite.name = "Sprite2D"
	sprite.z_index = -1
	var img_center := Vector2.ZERO
	if not texture_res_path.is_empty() and ResourceLoader.exists(texture_res_path):
		sprite.texture = load(texture_res_path)
		if sprite.texture:
			img_center = sprite.texture.get_size() / 2.0
			sprite.position = img_center
	root.add_child(sprite)
	sprite.owner = root

	var regions: Array = data.get("regions", [])
	var occlude_regions: Array = []
	var collision_regions: Array = []
	for r: Dictionary in regions:
		var rtype := int(r.get("type", 0))
		if rtype == 1:
			occlude_regions.append(r)
		elif rtype == 2:
			collision_regions.append(r)

	if not occlude_regions.is_empty():
		var obstacles := Node2D.new()
		obstacles.name = "Obstacles"
		obstacles.position = img_center
		root.add_child(obstacles)
		obstacles.owner = root
		for region: Dictionary in occlude_regions:
			_create_occlude_node(obstacles, region, root, img_center)

	if not collision_regions.is_empty():
		var collision := StaticBody2D.new()
		collision.name = "Collision"
		collision.position = img_center
		root.add_child(collision)
		collision.owner = root
		for region: Dictionary in collision_regions:
			_create_collision_node(collision, region, root, img_center)

	var packed := PackedScene.new()
	packed.pack(root)
	ResourceSaver.save(packed, tscn_path)
	root.queue_free()


# --- Structure helpers ---

func _is_background_sprite(node: Node, scene_root: Node) -> bool:
	return node is Sprite2D and node.get_parent() == scene_root


func _is_occlude_container(node: Node, scene_root: Node) -> bool:
	return node is Node2D and node.name == &"Obstacles" and node.get_parent() == scene_root


func _is_collision_container(node: Node, scene_root: Node) -> bool:
	return node is StaticBody2D and node.name == &"Collision" and node.get_parent() == scene_root


func _get_img_center(scene_root: Node) -> Vector2:
	for child: Node in scene_root.get_children():
		if _is_background_sprite(child, scene_root) and (child as Sprite2D).texture:
			return child.position
	return Vector2.ZERO


# --- Extract (Godot -> .gs: add img_center) ---

func _extract_occlude_region(area: Area2D, img_center: Vector2) -> Dictionary:
	var region: Dictionary = {
		"name": area.name,
		"type": 1,
		"groups": [] as Array[String],
	}

	for group: StringName in area.get_groups():
		region["groups"].append(String(group))

	for child: Node in area.get_children():
		if child is CollisionPolygon2D:
			region["verts"] = _polygon_to_verts((child as CollisionPolygon2D).polygon, img_center)
			return region
		elif child is CollisionShape2D and (child as CollisionShape2D).shape is RectangleShape2D:
			region["rect"] = _shape_to_rect(child as CollisionShape2D, img_center)
			return region

	return {}


func _extract_collision_region(node: Node, container_name: StringName, img_center: Vector2) -> Dictionary:
	var rname: StringName = node.name
	if rname == &"CollisionPolygon2D" or rname == &"CollisionShape2D":
		rname = container_name

	if node is CollisionPolygon2D:
		return {
			"name": rname,
			"type": 2,
			"verts": _polygon_to_verts((node as CollisionPolygon2D).polygon, img_center),
		}
	elif node is CollisionShape2D and (node as CollisionShape2D).shape is RectangleShape2D:
		return {
			"name": rname,
			"type": 2,
			"rect": _shape_to_rect(node as CollisionShape2D, img_center),
		}
	return {}


# --- Ensure containers ---

func _ensure_occlude_container(scene_root: Node) -> Node2D:
	for child: Node in scene_root.get_children():
		if _is_occlude_container(child, scene_root):
			return child as Node2D
	var obstacles := Node2D.new()
	obstacles.name = "Obstacles"
	scene_root.add_child(obstacles)
	obstacles.owner = scene_root
	return obstacles


func _ensure_collision_container(scene_root: Node) -> StaticBody2D:
	for child: Node in scene_root.get_children():
		if _is_collision_container(child, scene_root):
			return child as StaticBody2D
	var collision := StaticBody2D.new()
	collision.name = "Collision"
	scene_root.add_child(collision)
	collision.owner = scene_root
	return collision


func _update_background_sprite(scene_root: Node, texture_path: String) -> void:
	if texture_path.is_empty():
		return
	for child: Node in scene_root.get_children():
		if _is_background_sprite(child, scene_root):
			if ResourceLoader.exists(texture_path):
				(child as Sprite2D).texture = load(texture_path)
			return


# --- Sync ---

func _sync_occlude_regions(container: Node2D, regions: Array, scene_root: Node, img_center: Vector2) -> void:
	var existing: Dictionary = {}
	for child: Node in container.get_children():
		if child is Area2D:
			existing[child.name] = child

	var processed: Array[StringName] = []
	for region: Dictionary in regions:
		var rname: String = region.get("name", "")
		processed.append(StringName(rname))
		if existing.has(StringName(rname)):
			_update_occlude_node(existing[StringName(rname)] as Area2D, region, img_center)
		else:
			_create_occlude_node(container, region, scene_root, img_center)

	for key: StringName in existing:
		if key not in processed:
			var node: Node = existing[key]
			node.get_parent().remove_child(node)
			node.queue_free()


func _sync_collision_regions(container: StaticBody2D, regions: Array, scene_root: Node, img_center: Vector2) -> void:
	var existing: Dictionary = {}
	for child: Node in container.get_children():
		existing[child.name] = child

	var processed: Array[StringName] = []
	for region: Dictionary in regions:
		var rname: String = region.get("name", "")
		processed.append(StringName(rname))
		if existing.has(StringName(rname)):
			_update_collision_node(existing[StringName(rname)], region, img_center)
		else:
			_create_collision_node(container, region, scene_root, img_center)

	for key: StringName in existing:
		if key not in processed:
			var node: Node = existing[key]
			node.get_parent().remove_child(node)
			node.queue_free()


# --- Create nodes (.gs -> Godot: subtract img_center) ---

func _create_occlude_node(parent: Node, region: Dictionary, owner: Node, img_center: Vector2) -> void:
	var area := Area2D.new()
	area.name = region.get("name", "Region")
	parent.add_child(area)
	area.owner = owner

	for g: String in region.get("groups", []):
		if not g.is_empty():
			area.add_to_group(g, true)

	if region.has("verts"):
		var poly := CollisionPolygon2D.new()
		poly.name = "CollisionPolygon2D"
		poly.polygon = _verts_to_polygon(region.get("verts"), img_center)
		area.add_child(poly)
		poly.owner = owner
	elif region.has("rect"):
		var rect: Array = region.get("rect")
		var shape := RectangleShape2D.new()
		shape.size = Vector2(rect[2], rect[3])
		var shape_node := CollisionShape2D.new()
		shape_node.name = "CollisionShape2D"
		shape_node.shape = shape
		shape_node.position = Vector2(rect[0] + rect[2] / 2.0 - img_center.x, rect[1] + rect[3] / 2.0 - img_center.y)
		area.add_child(shape_node)
		shape_node.owner = owner


func _create_collision_node(parent: Node, region: Dictionary, owner: Node, img_center: Vector2) -> void:
	var rname: String = region.get("name", "Collision")

	if region.has("verts"):
		var poly := CollisionPolygon2D.new()
		poly.name = rname
		poly.polygon = _verts_to_polygon(region.get("verts"), img_center)
		parent.add_child(poly)
		poly.owner = owner
	elif region.has("rect"):
		var rect: Array = region.get("rect")
		var shape := RectangleShape2D.new()
		shape.size = Vector2(rect[2], rect[3])
		var shape_node := CollisionShape2D.new()
		shape_node.name = rname
		shape_node.shape = shape
		shape_node.position = Vector2(rect[0] + rect[2] / 2.0 - img_center.x, rect[1] + rect[3] / 2.0 - img_center.y)
		parent.add_child(shape_node)
		shape_node.owner = owner


# --- Update nodes ---

func _update_occlude_node(area: Area2D, region: Dictionary, img_center: Vector2) -> void:
	var desired_groups: Array[String] = []
	for g: String in region.get("groups", []):
		if not g.is_empty():
			desired_groups.append(g)

	for group: StringName in area.get_groups():
		if String(group) not in desired_groups:
			area.remove_from_group(group)
	for group: String in desired_groups:
		if not area.is_in_group(group):
			area.add_to_group(group, true)

	for child: Node in area.get_children():
		if child is CollisionPolygon2D and region.has("verts"):
			(child as CollisionPolygon2D).polygon = _verts_to_polygon(region.get("verts"), img_center)
			return
		elif child is CollisionShape2D and region.has("rect"):
			var rect: Array = region.get("rect")
			var cs := child as CollisionShape2D
			(cs.shape as RectangleShape2D).size = Vector2(rect[2], rect[3])
			cs.position = Vector2(rect[0] + rect[2] / 2.0 - img_center.x, rect[1] + rect[3] / 2.0 - img_center.y)
			return


func _update_collision_node(node: Node, region: Dictionary, img_center: Vector2) -> void:
	if node is CollisionPolygon2D and region.has("verts"):
		(node as CollisionPolygon2D).polygon = _verts_to_polygon(region.get("verts"), img_center)
	elif node is CollisionShape2D and region.has("rect"):
		var rect: Array = region.get("rect")
		var cs := node as CollisionShape2D
		(cs.shape as RectangleShape2D).size = Vector2(rect[2], rect[3])
		cs.position = Vector2(rect[0] + rect[2] / 2.0 - img_center.x, rect[1] + rect[3] / 2.0 - img_center.y)


# --- Conversion: .gs <-> Godot ---

func _polygon_to_verts(polygon: PackedVector2Array, img_center: Vector2) -> Array:
	var result: Array = []
	for point: Vector2 in polygon:
		result.append([point.x + img_center.x, point.y + img_center.y])
	return result


func _verts_to_polygon(verts: Array, img_center: Vector2) -> PackedVector2Array:
	var result := PackedVector2Array()
	for v: Array in verts:
		result.append(Vector2(v[0] - img_center.x, v[1] - img_center.y))
	return result


func _shape_to_rect(shape_node: CollisionShape2D, img_center: Vector2) -> Array:
	var shape := shape_node.shape as RectangleShape2D
	var pos := shape_node.position
	return [
		pos.x - shape.size.x / 2.0 + img_center.x,
		pos.y - shape.size.y / 2.0 + img_center.y,
		shape.size.x,
		shape.size.y,
	]


func _resolve_texture(gs_path: String, relative: String) -> String:
	if relative.is_empty():
		return ""
	return gs_path.get_base_dir().path_join(relative).simplify_path()
