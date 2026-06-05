@tool
extends Node
## Coordinates .gs file sync: dispatches to type-specific handlers.

const SceneRegionHandler = preload("handlers/scene_region_handler.gd")

var _handlers: Dictionary = {}  # GsType (int) → handler instance
var _self_written_files: Dictionary = {}  # path → write_timestamp
var _last_known_versions: Dictionary = {}  # path → version
var _pending_syncs: Dictionary = {}  # tscn_path → gs_path


func _ready():
	_handlers[1] = SceneRegionHandler.new()


func on_gs_changed(gs_path: String):
	if _is_self_written(gs_path):
		return

	var gs_data = _read_gs_file(gs_path)
	if gs_data.is_empty():
		return

	var gs_type = gs_data.get("type", 0) as int
	var handler = _handlers.get(gs_type)
	if not handler:
		return

	_last_known_versions[gs_path] = gs_data.get("version", 0)

	var tscn_path = gs_path.replace(".gs", ".tscn")

	if not FileAccess.file_exists(tscn_path):
		# First-time generation
		handler.create_scene(gs_data, gs_path)
		EditorInterface.get_resource_filesystem().scan()
		print("[G-Studio] Generated scene: ", tscn_path)
		return

	# Check if scene is currently open
	var open_scenes = EditorInterface.get_open_scenes()
	if tscn_path in open_scenes:
		_sync_to_open_scene(gs_path, gs_data, handler)
	else:
		_pending_syncs[tscn_path] = gs_path


func on_scene_saving():
	var edited_scene = EditorInterface.get_edited_scene_root()
	if not edited_scene:
		return

	var scene_path = edited_scene.scene_file_path
	if not scene_path:
		return

	var gs_path = scene_path.replace(".tscn", ".gs")
	if not FileAccess.file_exists(gs_path):
		return

	var gs_data = _read_gs_file(gs_path)
	if gs_data.is_empty():
		return

	var gs_type = gs_data.get("type", 0) as int
	var handler = _handlers.get(gs_type)
	if not handler:
		return

	# Recognize current scene tree state
	var recognized = handler.recognize(edited_scene)
	if recognized.is_empty():
		return

	# Assign IDs by matching names with existing regions
	var existing_regions = gs_data.get("data", {}).get("regions", [])
	var new_regions = _assign_ids(recognized.get("regions", []), existing_regions)

	# Update data
	gs_data["data"]["regions"] = new_regions

	# Write back with conflict check
	_write_gs(gs_path, gs_data)


func _sync_to_open_scene(gs_path: String, gs_data: Dictionary, handler) -> void:
	var tscn_path = gs_path.replace(".gs", ".tscn")
	var edited = EditorInterface.get_edited_scene_root()
	if not edited or edited.scene_file_path != tscn_path:
		return

	var data = gs_data.get("data", {})
	var regions = data.get("regions", [])
	var texture_path = _resolve_texture_path(gs_path, data.get("texture", ""))
	handler.apply(regions, edited, texture_path)


func _assign_ids(recognized: Array, existing: Array) -> Array:
	var existing_by_name = {}
	for r in existing:
		existing_by_name[r.get("name", "")] = r

	var max_id = 0
	for r in existing:
		var id_str = r.get("id", "r0").replace("r", "")
		var num = id_str.to_int()
		if num > max_id:
			max_id = num

	for region in recognized:
		var name = region.get("name", "")
		if existing_by_name.has(name):
			region["id"] = existing_by_name[name].get("id", "r0")
		else:
			max_id += 1
			region["id"] = "r%d" % max_id

	return recognized


# --- File I/O utilities ---

func _read_gs_file(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f = FileAccess.open(path, FileAccess.READ)
	if not f:
		return {}
	var text = f.get_as_text()
	f.close()
	var json = JSON.new()
	var err = json.parse(text)
	if err != OK:
		push_error("[G-Studio] Failed to parse .gs file: %s" % path)
		return {}
	return json.data if json.data is Dictionary else {}


func _write_gs(path: String, data: Dictionary) -> bool:
	var disk_version = 0
	var current = _read_gs_file(path)
	if not current.is_empty():
		disk_version = current.get("version", 0)

	var expected = _last_known_versions.get(path, 0)
	if disk_version > expected:
		push_warning("[G-Studio] Write conflict on %s: disk=%d, expected=%d" % [path, disk_version, expected])
		return false

	data["version"] = disk_version + 1
	data["gen"] = "godot-plugin/0.1.0"

	var json_text = JSON.stringify(data, "  ")
	var f = FileAccess.open(path, FileAccess.WRITE)
	if not f:
		push_error("[G-Studio] Cannot write to: %s" % path)
		return false
	f.store_string(json_text)
	f.close()

	_last_known_versions[path] = data["version"]
	_mark_self_written(path)
	return true


func _mark_self_written(path: String) -> void:
	_self_written_files[path] = Time.get_unix_time_from_system()


func _is_self_written(path: String) -> bool:
	if not _self_written_files.has(path):
		return false
	var written_at = _self_written_files[path]
	var now = Time.get_unix_time_from_system()
	if now - written_at < 2.0:
		_self_written_files.erase(path)
		return true
	_self_written_files.erase(path)
	return false


func _resolve_texture_path(gs_path: String, relative: String) -> String:
	if relative.is_empty():
		return ""
	var gs_dir = gs_path.get_base_dir()
	var resolved = gs_dir.path_join(relative)
	return resolved.simplify_path()
