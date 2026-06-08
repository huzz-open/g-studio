@tool
extends Node

const SceneRegionHandler = preload("handlers/scene_region_handler.gd")

var _handlers = {}
var _self_written = {}
var _last_known_versions = {}


func _ready():
	_handlers[1] = SceneRegionHandler.new()


func initial_sync(gs_paths):
	var count = 0
	for gs_path in gs_paths:
		var tscn_path = gs_path.replace(".gs", ".tscn")
		var need_gen = false
		if not FileAccess.file_exists(tscn_path):
			need_gen = true
		elif FileAccess.get_modified_time(gs_path) > FileAccess.get_modified_time(tscn_path):
			need_gen = true
		if need_gen:
			if _generate(gs_path):
				count += 1
	if count > 0:
		EditorInterface.get_resource_filesystem().scan()
		print("[G-Studio] Initial sync: generated %d scene(s)" % count)


func on_gs_changed(gs_path):
	if _is_self_written(gs_path):
		return

	if not _generate(gs_path):
		return

	var tscn_path = gs_path.replace(".gs", ".tscn")
	EditorInterface.get_resource_filesystem().scan()

	var open_scenes = EditorInterface.get_open_scenes()
	for i in range(open_scenes.size()):
		if open_scenes[i] == tscn_path:
			_deferred_reload(tscn_path)
			break


func on_scene_saving():
	var edited = EditorInterface.get_edited_scene_root()
	if edited == null:
		return

	var scene_path = edited.scene_file_path
	if scene_path.is_empty():
		return

	var gs_path = scene_path.replace(".tscn", ".gs")
	if not FileAccess.file_exists(gs_path):
		return

	var gs_data = _read_gs(gs_path)
	if gs_data.is_empty():
		return

	var gs_type = int(gs_data.get("type", 0))
	var handler = _handlers.get(gs_type)
	if handler == null:
		return

	var recognized = handler.recognize(edited)
	if recognized.is_empty():
		return

	var existing_regions = gs_data.get("data", {}).get("regions", [])
	var new_regions = _assign_ids(recognized.get("regions", []), existing_regions)

	gs_data["data"]["regions"] = new_regions
	_write_gs(gs_path, gs_data)


func _deferred_reload(tscn_path):
	get_tree().create_timer(0.3).timeout.connect(_do_reload.bind(tscn_path))


func _do_reload(tscn_path):
	EditorInterface.reload_scene_from_path(tscn_path)


func _generate(gs_path):
	var gs_data = _read_gs(gs_path)
	if gs_data.is_empty():
		return false

	var gs_type = int(gs_data.get("type", 0))
	var handler = _handlers.get(gs_type)
	if handler == null:
		return false

	_last_known_versions[gs_path] = gs_data.get("version", 0)
	handler.create_scene(gs_data, gs_path)

	var tscn_path = gs_path.replace(".gs", ".tscn")
	print("[G-Studio] Generated: ", tscn_path)
	return true


func _assign_ids(recognized, existing):
	var by_name = {}
	for r in existing:
		by_name[r.get("name", "")] = r

	var max_id = 0
	for r in existing:
		var num = r.get("id", "r0").replace("r", "").to_int()
		if num > max_id:
			max_id = num

	for region in recognized:
		var rname = region.get("name", "")
		if by_name.has(rname):
			region["id"] = by_name[rname].get("id", "r0")
		else:
			max_id += 1
			region["id"] = "r%d" % max_id

	return recognized


func _read_gs(path):
	if not FileAccess.file_exists(path):
		return {}
	var f = FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var text = f.get_as_text()
	f.close()
	var json = JSON.new()
	if json.parse(text) != OK:
		push_error("[G-Studio] Failed to parse: %s" % path)
		return {}
	if json.data is Dictionary:
		return json.data
	return {}


func _write_gs(path, data):
	var disk_version = 0
	var current = _read_gs(path)
	if not current.is_empty():
		disk_version = int(current.get("version", 0))

	var expected = _last_known_versions.get(path, 0)
	if int(disk_version) > int(expected):
		push_warning("[G-Studio] Write conflict on %s: disk=%d expected=%d" % [path, disk_version, expected])
		return false

	data["version"] = disk_version + 1
	data["gen"] = "godot-plugin/0.1.0"

	var json_text = JSON.stringify(data, "  ")
	var f = FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_error("[G-Studio] Cannot write: %s" % path)
		return false
	f.store_string(json_text)
	f.close()

	_last_known_versions[path] = data["version"]
	_mark_self_written(path)
	return true


func _mark_self_written(path):
	_self_written[path] = Time.get_unix_time_from_system()


func _is_self_written(path):
	if not _self_written.has(path):
		return false
	var age = Time.get_unix_time_from_system() - _self_written[path]
	_self_written.erase(path)
	return age < 2.0
